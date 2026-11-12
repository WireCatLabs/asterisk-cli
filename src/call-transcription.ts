import { createHash } from "node:crypto"
import type {
  MeetingMediaDescriptor,
  MeetingRecognitionSegment,
  MeetingTranscriptionSource,
} from "@wirecat/cli-core/meetings"
import type { Pcm, TimedText } from "@wirecat/cli-core/speech"

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
 * apart and named by their number: which side Asterisk put on which channel depends on the dialplan, so no role is
 * guessed.
 */
export const dialogue = (channels: readonly TimedText[][], durationMs: number): MeetingRecognitionSegment[] =>
  channels
    .flatMap((pieces, channel) =>
      pieces.map(({ start, end, text }) => ({
        startMs: Math.floor(start * 1000),
        endMs: Math.min(durationMs, Math.ceil(end * 1000)),
        text,
        ...(channels.length > 1 ? { speaker: `Channel ${channel + 1}` } : {}),
      })),
    )
    .filter(({ startMs, endMs, text }) => endMs > startMs && text.trim())
    .sort((a, b) => a.startMs - b.startMs)

/** One recorded call for cli-core's `transcribeMeeting`; the content hash keeps an unchanged file from a second run. */
export const callTranscriptionSource = (
  bytes: Uint8Array,
  channels: readonly Pcm[],
  { format, recognize, recognition }: { format: string; recognize: Recognize; recognition: Recognition },
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
      yield* dialogue(pieces, durationMs)
    },
  }
}
