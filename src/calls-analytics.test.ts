import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { MeetingEmbedder, MeetingMeaningApi } from "@wirecat/cli-core/services"
import { beforeEach, expect, it } from "vitest"
import { asteriskFolder, configure, fakeSpeech, freshFolders, type Ran, runCli } from "./testing/harness.js"

const EXAMPLES = new URL("../examples/", import.meta.url)
const IN_CALL = "monitor/2026/10/31/in-74950000000-79000000001-20261031-120000-1761901200.11.wav"
const OUT_CALL = "monitor/2026/10/31/out-89000000002-102-20261031-130000-1761904800.21.wav"

/** What each synthetic call says: one client wants a refund, the other is unhappy that the courier was late. */
const SAID: Record<string, string> = {
  [IN_CALL]: "I want a refund for the broken kettle",
  [OUT_CALL]: "the courier was late and the parcel came on Tuesday",
}

// Each axis is one invented topic; a text points along every topic one of its words belongs to.
const TOPICS = [
  ["refund", "money", "price", "kettle"],
  ["delivery", "courier", "parcel", "late"],
]
const topics: MeetingEmbedder = {
  key: "local:topics:3",
  model: "topics",
  dims: 3,
  kind: "local",
  embed: async (texts) =>
    texts.map((text) => {
      const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
      const vector = new Float32Array(3)
      TOPICS.forEach((topic, axis) => {
        vector[axis] = words.filter((word) => topic.includes(word)).length
      })
      vector[2] = 0.1
      const length = Math.hypot(...vector)
      return vector.map((value) => value / length)
    }),
  close: async () => {},
}

/** cli-core's meaning code with the topics model in place of a downloaded one. */
const meaning = async (): Promise<MeetingMeaningApi> => {
  const services = await import("@wirecat/cli-core/services")
  return {
    searchMeetingsCombined: services.searchMeetingsCombined,
    proposeMeetingEmbedding: services.proposeMeetingEmbedding,
    applyMeetingEmbedding: services.applyMeetingEmbedding,
    createMeetingRemoteModel: services.createMeetingRemoteModel,
    meetingEmbeddingModel: () => ({ key: topics.key, model: topics.model, dims: topics.dims, kind: topics.kind }),
    openMeetingEmbedder: async () => topics,
  }
}

const pbx = (...args: string[]) => runCli(["office", ...args, "--json"], { meaning })
const titles = (answer: Record<string, unknown>) =>
  (answer.items as { source: { title: string } }[]).map(({ source }) => source.title)
const body = (ran: Ran) => {
  expect(ran.code, ran.err).toBe(0)
  return ran.json()
}

let ids: Record<string, string> = {}

beforeEach(async () => {
  freshFolders()
  const wav = readFileSync(new URL(IN_CALL, EXAMPLES))
  const root = asteriskFolder({
    "Master.csv": readFileSync(new URL("Master.csv", EXAMPLES), "utf8"),
    [IN_CALL]: wav,
    [OUT_CALL]: wav,
  })
  await configure({
    cdr_csv_path: join(root, "Master.csv"),
    recordings_path: join(root, "monitor"),
    cdr_timezone: "Europe/Moscow",
    phone_region: "ru",
  })
  body(await pbx("meetings", "sync", "--since-time", "2026-10-01T00:00:00Z"))
  let heard = ""
  const speech = fakeSpeech({
    decodeChannelsFile: async (path) => {
      heard = SAID[Object.keys(SAID).find((call) => path.endsWith(call)) ?? ""] ?? ""
      return { channels: [{ samples: new Float32Array(80_000), rate: 8000 }], mixed: false }
    },
    recognizeLocalPieces: async () => [{ start: 0, end: 4, text: heard }],
  })
  const done = await runCli(["office", "meetings", "transcribe", "--json"], { speech })
  expect(done.json().item).toMatchObject({ transcribed: 2 })
  const items = body(await pbx("meetings", "list")).items as { id: string; title: string }[]
  ids = Object.fromEntries(items.map(({ id, title }) => [title, id]))
})

it("stats calls show counts the stored calls by direction and outcome, in one envelope", async () => {
  const stats = body(await pbx("stats", "calls", "show", "--since-time", "2026-10-01", "--timezone", "Europe/Moscow"))
  expect(stats.item).toMatchObject({
    calls: 5,
    by_direction: { incoming: 3, outgoing: 1, internal: 1 },
    by_outcome: { answered: 4, no_answer: 1 },
    missed: { calls: 1 },
  })
  expect(Object.keys(stats).sort()).toEqual(["item", "meta"])
  expect((stats.meta as { run_id: string }).run_id).toContain("stats-calls-show")
})

it("search meetings finds a call by its words, and with a model by what it means", async () => {
  const words = body(await pbx("search", "meetings", "refund"))
  expect(titles(words)).toEqual(["+79000000001 → 101"])
  expect(words.item).toBeUndefined()

  const preview = body(await pbx("meetings", "embed", "--model", "topics"))
  expect(JSON.stringify(preview)).not.toContain('"item":{"item"')
  body(await pbx("meetings", "embed", "--model", "topics", "--yes"))
  const meant = body(await pbx("search", "meetings", "was the delivery slow", "--model", "topics"))
  expect(titles(meant)[0]).toBe("102 → +79000000002")
})

it("tags add --matching marks every call the search finds, a rerun changes nothing, and --meeting marks by id", async () => {
  const added = body(await pbx("tags", "add", "complaint", "--matching", "refund OR courier"))
  expect((added.item as { changed: unknown[] }).changed).toHaveLength(2)
  const again = body(await pbx("tags", "add", "complaint", "--matching", "refund OR courier"))
  expect((again.item as { changed: unknown[] }).changed).toHaveLength(0)
  const listed = body(await pbx("tags", "list", "tag:complaint"))
  expect(listed.items).toHaveLength(2)

  body(await pbx("tags", "add", "vip", "--meeting", ids["+79000000001 → 101"] ?? ""))
  const vip = body(await pbx("search", "meetings", "refund", "--tag", "vip"))
  expect(vip.items).toHaveLength(1)
})

it("meetings show draws the call's WireCat Desktop link for a person, and leaves the JSON as it is", async () => {
  const id = ids["+79000000001 → 101"] ?? ""
  const shown = await runCli(["office", "meetings", "show", id], { tty: true })
  expect(shown.code, shown.err).toBe(0)
  expect(shown.out).toContain("Open in WireCat Desktop: wirecat://open/v1/meeting/asterisk/office/1761901200.11")
  const json = body(await pbx("meetings", "show", id))
  expect(JSON.stringify(json)).not.toContain("wirecat://")
  const off = await runCli(["office", "meetings", "show", id], { tty: true, env: { WIRECAT_LINKS: "off" } })
  expect(off.out).not.toContain("wirecat://")
})
