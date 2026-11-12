import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CliError, memoryKeyring } from "@wirecat/cli-base"
import { beforeEach, expect, it } from "vitest"
import type { RawRow } from "./cdr/record.js"
import type { SqlCdr, SqlSource } from "./cdr/sql.js"
import type { Speech } from "./commands/transcribe.js"
import { asteriskFolder, configure, freshFolders, runCli } from "./testing/harness.js"

const PASSWORD = "test-db-password-7f3a"

const ROWS: RawRow[] = [
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
const fakeTable = () => {
  const asked: string[] = []
  const open = async (source: SqlSource, password: string): Promise<SqlCdr> => {
    if (password !== PASSWORD)
      throw new CliError("authentication_error", `the ${source.kind} server refused the user or password`, {
        reason: "db.refused",
      })
    return {
      rows: async (since) => {
        asked.push(since.wall)
        return ROWS.filter((row) => String(row.calldate) >= since.wall)
      },
      close: async () => {},
    }
  }
  return { open, asked }
}

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
  const speech: Speech = {
    findModel: ((id: string) => ({ id })) as Speech["findModel"],
    isInstalled: () => true,
    modelsDirectory: () => "/models",
    localSpeechRecognitionModel: ((model: string) => ({ engine: "sherpa-onnx", model, version: "1" })) as never,
    decodeChannels: async () => ({ channels: [{ samples: new Float32Array(80_000), rate: 8000 }], mixed: true }),
    recognizeLocalPieces: async () => [{ start: 0, end: 3, text: "оплатим в пятницу" }],
  }
  const done = await runCli(["office", "meetings", "transcribe", "--offline", "--json"], { keyring, speech })
  expect(done.code, done.err).toBe(0)
  expect(done.json().item).toMatchObject({ transcribed: 1 })
  expect(table.asked).toHaveLength(asked)
})

it("session start refuses files_from sftp before it asks any password", async () => {
  await configure({ files_from: "sftp", sftp_host: "pbx.example.test", sftp_user: "reader" })
  const started = await runCli(["office", "session", "start", "--json"], { keyring: memoryKeyring(), stdin: "x\n" })
  expect(started.json()).toMatchObject({ error: { code: "configuration_error", reason: "source.bad-setting" } })
  expect(started.err).not.toContain("password of the SFTP user")
})
