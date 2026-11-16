import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { memoryKeyring } from "@wirecat/cli-base"
import { beforeEach, expect, it, vi } from "vitest"
import { fakeTable, fakeTunnel, PASSWORD, ROWS, SSH_KEY, SSH_PASSWORD } from "./testing/fakes.js"
import { asteriskFolder, configure, fakeSpeech, freshFolders, runCli } from "./testing/harness.js"

beforeEach(async () => {
  freshFolders()
  await configure({
    cdr_source: "mysql",
    db_host: "pbx.example.test",
    db_name: "asteriskcdrdb",
    db_user: "wirecat_reader",
    cdr_timezone: "Europe/Moscow",
    phone_region: "ru",
  })
})

it("session start asks the database password, checks it, and keeps it only once it works", async () => {
  const table = fakeTable()
  const keyring = memoryKeyring()
  const wrong = await runCli(["office", "session", "start", "--json"], { keyring, sql: table.open, stdin: "nope\n" })
  expect(wrong.code).not.toBe(0)
  expect(wrong.json()).toMatchObject({ error: { code: "authentication_error", reason: "db.refused" } })
  expect(JSON.stringify(keyring)).not.toContain("nope")

  const started = await runCli(["office", "session", "start", "--json"], {
    keyring,
    sql: table.open,
    stdin: `${PASSWORD}\n`,
  })
  expect(started.code, started.err).toBe(0)
  expect(started.json().item).toMatchObject({ password: "db", verified: true, cdr: "mysql" })
  expect(started.out).not.toContain(PASSWORD)

  const status = await runCli(["office", "session", "status", "--check", "--json"], { keyring, sql: table.open })
  expect(status.json().item).toMatchObject({ password: "db", state: "saved", verified: true })
  expect(status.out).not.toContain(PASSWORD)
})

it("session start stops reading a pipe once the password line is in, though the pipe stays open", async () => {
  const stdin = new PassThrough()
  stdin.write(`${PASSWORD}\n`)
  const started = await runCli(["office", "session", "start", "--json"], { sql: fakeTable().open, stdin })
  expect(started.code, started.err).toBe(0)
  expect(started.json().item).toMatchObject({ password: "db", verified: true })
  expect(stdin.writableEnded).toBe(false)
  stdin.destroy()
})

it("session start gives up on an open pipe that sends no password after 30 seconds", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  try {
    const stdin = new PassThrough()
    const started = runCli(["office", "session", "start", "--json"], { sql: fakeTable().open, stdin })
    await vi.advanceTimersByTimeAsync(30_000)
    const ran = await started
    expect(ran.json()).toMatchObject({ error: { code: "validation_error", message: "no password was given" } })
    stdin.destroy()
  } finally {
    vi.useRealTimers()
  }
})

it("syncs the CDR table from six hours before the cursor, in the CDR's own wall time", async () => {
  const table = fakeTable()
  const keyring = memoryKeyring()
  expect(
    (await runCli(["office", "session", "start"], { keyring, sql: table.open, stdin: `${PASSWORD}\n` })).code,
  ).toBe(0)
  const synced = await runCli(["office", "meetings", "sync", "--since-time", "2026-10-31T09:30:00Z", "--json"], {
    keyring,
    sql: table.open,
  })
  expect(synced.code, synced.err).toBe(0)
  expect(table.asked.at(-1)).toBe("2026-10-31 06:30:00")
  const listed = await runCli(["office", "meetings", "list", "--json"], { keyring })
  expect((listed.json().items as { title: string }[]).map(({ title }) => title).sort()).toEqual([
    "+79000000001 → 101",
    "102 → +79000000002",
  ])
})

it("a sync before session start says how to sign in, and reaches nothing", async () => {
  const table = fakeTable()
  const synced = await runCli(["office", "meetings", "sync", "--json"], { sql: table.open })
  expect(synced.code).not.toBe(0)
  expect(synced.json()).toMatchObject({ error: { code: "authentication_error" } })
  expect(table.asked).toEqual([])
})

it("--offline refuses a database source before it connects", async () => {
  const table = fakeTable()
  const synced = await runCli(["office", "meetings", "sync", "--offline", "--json"], {
    keyring: memoryKeyring({ "asterisk-cli:token:office": PASSWORD }),
    sql: table.open,
  })
  expect(synced.json()).toMatchObject({ error: { reason: "offline.refused" } })
  expect(table.asked).toEqual([])
})

it("meetings transcribe reads only the recordings: no password and no database, even --offline", async () => {
  const wav = readFileSync(new URL(`../examples/monitor/2026/10/31/${ROWS[0]?.recordingfile}`, import.meta.url))
  const root = asteriskFolder({ [`monitor/2026/10/31/${ROWS[0]?.recordingfile}`]: wav })
  await configure({ recordings_path: join(root, "monitor") })
  const table = fakeTable()
  const keyring = memoryKeyring()
  await runCli(["office", "session", "start"], { keyring, sql: table.open, stdin: `${PASSWORD}\n` })
  const synced = await runCli(["office", "meetings", "sync", "--since-time", "2026-10-31T00:00:00Z", "--json"], {
    keyring,
    sql: table.open,
  })
  expect(synced.code, synced.err).toBe(0)
  expect((await runCli(["office", "session", "end", "--json"], { keyring })).code).toBe(0)
  const asked = table.asked.length
  const speech = fakeSpeech()
  const done = await runCli(["office", "meetings", "transcribe", "--offline", "--json"], { keyring, speech })
  expect(done.code, done.err).toBe(0)
  expect(done.json().item).toMatchObject({ transcribed: 1 })
  expect(table.asked).toHaveLength(asked)
})

it("a database behind the PBX's SSH: the key is pinned first, then both passwords are asked, kept in one entry", async () => {
  await configure({ db_host: "127.0.0.1", db_ssh_host: "pbx.example.test", db_ssh_user: "wirecat" })
  const table = fakeTable()
  const tunnel = fakeTunnel()
  const keyring = memoryKeyring()
  const environment = {
    keyring,
    sql: table.open,
    sshTunnel: tunnel.open,
    sftpHostKey: async () => ({ algorithm: "ssh-ed25519", fingerprint: SSH_KEY }),
  }
  const unpinned = await runCli(["office", "session", "start", "--json"], {
    ...environment,
    stdin: `${PASSWORD}\n${SSH_PASSWORD}\n`,
  })
  expect(unpinned.json()).toMatchObject({ error: { reason: "sftp.host-key-missing" } })
  expect(unpinned.err).toContain(`pbx office config set db_ssh_host_key ${SSH_KEY}`)
  expect(tunnel.opened).toEqual([])

  await configure({ db_ssh_host_key: SSH_KEY })
  const one = await runCli(["office", "session", "start", "--json"], { ...environment, stdin: `${PASSWORD}\n` })
  expect(one.json()).toMatchObject({ error: { code: "validation_error" } })
  expect(one.err).toContain("2 passwords, one per line in this order: db, ssh")

  const started = await runCli(["office", "session", "start", "--json"], {
    ...environment,
    stdin: `${PASSWORD}\n${SSH_PASSWORD}\n`,
  })
  expect(started.code, started.err).toBe(0)
  expect(started.json().item).toMatchObject({ password: "db", passwords: ["db", "ssh"], verified: true })
  expect(tunnel.forwarded).toEqual(["127.0.0.1:3306"])
  expect(tunnel.closed()).toBe(1)
  expect([...keyring.entries.keys()]).toEqual(["asterisk-cli:token:office"])
  expect(keyring.entries.get("asterisk-cli:token:office")).not.toBe(PASSWORD)

  const synced = await runCli(["office", "meetings", "sync", "--since-time", "2026-10-31T00:00:00Z", "--json"], {
    ...environment,
  })
  expect(synced.code, synced.err).toBe(0)
  expect(tunnel.opened.at(-1)).toMatchObject({ host: "pbx.example.test", username: "wirecat", hostKey: SSH_KEY })
  expect(tunnel.closed()).toBe(2)
  const status = await runCli(["office", "session", "status", "--json"], environment)
  expect(status.json().item).toMatchObject({ state: "saved", passwords: ["db", "ssh"] })
})

it("a tunnel that signs in with a key file asks only the database password, and a missing SSH password says so", async () => {
  await configure({
    db_host: "127.0.0.1",
    db_ssh_host: "pbx.example.test",
    db_ssh_user: "wirecat",
    db_ssh_host_key: SSH_KEY,
  })
  const keyring = memoryKeyring({ "asterisk-cli:token:office": PASSWORD })
  const missing = await runCli(["office", "meetings", "sync", "--json"], {
    keyring,
    sql: fakeTable().open,
    sshTunnel: fakeTunnel().open,
  })
  expect(missing.json()).toMatchObject({ error: { reason: "profile.not-signed-in" } })
  expect(missing.err).toContain("no SSH password yet")
  const keyPath = join(asteriskFolder({ id: "-----BEGIN OPENSSH PRIVATE KEY-----\n" }), "id")
  await configure({ db_ssh_key_path: keyPath })
  const status = await runCli(["office", "session", "status", "--json"], { keyring })
  expect(status.json().item).toMatchObject({ state: "saved", passwords: ["db"] })
})

const employeeNames = async (keyring: ReturnType<typeof memoryKeyring>, open: ReturnType<typeof fakeTable>["open"]) => {
  const stats = await runCli(["office", "stats", "calls", "show", "--since-time", "2026-10-01", "--json"], {
    keyring,
    sql: open,
  })
  const employees = (stats.json().item as { employees: { extension: string; name: string | null }[] }).employees
  return Object.fromEntries(employees.map(({ extension, name }) => [extension, name]))
}

it("names extensions by extension_names, then FreePBX's asterisk.users, then the caller ID", async () => {
  await configure({ extension_names: "101=Oleg Owner" })
  const table = fakeTable(
    new Map([
      ["101", "Oleg FreePBX"],
      ["102", "Anna FreePBX"],
    ]),
  )
  const keyring = memoryKeyring()
  await runCli(["office", "session", "start"], { keyring, sql: table.open, stdin: `${PASSWORD}\n` })
  const synced = await runCli(["office", "meetings", "sync", "--since-time", "2026-10-31T00:00:00Z", "--json"], {
    keyring,
    sql: table.open,
  })
  expect(synced.code, synced.err).toBe(0)
  expect(synced.err).not.toContain("asterisk.users")
  expect(await employeeNames(keyring, table.open)).toEqual({ "101": "Oleg Owner", "102": "Anna FreePBX" })
})

it("a user that may not read asterisk.users syncs all the same, with one note that names the grant", async () => {
  const table = fakeTable(null)
  const keyring = memoryKeyring()
  await runCli(["office", "session", "start"], { keyring, sql: table.open, stdin: `${PASSWORD}\n` })
  const synced = await runCli(["office", "meetings", "sync", "--since-time", "2026-10-31T00:00:00Z", "--json"], {
    keyring,
    sql: table.open,
  })
  expect(synced.code, synced.err).toBe(0)
  expect(synced.err.match(/could not be read/g)).toHaveLength(1)
  expect(synced.err).toContain("grant SELECT (extension, name) on asterisk.users")
  expect(await employeeNames(keyring, table.open)).toEqual({ "101": null, "102": "Anna Managerova" })
})
