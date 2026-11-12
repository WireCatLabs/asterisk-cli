import { beforeEach, expect, it, vi } from "vitest"
import { type SqlSource, sqlCdr } from "./sql.js"

const PAGE = 5_000

const db = vi.hoisted(() => ({
  statements: [] as { sql: string; params?: unknown[] }[],
  options: {} as Record<string, unknown>,
  columns: ["calldate", "src", "uniqueid"],
  pages: [] as unknown[][],
  fail: {} as Partial<Record<"connect" | "columns" | "page", unknown>>,
  closed: 0,
}))

const answer = async (sql: string, params?: unknown[]) => {
  db.statements.push({ sql, ...(params ? { params } : {}) })
  if (sql.endsWith("LIMIT 0")) {
    if (db.fail.columns) throw db.fail.columns
    return db.columns.map((name) => ({ name }))
  }
  if (!sql.startsWith("SELECT")) return []
  if (db.fail.page) throw db.fail.page
  return db.pages.shift() ?? []
}

vi.mock("mysql2/promise", () => ({
  createConnection: async (options: Record<string, unknown>) => {
    db.options = options
    if (db.fail.connect) throw db.fail.connect
    return {
      query: async (query: string | { sql: string }, params?: unknown[]) => {
        const sql = typeof query === "string" ? query : query.sql
        const rows = await answer(sql, params)
        return sql.endsWith("LIMIT 0") ? [[], rows] : [rows]
      },
      end: async () => {
        db.closed++
      },
    }
  },
}))

vi.mock("pg", () => {
  class Client {
    constructor(options: Record<string, unknown>) {
      db.options = options
    }
    async connect() {
      if (db.fail.connect) throw db.fail.connect
    }
    async query(sql: string, params?: unknown[]) {
      const rows = await answer(sql, params)
      return sql.endsWith("LIMIT 0") ? { fields: rows } : { rows }
    }
    async end() {
      db.closed++
    }
  }
  return { default: { Client, types: { getTypeParser: () => (value: string) => `parsed ${value}` } } }
})

const source = (kind: SqlSource["kind"], overrides: Partial<SqlSource> = {}): SqlSource => ({
  kind,
  host: "pbx.example.test",
  port: null,
  database: "asteriskcdrdb",
  user: "reader",
  table: "asteriskcdrdb.cdr",
  tls: false,
  ...overrides,
})

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ uniqueid: `1761901200.${index}` }))

beforeEach(() => {
  db.statements = []
  db.options = {}
  db.columns = ["calldate", "src", "uniqueid"]
  db.pages = []
  db.fail = {}
  db.closed = 0
})

it("mysql opens a read-only session and reads every page from the cursor, ordered by time and uniqueid", async () => {
  db.pages = [rows(PAGE), rows(3)]
  const cdr = await sqlCdr(source("mysql", { tls: true }), "pw")
  expect(await cdr.rows("2026-10-31 06:30:00")).toHaveLength(PAGE + 3)
  await cdr.close()
  expect(db.options).toMatchObject({ port: 3306, dateStrings: true, ssl: { rejectUnauthorized: true } })
  expect(db.statements.map(({ sql }) => sql)).toEqual([
    "SET SESSION TRANSACTION READ ONLY",
    "SELECT * FROM `asteriskcdrdb`.`cdr` LIMIT 0",
    `SELECT * FROM \`asteriskcdrdb\`.\`cdr\` WHERE \`calldate\` >= ? ORDER BY \`calldate\`, \`uniqueid\` LIMIT ${PAGE} OFFSET 0`,
    `SELECT * FROM \`asteriskcdrdb\`.\`cdr\` WHERE \`calldate\` >= ? ORDER BY \`calldate\`, \`uniqueid\` LIMIT ${PAGE} OFFSET ${PAGE}`,
  ])
  expect(db.statements[2]?.params).toEqual(["2026-10-31 06:30:00"])
  expect(db.closed).toBe(1)
})

it("postgres asks for a read-only transaction and keeps a timestamp without zone as its wall time", async () => {
  db.columns = ["start", "src"]
  db.pages = [rows(1)]
  const cdr = await sqlCdr(source("postgres", { table: "cdr" }), "pw")
  expect(await cdr.rows("2026-10-31 06:30:00")).toHaveLength(1)
  expect(db.options).toMatchObject({ port: 5432, options: "-c default_transaction_read_only=on" })
  expect(db.statements.at(-1)?.sql).toBe(
    `SELECT * FROM "cdr" WHERE "start" >= $1 ORDER BY "start" LIMIT ${PAGE} OFFSET 0`,
  )
  const parser = (db.options.types as { getTypeParser: (oid: number) => (value: string) => unknown }).getTypeParser
  expect(parser(1114)("2026-10-31 09:30:00")).toBe("2026-10-31 09:30:00")
  expect(parser(23)("1")).toBe("parsed 1")
})

it.each([
  [{ code: "ER_ACCESS_DENIED_ERROR" }, "authentication_error", "db.refused"],
  [{ code: "3D000" }, "not_found", "db.no-database"],
  [{ code: "ECONNREFUSED" }, "network_error", undefined],
  [{ code: "ETIMEDOUT" }, "timeout", undefined],
  [{ code: "XX000" }, "provider_error", undefined],
])("a refused connection %j is %s, without the driver's text", async (error, code, reason) => {
  db.fail.connect = Object.assign(new Error("Access denied for user 'reader'@'pbx.example.test'"), error)
  const opened = sqlCdr(source("postgres"), "pw")
  await expect(opened).rejects.toMatchObject({ code, ...(reason ? { details: { reason } } : {}) })
  await expect(opened).rejects.not.toThrow(/reader|pbx\.example/)
})

it("a missing table, a table without a time column and a denied SELECT say what to change", async () => {
  db.fail.columns = Object.assign(new Error("no such table"), { code: "ER_NO_SUCH_TABLE" })
  await expect((await sqlCdr(source("mysql"), "pw")).rows("2026-10-31 06:30:00")).rejects.toMatchObject({
    details: { reason: "db.no-table" },
  })
  db.fail = {}
  db.columns = ["src", "dst"]
  await expect((await sqlCdr(source("mysql"), "pw")).rows("2026-10-31 06:30:00")).rejects.toMatchObject({
    details: { reason: "cdr.no-time-column" },
  })
  db.columns = ["calldate"]
  db.fail.page = Object.assign(new Error("permission denied for table cdr"), { code: "42501" })
  await expect((await sqlCdr(source("postgres"), "pw")).rows("2026-10-31 06:30:00")).rejects.toMatchObject({
    code: "permission_error",
    details: { reason: "db.no-select" },
  })
})

it("a stopped run closes the connection and reads no further page", async () => {
  const stop = new AbortController()
  const cdr = await sqlCdr(source("mysql"), "pw", { signal: stop.signal })
  stop.abort()
  await expect(cdr.rows("2026-10-31 06:30:00")).rejects.toMatchObject({ code: "cancelled" })
  expect(db.closed).toBe(1)
})
