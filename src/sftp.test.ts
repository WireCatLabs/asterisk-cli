import { readFileSync } from "node:fs"
import { posix } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import type { SftpClient, SftpEntry, SftpOptions } from "@wirecat/cli-core/sftp"
import { beforeEach, expect, it } from "vitest"
import type { Speech } from "./commands/transcribe.js"
import { configure, freshFolders, runCli } from "./testing/harness.js"

const PASSWORD = "test-sftp-password-91c2"
const KEY = "SHA256:dGVzdC1ob3N0LWtleS1maW5nZXJwcmludC0wMDAwMDA"
const EXAMPLES = new URL("../examples/", import.meta.url)
const IN_CALL = "2026/10/31/in-74950000000-79000000001-20261031-120000-1761901200.11.wav"
const HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString()

/** The PBX's files as an SFTP server shows them; it refuses any password but the test's and any other host key. */
const fakeServer = () => {
  const files = new Map<string, Uint8Array>([
    ["/var/log/asterisk/cdr-csv/Master.csv", readFileSync(new URL("Master.csv", EXAMPLES))],
    [`/var/spool/asterisk/monitor/${IN_CALL}`, readFileSync(new URL(`monitor/${IN_CALL}`, EXAMPLES))],
  ])
  const opened: SftpOptions[] = []
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
    if (!("password" in options.auth) || options.auth.password !== PASSWORD)
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
      close: async () => {},
    }
  }
  return { open, opened }
}

const hostKey = async () => ({ algorithm: "ssh-ed25519", fingerprint: KEY })

beforeEach(async () => {
  freshFolders()
  await configure({
    files_from: "sftp",
    sftp_host: "pbx.example.test",
    sftp_user: "wirecat",
    cdr_csv_path: "/var/log/asterisk/cdr-csv/Master.csv",
    recordings_path: "/var/spool/asterisk/monitor",
    cdr_timezone: "Europe/Moscow",
    phone_region: "ru",
  })
})

it("session start shows the server's key to pin, and asks no password until it is pinned", async () => {
  const server = fakeServer()
  const started = await runCli(["office", "session", "start", "--json"], {
    sftp: server.open,
    sftpHostKey: hostKey,
    stdin: `${PASSWORD}\n`,
  })
  expect(started.json()).toMatchObject({ error: { code: "configuration_error", reason: "sftp.host-key-missing" } })
  expect(started.err).toContain(`pbx office config set sftp_host_key ${KEY}`)
  expect(server.opened).toEqual([])
})

it("syncs Master.csv and links recordings over SFTP, and transcribes a recording read from the server", async () => {
  await configure({ sftp_host_key: KEY })
  const server = fakeServer()
  const keyring = memoryKeyring()
  const wrong = await runCli(["office", "session", "start", "--json"], { keyring, sftp: server.open, stdin: "nope\n" })
  expect(wrong.json()).toMatchObject({ error: { reason: "auth.failed" } })
  const started = await runCli(["office", "session", "start", "--json"], {
    keyring,
    sftp: server.open,
    stdin: `${PASSWORD}\n`,
  })
  expect(started.code, started.err).toBe(0)
  expect(started.json().item).toMatchObject({ password: "sftp", verified: true })
  const synced = await runCli(["office", "meetings", "sync", "--since-time", "2026-10-01T00:00:00Z", "--json"], {
    keyring,
    sftp: server.open,
  })
  expect(synced.code, synced.err).toBe(0)
  const listed = await runCli(["office", "meetings", "list", "--json"], { keyring })
  expect(listed.json().items).toHaveLength(6)
  const speech: Speech = {
    findModel: ((id: string) => ({ id })) as Speech["findModel"],
    isInstalled: () => true,
    modelsDirectory: () => "/models",
    localSpeechRecognitionModel: ((model: string) => ({ engine: "sherpa-onnx", model, version: "1" })) as never,
    decodeChannels: async () => ({ channels: [{ samples: new Float32Array(80_000), rate: 8000 }], mixed: true }),
    recognizeLocalPieces: async () => [{ start: 0, end: 3, text: "оплатим в пятницу" }],
  }
  const done = await runCli(["office", "meetings", "transcribe", "--json"], { keyring, sftp: server.open, speech })
  expect(done.code, done.err).toBe(0)
  expect(done.json().item).toMatchObject({ transcribed: 1 })
  expect(server.opened.every((options) => options.hostKey === KEY && options.username === "wirecat")).toBe(true)
})

it("a database profile reads files over SFTP only with a key file", async () => {
  await configure({ sftp_host_key: KEY, cdr_source: "mysql", db_host: "db", db_name: "cdr", db_user: "reader" })
  const synced = await runCli(["office", "meetings", "sync", "--json"], {
    keyring: memoryKeyring({ "asterisk-cli:token:office": "db-password" }),
    sftp: fakeServer().open,
  })
  expect(synced.json()).toMatchObject({ error: { code: "configuration_error", reason: "source.not-configured" } })
  expect(synced.err).toContain("sftp_key_path")
})

it("sftpFiles signs in with a key file, needs a password without one, and answers nothing for what is not a file", async () => {
  const { sftpFiles } = await import("./sftp-files.js")
  const { mkdtempSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const keyPath = posix.join(mkdtempSync(posix.join(tmpdir(), "key-")), "id")
  writeFileSync(keyPath, "-----BEGIN OPENSSH PRIVATE KEY-----\n")
  const seen: SftpOptions[] = []
  const missingFile = () => new CliError("not_found", "no such file", { reason: "file.not-found" })
  const open = async (options: SftpOptions): Promise<SftpClient> => {
    seen.push(options)
    return {
      stat: async (path) => {
        if (path === "/dir") return { name: "dir", kind: "directory", size: 0, modifiedAt: HOUR_AGO }
        throw missingFile()
      },
      list: async () => {
        throw missingFile()
      },
      readFile: async () => new Uint8Array([1]),
      close: async () => {},
    }
  }
  const place = { host: "pbx", port: 2222, user: "wirecat", keyPath, hostKey: KEY }
  const files = await sftpFiles(place, undefined, { open })
  expect("privateKey" in (seen[0]?.auth ?? {})).toBe(true)
  expect(seen[0]?.port).toBe(2222)
  expect(await files.stat("/dir")).toBeNull()
  expect(await files.stat("/nope")).toBeNull()
  expect(await files.list("/nope")).toEqual([])
  expect(await files.read("/x", 10)).toEqual(new Uint8Array([1]))
  await files.close()
  await expect(sftpFiles({ ...place, keyPath: "/nonexistent/key" }, undefined, { open })).rejects.toMatchObject({
    details: { reason: "source.bad-setting" },
  })
  await expect(sftpFiles({ ...place, keyPath: null }, undefined, { open })).rejects.toMatchObject({
    details: { reason: "profile.not-signed-in" },
  })
})
