import { CliError } from "@wirecat/cli-base"
import { type EventSink, providerRequest, wallClock } from "@wirecat/cli-core/cli"
import type { CdrRows } from "../call-source.js"
import type { FileAccess } from "../files.js"
import type { SourceConfig } from "../source.js"
import { csvRows } from "./csv.js"
import { type CdrRow, cdrRow, type RawRow } from "./record.js"
import type { SqlCdr, SqlSource } from "./sql.js"

/** Larger than years of a busy office's calls; past it, a database source reads in pages instead. */
export const LARGEST_CSV = 512 * 1024 * 1024

export interface CdrReader extends CdrRows {
  close(): Promise<void>
}

const normalized = (raw: readonly RawRow[], zone: string, since: number) => {
  const rows: CdrRow[] = []
  let skipped = 0
  for (const one of raw) {
    try {
      const row = cdrRow(one, zone)
      if (row.start >= since) rows.push(row)
    } catch {
      skipped++
    }
  }
  return { rows, skipped }
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
        let text: string
        try {
          text = new TextDecoder().decode(await files.read(cdr.path, LARGEST_CSV))
        } catch (error) {
          done({ error })
          throw error
        }
        const read = csvRows(text, cdr.columns ?? undefined)
        const kept = normalized(read.rows, zone, since)
        done({ counts: { rows: read.rows.length, kept: kept.rows.length } })
        return { rows: kept.rows, skipped: kept.skipped + read.skipped }
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
