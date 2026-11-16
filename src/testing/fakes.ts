import { readFileSync } from "node:fs"
import { posix } from "node:path"
import { PassThrough } from "node:stream"
import { CliError } from "@wirecat/cli-base"
import type { SftpClient, SftpEntry, SftpOptions, SshTunnel, SshTunnelOptions } from "@wirecat/cli-core/sftp"
import type { RawRow } from "../cdr/record.js"
import type { SqlCdr, SqlCdrOptions, SqlSource } from "../cdr/sql.js"

export const PASSWORD = "test-db-password-7f3a"

export const ROWS: RawRow[] = [
  {
    calldate: "2026-10-31 12:00:00",
    clid: '"Ivan Testov" <79000000001>',
    src: "79000000001",
    dst: "74950000000",
    dcontext: "from-trunk",
    channel: "PJSIP/trunk-00000001",
    dstchannel: "PJSIP/101-00000002",
    lastapp: "Dial",
    duration: 185,
    billsec: 180,
    disposition: "ANSWERED",
    uniqueid: "1761901200.11",
    linkedid: "1761901200.11",
    sequence: 11,
    recordingfile: "in-74950000000-79000000001-20261031-120000-1761901200.11.wav",
  },
  {
    calldate: "2026-10-31 13:00:00",
    clid: '"Anna Managerova" <102>',
    src: "102",
    dst: "89000000002",
    dcontext: "from-internal",
    channel: "PJSIP/102-00000003",
    dstchannel: "PJSIP/trunk-00000004",
    duration: 130,
    billsec: 120,
    disposition: "ANSWERED",
    uniqueid: "1761904800.21",
    linkedid: "1761904800.21",
    sequence: 21,
  },
]

/** A CDR table that refuses any password but the test's, as the server does, and records the bounds it was asked. */
/** `names`: FreePBX's asterisk.users as the server answers it, or null for a user that may not read it. */
export const fakeTable = (names?: Map<string, string> | null) => {
  const asked: string[] = []
  const options: SqlCdrOptions[] = []
  const open = async (source: SqlSource, password: string, given: SqlCdrOptions): Promise<SqlCdr> => {
    options.push(given)
    await given.socket?.()
    if (password !== PASSWORD)
      throw new CliError("authentication_error", `the ${source.kind} server refused the user or password`, {
        reason: "db.refused",
      })
    return {
      rows: async (since) => {
        asked.push(since.wall)
        return ROWS.filter((row) => String(row.calldate) >= since.wall)
      },
      ...(names === undefined ? {} : { names: async () => names }),
      close: async () => {},
    }
  }
  return { open, asked, options }
}

export const SSH_PASSWORD = "test-ssh-password-4e1b"
// biome-ignore lint/security/noSecrets: a made-up fingerprint the fake server answers with
export const SSH_KEY = "SHA256:c3NoLWhvc3Qta2V5LWZpbmdlcnByaW50LTAwMDAwMDAw"

/** An SSH server that forwards only to the database on its own loopback, for the test's password and key. */
export const fakeTunnel = () => {
  const opened: SshTunnelOptions[] = []
  const forwarded: string[] = []
  let closed = 0
  const open = async (options: SshTunnelOptions): Promise<SshTunnel> => {
    opened.push(options)
    if (options.hostKey !== SSH_KEY) throw new CliError("authentication_error", "host key", { reason: "ssh.host-key" })
    if (!("password" in options.auth) || options.auth.password !== SSH_PASSWORD)
      throw new CliError("authentication_error", "refused", { reason: "auth.failed" })
    return {
      connect: async (host, port) => {
        forwarded.push(`${host}:${port}`)
        return new PassThrough()
      },
      close: async () => {
        closed++
      },
    }
  }
  return { open, opened, forwarded, closed: () => closed }
}

export const SFTP_PASSWORD = "test-sftp-password-91c2"
// biome-ignore lint/security/noSecrets: a made-up fingerprint the fake server answers with
export const KEY = "SHA256:dGVzdC1ob3N0LWtleS1maW5nZXJwcmludC0wMDAwMDA"
export const EXAMPLES = new URL("../../examples/", import.meta.url)
export const IN_CALL = "2026/10/31/in-74950000000-79000000001-20261031-120000-1761901200.11.wav"
export const HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString()

/** The PBX's files as an SFTP server shows them; it refuses any password but the test's and any other host key. */
export const fakeServer = () => {
  const files = new Map<string, Uint8Array>([
    ["/var/log/asterisk/cdr-csv/Master.csv", readFileSync(new URL("Master.csv", EXAMPLES))],
    [`/var/spool/asterisk/monitor/${IN_CALL}`, readFileSync(new URL(`monitor/${IN_CALL}`, EXAMPLES))],
  ])
  const opened: SftpOptions[] = []
  const streamed: string[] = []
  const entry = (path: string, kind: SftpEntry["kind"], size = 0): SftpEntry => ({
    name: posix.basename(path),
    kind,
    size,
    modifiedAt: HOUR_AGO,
  })
  const notFound = () => new CliError("not_found", "no such file", { reason: "file.not-found" })
  const open = async (options: SftpOptions): Promise<SftpClient> => {
    opened.push(options)
    if (options.hostKey !== KEY)
      throw new CliError("authentication_error", "host key", { reason: "sftp.host-key-mismatch" })
    if (!("password" in options.auth) || options.auth.password !== SFTP_PASSWORD)
      throw new CliError("authentication_error", "refused", { reason: "auth.failed" })
    return {
      stat: async (path) => {
        const bytes = files.get(path)
        if (bytes) return entry(path, "file", bytes.length)
        if ([...files.keys()].some((one) => one.startsWith(`${path}/`))) return entry(path, "directory")
        throw notFound()
      },
      list: async (folder) => {
        const inside = [...files.entries()].filter(([path]) => posix.dirname(path) === folder)
        if (!inside.length && ![...files.keys()].some((one) => one.startsWith(`${folder}/`))) throw notFound()
        return inside.map(([path, bytes]) => entry(path, "file", bytes.length))
      },
      readFile: async (path) => {
        const bytes = files.get(path)
        if (!bytes) throw notFound()
        return bytes
      },
      readStream: async function* (path) {
        const bytes = files.get(path)
        if (!bytes) throw notFound()
        streamed.push(path)
        for (let at = 0; at < bytes.length; at += 4096) yield bytes.subarray(at, at + 4096)
      },
      close: async () => {},
    }
  }
  return { open, opened, streamed }
}

export const hostKey = async () => ({ algorithm: "ssh-ed25519", fingerprint: KEY })
