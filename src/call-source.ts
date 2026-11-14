import { e164Of } from "@wirecat/cli-core"
import type {
  MeetingSave,
  MeetingSource,
  MeetingStore,
  SourceMeeting,
  SourceParticipant,
} from "@wirecat/cli-core/meetings"
import { isDialable, type Party } from "./cdr/call.js"
import { callsOf, extensionNames, type Leg, type PhoneCall } from "./cdr/calls.js"
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

const legOf = ({ row }: Leg) => ({
  uniqueid: row.uniqueid,
  sequence: row.sequence,
  start: new Date(row.start).toISOString(),
  answer: row.answer === null ? null : new Date(row.answer).toISOString(),
  end: row.end === null ? null : new Date(row.end).toISOString(),
  src: row.src,
  dst: row.dst,
  channel: row.channel,
  dstchannel: row.dstchannel,
  dcontext: row.dcontext,
  lastapp: row.lastapp,
  disposition: row.disposition,
  billMs: row.billMs,
})

const titleOf = (call: PhoneCall, region: string | null) => {
  const [first] = call.legs as [Leg, ...Leg[]]
  const to = call.answeredBy.at(-1) ?? (call.rang.length === 1 ? call.rang[0] : null) ?? call.dialed
  const from = call.direction === "outgoing" ? (call.answeredBy[0] ?? first.call.from?.number) : first.call.from?.number
  const label = (number: string | null | undefined, internal: boolean) =>
    !number ? "?" : internal ? number : (e164(number, region) ?? number)
  return call.direction === "outgoing"
    ? `${label(from, true)} → ${label(call.client?.number, false)}`
    : `${label(from, call.direction === "internal")} → ${label(to, true)}`
}

const meetingOf = (call: PhoneCall, region: string | null): SourceMeeting => {
  const [first] = call.legs as [Leg, ...Leg[]]
  return {
    series: null,
    occurrence: {
      id: call.id,
      seriesId: call.id,
      title: titleOf(call, region),
      startedAt: new Date(call.start).toISOString(),
      endedAt: call.end === null ? null : new Date(call.end).toISOString(),
    },
    metadata: {
      direction: call.direction,
      outcome: call.outcome,
      disposition: first.row.disposition,
      dialed: call.dialed,
      answeredBy: call.answeredBy,
      rang: call.rang,
      waitMs: call.waitMs,
      talkMs: call.talkMs,
      answeredMs: call.talkMs,
      durationMs: call.end === null ? null : call.end - call.start,
      uniqueid: first.row.uniqueid,
      linkedid: first.row.linkedid,
      accountcode: first.row.accountcode,
      userfield: call.legs.map(({ row }) => row.userfield).find(Boolean) ?? null,
      legs: call.legs.map(legOf),
    },
  }
}

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
    // What cli-core matches the caller by to the CRM contact or messenger person with the same number.
    phone,
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
 * CDR rows as meetings for cli-core's `pull`: one call is one meeting, its id the call's `linkedid`, with every leg in
 * the metadata. Its people are the outside party and each extension that talked; its attachments are the recordings of
 * its legs, by their paths. A file is never copied, changed or deleted.
 */
export const callSource = (rows: CdrRows, options: CallSourceOptions & { where: string }): MeetingSource => {
  const seen = new Map<string, PhoneCall>()
  let names = new Map<string, string>()
  return {
    provider: PROVIDER_NAME,
    name: "Asterisk",
    overlapMs: OVERLAP_MS,
    meetings: async (since) => {
      const read = await rows.rows(Date.parse(since))
      if (read.skipped > 0) options.skipped?.(read.skipped)
      const calls = callsOf(read.rows, options.extension)
      names = extensionNames(calls.flatMap(({ legs }) => legs))
      for (const call of calls) seen.set(call.id, call)
      return calls.map((call) => meetingOf(call, options.phoneRegion))
    },
    participants: async (id) => {
      const call = seen.get(id)
      if (!call) return null
      const employees = staffOf(call)
      const staff = employees.map((number) =>
        participantOf({ number, internal: true, name: names.get(number) ?? null }, options.phoneRegion),
      )
      const client =
        call.client && isDialable(call.client.number) ? [participantOf(call.client, options.phoneRegion)] : []
      return call.direction === "outgoing" ? [...staff, ...client] : [...client, ...staff]
    },
    transcript: async () => null,
    chat: async () => null,
    summary: async () => null,
    files: async (id): Promise<NonNullable<MeetingSave["attachments"]> | null> => {
      const call = seen.get(id)
      if (!call || !options.recording) return null
      const found = new Map<string, Recording>()
      for (const { row } of call.legs) {
        const recording = await options.recording(row)
        if (recording && !found.has(recording.path)) found.set(recording.path, recording)
      }
      const attachments = [...found.values()].map((recording, position) => ({
        ...recordingOf(recording, call.talkMs, options.where),
        position,
      }))
      return attachments.length ? attachments : null
    },
  }
}

/** The extension that placed the call, if one did, and every extension that talked on it. */
const staffOf = (call: PhoneCall) => {
  const [first] = call.legs as [Leg, ...Leg[]]
  const caller = first.call.from?.internal ? [first.call.from.number] : []
  return [...new Set([...caller, ...call.answeredBy])]
}

/** Versions up to 0.3.0 kept one meeting per CDR row, `<uniqueid>#<sequence>`; the call that replaced it holds them. */
const ROW_MEETING = /#/

/** Marks the row meetings of older versions deleted, so no call shows twice. Their transcripts go with them. */
export const retireRowMeetings = async (store: MeetingStore, accountId: number, now: number): Promise<number> => {
  const old = (await store.meetings({ accountId })).filter(({ externalId }) => ROW_MEETING.test(externalId))
  for (const { id, createdAt, updatedAt, meetingSeriesId, eventId, ...meeting } of old)
    await store.saveMeeting({ meeting: { ...meeting, deletedAt: now }, now })
  return old.length
}
