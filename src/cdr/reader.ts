import { CliError } from "@wirecat/cli-base"
import { type EventSink, providerRequest, wallClock } from "@wirecat/cli-core/cli"
import type { CdrRows } from "../call-source.js"
import type { FileAccess } from "../files.js"
import type { SourceConfig } from "../source.js"
import { csvParser, csvTable } from "./csv.js"
import { type CdrRow, cdrRow, type RawRow, timeIn } from "./record.js"
import type { SqlCdr, SqlSource } from "./sql.js"

export interface CdrReader extends CdrRows {
  close(): Promise<void>
}

const normalizer = (zone: string, since: number) => {
  const rows: CdrRow[] = []
  let skipped = 0
  return {
    rows,
    // The start alone first: in a large Master.csv most rows are older than the sync, and reading a whole row in its
    // zone costs several times more.
    keep: (one: RawRow) => {
      const start = timeIn(one.start ?? one.calldate, zone)
      if (start === null) skipped++
      else if (start >= since) rows.push(cdrRow(one, zone))
    },
    skipped: () => skipped,
  }
}

const normalized = (raw: readonly RawRow[], zone: string, since: number) => {
  const kept = normalizer(zone, since)
  for (const one of raw) kept.keep(one)
  return { rows: kept.rows, skipped: kept.skipped() }
}

/** Master.csv read piece by piece: only the rows since `since` stay in memory, never the file's text. */
const csvFileRows = async (
  files: FileAccess,
  { path, columns }: { path: string; columns: readonly string[] | undefined },
  zone: string,
  since: number,
) => {
  const parser = csvParser()
  const table = csvTable(columns)
  const kept = normalizer(zone, since)
  const take = (lines: readonly string[][]) => {
    for (const line of lines) {
      const raw = table.row(line)
      if (raw) kept.keep(raw)
    }
  }
  const decoder = new TextDecoder()
  for await (const piece of files.stream(path)) take(parser.push(decoder.decode(piece, { stream: true })))
  take(parser.push(decoder.decode()))
  take(parser.end())
  const read = table.end()
  return { rows: kept.rows, read: read.rows, skipped: read.skipped + kept.skipped() }
}

/** The profile's call records, from Master.csv through `files`, or from the CDR table with `password`. */
export const cdrReader = async (
  source: SourceConfig,
  files: FileAccess,
  {
    password,
    events,
    signal,
    sql: open,
  }: {
    password?: string | undefined
    events?: EventSink
    signal?: AbortSignal
    sql?: (source: SqlSource, password: string) => Promise<SqlCdr>
  },
): Promise<CdrReader> => {
  const { cdr, zone } = source
  if (cdr.kind === "csv")
    return {
      rows: async (since) => {
        const done = providerRequest("cdr.read", events)
        try {
          const { rows, read, skipped } = await csvFileRows(
            files,
            { path: cdr.path, columns: cdr.columns ?? undefined },
            zone,
            since,
          )
          done({ counts: { rows: read, kept: rows.length } })
          return { rows, skipped }
        } catch (error) {
          done({ error })
          throw error
        }
      },
      close: async () => {},
    }
  if (!password)
    throw new CliError("authentication_error", "this profile has no database password yet; run session start", {
      reason: "profile.not-signed-in",
    })
  const sql = open
    ? await open(cdr, password)
    : await (await import("./sql.js")).sqlCdr(cdr, password, { events, signal })
  return {
    rows: async (since) => {
      const utc = new Date(since).toISOString()
      return normalized(await sql.rows({ wall: `${wallClock(zone).time(utc)}:00`, utc }), zone, since)
    },
    close: () => sql.close(),
  }
}
