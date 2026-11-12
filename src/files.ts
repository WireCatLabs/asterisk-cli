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
  close(): Promise<void>
}

const missing = (error: unknown) => ["ENOENT", "ENOTDIR"].includes(String((error as { code?: unknown }).code))

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
      throw error
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
      throw error
    }
  },
  read: async (path, maxBytes) => {
    const found = await stat(path).catch((error: unknown) => {
      if (missing(error)) throw new CliError("not_found", "the file is not there any more", { reason: "file.missing" })
      throw error
    })
    if (found.size > maxBytes) throw tooLarge(maxBytes)
    return new Uint8Array(await readFile(path))
  },
  close: async () => {},
})
