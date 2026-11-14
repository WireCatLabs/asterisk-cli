import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Pcm } from "@wirecat/cli-core/speech"
import { beforeEach, expect, it } from "vitest"
import type { Speech } from "./commands/transcribe.js"
import { asteriskFolder, configure, freshFolders, runCli } from "./testing/harness.js"
import { largestRecording } from "./transcribe-calls.js"

const EXAMPLES = new URL("../examples/", import.meta.url)
const IN_CALL = "monitor/2026/10/31/in-74950000000-79000000001-20261031-120000-1761901200.11.wav"
const OUT_CALL = "monitor/2026/10/31/out-89000000002-102-20261031-130000-1761904800.21.wav"

const mono = (): Pcm => ({ samples: new Float32Array(8000 * 10), rate: 8000 })

const speech = (overrides: Partial<Speech> = {}): Speech => ({
  findModel: ((id: string) => (id === "gigaam-v3" ? { id } : undefined)) as Speech["findModel"],
  isInstalled: () => true,
  modelsDirectory: () => "/models",
  localSpeechRecognitionModel: ((model: string) => ({ engine: "sherpa-onnx", model, version: "1" })) as never,
  decodeChannels: async () => ({ channels: [mono()], mixed: true }),
  recognizeLocalPieces: async () => [
    { start: 0, end: 3, text: "Здравствуйте, по поводу оплаты" },
    { start: 3.5, end: 6, text: "оплатим в пятницу" },
  ],
  ...overrides,
})

const transcribe = (args: string[], options: { speech: Speech }) =>
  runCli(["office", "meetings", "transcribe", ...args, "--json"], options)

let root = ""

beforeEach(async () => {
  freshFolders()
  const wav = readFileSync(new URL(IN_CALL, EXAMPLES))
  root = asteriskFolder({
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
  const synced = await runCli(["office", "meetings", "sync", "--since-time", "2026-10-01T00:00:00Z", "--json"])
  expect(synced.code, synced.err).toBe(0)
})

it("transcribes the calls that have a recording, counts those without, and finds what the client said", async () => {
  const done = await transcribe([], { speech: speech() })
  expect(done.code, done.err).toBe(0)
  expect(done.json().item).toMatchObject({ transcribed: 2, failed: [], without_recording: 3, remaining: 0 })

  const list = await runCli(["office", "meetings", "list", "--json"])
  const call = (list.json().items as { id: string; title: string }[]).find(
    ({ title }) => title === "+79000000001 → 101",
  )
  const transcript = await runCli(["office", "meetings", "transcript", call?.id ?? "", "--json"])
  expect(transcript.code, transcript.err).toBe(0)
  expect(transcript.out).toContain("оплатим в пятницу")

  const again = await transcribe([], { speech: speech() })
  expect(again.json().item).toMatchObject({ transcribed: 0, without_recording: 3 })
})

it("lists a recording that cannot be decoded and goes on with the rest", async () => {
  let calls = 0
  const failing = speech({
    decodeChannels: async () => {
      calls++
      if (calls === 1) throw new Error("ffmpeg is not installed")
      return { channels: [mono()], mixed: true }
    },
  })
  const done = await transcribe([], { speech: failing })
  expect(done.code, done.err).toBe(0)
  expect(done.json().item).toMatchObject({ transcribed: 1, failed: [{ reason: "unexpected" }] })
})

it("refuses a model that is not downloaded, and says how to get it", async () => {
  const done = await transcribe([], { speech: speech({ isInstalled: () => false }) })
  expect(done.json()).toMatchObject({ error: { code: "not_found", reason: "model.not-downloaded" } })
  expect(done.err).toContain("pbx models download gigaam-v3")
})

it("stops at --max-meetings, and --replace transcribes again what has a transcript", async () => {
  const first = await transcribe(["--max-meetings", "1", "--model", "gigaam-v3"], { speech: speech() })
  expect(first.code, first.err).toBe(0)
  expect(first.json().item).toMatchObject({ transcribed: 1, remaining: 1 })
  await transcribe([], { speech: speech() })
  const replaced = await transcribe(["--replace"], { speech: speech() })
  expect(replaced.code, replaced.err).toBe(0)
  expect(replaced.json().item).toMatchObject({ transcribed: 2 })
})

const stereo = (): Speech => {
  let heard = 0
  return speech({
    decodeChannels: async () => ({ channels: [mono(), mono()], mixed: false }),
    recognizeLocalPieces: async () =>
      heard++ % 2 === 0
        ? [{ start: 0, end: 2, text: "Добрый день, компания" }]
        : [{ start: 2.5, end: 4, text: "Здравствуйте" }],
  })
}

const speakersOf = async (title: string) => {
  const list = await runCli(["office", "meetings", "list", "--json"])
  const call = (list.json().items as { id: string; title: string }[]).find((one) => one.title === title)
  const shown = await runCli(["office", "meetings", "transcript", call?.id ?? "", "--json"])
  expect(shown.code, shown.err).toBe(0)
  const [transcript] = shown.json().items as { lines: { speaker: string | null; text: string }[] }[]
  return (transcript?.lines ?? []).map(({ speaker, text }) => `${speaker}: ${text}`)
}

it("names a stereo call's channels by recordings_channels: the caller by name and number, the employee by extension", async () => {
  await configure({ recordings_channels: "employee,caller" })
  const done = await transcribe([], { speech: stereo() })
  expect(done.code, done.err).toBe(0)
  expect(await speakersOf("+79000000001 → 101")).toEqual([
    "101 Oleg Operatorov: Добрый день, компания",
    "Ivan Testov +79000000001: Здравствуйте",
  ])
})

it("keeps Channel 1 and Channel 2 without recordings_channels, and refuses another value", async () => {
  const done = await transcribe([], { speech: stereo() })
  expect(done.code, done.err).toBe(0)
  expect(await speakersOf("+79000000001 → 101")).toEqual([
    "Channel 1: Добрый день, компания",
    "Channel 2: Здравствуйте",
  ])
  const set = await runCli(["office", "config", "set", "recordings_channels", "left,right", "--json"])
  expect(set.code).not.toBe(0)
  expect(set.err).toContain("caller,employee or employee,caller")
})

it("reads what ffmpeg decodes up to 2 GB, since its output stops at an hour, and MP3, Ogg and FLAC up to 256 MB", () => {
  expect(largestRecording("in-1761901200.11.WAV")).toBe(2 * 1024 ** 3)
  expect(largestRecording("1761908400.31.gsm")).toBe(2 * 1024 ** 3)
  expect(largestRecording("external-1761904800.21.mp3")).toBe(256 * 1024 ** 2)
})
