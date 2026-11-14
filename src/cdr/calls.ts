import { type Call, callerName, callOf, type Direction, type Party } from "./call.js"
import type { CdrRow } from "./record.js"

/** What became of a call: a person answered, it went to voicemail, the line was busy, or nobody picked up. */
export type Outcome = "answered" | "voicemail" | "busy" | "no_answer" | "failed"

/** One CDR row of a call, as read. */
export interface Leg {
  row: CdrRow
  call: Call
}

/**
 * One call: every CDR row that shares its `linkedid` (its `uniqueid` when the CDR keeps no `linkedid`). A ring group,
 * a queue or a transfer writes a row per leg; the call is what a person means by "a call".
 */
export interface PhoneCall {
  id: string
  legs: Leg[]
  start: number
  end: number | null
  direction: Direction | null
  /** The outside side of the call; none on an internal one. */
  client: Party | null
  /** What the caller dialled first: an extension, a ring group, a queue or an outside number. */
  dialed: string | null
  outcome: Outcome
  /** The extensions that talked on the call, in the order they answered. */
  answeredBy: string[]
  /** Extensions that rang and did not answer. */
  rang: string[]
  /** From the start of the call to the first answer by a person. */
  waitMs: number | null
  /** From the first answer by a person to the end of the last leg a person answered. */
  talkMs: number | null
}

/** A leg where someone talked: Dial or Queue bridged it. VoiceMail, Busy and Hangup rows say ANSWERED too. */
const BRIDGED = /^(dial|queue)$/i

const talked = ({ row }: Leg) =>
  /^answered$/i.test(row.disposition ?? "") && BRIDGED.test(row.lastapp ?? "") && (row.billMs ?? 0) > 0

const smallest = (values: readonly number[]) => (values.length ? values.reduce((a, b) => Math.min(a, b)) : null)
const largest = (values: readonly number[]) => (values.length ? values.reduce((a, b) => Math.max(a, b)) : null)

const callKey = (row: CdrRow) => row.linkedid ?? row.uniqueid ?? row.id

const order = (a: Leg, b: Leg) =>
  a.row.start - b.row.start || (a.row.sequence ?? 0) - (b.row.sequence ?? 0) || a.row.id.localeCompare(b.row.id)

/** Employees' names from the caller ID of the calls they made: `"Анна Смирнова" <101>`. */
export const extensionNames = (legs: readonly Leg[]): Map<string, string> => {
  const names = new Map<string, string>()
  for (const { row, call } of legs)
    if (call.from?.internal) {
      const name = callerName(row.clid, call.from.number)
      if (name) names.set(call.from.number, name)
    }
  return names
}

const outcomeOf = (legs: readonly Leg[]): Outcome => {
  if (legs.some(talked)) return "answered"
  const seen = (pattern: RegExp, field: "disposition" | "lastapp") =>
    legs.some(({ row }) => pattern.test(row[field] ?? ""))
  if (seen(/^voicemail$/i, "lastapp")) return "voicemail"
  if (seen(/^busy$/i, "disposition")) return "busy"
  if (seen(/^no answer$/i, "disposition")) return "no_answer"
  if (seen(/^(failed|congestion)$/i, "disposition")) return "failed"
  return "no_answer"
}

/** The extension a leg reached or, on an outgoing leg, the one that placed it. */
const employeeOf = ({ call }: Leg): string | null =>
  call.to?.internal ? call.to.number : call.from?.internal ? call.from.number : null

const summary = (id: string, legs: Leg[]): PhoneCall => {
  const [first] = legs as [Leg, ...Leg[]]
  const answered = legs.filter(talked)
  const answeredBy = [
    ...new Set(answered.toSorted((a, b) => (a.row.answer ?? 0) - (b.row.answer ?? 0)).map(employeeOf)),
  ]
  const people = answeredBy.filter((one): one is string => one !== null)
  const rang = [
    ...new Set(
      legs
        .filter((leg) => !talked(leg) && BRIDGED.test(leg.row.lastapp ?? "") && leg.call.to?.internal)
        .map((leg) => leg.call.to?.number as string),
    ),
  ].filter((one) => !people.includes(one))
  const start = smallest(legs.map(({ row }) => row.start)) as number
  const ends = legs.map(({ row }) => row.end).filter((end): end is number => end !== null)
  // A queue or IVR answers the caller before any person does; the Dial legs carry the moment a person picked up.
  const answers = (only: RegExp) =>
    answered.filter(({ row }) => only.test(row.lastapp ?? "")).map(({ row }) => row.answer ?? row.start)
  const firstAnswer = smallest(answers(/^dial$/i).length ? answers(/^dial$/i) : answers(BRIDGED))
  const lastEnd = largest(answered.map(({ row }) => row.end ?? row.start)) ?? 0
  const direction = legs.map(({ call }) => call.direction).find((one) => one !== null) ?? null
  const client =
    direction === "internal"
      ? null
      : (legs.flatMap(({ call }) => [call.from, call.to]).find((party) => party && !party.internal) ?? null)
  return {
    id,
    legs,
    start,
    end: largest(ends),
    direction,
    client,
    dialed: first.row.dst,
    outcome: outcomeOf(legs),
    answeredBy: people,
    rang,
    waitMs: firstAnswer === null ? null : Math.max(0, firstAnswer - start),
    talkMs: firstAnswer === null ? null : Math.max(0, lastEnd - firstAnswer),
  }
}

/** CDR rows as calls, oldest first. */
export const callsOf = (rows: readonly CdrRow[], extension: RegExp): PhoneCall[] => {
  const grouped = new Map<string, Leg[]>()
  for (const row of rows) {
    const key = callKey(row)
    const legs = grouped.get(key) ?? []
    legs.push({ row, call: callOf(row, extension) })
    grouped.set(key, legs)
  }
  return [...grouped]
    .map(([id, legs]) => summary(id, legs.toSorted(order)))
    .toSorted((a, b) => a.start - b.start || a.id.localeCompare(b.id))
}
