import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, expect, it } from "vitest"
import { callsOf } from "./cdr/calls.js"
import { csvRows } from "./cdr/csv.js"
import { cdrRow } from "./cdr/record.js"
import { openAsteriskStore } from "./store.js"
import { asteriskFolder, configure, freshFolders, runCli } from "./testing/harness.js"

// Written by bin/dev-pbx: ring group 600 (101, 102), queue 700 (103, 101), twelve calls between Local channels.
const OFFICE = readFileSync(new URL("testing/office-master.csv", import.meta.url), "utf8")
const ZONE = "Europe/Madrid"
const EXTENSION = /^\d{2,5}$/

const rowsOf = (text: string) => csvRows(text).rows.map((raw) => cdrRow(raw, ZONE))

beforeEach(freshFolders)

it("joins the office's 29 CDR rows into its 12 calls, each with what became of it", () => {
  const calls = callsOf(rowsOf(OFFICE), EXTENSION).map((call) => ({
    from: call.legs[0]?.row.src,
    dialed: call.dialed,
    direction: call.direction,
    outcome: call.outcome,
    answeredBy: call.answeredBy,
    placedBy: call.placedBy,
    rang: call.rang,
    waitS: call.waitMs === null ? null : call.waitMs / 1000,
    talkS: call.talkMs === null ? null : call.talkMs / 1000,
  }))
  const at = (from: string, dialed: string) => calls.filter((one) => one.from === from && one.dialed === dialed)
  expect(calls).toHaveLength(12)
  expect(at("79161234567", "600")).toEqual([
    expect.objectContaining({ outcome: "answered", answeredBy: ["101"], rang: ["102"], waitS: 3, talkS: 24 }),
    expect.objectContaining({ outcome: "answered", answeredBy: ["102"], rang: ["101"], waitS: 5 }),
  ])
  expect(at("79035550000", "600")).toEqual([
    expect.objectContaining({ outcome: "voicemail", answeredBy: [], rang: ["101", "102"], waitS: null }),
  ])
  expect(at("79267770011", "700")).toEqual([
    expect.objectContaining({ outcome: "answered", answeredBy: ["103"], rang: ["101"], waitS: 6 }),
  ])
  expect(at("74957770000", "102")).toEqual([expect.objectContaining({ outcome: "busy", answeredBy: [] })])
  expect(at("79161112233", "103")).toEqual([
    expect.objectContaining({ direction: "incoming", outcome: "answered", answeredBy: ["101", "103"], waitS: 2 }),
  ])
  expect(at("101", "102")).toEqual([
    expect.objectContaining({ direction: "internal", placedBy: "101", answeredBy: ["102"] }),
  ])
  expect(at("101", "74951234567")).toEqual([
    expect.objectContaining({ direction: "outgoing", outcome: "answered", placedBy: "101", answeredBy: [] }),
  ])
  expect(at("102", "74959990000")).toEqual([
    expect.objectContaining({ direction: "outgoing", outcome: "no_answer", answeredBy: [] }),
  ])
  expect(at("79990001122", "103")).toEqual([
    expect.objectContaining({ outcome: "no_answer", rang: ["103"], waitS: null }),
  ])
  expect(at("anonymous", "600")).toEqual([expect.objectContaining({ outcome: "answered", answeredBy: ["102"] })])
  expect(at("102", "79035550000")).toEqual([
    expect.objectContaining({ direction: "outgoing", outcome: "answered", placedBy: "102", answeredBy: [] }),
  ])
})

it("names who answered from the phone's channel on a real PBX, past the ring group's number", () => {
  const text = [
    '"","79161234567","600","from-trunk","""Иван"" <79161234567>","PJSIP/trunk-00000001","PJSIP/101-00000002",' +
      '"Dial","PJSIP/101","2026-11-02 10:00:00","","2026-11-02 10:00:07",7,0,"NO ANSWER","DOCUMENTATION",' +
      '"1762077600.1","","","1762077600.1",1',
    '"","79161234567","600","from-trunk","""Иван"" <79161234567>","PJSIP/trunk-00000001","PJSIP/102-00000003",' +
      '"Dial","PJSIP/102","2026-11-02 10:00:00","2026-11-02 10:00:07","2026-11-02 10:01:00",60,53,"ANSWERED",' +
      '"DOCUMENTATION","1762077600.1","","","1762077600.1",2',
  ].join("\n")
  const [call] = callsOf(rowsOf(text), EXTENSION)
  expect(call).toMatchObject({ outcome: "answered", answeredBy: ["102"], rang: ["101"], waitMs: 7_000 })
})

const office = async () => {
  const root = asteriskFolder({ "Master.csv": OFFICE })
  await configure({ cdr_csv_path: join(root, "Master.csv"), cdr_timezone: ZONE, phone_region: "ru" })
}

const sync = () => runCli(["office", "meetings", "sync", "--since-time", "2026-11-01T00:00:00Z", "--json"])

const crmContact = async (externalId: string, name: string, phone: string) => {
  const store = await openAsteriskStore(process.env)
  try {
    const crm = { provider: "bitrix24", account: "work" }
    await store.accounts.registerProvider({ name: "bitrix24", kind: "crm", aliases: [], command: "b24" })
    await store.accounts.saveAccount(crm, { name: "work", scope: "work" })
    await store.crm.savePeople(crm, [{ externalId, name, phone }])
  } finally {
    await store.close()
  }
}

const shown = async (title: string) => {
  const list = await runCli(["office", "meetings", "list", "--limit", "50", "--json"])
  const id = (list.json().items as { id: string; title: string }[]).find((one) => one.title === title)?.id
  const details = await runCli(["office", "meetings", "show", String(id), "--json"])
  expect(details.code, details.err).toBe(0)
  type Shown = { description: string; participants: { name: string | null; role: string; person: unknown }[] }
  return (details.json() as { item: { item: Shown } }).item.item
}

it("a sync keeps one meeting per call, with the caller and each employee who talked", async () => {
  await office()
  const synced = await sync()
  expect(synced.code, synced.err).toBe(0)
  const list = await runCli(["office", "meetings", "list", "--limit", "50", "--json"])
  const titles = (list.json().items as { title: string }[]).map(({ title }) => title)
  expect(titles).toHaveLength(12)
  expect(titles).toContain("+79035550000 → 600")
  const transfer = await shown("+79161112233 → 103")
  expect(transfer.participants.map(({ name, role }) => [name, role])).toEqual([
    ["Ольга Новикова", "client"],
    ["Анна Смирнова", "manager"],
    [null, "manager"],
  ])
  expect(transfer.description).toBe(
    "Incoming call to 103: answered by 101 Анна Смирнова, then 103 after 0:02, talk 0:25.",
  )
  expect((await shown("+79035550000 → 600")).description).toBe(
    "Incoming call to 600: went to voicemail after ringing 101 Анна Смирнова, 102 Борис Кузнецов.",
  )
})

it("a sync links the caller to the b24 contact with the same mobile number", async () => {
  await crmContact("701", "Иван Тестов из CRM", "8 (916) 123-45-67")
  await office()
  expect((await sync()).code).toBe(0)
  const call = await shown("+79161234567 → 101")
  expect(call.participants.find(({ role }) => role === "client")).toMatchObject({
    person: { name: "Иван Тестов из CRM" },
  })
})

const oldRowMeeting = async (externalId: string, startedAt: string) => {
  const store = await openAsteriskStore(process.env)
  try {
    const [call] = await store.meetings.meetings({})
    await store.meetings.saveMeeting({
      meeting: {
        accountId: call?.accountId as number,
        externalId,
        title: "+79161234567 → 600",
        description: null,
        location: null,
        joinUrl: null,
        startedAt: Date.parse(startedAt),
        endedAt: null,
        durationMs: null,
        timezone: null,
        hostIdentityId: null,
        metadata: {},
        deletedAt: null,
      },
      now: Date.now(),
    })
  } finally {
    await store.close()
  }
}

const count = async () =>
  ((await runCli(["office", "meetings", "list", "--limit", "50", "--json"])).json().items as unknown[]).length

it("a sync replaces the row meetings older versions kept for the rows it read", async () => {
  await office()
  expect((await sync()).code).toBe(0)
  await oldRowMeeting("1794625502.3#3", "2026-11-14T03:05:02Z")
  expect(await count()).toBe(13)
  const synced = await sync()
  expect(synced.code, synced.err).toBe(0)
  expect(synced.err).toContain("1 meetings of single call records")
  expect(await count()).toBe(12)
})

it("a sync keeps an older row meeting whose rows it did not read again", async () => {
  await office()
  expect((await sync()).code).toBe(0)
  await oldRowMeeting("1762000000.1#1", "2026-11-01T12:00:00Z")
  const synced = await runCli(["office", "meetings", "sync", "--json"])
  expect(synced.code, synced.err).toBe(0)
  expect(await count()).toBe(13)
})

it("extension 101 of two PBXs is two people, not one", async () => {
  await office()
  const root = asteriskFolder({ "Master.csv": OFFICE })
  for (const [key, value] of Object.entries({ cdr_csv_path: join(root, "Master.csv"), cdr_timezone: ZONE }))
    expect((await runCli(["branch", "config", "set", key, value, "--json"])).code).toBe(0)
  expect((await sync()).code).toBe(0)
  const branch = await runCli(["branch", "meetings", "sync", "--since-time", "2026-11-01T00:00:00Z", "--json"])
  expect(branch.code, branch.err).toBe(0)
  const anna = async (profile: string) => {
    const list = await runCli([profile, "meetings", "list", "--limit", "50", "--json"])
    const id = (list.json().items as { id: string; title: string }[]).find((one) => one.title === "101 → 102")?.id
    const shown = (await runCli([profile, "meetings", "show", String(id), "--json"])).json() as {
      item: { item: { participants: { name: string | null; person: { ref: string } }[] } }
    }
    return shown.item.item.participants.find(({ name }) => name === "Анна Смирнова")?.person.ref
  }
  const [office101, branch101] = [await anna("office"), await anna("branch")]
  expect(office101).toBeDefined()
  expect(branch101).toBeDefined()
  expect(office101).not.toBe(branch101)
})

it("reads a number in the one listed country it fits, and keeps one that fits two as written", async () => {
  const root = asteriskFolder({ "Master.csv": OFFICE })
  await configure({ cdr_csv_path: join(root, "Master.csv"), cdr_timezone: ZONE, phone_region: "es,ru" })
  expect((await sync()).code).toBe(0)
  expect((await shown("+79161234567 → 101")).participants[0]).toMatchObject({ role: "client" })

  await configure({ phone_region: "ru,de" })
  const synced = await sync()
  expect(synced.code, synced.err).toBe(0)
  expect(synced.err).toMatch(/callers' numbers fit more than one of phone_region's countries/)
  const list = await runCli(["office", "meetings", "list", "--limit", "50", "--json"])
  expect((list.json().items as { title: string }[]).map(({ title }) => title)).toContain("79161234567 → 101")
})
