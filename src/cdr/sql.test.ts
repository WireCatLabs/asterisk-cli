import type { EventSink } from "@wirecat/cli-core/cli"
import type { SqlDriver } from "@wirecat/cli-core/sql"
import { beforeEach, expect, it } from "vitest"
import { type SqlSource, sqlCdr } from "./sql.js"

const PAGE = 5_000
const SINCE = { wall: "2026-10-31 06:30:00", utc: "2026-10-31T03:30:00.000Z" }

const db = {
  statements: [] as { sql: string; params?: readonly unknown[] }[],
  columns: ["calldate", "src", "uniqueid"],
  zoned: "",
  pages: [] as Record<string, unknown>[][],
  fail: {} as Partial<Record<"connect" | "columns" | "page", unknown>>,
  closed: 0,
}

/** cli-core's driver seam, in place of mysql2 and pg: the statements cli-core sends for the CDR's schema. */
const driver = async (): Promise<SqlDriver> => {
  if (db.fail.connect) throw db.fail.connect
  return {
    columns: async (sql) => {
      db.statements.push({ sql })
      if (db.fail.columns) throw db.fail.columns
      return db.columns.map((name) => ({ name, zoned: name === db.zoned }))
    },
    query: async (sql, params) => {
      db.statements.push({ sql, params })
      if (db.fail.page) throw db.fail.page
      return db.pages.shift() ?? []
    },
    close: async () => {
      db.closed++
    },
  }
}

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
  db.columns = ["calldate", "src", "uniqueid"]
  db.zoned = ""
  db.pages = []
  db.fail = {}
  db.closed = 0
})

it("reads every page from the cursor, by offset when only the time orders, each page a sql event", async () => {
  db.pages = [rows(PAGE), rows(3)]
  const events: Parameters<EventSink>[0][] = []
  const cdr = await sqlCdr(source("mysql"), "pw", { driver, events: (event) => events.push(event) })
  expect(await cdr.rows(SINCE)).toHaveLength(PAGE + 3)
  await cdr.close()
  expect(db.statements.map(({ sql }) => sql)).toEqual([
    "SELECT * FROM `asteriskcdrdb`.`cdr` LIMIT 0",
    `SELECT * FROM \`asteriskcdrdb\`.\`cdr\` WHERE \`calldate\` >= ? ORDER BY \`calldate\` LIMIT ${PAGE} OFFSET 0`,
    `SELECT * FROM \`asteriskcdrdb\`.\`cdr\` WHERE \`calldate\` >= ? ORDER BY \`calldate\` LIMIT ${PAGE} OFFSET ${PAGE}`,
  ])
  expect(db.statements[1]?.params).toEqual(["2026-10-31 06:30:00"])
  expect(db.closed).toBe(1)
  const operations = events.map((event) => (event as { operation?: string }).operation).filter(Boolean)
  expect(new Set(operations)).toEqual(new Set(["sql.connect", "sql.columns", "sql.rows"]))
})

it("with uniqueid and sequence, a page starts after the last row seen, so a transfer's legs are never skipped", async () => {
  db.columns = ["calldate", "uniqueid", "sequence"]
  const full = rows(PAGE).map((row, index) => ({ ...row, calldate: "2026-10-31 12:00:00", sequence: String(index) }))
  db.pages = [full, rows(1)]
  const cdr = await sqlCdr(source("postgres", { table: "cdr" }), "pw", { driver })
  expect(await cdr.rows(SINCE)).toHaveLength(PAGE + 1)
  const last = db.statements.at(-1)
  expect(last?.sql).toBe(
    `SELECT * FROM "cdr" WHERE "calldate" >= $1 AND ("calldate", "uniqueid", "sequence") > ($2, $3, $4) ORDER BY "calldate", "uniqueid", "sequence" LIMIT ${PAGE}`,
  )
  expect(last?.params).toEqual([SINCE.wall, "2026-10-31 12:00:00", `1761901200.${PAGE - 1}`, String(PAGE - 1)])
})

it("a timestamp with time zone is asked in UTC, since the server reads a bare time in its own zone", async () => {
  db.zoned = "calldate"
  db.pages = [rows(1)]
  await (await sqlCdr(source("postgres", { table: "cdr" }), "pw", { driver })).rows(SINCE)
  expect(db.statements.at(-1)?.params).toEqual([SINCE.utc])
})

it("a table that names its start `start` is read by it", async () => {
  db.columns = ["start", "src"]
  db.pages = [rows(1)]
  const cdr = await sqlCdr(source("postgres", { table: "cdr" }), "pw", { driver })
  expect(await cdr.rows(SINCE)).toHaveLength(1)
  expect(db.statements.at(-1)?.sql).toBe(
    `SELECT * FROM "cdr" WHERE "start" >= $1 ORDER BY "start" LIMIT ${PAGE} OFFSET 0`,
  )
})

it.each([
  [{ code: "ER_ACCESS_DENIED_ERROR" }, "authentication_error", "db.refused"],
  [{ code: "3D000" }, "not_found", "db.no-database"],
  [{ code: "ECONNREFUSED" }, "network_error", undefined],
  [{ code: "ETIMEDOUT" }, "timeout", undefined],
  [{ code: "XX000" }, "provider_error", undefined],
])("a refused connection %j is %s, without the driver's text", async (error, code, reason) => {
  db.fail.connect = Object.assign(new Error("Access denied for user 'reader'@'pbx.example.test'"), error)
  const opened = sqlCdr(source("postgres"), "pw", { driver })
  await expect(opened).rejects.toMatchObject({ code, ...(reason ? { details: { reason } } : {}) })
  await expect(opened).rejects.not.toThrow(/reader|Access denied/)
})

it("a missing table, a table without a time column and a denied SELECT say what to change", async () => {
  db.fail.columns = Object.assign(new Error("no such table"), { code: "ER_NO_SUCH_TABLE" })
  const missing = (await sqlCdr(source("mysql"), "pw", { driver })).rows(SINCE)
  await expect(missing).rejects.toMatchObject({ details: { reason: "db.no-table" } })
  await expect(missing).rejects.toThrow("set db_table")
  db.fail = {}
  db.columns = ["src", "dst"]
  await expect((await sqlCdr(source("mysql"), "pw", { driver })).rows(SINCE)).rejects.toMatchObject({
    details: { reason: "cdr.no-time-column" },
  })
  db.columns = ["calldate"]
  db.fail.page = Object.assign(new Error("permission denied for table cdr"), { code: "42501" })
  const denied = (await sqlCdr(source("postgres"), "pw", { driver })).rows(SINCE)
  await expect(denied).rejects.toMatchObject({ code: "permission_error", details: { reason: "db.no-select" } })
  await expect(denied).rejects.toThrow("grant it SELECT")
})

it("a stopped run closes the connection and reads no further page", async () => {
  const stop = new AbortController()
  const cdr = await sqlCdr(source("mysql"), "pw", { driver, signal: stop.signal })
  stop.abort()
  await expect(cdr.rows(SINCE)).rejects.toMatchObject({ code: "cancelled" })
  expect(db.closed).toBe(1)
})

it("a tunnel's stream is handed to the driver in place of a connection of its own", async () => {
  const stream = { tunnel: true } as never
  let given: unknown
  const cdr = await sqlCdr(source("mysql"), "pw", {
    socket: async () => stream,
    driver: async (_options, socket) => {
      given = socket
      return driver()
    },
  })
  await cdr.close()
  expect(given).toBe(stream)
})
