import { CliError, isCliError } from "@wirecat/cli-base"
import { type EventSink, providerRequest } from "@wirecat/cli-core/cli"
import type { RawRow } from "./record.js"

export interface SqlSource {
  kind: "mysql" | "postgres"
  host: string
  port: number | null
  database: string
  user: string
  table: string
  tls: boolean
}

/** A moment twice: the wall time in the CDR zone, for a column without a zone, and UTC, for one with a zone. */
export interface Since {
  wall: string
  utc: string
}

/** What a SQL backend answers: the rows that started at `since` or later, oldest first. */
export interface SqlCdr {
  rows(since: Since): Promise<RawRow[]>
  close(): Promise<void>
}

const CONNECT_MS = 15_000
const QUERY_MS = 120_000
/** Read in pages, so a first import of years of calls never holds one answer of millions of rows. */
const PAGE = 5_000

const quoted = (kind: SqlSource["kind"], table: string) =>
  table
    .split(".")
    .map((part) => (kind === "mysql" ? `\`${part}\`` : `"${part}"`))
    .join(".")

/** `calldate` is what cdr_mysql, cdr_pgsql and FreePBX name the start; cdr_adaptive_odbc may keep `start`. */
const timeColumn = (columns: readonly Column[]) => {
  const named = columns.find(({ name }) => ["calldate", "start"].includes(name.toLowerCase()))
  if (!named)
    throw new CliError("invalid_response", "the CDR table has neither a calldate nor a start column", {
      reason: "cdr.no-time-column",
    })
  return named
}

/** A driver's refusal, without its text: it can quote the host, the user or the statement (WC-SECR-6). */
const failureOf = (source: SqlSource, error: unknown): CliError => {
  if (isCliError(error)) return error
  const code = String((error as { code?: unknown }).code ?? "")
  const where = `the ${source.kind} server`
  if (["ER_ACCESS_DENIED_ERROR", "28P01", "28000"].includes(code))
    return new CliError("authentication_error", `${where} refused the user or password`, { reason: "db.refused" })
  if (["ER_BAD_DB_ERROR", "3D000"].includes(code))
    return new CliError("not_found", `${where} has no database ${source.database}`, { reason: "db.no-database" })
  if (["ER_NO_SUCH_TABLE", "42P01"].includes(code))
    return new CliError("not_found", `the database has no table ${source.table}; set db_table`, {
      reason: "db.no-table",
    })
  if (["ER_TABLEACCESS_DENIED_ERROR", "42501"].includes(code))
    return new CliError("permission_error", `the user may not read ${source.table}; grant it SELECT`, {
      reason: "db.no-select",
    })
  if (["ETIMEDOUT", "PROTOCOL_SEQUENCE_TIMEOUT"].includes(code) || /timeout/i.test(String(error)))
    return new CliError("timeout", `${where} did not answer in time`, { retryable: true })
  if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET", "EAI_AGAIN"].includes(code))
    return new CliError("network_error", `${where} could not be reached`, { retryable: true })
  return new CliError("provider_error", `${where} failed the query (${code || "no code"})`, { retryable: false })
}

interface Column {
  name: string
  zoned: boolean
}

interface Driver {
  columns(): Promise<Column[]>
  page(sql: string, params: unknown[]): Promise<RawRow[]>
  close(): Promise<void>
}

const mysqlDriver = async (source: SqlSource, password: string): Promise<Driver> => {
  const { createConnection } = await import("mysql2/promise")
  const connection = await createConnection({
    host: source.host,
    port: source.port ?? 3306,
    user: source.user,
    password,
    database: source.database,
    connectTimeout: CONNECT_MS,
    // DATETIME stays the wall time it is; the CDR zone reads it, not this computer's zone.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    ...(source.tls ? { ssl: { rejectUnauthorized: true } } : {}),
  })
  await connection.query("SET SESSION TRANSACTION READ ONLY").catch(async (error: unknown) => {
    await connection.end().catch(() => undefined)
    throw error
  })
  return {
    columns: async () => {
      const [, fields] = await connection.query({ sql: `SELECT * FROM ${quoted("mysql", source.table)} LIMIT 0` })
      return (fields ?? []).map((field) => ({ name: field.name, zoned: false }))
    },
    page: async (sql, params) => {
      const [rows] = await connection.query({ sql, timeout: QUERY_MS }, params)
      return rows as RawRow[]
    },
    close: () => connection.end(),
  }
}

const TIMESTAMP_WITHOUT_ZONE = 1114
const TIMESTAMP_WITH_ZONE = 1184

const postgresDriver = async (source: SqlSource, password: string): Promise<Driver> => {
  const { default: pg } = await import("pg")
  const client = new pg.Client({
    host: source.host,
    port: source.port ?? 5432,
    user: source.user,
    password,
    database: source.database,
    connectionTimeoutMillis: CONNECT_MS,
    query_timeout: QUERY_MS,
    statement_timeout: QUERY_MS,
    options: "-c default_transaction_read_only=on",
    ...(source.tls ? { ssl: { rejectUnauthorized: true } } : {}),
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        oid === TIMESTAMP_WITHOUT_ZONE
          ? (value: string) => value
          : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
    },
  })
  await client.connect()
  return {
    columns: async () =>
      (await client.query(`SELECT * FROM ${quoted("postgres", source.table)} LIMIT 0`)).fields.map(
        ({ name, dataTypeID }) => ({ name, zoned: dataTypeID === TIMESTAMP_WITH_ZONE }),
      ),
    page: async (sql, params) => (await client.query(sql, params)).rows as RawRow[],
    close: () => client.end(),
  }
}

/**
 * The CDR table, read only: the session is opened read-only, and the one statement is a SELECT whose table name was
 * checked as an identifier by the settings and whose values are parameters. Each page is a request in the run.
 */
export const sqlCdr = async (
  source: SqlSource,
  password: string,
  { events, signal }: { events?: EventSink | undefined; signal?: AbortSignal | undefined } = {},
): Promise<SqlCdr> => {
  const opened = providerRequest("cdr.connect", events)
  let driver: Driver
  try {
    driver = await (source.kind === "mysql" ? mysqlDriver : postgresDriver)(source, password)
    opened()
  } catch (error) {
    const failure = failureOf(source, error)
    opened({ error: failure })
    throw failure
  }
  const stop = () => void driver.close().catch(() => undefined)
  signal?.addEventListener("abort", stop, { once: true })
  const table = quoted(source.kind, source.table)
  const mark = (index: number) => (source.kind === "mysql" ? "?" : `$${index}`)
  return {
    rows: async (since) => {
      const done = providerRequest("cdr.columns", events)
      let time: Column
      let key: string[]
      try {
        const columns = await driver.columns()
        time = timeColumn(columns)
        const names = new Set(columns.map(({ name }) => name))
        // The legs of one transfer share their time and uniqueid; only the sequence tells them apart in the order.
        key = names.has("uniqueid") && names.has("sequence") ? [time.name, "uniqueid", "sequence"] : [time.name]
        done()
      } catch (error) {
        const failure = failureOf(source, error)
        done({ error: failure })
        throw failure
      }
      const at = quoted(source.kind, time.name)
      const order = key.map((name) => quoted(source.kind, name)).join(", ")
      const bound = time.zoned ? since.utc : since.wall
      const rows: RawRow[] = []
      let last: RawRow | undefined
      for (let offset = 0; ; offset += PAGE) {
        if (signal?.aborted) throw new CliError("cancelled", "the CDR read was stopped")
        // A full key pages by the last row seen, so a row written during the read never shifts a page; a time alone
        // is not unique, and pages by offset.
        const after = last && key.length > 1
        const where = after
          ? `${at} >= ${mark(1)} AND (${order}) > (${key.map((_, index) => mark(index + 2)).join(", ")})`
          : `${at} >= ${mark(1)}`
        const params = after ? [bound, ...key.map((name) => last?.[name] ?? null)] : [bound]
        const read = providerRequest("cdr.rows", events)
        try {
          const page = await driver.page(
            `SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ${PAGE}${key.length > 1 ? "" : ` OFFSET ${offset}`}`,
            params,
          )
          read({ counts: { rows: page.length } })
          for (const row of page) rows.push(row)
          last = page.at(-1)
          if (page.length < PAGE) return rows
        } catch (error) {
          const failure = failureOf(source, error)
          read({ error: failure })
          throw failure
        }
      }
    },
    close: async () => {
      signal?.removeEventListener("abort", stop)
      await driver.close()
    },
  }
}
