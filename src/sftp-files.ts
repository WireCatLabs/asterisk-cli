import { readFile } from "node:fs/promises"
import { posix } from "node:path"
import { CliError, isCliError } from "@wirecat/cli-base"
import type { SftpAuth, SftpClient, SftpEntry, SftpOptions } from "@wirecat/cli-core/sftp"
import type { FileAccess, FileEntry } from "./files.js"
import { IDENTITY } from "./identity.js"
import type { SftpPlace } from "./source.js"

export type OpenSftp = (options: SftpOptions) => Promise<SftpClient>

const missing = (error: unknown) => isCliError(error) && error.details.reason === "file.not-found"

const entryOf = (path: string, entry: SftpEntry): FileEntry => ({
  path,
  name: entry.name,
  size: entry.size,
  mtimeMs: Date.parse(entry.modifiedAt),
})

/**
 * An SFTP or SSH server's key, unknown until the owner confirms it: the error names the fingerprint the server sent
 * and the command that pins it, so the owner compares it with `ssh-keygen -lf` on the server first.
 */
export const hostKeyRefusal = (
  profile: string,
  key: { algorithm: string; fingerprint: string },
  { setting, what }: { setting: string; what: string } = { setting: "sftp_host_key", what: "SFTP server" },
) =>
  new CliError(
    "configuration_error",
    `the ${what}'s ${key.algorithm} key is ${key.fingerprint}. Check it on the server with ` +
      `\`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub\`, then pin it: ` +
      `${IDENTITY.command} ${profile} config set ${setting} ${key.fingerprint}`,
    { reason: "sftp.host-key-missing" },
  )

/** The key file the setting names, or else the password `session start` kept. */
export const authOf = async (
  place: Pick<SftpPlace, "keyPath">,
  password: string | undefined,
  setting = "sftp_key_path",
): Promise<SftpAuth> => {
  if (place.keyPath) {
    const privateKey = await readFile(place.keyPath).catch(() => {
      throw new CliError("configuration_error", `the key file set in ${setting} cannot be read`, {
        reason: "source.bad-setting",
      })
    })
    return { privateKey }
  }
  if (!password)
    throw new CliError("authentication_error", "this profile has no password for that server yet; run session start", {
      reason: "profile.not-signed-in",
    })
  return { password }
}

/**
 * The PBX's files over SFTP, read only, through cli-core's client: the host key is pinned before any credential is
 * sent, and Master.csv and the recordings are read where they are, never copied to a folder of their own.
 */
export const sftpFiles = async (
  place: SftpPlace & { hostKey: string },
  password: string | undefined,
  { signal, open }: { signal?: AbortSignal | undefined; open?: OpenSftp } = {},
): Promise<FileAccess> => {
  const connect = open ?? (await import("@wirecat/cli-core/sftp")).openSftp
  const client = await connect({
    host: place.host,
    ...(place.port ? { port: place.port } : {}),
    username: place.user,
    auth: await authOf(place, password),
    hostKey: place.hostKey,
    ...(signal ? { signal } : {}),
  })
  return {
    where: "sftp",
    stat: async (path) => {
      try {
        const entry = await client.stat(path)
        return entry.kind === "file" ? entryOf(path, entry) : null
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
    },
    list: async (folder) => {
      try {
        return (await client.list(folder))
          .filter((entry) => entry.kind === "file")
          .map((entry) => entryOf(posix.join(folder, entry.name), entry))
      } catch (error) {
        if (missing(error)) return []
        throw error
      }
    },
    stream: (path) => client.readStream(path),
    close: () => client.close(),
  }
}
