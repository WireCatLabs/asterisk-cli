import { existsSync } from "node:fs"
import { CliError, isCliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { defineQuery, fieldsHelp, parseLucene, validateQuery } from "@wirecat/cli-base/query"
import { answerEntity, type BaseEnvironment, baseContext, environmentOf, FETCH } from "@wirecat/cli-core/cli"
import { MEETING_QUERY, type MeetingStore, type MeetingTranscriptReceiptStore } from "@wirecat/cli-core/meetings"
import { queryWordsAfterOptions } from "@wirecat/cli-core/meetings/cli"
import { Command } from "commander"
import * as v from "valibot"
import { configuration } from "../config.js"
import type { FileAccess } from "../files.js"
import { IDENTITY } from "../identity.js"
import { sourceOf } from "../source.js"
import type { TranscribeReport } from "../transcribe-calls.js"
import { DEFAULT_SPEECH_MODEL } from "./models.js"

export type Speech = Pick<
  typeof import("@wirecat/cli-core/speech"),
  | "findModel"
  | "isInstalled"
  | "modelsDirectory"
  | "localSpeechRecognitionModel"
  | "decodeChannelsFile"
  | "recognizeLocalPieces"
  | "cloudSpeech"
  | "vadPath"
>

/** A test hands in its own speech engine here; the real one needs a model hundreds of MB large. */
export interface SpeechEnvironment extends BaseEnvironment {
  speech?: Speech
}

export interface TranscribeDeps {
  store: () => MeetingStore & MeetingTranscriptReceiptStore
  accountId: () => number
  files: () => Promise<FileAccess>
  env: () => NodeJS.ProcessEnv
  signal: () => AbortSignal | undefined
  progress: (line: string) => void
  write: (report: TranscribeReport, command: Command) => void
}

const count = (name: string) => (text: string) => {
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 0) throw new CliError("validation_error", `${name} takes a whole number`)
  return value
}

/** Without a query: every call of at least five seconds; shorter ones are mostly no answer or a hang-up. */
export const DEFAULT_QUERY = "duration_ms>=5000"

/** An MP3, Ogg or FLAC file is read whole for its bundled decoder; WAV, GSM and M4A go to ffmpeg by path. */
export const LARGEST_COMPRESSED = 640 * 1024 * 1024

const GUIDE = "https://github.com/WireCatLabs/cli-core/blob/main/docs/search/query-language.md"

export const callQuery = (text: string) => {
  const context = { command: "meetings transcribe", guide: GUIDE }
  const query = parseLucene(text, { defaultField: "none", ...context })
  validateQuery(query, MEETING_QUERY, context)
  return query
}

const REPORT = v.strictObject({
  transcribed: v.number(),
  audio_ms: v.number(),
  failed: v.array(v.strictObject({ meeting: v.number(), ref: v.string(), reason: v.string(), message: v.string() })),
  remaining: v.number(),
  stopped: v.boolean(),
})

/** cli-core names `models ai set` for the key, a command pbx does not have; the variable is how pbx gets it. */
const cloudOf = (speech: Speech, deps: Parameters<Speech["cloudSpeech"]>[0]) => {
  try {
    return speech.cloudSpeech(deps)
  } catch (error) {
    if (isCliError(error) && error.details.reason === "transcription.no-key")
      throw new CliError(
        "authentication_error",
        "transcribe_engine openai needs the service's key: give it in OPENAI_API_KEY for this run",
        { reason: "transcription.no-key" },
      )
    throw error
  }
}

export const transcribeCommand = (deps: TranscribeDeps): Command => {
  const command = queryWordsAfterOptions(
    answerEntity(
      annotate(new Command("transcribe"), {
        effects: FETCH,
        cooperative: true,
        partial: true,
        query: defineQuery(MEETING_QUERY),
        examples: [
          `${IDENTITY.command} office meetings transcribe --max-meetings 20 --json`,
          `${IDENTITY.command} office meetings transcribe duration_ms>=60000 --json`,
          `${IDENTITY.command} office meetings transcribe id:12 --replace --json`,
        ],
      }),
      "call_transcription_report",
      REPORT,
    ),
  )
    .summary("turn call recordings into text, on this computer or a chosen service")
    .description(
      "read each call's recording, never changing it, and recognize the speech with a local speech model; a " +
        "profile with transcribe_engine openai sends the audio to that service instead, and the run says so first",
    )
    .argument("[query...]", `field:value terms that pick the calls (default ${DEFAULT_QUERY}) — the fields are below`)
    .addHelpText(
      "after",
      `\nThe calls the query names that have a recording and no transcript yet, newest first, at most ` +
        `--max-meetings of them; without a query, ${DEFAULT_QUERY}. A recording already transcribed is not read ` +
        `again unless it changed. WAV, GSM and M4A recordings need ffmpeg. A recording longer than one hour, or an ` +
        `MP3, Ogg or FLAC file larger than ${LARGEST_COMPRESSED / 1024 / 1024} MB, is not transcribed. A call that fails is listed and the rest go ` +
        `on.\n\n${fieldsHelp(MEETING_QUERY, GUIDE)}`,
    )
    .option("--replace", "transcribe calls that already have a transcript too, replacing it")
    .option("--max-meetings <n>", "at most this many calls transcribed, newest first", count("--max-meetings"), 20)
    .option("--model <model>", "local speech model, when the profile transcribes locally", DEFAULT_SPEECH_MODEL)
  return command.action(async function (this: Command, words: string[], opts: Record<string, unknown>) {
    const { replace, maxMeetings: limit, model } = opts as { replace?: boolean; maxMeetings: number; model: string }
    const context = baseContext(this, configuration.resolveSettings)
    const query = callQuery(words.join(" ").trim() || DEFAULT_QUERY)
    const env = deps.env()
    const speech: Speech = environmentOf<SpeechEnvironment>(this).speech ?? (await import("@wirecat/cli-core/speech"))
    const signal = deps.signal()
    const own = context.settings.configured
    // Only the profile's own section turns it on; cli-core's speech reads its own names for the two settings.
    const cloud = cloudOf(speech, {
      app: IDENTITY,
      env,
      keyring: context.keyring,
      settings: { configured: { transcribeWith: own.transcribe_engine, transcribeModel: own.transcribe_model } },
      notify: deps.progress,
      signal,
    })
    // cli-core finds the speech with the local voice detector before it sends a piece; without it every call fails.
    if (cloud && !existsSync(speech.vadPath(speech.modelsDirectory(env))))
      throw new CliError(
        "not_found",
        `the voice detector that finds the speech before it is sent is not on this computer; it comes with any ` +
          `local speech model: ${IDENTITY.command} models download ${DEFAULT_SPEECH_MODEL}`,
        { reason: "model.not-downloaded" },
      )
    if (!cloud) {
      const chosen = speech.findModel(model)
      if (!chosen)
        throw new CliError("validation_error", `no speech model ${model}; see ${IDENTITY.command} models list`)
      if (!speech.isInstalled(chosen, speech.modelsDirectory(env)))
        throw new CliError(
          "not_found",
          `the speech model ${model} is not on this computer; download it once with ${IDENTITY.command} models download ${model}`,
          { reason: "model.not-downloaded" },
        )
    }
    const { transcribeCalls } = await import("../transcribe-calls.js")
    const local = cloud ? null : speech.localSpeechRecognitionModel(model)
    const recognition = cloud
      ? cloud.recognition
      : { engine: local?.engine ?? "local", model: local?.model ?? model, version: local?.version }
    const sides = sourceOf(context.settings).recordingSides
    // Unbounded: run() already stops this cooperative command at its deadline by its signal, and it answers with what
    // it finished; the run's own deadline would throw that answer away instead.
    const report = await context.run(
      () =>
        transcribeCalls(
          {
            store: deps.store(),
            accountId: deps.accountId(),
            files: deps.files,
            decode: async (path) => (await speech.decodeChannelsFile(path, { maxBytes: LARGEST_COMPRESSED })).channels,
            recognize: cloud
              ? (pcm) => cloud.recognize(pcm)
              : (pcm) => speech.recognizeLocalPieces(model, pcm, { env, ...(signal ? { signal } : {}) }),
            recognition,
            sides,
          },
          {
            query,
            limit,
            ...(replace ? { replace } : {}),
            progress: deps.progress,
            ...(signal ? { signal } : {}),
          },
        ),
      { unbounded: true },
    )
    deps.write(report, this)
  })
}
