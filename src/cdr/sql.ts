import type { Duplex } from "node:stream"
import { CliError, isCliError } from "@wirecat/cli-base"
import type { EventSink } from "@wirecat/cli-core/cli"
import type { SqlColumn, SqlDriver, SqlOptions } from "@wirecat/cli-core/sql"
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
  /** FreePBX's extension names; empty on any other server, null when the user may not read them. */
  names?(): Promise<Map<string, string> | null>
  close(): Promise<void>
}

export interface SqlCdrOptions {
  events?: EventSink | undefined
  signal?: AbortSignal | undefined
  /** A tunnel's stream to the database, for one that listens only on its own server. */
  socket?: (() => Promise<Duplex>) | undefined
  /** A seam for tests: the driver in place of mysql2 or pg. */
  driver?: ((options: SqlOptions, socket: Duplex | undefined) => Promise<SqlDriver>) | undefined
}

/** `calldate` is what cdr_mysql, cdr_pgsql and FreePBX name the start; cdr_adaptive_odbc may keep `start`. */
const timeColumn = (columns: readonly SqlColumn[]) => {
  const named = columns.find(({ name }) => ["calldate", "start"].includes(name.toLowerCase()))
  if (!named)
    throw new CliError("invalid_response", "the CDR table has neither a calldate nor a start column", {
      reason: "cdr.no-time-column",
    })
  return named
}

/** cli-core words its refusals for any table; these name the setting or the grant that fixes a CDR read. */
const worded = (source: SqlSource, error: unknown) => {
  if (!isCliError(error)) return error
  const reason = error.details.reason
  if (reason === "db.no-table")
    return new CliError("not_found", `the database has no table ${source.table}; set db_table`, { reason })
  if (reason === "db.no-database")
    return new CliError("not_found", `the ${source.kind} server has no database ${source.database}; set db_name`, {
      reason,
    })
  if (reason === "db.no-select")
    return new CliError("permission_error", `the user may not read ${source.table}; grant it SELECT`, { reason })
  return error
}

/**
 * The CDR table through cli-core's read-only SQL reader: this keeps only Asterisk's schema, the start column, the
 * order that tells a transfer's legs apart, and which form of `since` the column compares with.
 */
export const sqlCdr = async (source: SqlSource, password: string, options: SqlCdrOptions = {}): Promise<SqlCdr> => {
  const { openSqlReader } = await import("@wirecat/cli-core/sql")
  const reader = await openSqlReader({
    kind: source.kind,
    host: source.host,
    port: source.port,
    database: source.database,
    user: source.user,
    password,
    tls: source.tls,
    ...(options.socket ? { socket: options.socket } : {}),
    ...(options.events ? { events: options.events } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.driver ? { driver: options.driver } : {}),
  }).catch((error: unknown) => {
    throw worded(source, error)
  })
  return {
    rows: async (since) => {
      try {
        const columns = await reader.columns(source.table)
        const time = timeColumn(columns)
        const names = new Set(columns.map(({ name }) => name))
        // The legs of one transfer share their time and uniqueid; only the sequence tells them apart in the order.
        const unique = names.has("uniqueid") && names.has("sequence")
        const rows: RawRow[] = []
        for await (const page of reader.pages({
          table: source.table,
          where: [{ column: time.name, op: ">=", value: time.zoned ? since.utc : since.wall }],
          orderBy: unique ? [time.name, "uniqueid", "sequence"] : [time.name],
          unique,
        }))
          for (const row of page) rows.push(row as RawRow)
        return rows
      } catch (error) {
        throw worded(source, error)
      }
    },
    names: async () => {
      if (source.kind !== "mysql") return new Map()
      try {
        // Only these two columns: the table also keeps each extension's secrets, which the admin grants no access to.
        const rows = await reader.query("SELECT extension, name FROM asterisk.users")
        return new Map(
          rows.flatMap((row) => {
            const extension = String(row.extension ?? "").trim()
            const name = String(row.name ?? "").trim()
            return extension && name && name !== extension ? [[extension, name] as const] : []
          }),
        )
      } catch (error) {
        const reason = isCliError(error) ? error.details.reason : undefined
        // No such database or table: not a FreePBX, which has nothing to say.
        return reason === "db.no-database" || reason === "db.no-table" ? new Map() : null
      }
    },
    close: () => reader.close(),
  }
}
