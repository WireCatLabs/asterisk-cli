import { posix } from "node:path"
import { wallClock } from "@wirecat/cli-core/cli"
import type { CdrRow } from "./cdr/record.js"
import type { FileAccess, FileEntry } from "./files.js"

/**
 * FreePBX keeps calls under `<monitor>/YYYY/MM/DD/`, and a plain MixMonitor dialplan names the file after the call's
 * uniqueid. Both are tried when `recordings_pattern` names none.
 */
export const DEFAULT_PATTERNS = ["{yyyy}/{mm}/{dd}/*{uniqueid}*", "*{uniqueid}*"]

/** What MixMonitor and Monitor write: `.WAV` is wav49 (GSM in WAV), `.sln` raw signed linear. */
const FORMATS: Record<string, string> = {
  wav: "audio/wav",
  gsm: "audio/x-gsm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  sln: "audio/l16",
}

/** A file changed this recently may still be written: MixMonitor writes until the call ends. */
export const STILL_WRITING_MS = 2 * 60 * 1000

/** MixMonitor leaves a file with only its header when nobody talked: 44 bytes of WAV, 60 of WAV49. */
const NO_SOUND_BYTES = 1024

export interface Recording extends FileEntry {
  mime: string
}

export const mimeOf = (name: string): string | null => FORMATS[name.split(".").pop()?.toLowerCase() ?? ""] ?? null

const literal = (text: string) => text.replace(/[.+^${}()|[\]\\?*]/g, "\\$&")

/** `*` is any text; a call id must end where a digit cannot follow, so `1730383509.4` never takes `….42.wav`. */
const matcherOf = (pattern: string, values: Record<string, string>) =>
  new RegExp(
    `^${pattern
      .split(/(\{\w+\}|\*)/)
      .map((part) => {
        if (part === "*") return ".*"
        const key = /^\{(\w+)\}$/.exec(part)?.[1]
        if (key === undefined) return literal(part)
        const value = values[key]
        if (value === undefined) return literal(part)
        return ["uniqueid", "linkedid"].includes(key) ? `(?<![0-9])${literal(value)}(?![0-9])` : literal(value)
      })
      .join("")}$`,
  )

/** Inside `root` only: `recordingfile` comes from the CDR, which a caller's own caller ID can shape. */
const within = (root: string, path: string) => {
  const relative = posix.relative(posix.resolve(root), posix.resolve(root, path))
  return relative !== "" && !relative.startsWith("..") && !posix.isAbsolute(relative)
}

/**
 * The recordings of one call's row: from its `recordingfile` when the CDR has one, else by the patterns, in order.
 * Folders are listed once per run, through `list`, whatever the number of calls in them.
 */
export const recordingFinder = (
  files: FileAccess,
  { root, patterns, zone, now }: { root: string; patterns: readonly string[]; zone: string; now: () => number },
) => {
  const listed = new Map<string, Promise<FileEntry[]>>()
  const listing = (folder: string) => {
    let found = listed.get(folder)
    if (!found) {
      found = files.list(folder)
      listed.set(folder, found)
    }
    return found
  }
  const settled = (entry: FileEntry): Recording | null => {
    const mime = mimeOf(entry.name)
    if (!mime || entry.size <= NO_SOUND_BYTES || now() - entry.mtimeMs < STILL_WRITING_MS) return null
    return { ...entry, mime }
  }
  const dated = (row: CdrRow) => {
    const date = wallClock(zone).date(new Date(row.start).toISOString())
    const [yyyy, mm, dd] = date.split("-") as [string, string, string]
    return { yyyy, mm, dd }
  }
  return async (row: CdrRow): Promise<Recording | null> => {
    const { yyyy, mm, dd } = dated(row)
    if (row.recordingfile) {
      const name = row.recordingfile
      const candidates = name.startsWith("/") ? [name] : [posix.join(root, yyyy, mm, dd, name), posix.join(root, name)]
      for (const path of candidates.filter((candidate) => within(root, candidate))) {
        const entry = await files.stat(path)
        if (entry) return settled(entry)
      }
    }
    if (!row.uniqueid) return null
    const values: Record<string, string> = {
      uniqueid: row.uniqueid,
      linkedid: row.linkedid ?? row.uniqueid,
      yyyy,
      mm,
      dd,
    }
    for (const pattern of patterns) {
      const filled = pattern.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole)
      const folder = posix.join(root, posix.dirname(filled))
      if (!within(root, posix.join(folder, "x"))) continue
      const matcher = matcherOf(posix.basename(pattern), values)
      const found = (await listing(folder)).filter(({ name }) => matcher.test(name) && mimeOf(name))
      const newest = found.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
      if (newest) return settled(newest)
    }
    return null
  }
}
