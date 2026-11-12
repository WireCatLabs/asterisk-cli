import { isCliError } from "@wirecat/cli-base"
import type { QueryAst } from "@wirecat/cli-base/query"
import {
  type Attachment,
  type MeetingStore,
  type MeetingTranscriptReceiptStore,
  transcribeMeeting,
} from "@wirecat/cli-core/meetings"
import type { Pcm } from "@wirecat/cli-core/speech"
import { callTranscriptionSource, type Recognition, type Recognize } from "./call-transcription.js"
import type { FileAccess } from "./files.js"

/** An hour of 16-bit stereo WAV at 48 kHz is about 690 MB; a business call is far shorter. */
export const LARGEST_RECORDING = 256 * 1024 * 1024

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
  decode: (bytes: Uint8Array) => Promise<Pcm[]>
  recognize: Recognize
  recognition: Recognition
}

const recordingOf = (attachments: readonly Attachment[]) => {
  const found = attachments.find(({ kind }) => kind === "recording")
  const path = (found?.providerRef as { path?: unknown } | null)?.path
  return found && typeof path === "string" ? { path, name: found.name ?? path } : null
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
    if (recording) pending.push({ call, recording })
    else report.without_recording++
  }
  const shown = Math.min(pending.length, options.limit)
  for (const [index, { call, recording }] of pending.entries()) {
    if (index >= options.limit || options.signal?.aborted) {
      report.remaining = pending.length - index
      report.stopped = index < options.limit
      break
    }
    try {
      const bytes = await (await ports.files()).read(recording.path, LARGEST_RECORDING)
      const channels = await ports.decode(bytes)
      const format = recording.name.split(".").pop()?.toLowerCase() ?? "audio"
      const source = callTranscriptionSource(bytes, channels, {
        format,
        recognize: ports.recognize,
        recognition: ports.recognition,
      })
      await transcribeMeeting(
        source,
        store,
        { accountId, externalId: call.externalId, now: (options.now ?? Date.now)() },
        { apply: true },
      )
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
