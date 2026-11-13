import { e164Of } from "@wirecat/cli-core"
import type { MeetingSave, MeetingSource, SourceMeeting, SourceParticipant } from "@wirecat/cli-core/meetings"
import { type Call, callOf, isDialable, type Party } from "./cdr/call.js"
import type { CdrRow } from "./cdr/record.js"
import type { Recording } from "./recordings.js"

export const PROVIDER_NAME = "asterisk"

/**
 * Each sync reads again the six hours before its cursor: a CDR row is written when the call ends, with the call's start
 * time, so a call that was going on when the last sync read is found the next time. Six hours is our choice, longer
 * than any business call.
 */
export const OVERLAP_MS = 6 * 60 * 60 * 1000

export interface CdrRows {
  /** The rows that started at `since` or later, and how many rows could not be read. */
  rows(since: number): Promise<{ rows: CdrRow[]; skipped: number }>
}

export interface CallSourceOptions {
  phoneRegion: string | null
  extension: RegExp
  recording?: ((row: CdrRow) => Promise<Recording | null>) | undefined
  /** Told how many rows were unreadable, so the run shows it. */
  skipped?: (count: number) => void
}

/** The form WhatsApp, MAX and the CRMs keep, so the caller is one `phone:` identity across them. */
const e164 = (number: string, region: string | null) => e164Of(number, region ?? undefined) ?? null

const labelOf = (party: Party | null, region: string | null) =>
  party ? (party.internal ? party.number : (e164(party.number, region) ?? party.number)) : "?"

/** `+79161234567 → 101`: the two sides as the CDR names them, the outside one in E.164 when it can be read so. */
const titleOf = ({ from, to }: Call, region: string | null) => `${labelOf(from, region)} → ${labelOf(to, region)}`

const meetingOf = (row: CdrRow, call: Call, region: string | null): SourceMeeting => ({
  series: null,
  occurrence: {
    id: row.id,
    seriesId: row.id,
    title: titleOf(call, region),
    startedAt: new Date(row.start).toISOString(),
    endedAt: row.end === null ? null : new Date(row.end).toISOString(),
  },
  metadata: {
    direction: call.direction,
    disposition: row.disposition,
    durationMs: row.durationMs,
    answeredMs: row.billMs,
    uniqueid: row.uniqueid,
    linkedid: row.linkedid,
    sequence: row.sequence,
    dcontext: row.dcontext,
    accountcode: row.accountcode,
    lastapp: row.lastapp,
    userfield: row.userfield,
  },
})

const NONE = { joinedAt: null, leftAt: null, durationMs: null, sessions: null, metadata: {} }

const participantOf = (party: Party, region: string | null): SourceParticipant => {
  if (party.internal)
    return {
      ...NONE,
      identityExternalId: `extension:${party.number}`,
      email: null,
      displayName: party.name,
      externalId: party.number,
      role: "manager",
    }
  const phone = e164(party.number, region)
  return {
    ...NONE,
    identityExternalId: phone ? `phone:${phone}` : `number:${party.number.replace(/\s/g, "")}`,
    email: null,
    displayName: party.name,
    externalId: null,
    role: "client",
  }
}

const recordingOf = (found: Recording, durationMs: number | null, where: string) => ({
  position: 0,
  kind: "recording",
  mime: found.mime,
  name: found.name,
  title: null,
  url: null,
  size: found.size,
  width: null,
  height: null,
  duration: durationMs,
  providerRef: { path: found.path, where, mtime_ms: Math.round(found.mtimeMs) },
  localPath: where === "local" ? found.path : null,
  text: null,
  normalizedText: null,
  extraction: null,
  extractor: null,
  extractionError: null,
  contentSha256: null,
  extractedAt: null,
})

/**
 * CDR rows as meetings for cli-core's `pull`: one row is one meeting, its id the row's own, so legs of one transferred
 * call stay apart and keep their `uniqueid` and `linkedid` in the metadata. A recording is the meeting's attachment,
 * by its path; the file itself is never copied, changed or deleted.
 */
export const callSource = (rows: CdrRows, options: CallSourceOptions & { where: string }): MeetingSource => {
  const seen = new Map<string, { row: CdrRow; call: Call }>()
  return {
    provider: PROVIDER_NAME,
    name: "Asterisk",
    overlapMs: OVERLAP_MS,
    meetings: async (since) => {
      const read = await rows.rows(Date.parse(since))
      if (read.skipped > 0) options.skipped?.(read.skipped)
      return read.rows.map((row) => {
        const call = callOf(row, options.extension)
        seen.set(row.id, { row, call })
        return meetingOf(row, call, options.phoneRegion)
      })
    },
    participants: async (id) => {
      const found = seen.get(id)
      if (!found) return null
      return [found.call.from, found.call.to]
        .filter((party): party is Party => party !== null && (party.internal || isDialable(party.number)))
        .map((party) => participantOf(party, options.phoneRegion))
    },
    transcript: async () => null,
    chat: async () => null,
    summary: async () => null,
    files: async (id): Promise<NonNullable<MeetingSave["attachments"]> | null> => {
      const found = seen.get(id)
      if (!found || !options.recording) return null
      const recording = await options.recording(found.row)
      return recording ? [recordingOf(recording, found.row.billMs, options.where)] : null
    },
  }
}
