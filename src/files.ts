import { createReadStream } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { CliError } from "@wirecat/cli-base"

export interface FileEntry {
  path: string
  name: string
  size: number
  mtimeMs: number
}

/** Read-only access to Master.csv and the recordings, on this computer or a server; nothing here writes or deletes. */
export interface FileAccess {
  readonly where: "local" | "sftp"
  stat(path: string): Promise<FileEntry | null>
  /** The files of a folder, without its subfolders; an empty list when the folder is missing. */
  list(folder: string): Promise<FileEntry[]>
  read(path: string, maxBytes: number): Promise<Uint8Array>
  /** The file piece by piece, for one too large to hold in memory. */
  stream(path: string): AsyncIterable<Uint8Array>
  close(): Promise<void>
}

const codeOf = (error: unknown) => String((error as { code?: unknown }).code ?? "")
const missing = (error: unknown) => ["ENOENT", "ENOTDIR"].includes(codeOf(error))

/** Node's own text quotes the path, and a recording's path holds the caller's number (WC-SECR-6). */
const unreadable = (error: unknown): CliError =>
  ["EACCES", "EPERM"].includes(codeOf(error))
    ? new CliError("permission_error", "this user may not read a file or folder of the PBX; grant it read access", {
        reason: "file.denied",
      })
    : new CliError("provider_error", `a file or folder of the PBX could not be read (${codeOf(error) || "no code"})`, {
        reason: "file.unreadable",
      })

// No path in the text: a recording's file name often holds the caller's number (WC-SECR-6).
const tooLarge = (maxBytes: number) =>
  new CliError("validation_error", `the file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`, {
    reason: "file.too-large",
  })

/** Files on this computer or on a mounted folder. */
export const localFiles = (): FileAccess => ({
  where: "local",
  stat: async (path) => {
    try {
      const found = await stat(path)
      return found.isFile()
        ? { path, name: path.split(/[\\/]/).pop() ?? path, size: found.size, mtimeMs: found.mtimeMs }
        : null
    } catch (error) {
      if (missing(error)) return null
      throw unreadable(error)
    }
  },
  list: async (folder) => {
    try {
      const entries = await readdir(folder, { withFileTypes: true })
      const files = entries.filter((entry) => entry.isFile())
      return await Promise.all(
        files.map(async ({ name }) => {
          const found = await stat(join(folder, name))
          return { path: join(folder, name), name, size: found.size, mtimeMs: found.mtimeMs }
        }),
      )
    } catch (error) {
      if (missing(error)) return []
      throw unreadable(error)
    }
  },
  read: async (path, maxBytes) => {
    const found = await stat(path).catch((error: unknown) => {
      if (missing(error)) throw new CliError("not_found", "the file is not there any more", { reason: "file.missing" })
      throw unreadable(error)
    })
    if (found.size > maxBytes) throw tooLarge(maxBytes)
    return readFile(path).catch((error: unknown) => {
      throw unreadable(error)
    })
  },
  stream: async function* (path) {
    try {
      yield* createReadStream(path, { highWaterMark: 1024 * 1024 })
    } catch (error) {
      if (missing(error)) throw new CliError("not_found", "the file is not there any more", { reason: "file.missing" })
      throw unreadable(error)
    }
  },
  close: async () => {},
})
