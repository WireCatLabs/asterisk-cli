import { createHash } from "node:crypto"
import type {
  MeetingDetails,
  MeetingMediaDescriptor,
  MeetingRecognitionSegment,
  MeetingTranscriptionSource,
} from "@wirecat/cli-core/meetings"
import type { Pcm, TimedText } from "@wirecat/cli-core/speech"
import type { RecordingSide } from "./source.js"

export type Recognize = (pcm: Pcm) => Promise<TimedText[]>

export interface Recognition {
  engine: string
  model: string
  version?: string
}

const durationMsOf = (channels: readonly Pcm[]) =>
  Math.floor(channels.reduce((longest, { samples, rate }) => Math.max(longest, (samples.length / rate) * 1000), 0))

/**
 * A mono recording, what MixMonitor writes by default, is one track with no speaker. Two separate channels are kept
 * apart and named by `speakers` when the owner set which side is on which channel; otherwise by their number, since
 * which side Asterisk put on which channel depends on the dialplan and no role is guessed.
 */
export const dialogue = (
  channels: readonly TimedText[][],
  durationMs: number,
  speakers: readonly string[] | null = null,
): MeetingRecognitionSegment[] =>
  channels
    .flatMap((pieces, channel) =>
      pieces.map(({ start, end, text }) => ({
        startMs: Math.floor(start * 1000),
        endMs: Math.min(durationMs, Math.ceil(end * 1000)),
        text,
        ...(channels.length > 1 ? { speaker: speakers?.[channel] ?? `Channel ${channel + 1}` } : {}),
      })),
    )
    .filter(({ startMs, endMs, text }) => endMs > startMs && text.trim())
    .sort((a, b) => a.startMs - b.startMs)

/** cli-core keeps a speaker's name to 200 characters on one line. */
const LONGEST_SPEAKER = 200

const named = (...parts: (string | null | undefined)[]) =>
  parts
    .filter(Boolean)
    .join(" ")
    .replace(/[\0\r\n]+/g, " ")
    .trim()
    .slice(0, LONGEST_SPEAKER)

/**
 * The names for each channel of a stereo call: the caller by name and number, the employees by extension and name,
 * as the call record knows them. An internal call has no caller, so it keeps the channel numbers.
 */
export const speakersOf = (details: MeetingDetails, sides: readonly RecordingSide[] | null): string[] | null => {
  if (!sides) return null
  const client = details.participants.find(({ role }) => role === "client")
  const number = (details.meeting.metadata as { client?: unknown } | null)?.client
  const caller = named(client?.displayName, typeof number === "string" ? number : null)
  const employee = named(
    details.participants
      .filter(({ role }) => role === "manager")
      .map(({ externalId, displayName }) => named(externalId, displayName))
      .filter(Boolean)
      .join(", "),
  )
  if (!caller || !employee || caller === employee) return null
  return sides.map((side) => (side === "caller" ? caller : employee))
}

/** One recorded call for cli-core's `transcribeMeeting`; the content hash keeps an unchanged file from a second run. */
export const callTranscriptionSource = (
  bytes: Uint8Array,
  channels: readonly Pcm[],
  {
    format,
    recognize,
    recognition,
    speakers = null,
  }: { format: string; recognize: Recognize; recognition: Recognition; speakers?: readonly string[] | null },
): MeetingTranscriptionSource => {
  const durationMs = durationMsOf(channels)
  const hash = createHash("sha256").update(bytes).digest("hex")
  const media: MeetingMediaDescriptor = {
    id: hash.slice(0, 32),
    contentHash: hash,
    size: bytes.byteLength,
    durationMs,
    format,
    sampleRate: channels[0]?.rate ?? 8000,
    channels: channels.length,
    recognition: { ...recognition, timing: "recognition-segments" },
  }
  return {
    describe: async () => media,
    async *segments() {
      const pieces: TimedText[][] = []
      for (const channel of channels) pieces.push(await recognize(channel))
      yield* dialogue(pieces, durationMs, speakers)
    },
  }
}
