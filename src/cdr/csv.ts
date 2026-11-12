import { CliError } from "@wirecat/cli-base"
import type { RawRow } from "./record.js"

/** The 16 columns `cdr_csv` always writes, in its order (asterisk/cdr/cdr_csv.c, `build_csv_record`). */
const BASE = [
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
] as const

/** `newcdrcolumns=yes` adds these three after the optional `uniqueid` and `userfield`. */
const NEW = ["peeraccount", "linkedid", "sequence"]

const UNIQUEID = /^(?:[\w.-]+-)?\d{9,}\.\d+$/

/**
 * Master.csv has no header, and `loguniqueid`, `loguserfield` and `newcdrcolumns` in cdr.conf each add columns. The
 * count tells them apart, except 17 and 20 columns, where the 17th is `uniqueid` when it looks like one
 * (`1730383509.42`) and `userfield` otherwise. `cdr_csv_columns` names them when this guess is wrong.
 */
export const csvColumns = (first: readonly string[]): string[] => {
  const extra = first.length - BASE.length
  const looksUnique = UNIQUEID.test(first[BASE.length] ?? "")
  const middle: Record<number, string[]> = {
    0: [],
    1: [looksUnique ? "uniqueid" : "userfield"],
    2: ["uniqueid", "userfield"],
    3: NEW,
    4: [looksUnique ? "uniqueid" : "userfield", ...NEW],
    5: ["uniqueid", "userfield", ...NEW],
  }
  const columns = middle[extra]
  if (!columns)
    throw new CliError(
      "validation_error",
      `Master.csv has ${first.length} columns, and cdr_csv writes 16 to 21; name them with cdr_csv_columns`,
      { reason: "cdr.unknown-columns" },
    )
  return [...BASE, ...columns]
}

/** RFC 4180 rows, as `cdr_csv` writes them: every field quoted, a quote inside doubled. */
export function* csvLines(text: string): Generator<string[]> {
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        field += '"'
        at++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[at + 1] === "\n") at++
      row.push(field)
      if (row.length > 1 || row[0] !== "") yield row
      row = []
      field = ""
    } else field += char
  }
  row.push(field)
  if (row.length > 1 || row[0] !== "") yield row
}

/** Every row of a Master.csv, keyed by column name; a row with another column count than the first is skipped. */
export const csvRows = (text: string, named?: readonly string[]): { rows: RawRow[]; skipped: number } => {
  const rows: RawRow[] = []
  let columns: readonly string[] | undefined = named
  let skipped = 0
  for (const line of csvLines(text)) {
    columns ??= csvColumns(line)
    if (line.length !== columns.length) {
      skipped++
      continue
    }
    rows.push(Object.fromEntries(columns.map((name, index) => [name, line[index] ?? null])))
  }
  return { rows, skipped }
}
