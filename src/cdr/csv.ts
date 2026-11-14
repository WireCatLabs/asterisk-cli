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

/**
 * RFC 4180 rows, as `cdr_csv` writes them: every field quoted, a quote inside doubled. Fed text piece by piece, so a
 * file of any size is read without holding it whole; a quote, a `\r\n` or a quoted newline may fall between pieces.
 */
export const csvParser = () => {
  let row: string[] = []
  let field = ""
  let quoted = false
  let quoteSeen = false
  let afterReturn = false
  const finished = (rows: string[][]) => {
    row.push(field)
    if (row.length > 1 || row[0] !== "") rows.push(row)
    row = []
    field = ""
  }
  return {
    push: (text: string): string[][] => {
      const rows: string[][] = []
      for (const char of text) {
        if (afterReturn) {
          afterReturn = false
          if (char === "\n") continue
        }
        if (quoteSeen) {
          quoteSeen = false
          if (char === '"') {
            field += '"'
            continue
          }
          quoted = false
        }
        if (quoted) {
          if (char === '"') quoteSeen = true
          else field += char
        } else if (char === '"') quoted = true
        else if (char === ",") {
          row.push(field)
          field = ""
        } else if (char === "\n" || char === "\r") {
          afterReturn = char === "\r"
          finished(rows)
        } else field += char
      }
      return rows
    },
    end: (): string[][] => {
      const rows: string[][] = []
      finished(rows)
      return rows
    },
  }
}

export function* csvLines(text: string): Generator<string[]> {
  const parser = csvParser()
  yield* parser.push(text)
  yield* parser.end()
}

/**
 * Names each line's fields. Without `named`, each line's own count names its columns: turning `loguniqueid` or
 * `newcdrcolumns` on later makes the newer lines longer than the older ones. A line that fits no layout is skipped
 * and counted; a file where no line fits is refused at `end`, so a wrong guess is never silent.
 */
export const csvTable = (named?: readonly string[]) => {
  let fitted = 0
  let skipped = 0
  let refusal: unknown
  return {
    row: (line: readonly string[]): RawRow | null => {
      let columns: readonly string[]
      try {
        columns = named ?? csvColumns(line)
      } catch (error) {
        refusal ??= error
        skipped++
        return null
      }
      if (line.length !== columns.length) {
        skipped++
        return null
      }
      fitted++
      return Object.fromEntries(columns.map((name, index) => [name, line[index] ?? null]))
    },
    end: () => {
      if (fitted === 0 && refusal) throw refusal
      return { rows: fitted, skipped }
    },
  }
}

/** Every row of a Master.csv held in memory, keyed by column name. */
export const csvRows = (text: string, named?: readonly string[]): { rows: RawRow[]; skipped: number } => {
  const table = csvTable(named)
  const rows = [...csvLines(text)].map(table.row).filter((row): row is RawRow => row !== null)
  return { rows, skipped: table.end().skipped }
}
