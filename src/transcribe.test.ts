import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Pcm } from "@wirecat/cli-core/speech"
import { beforeEach, expect, it } from "vitest"
import type { Speech } from "./commands/transcribe.js"
import { asteriskFolder, configure, fakeSpeech, freshFolders, runCli } from "./testing/harness.js"

const EXAMPLES = new URL("../examples/", import.meta.url)
const IN_CALL = "monitor/2026/10/31/in-74950000000-79000000001-20261031-120000-1761901200.11.wav"
const OUT_CALL = "monitor/2026/10/31/out-89000000002-102-20261031-130000-1761904800.21.wav"

const mono = (): Pcm => ({ samples: new Float32Array(8000 * 10), rate: 8000 })

const speech = fakeSpeech

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

it("transcribes the calls that have a recording, lists those without as failed, and finds what the client said", async () => {
  const done = await transcribe([], { speech: speech() })
  expect(done.code, done.err).toBe(0)
  const item = done.json().item as { transcribed: number; audio_ms: number; failed: { ref: string; reason: string }[] }
  expect(item).toMatchObject({ transcribed: 2, remaining: 0 })
  expect(item.audio_ms).toBeGreaterThan(0)
  expect(item.failed.map(({ reason }) => reason)).toEqual([
    "recording.missing",
    "recording.missing",
    "recording.missing",
  ])
  expect(item.failed.every(({ ref }) => ref.startsWith("meeting:"))).toBe(true)

  const list = await runCli(["office", "meetings", "list", "--json"])
  const call = (list.json().items as { id: string; title: string }[]).find(
    ({ title }) => title === "+79000000001 → 101",
  )
  const transcript = await runCli(["office", "meetings", "transcript", call?.id ?? "", "--json"])
  expect(transcript.code, transcript.err).toBe(0)
  expect(transcript.out).toContain("оплатим в пятницу")

  const again = await transcribe([], { speech: speech() })
  expect(again.json().item).toMatchObject({ transcribed: 0, failed: [{}, {}, {}] })
})

it("lists a recording that cannot be decoded and goes on with the rest", async () => {
  let calls = 0
  const failing = speech({
    decodeChannelsFile: async () => {
      calls++
      if (calls === 1) throw new Error("ffmpeg is not installed")
      return { channels: [mono()], mixed: false }
    },
  })
  const done = await transcribe([], { speech: failing })
  expect(done.code, done.err).toBe(0)
  const item = done.json().item as { transcribed: number; failed: { reason: string }[] }
  expect(item.transcribed).toBe(1)
  expect(item.failed.filter(({ reason }) => reason !== "recording.missing")).toMatchObject([{ reason: "unexpected" }])
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
    decodeChannelsFile: async () => ({ channels: [mono(), mono()], mixed: false }),
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

it("decodes each recording where it lies, by its path, with nothing held in memory first", async () => {
  const paths: string[] = []
  const done = await transcribe([], {
    speech: speech({
      decodeChannelsFile: async (path) => {
        paths.push(path)
        return { channels: [mono()], mixed: false }
      },
    }),
  })
  expect(done.code, done.err).toBe(0)
  expect(paths.sort()).toEqual([join(root, IN_CALL), join(root, OUT_CALL)].sort())
})

const CLOUD_LINE =
  "the recordings' audio leaves this computer: it goes to api.openai.com (gpt-transcribe) to be transcribed"

/** cli-core's cloud speech as a profile set to openai gets it: it says where the audio goes before the first piece. */
const cloud =
  (seen: unknown[]): Speech["cloudSpeech"] =>
  (deps) => {
    seen.push(deps.settings.configured)
    if (deps.settings.configured.transcribeWith !== "openai") return null
    let told = false
    return {
      baseUrl: "https://api.openai.com/v1",
      leavesComputer: true,
      recognition: { engine: "openai", model: "gpt-transcribe" },
      recognize: async () => {
        if (!told) deps.notify(CLOUD_LINE)
        told = true
        return [{ start: 0, end: 2, text: "хочу вернуть деньги" }]
      },
    }
  }

it("a profile set to transcribe with openai sends the audio there, and says so before the first call", async () => {
  await configure({ transcribe_engine: "openai", transcribe_model: "gpt-transcribe" })
  const seen: unknown[] = []
  const done = await transcribe([], { speech: speech({ cloudSpeech: cloud(seen), isInstalled: () => false }) })
  expect(done.code, done.err).toBe(0)
  expect(done.json().item).toMatchObject({ transcribed: 2 })
  expect(seen).toEqual([{ transcribeWith: "openai", transcribeModel: "gpt-transcribe" }])
  expect(done.err.indexOf(CLOUD_LINE)).toBeLessThan(done.err.indexOf("transcribed"))
  expect(done.err.split(CLOUD_LINE)).toHaveLength(2)
})

it("only the profile's own setting sends audio away: one in the shared defaults stays local", async () => {
  const set = await runCli(["config", "set", "transcribe_engine", "openai", "--defaults", "--json"])
  expect(set.code, set.err).toBe(0)
  const seen: unknown[] = []
  const done = await transcribe([], { speech: speech({ cloudSpeech: cloud(seen) }) })
  expect(done.code, done.err).toBe(0)
  expect(seen).toEqual([{ transcribeWith: undefined, transcribeModel: undefined }])
  expect(done.err).not.toContain("leaves this computer")
})

it("openai without the local voice detector refuses before any audio is read or sent, naming the download", async () => {
  await configure({ transcribe_engine: "openai" })
  const seen: unknown[] = []
  const done = await transcribe([], {
    speech: speech({ cloudSpeech: cloud(seen), vadPath: () => "/nowhere/vad.onnx" }),
  })
  expect(done.json()).toMatchObject({ error: { reason: "model.not-downloaded" } })
  expect(done.err).toContain("pbx models download gigaam-v3")
  expect(done.err).not.toContain("leaves this computer")
})

it("openai without a key refuses before any recording is read, and names the variable that gives it", async () => {
  await configure({ transcribe_engine: "openai" })
  const { cloudSpeech } = await import("@wirecat/cli-core/speech")
  let read = 0
  const done = await transcribe([], {
    speech: speech({
      cloudSpeech,
      decodeChannelsFile: async () => {
        read++
        return { channels: [mono()], mixed: false }
      },
    }),
  })
  expect(done.json()).toMatchObject({ error: { reason: "transcription.no-key" } })
  expect(done.err).toContain("OPENAI_API_KEY")
  expect(read).toBe(0)
})

it("transcribe_engine takes local or openai only", async () => {
  const set = await runCli(["office", "config", "set", "transcribe_engine", "whisper", "--json"])
  expect(set.code).not.toBe(0)
  expect(set.err).toContain("local or openai")
})
