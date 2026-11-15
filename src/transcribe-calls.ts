import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import { Readable, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { isCliError } from "@wirecat/cli-base"
import type { QueryAst } from "@wirecat/cli-base/query"
import {
  type Attachment,
  type MeetingStore,
  type MeetingTranscriptReceiptStore,
  transcribeMeeting,
} from "@wirecat/cli-core/meetings"
import type { Pcm } from "@wirecat/cli-core/speech"
import { callTranscriptionSource, type Recognition, type Recognize, speakersOf } from "./call-transcription.js"
import type { FileAccess } from "./files.js"
import type { RecordingSide } from "./source.js"

export interface TranscribeOptions {
  /** Which stored calls, in `meetings list`'s query language. */
  query: QueryAst
  limit: number
  /** Calls that already have a transcript are transcribed again too. */
  replace?: boolean
  now?: () => number
  progress?: (line: string) => void
  /** Checked before each call: once it aborts, the run stops after the call it is on and keeps what it did. */
  signal?: AbortSignal
}

export interface TranscribeReport {
  transcribed: number
  audio_seconds: number
  failed: { meeting: number; reason: string; message: string }[]
  /** Calls the query names that have no recording attached: nothing to transcribe. */
  without_recording: number
  remaining: number
  /** True when the run stopped on its signal before reaching --max-meetings. */
  stopped: boolean
}

export interface TranscribePorts {
  store: MeetingStore & MeetingTranscriptReceiptStore
  accountId: number
  files: () => Promise<FileAccess>
  /** The channels of a recording on this computer, read by its path. */
  decode: (path: string) => Promise<Pcm[]>
  recognize: Recognize
  recognition: Recognition
  /** Which side is on which channel of a stereo recording, when the owner set `recordings_channels`. */
  sides?: readonly RecordingSide[] | null
}

const recordingOf = (attachments: readonly Attachment[]) => {
  const found = attachments.find(({ kind }) => kind === "recording")
  const path = (found?.providerRef as { path?: unknown } | null)?.path
  return found && typeof path === "string" ? { path, name: found.name ?? path } : null
}

interface LocalRecording {
  path: string
  hash: string
  size: number
  dispose(): Promise<void>
}

/**
 * The recording as a file on this computer, hashed as it is read. A file on the server is streamed to a private
 * temporary file, so a recording of any size is never held in memory; it is deleted once the call is done.
 */
const localRecording = async (files: FileAccess, path: string): Promise<LocalRecording> => {
  const hash = createHash("sha256")
  let size = 0
  const counted = async function* () {
    for await (const piece of files.stream(path)) {
      hash.update(piece)
      size += piece.byteLength
      yield piece
    }
  }
  if (files.where === "local") {
    await pipeline(Readable.from(counted()), new Writable({ write: (_piece, _encoding, done) => done() }))
    return { path, hash: hash.digest("hex"), size, dispose: async () => {} }
  }
  // No caller's number in the temporary name; the extension stays, since ffmpeg reads a raw GSM or SLN file by it.
  const folder = await mkdtemp(join(tmpdir(), "pbx-recording-"))
  const copy = join(folder, `call${extname(path).toLowerCase()}`)
  const dispose = () => rm(folder, { recursive: true, force: true })
  try {
    await pipeline(Readable.from(counted()), createWriteStream(copy, { flags: "wx", mode: 0o600 }))
  } catch (error) {
    await dispose()
    throw error
  }
  return { path: copy, hash: hash.digest("hex"), size, dispose }
}

/** Calls the query names that have a recording and no transcript yet, newest first; one that fails is reported. */
export const transcribeCalls = async (
  ports: TranscribePorts,
  options: TranscribeOptions,
): Promise<TranscribeReport> => {
  const { store, accountId } = ports
  const calls = (await store.meetings({ accountId, query: options.query })).sort(
    (a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0),
  )
  const report: TranscribeReport = {
    transcribed: 0,
    audio_seconds: 0,
    failed: [],
    without_recording: 0,
    remaining: 0,
    stopped: false,
  }
  const pending = []
  for (const call of calls) {
    const details = await store.meeting(call.id)
    if (!details || (!options.replace && details.transcripts.length > 0)) continue
    const recording = recordingOf(details.attachments)
    if (recording) pending.push({ call, recording, speakers: speakersOf(details, ports.sides ?? null) })
    else report.without_recording++
  }
  const shown = Math.min(pending.length, options.limit)
  for (const [index, { call, recording, speakers }] of pending.entries()) {
    if (index >= options.limit || options.signal?.aborted) {
      report.remaining = pending.length - index
      report.stopped = index < options.limit
      break
    }
    try {
      const local = await localRecording(await ports.files(), recording.path)
      try {
        const channels = await ports.decode(local.path)
        const format = recording.name.split(".").pop()?.toLowerCase() ?? "audio"
        const source = callTranscriptionSource(local, channels, {
          format,
          recognize: ports.recognize,
          recognition: ports.recognition,
          speakers,
        })
        await transcribeMeeting(
          source,
          store,
          { accountId, externalId: call.externalId, now: (options.now ?? Date.now)() },
          { apply: true },
        )
      } finally {
        await local.dispose()
      }
      report.transcribed++
      report.audio_seconds += Math.round((call.durationMs ?? 0) / 1000)
      options.progress?.(`${index + 1}/${shown} meeting ${call.id} transcribed`)
    } catch (error) {
      // The run's deadline stops a read or a recognition halfway, whatever error that throws; the calls finished
      // so far are the answer, not a failure.
      if (options.signal?.aborted) {
        report.remaining = pending.length - index
        report.stopped = true
        break
      }
      if (isCliError(error) && error.code === "cancelled") throw error
      const reason = isCliError(error) ? (error.details.reason ?? error.code) : "unexpected"
      report.failed.push({
        meeting: call.id,
        reason: String(reason),
        message: isCliError(error) ? error.message : "the call could not be transcribed",
      })
      options.progress?.(`${index + 1}/${shown} meeting ${call.id} failed: ${reason}`)
    }
  }
  return report
}
