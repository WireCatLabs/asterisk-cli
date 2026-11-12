import { appendFileSync, readFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { wallClock } from "@wirecat/cli-core/cli"
import { afterEach, beforeEach, expect, it } from "vitest"
import { openAsteriskStore } from "./store.js"
import { asteriskFolder, configure, freshFolders, runCli } from "./testing/harness.js"

const EXAMPLES = new URL("../examples/", import.meta.url)
const MASTER = readFileSync(new URL("Master.csv", EXAMPLES), "utf8")
const WAV = readFileSync(
  new URL("monitor/2026/10/31/in-74950000000-79000000001-20261031-120000-1761901200.11.wav", EXAMPLES),
)

const IN_CALL = "monitor/2026/10/31/in-74950000000-79000000001-20261031-120000-1761901200.11.wav"
const OUT_CALL = "monitor/2026/10/31/out-89000000002-102-20261031-130000-1761904800.21.wav"

let root = ""

const office = async () => {
  root = asteriskFolder({ "Master.csv": MASTER, [IN_CALL]: WAV, [OUT_CALL]: WAV })
  await configure({
    cdr_csv_path: join(root, "Master.csv"),
    recordings_path: join(root, "monitor"),
    cdr_timezone: "Europe/Moscow",
    phone_region: "ru",
  })
}

const sync = () => runCli(["office", "meetings", "sync", "--since-time", "2026-10-01T00:00:00Z", "--json"])

interface Listed {
  id: string
  title: string
  started_at: string
}

const listed = async (): Promise<Listed[]> => {
  const list = await runCli(["office", "meetings", "list", "--limit", "50", "--json"])
  expect(list.code, list.err).toBe(0)
  return list.json().items as Listed[]
}

const details = async (id: string) => {
  const shown = await runCli(["office", "meetings", "show", id, "--json"])
  expect(shown.code, shown.err).toBe(0)
  return JSON.stringify(shown.json())
}

beforeEach(freshFolders)

afterEach(() => {
  delete process.env.ASTERISK_TOKEN
})

const externalIds = async () => {
  const store = await openAsteriskStore(process.env, { readOnly: true })
  try {
    return (await store.meetings.meetings({})).map(({ externalId }) => externalId)
  } finally {
    await store.close()
  }
}

it("imports each CDR row of Master.csv as a meeting, its times read in the CDR's zone", async () => {
  await office()
  const synced = await sync()
  expect(synced.code, synced.err).toBe(0)

  const calls = await listed()
  expect(calls).toHaveLength(6)
  const first = calls.find(({ title }) => title === "+79000000001 → 101")
  expect(first?.started_at).toBe("2026-10-31T09:00:00.000Z")
  expect(calls.map(({ title }) => title)).toContain("102 → +79000000002")
  expect(calls.map(({ title }) => title)).toContain("101 → 102")
})

it("a second sync of the same file adds nothing, and a new row is added once", async () => {
  await office()
  expect((await sync()).code).toBe(0)
  expect((await sync()).code).toBe(0)
  expect(await listed()).toHaveLength(6)

  const at = (offsetMs: number) =>
    `${wallClock("Europe/Moscow").time(new Date(Date.now() - offsetMs).toISOString())}:00`
  appendFileSync(
    join(root, "Master.csv"),
    '"","79000000005","74950000000","from-trunk","""Test Caller"" <79000000005>","PJSIP/trunk-0000000c",' +
      `"PJSIP/101-0000000d","Dial","PJSIP/101,30","${at(120_000)}","${at(110_000)}",` +
      `"${at(60_000)}",60,50,"ANSWERED","DOCUMENTATION","1761980400.61","","","1761980400.61",61\n`,
  )
  const again = await runCli(["office", "meetings", "sync", "--json"])
  expect(again.code, again.err).toBe(0)
  expect(await listed()).toHaveLength(7)
})

it("keeps the two legs of a transferred call apart: one uniqueid, two sequences, two meetings", async () => {
  await office()
  expect((await sync()).code).toBe(0)
  const legs = (await listed()).filter(({ title }) => title.startsWith("+79000000004"))
  expect(legs.map(({ title }) => title).sort()).toEqual(["+79000000004 → 101", "+79000000004 → 103"])
  expect((await externalIds()).filter((id) => id.startsWith("1761912000.41#")).sort()).toEqual([
    "1761912000.41#41",
    "1761912000.41#42",
  ])
})

it("links a call's recording by its uniqueid in the date folder, and a missed call has none", async () => {
  await office()
  expect((await sync()).code).toBe(0)
  const calls = await listed()
  const answered = calls.find(({ title }) => title === "+79000000001 → 101") as Listed
  const outgoing = calls.find(({ title }) => title === "102 → +79000000002") as Listed
  const missed = calls.find(({ title }) => title === "+79000000003 → 101") as Listed
  expect(await details(answered.id)).toContain("1761901200.11.wav")
  expect(await details(outgoing.id)).toContain("1761904800.21.wav")
  expect(await details(missed.id)).not.toContain(".wav")
})

it("leaves a recording that is still being written for the next sync", async () => {
  await office()
  const now = new Date()
  utimesSync(join(root, IN_CALL), now, now)
  expect((await sync()).code).toBe(0)
  const answered = (await listed()).find(({ title }) => title === "+79000000001 → 101") as Listed
  expect(await details(answered.id)).not.toContain(".wav")
})

it("skips a row it cannot read, says so, and imports the rest", async () => {
  await office()
  appendFileSync(join(root, "Master.csv"), `${MASTER.split("\n")[0]?.replace("2026-10-31 12:00:00", "not a time")}\n`)
  const synced = await sync()
  expect(synced.code, synced.err).toBe(0)
  expect(synced.err).toContain("1 call records could not be read")
  expect(await listed()).toHaveLength(6)
})

it("names the setting to fill when the profile has no source yet", async () => {
  const synced = await runCli(["fresh", "meetings", "sync", "--json"])
  expect(synced.code).not.toBe(0)
  expect(synced.json()).toMatchObject({ error: { code: "configuration_error", reason: "source.not-configured" } })
  expect(synced.err).toContain("asterisk fresh config set cdr_csv_path")
})

it("session start on a local Master.csv needs no password, checks the file, and keeps nothing", async () => {
  await office()
  const started = await runCli(["office", "session", "start", "--json"])
  expect(started.code, started.err).toBe(0)
  expect(started.json().item).toMatchObject({ password: "none", stored_in: null, verified: true, cdr: "csv" })

  const list = await runCli(["session", "list", "--json"])
  expect(list.json().items).toContainEqual(expect.objectContaining({ profile: "office", signed_in: true }))
})
