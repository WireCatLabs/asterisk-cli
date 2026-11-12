import { createHash } from "node:crypto"
import { CliError } from "@wirecat/cli-base"
import { localMoment } from "@wirecat/cli-core/calendar"

/**
 * One CDR row, by the field names of Asterisk's CDR specification
 * (https://docs.asterisk.org/Configuration/Reporting/Call-Detail-Records-CDR/CDR-Specification/). Every field but the
 * start may be missing: which ones a row has depends on the backend and its settings.
 */
export interface CdrRow {
  /** The row's own id: never two rows with one id, and the same id for the same row on every read. */
  id: string
  uniqueid: string | null
  linkedid: string | null
  sequence: number | null
  start: number
  answer: number | null
  end: number | null
  durationMs: number | null
  billMs: number | null
  src: string | null
  dst: string | null
  clid: string | null
  dcontext: string | null
  channel: string | null
  dstchannel: string | null
  lastapp: string | null
  disposition: string | null
  accountcode: string | null
  userfield: string | null
  /** FreePBX's `recordingfile` column: the recording's file name, or its path under the monitor folder. */
  recordingfile: string | null
}

/** The fields a row is read from, by their CDR names; `calldate` is the SQL backends' name for the start. */
export const CDR_FIELDS = [
  "accountcode",
  "src",
  "dst",
  "dcontext",
  "clid",
  "channel",
  "dstchannel",
  "lastapp",
  "lastdata",
  "start",
  "answer",
  "end",
  "duration",
  "billsec",
  "disposition",
  "amaflags",
  "uniqueid",
  "userfield",
  "peeraccount",
  "linkedid",
  "sequence",
  "calldate",
  "recordingfile",
] as const

export type RawRow = Partial<Record<string, string | number | Date | null>>

const textOf = (value: RawRow[string]): string | null => {
  if (value === null || value === undefined) return null
  const text = value instanceof Date ? value.toISOString() : String(value).trim()
  return text === "" ? null : text
}

const numberOf = (value: RawRow[string]): number | null => {
  const text = textOf(value)
  if (text === null || !/^-?\d+$/.test(text)) return null
  return Number(text)
}

/** `2026-10-31 14:05:09` read in `zone` (WC-TIME-3), as UTC milliseconds; a `Date` from a driver is already a moment. */
export const timeIn = (value: RawRow[string], zone: string): number | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  const found = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/.exec(textOf(value) ?? "")
  // MySQL keeps an unanswered call's answer time as 0000-00-00 00:00:00.
  if (!found || found[1]?.startsWith("0000")) return null
  return localMoment(found[1] as string, found[2] as string, zone)
}

const digest = (row: RawRow): string =>
  createHash("sha256")
    .update(JSON.stringify(CDR_FIELDS.map((field) => textOf(row[field]))))
    .digest("hex")
    .slice(0, 16)

/**
 * A CDR row as `CdrRow`, its times read in `zone`. One logical call may have several rows with one `uniqueid` (a
 * transfer adds a row per leg, the spec's examples show it), so the row id is `uniqueid` with `sequence`, or with a
 * digest of the whole row when there is no sequence: two rows are merged only when they are the same row.
 */
export const cdrRow = (row: RawRow, zone: string): CdrRow => {
  const start = timeIn(row.start ?? row.calldate, zone)
  if (start === null)
    throw new CliError("invalid_response", "a call record has no start time", { reason: "cdr.bad-row" })
  const uniqueid = textOf(row.uniqueid)
  const sequence = numberOf(row.sequence)
  const durationSec = numberOf(row.duration)
  const billSec = numberOf(row.billsec)
  const end = timeIn(row.end, zone)
  return {
    id: uniqueid ? `${uniqueid}#${sequence ?? digest(row)}` : `row-${digest(row)}`,
    uniqueid,
    linkedid: textOf(row.linkedid),
    sequence,
    start,
    answer: timeIn(row.answer, zone),
    end: end ?? (durationSec === null ? null : start + durationSec * 1000),
    durationMs: durationSec === null ? null : durationSec * 1000,
    billMs: billSec === null ? null : billSec * 1000,
    src: textOf(row.src),
    dst: textOf(row.dst),
    clid: textOf(row.clid),
    dcontext: textOf(row.dcontext),
    channel: textOf(row.channel),
    dstchannel: textOf(row.dstchannel),
    lastapp: textOf(row.lastapp),
    disposition: textOf(row.disposition),
    accountcode: textOf(row.accountcode),
    userfield: textOf(row.userfield),
    recordingfile: textOf(row.recordingfile),
  }
}
