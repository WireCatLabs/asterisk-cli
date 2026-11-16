import { existsSync, readFileSync, statSync } from "node:fs"
import { posix } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import type { SftpClient, SftpOptions } from "@wirecat/cli-core/sftp"
import { beforeEach, expect, it } from "vitest"
import { EXAMPLES, fakeServer, HOUR_AGO, hostKey, IN_CALL, KEY, SFTP_PASSWORD as PASSWORD } from "./testing/fakes.js"
import { configure, fakeSpeech, freshFolders, runCli } from "./testing/harness.js"

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
  expect(listed.json().items).toHaveLength(5)
  const decoded: { path: string; mode: number; same: boolean }[] = []
  const speech = fakeSpeech({
    decodeChannelsFile: async (path) => {
      decoded.push({
        path,
        mode: statSync(path).mode & 0o777,
        same: readFileSync(path).equals(readFileSync(new URL(`monitor/${IN_CALL}`, EXAMPLES))),
      })
      return { channels: [{ samples: new Float32Array(80_000), rate: 8000 }], mixed: false }
    },
  })
  const done = await runCli(["office", "meetings", "transcribe", "--json"], { keyring, sftp: server.open, speech })
  expect(done.code, done.err).toBe(0)
  expect(done.json().item).toMatchObject({ transcribed: 1 })
  // Windows keeps no POSIX mode; the copy is private there because it sits in the user's own temp folder.
  const mode = process.platform === "win32" ? expect.any(Number) : 0o600
  expect(decoded).toEqual([{ path: expect.stringMatching(/pbx-recording-.*[\\/]call\.wav$/), mode, same: true }])
  expect(existsSync(decoded[0]?.path ?? "")).toBe(false)
  expect(server.streamed).toContain(`/var/spool/asterisk/monitor/${IN_CALL}`)
  expect(server.opened.every((options) => options.hostKey === KEY && options.username === "wirecat")).toBe(true)
})

it("a profile kept by 0.5.0, its SFTP password as the token, still reads", async () => {
  await configure({ sftp_host_key: KEY })
  const synced = await runCli(["office", "meetings", "sync", "--since-time", "2026-10-01T00:00:00Z", "--json"], {
    keyring: memoryKeyring({ "asterisk-cli:token:office": PASSWORD }),
    sftp: fakeServer().open,
  })
  expect(synced.code, synced.err).toBe(0)
})

it("a database profile with an SFTP password keeps it beside the database's, and transcribes with it alone", async () => {
  await configure({ sftp_host_key: KEY, cdr_source: "mysql", db_host: "db", db_name: "cdr", db_user: "reader" })
  const keyring = memoryKeyring()
  const server = fakeServer()
  const sql = async () => ({ rows: async () => [], close: async () => {} })
  const started = await runCli(["office", "session", "start", "--json"], {
    keyring,
    sftp: server.open,
    sql,
    stdin: `db-password\n${PASSWORD}\n`,
  })
  expect(started.code, started.err).toBe(0)
  expect(started.json().item).toMatchObject({ passwords: ["db", "sftp"] })
  expect([...keyring.entries.keys()]).toEqual(["asterisk-cli:token:office"])
  const done = await runCli(["office", "meetings", "transcribe", "--json"], {
    keyring,
    sftp: server.open,
    speech: fakeSpeech(),
  })
  expect(done.code, done.err).toBe(0)
  expect(server.opened.at(-1)?.auth).toEqual({ password: PASSWORD })
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
      readStream: async function* () {
        yield new Uint8Array([1])
      },
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
  const pieces: Uint8Array[] = []
  for await (const piece of files.stream("/x")) pieces.push(piece)
  expect(pieces).toEqual([new Uint8Array([1])])
  await files.close()
  await expect(sftpFiles({ ...place, keyPath: "/nonexistent/key" }, undefined, { open })).rejects.toMatchObject({
    details: { reason: "source.bad-setting" },
  })
  await expect(sftpFiles({ ...place, keyPath: null }, undefined, { open })).rejects.toMatchObject({
    details: { reason: "profile.not-signed-in" },
  })
})
