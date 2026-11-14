import type { CdrRow } from "./record.js"

export type Direction = "incoming" | "outgoing" | "internal"

export interface Party {
  /** An internal extension, `101`, or an outside number as the CDR wrote it. */
  number: string
  internal: boolean
  name: string | null
}

export interface Call {
  direction: Direction | null
  from: Party | null
  to: Party | null
}

/**
 * `PJSIP/101-0000002a`, `SIP/101-…`: the peer is the part before `-`, `@` or `;`. A `Local/` channel names what was
 * dialled (a queue or ring group member), not who is on the line, so it names no peer and the number decides.
 */
export const peerOf = (channel: string | null): string | null =>
  /^local\//i.test(channel ?? "") ? null : (/^[^/]+\/([^-@;/]+)/.exec(channel ?? "")?.[1] ?? null)

/**
 * Who a leg reached: the peer of a phone channel, or the extension a `Local/101@…` channel dialled. A ring group or a
 * queue reaches its members that way, and the row's `dst` keeps the group's number, or after a transfer the new one.
 */
export const reachedOf = (channel: string | null): string | null =>
  peerOf(channel) ?? /^local\/([^@/]+)@/i.exec(channel ?? "")?.[1] ?? null

/** `anonymous`, `s`, `Restricted`: what a CDR writes for no number. Only something dialable is a person. */
export const isDialable = (number: string): boolean =>
  /^\+?[\d\s().-]+$/.test(number) && /\d{3}/.test(number.replace(/\D/g, ""))

/** `"Ivan Petrov" <101>` → `Ivan Petrov`; a name that only repeats the number is no name. */
export const callerName = (clid: string | null, number: string | null): string | null => {
  const name = /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(clid ?? "")?.[1]?.trim()
  return name && name !== number ? name : null
}

/** FreePBX's and the sample dialplan's contexts for calls from a trunk: a call there that no extension took is incoming. */
const FROM_OUTSIDE = /^from-(trunk|pstn|did|external)/

/**
 * Who called whom. A side is internal when its channel's peer, or else its number, matches the extension pattern:
 * the channel names the extension even when the number shown outside was rewritten. No direction is guessed when
 * neither side is internal and the context does not say the call came from a trunk.
 */
export const callOf = (row: CdrRow, extension: RegExp): Call => {
  const sideOf = (channel: string | null, number: string | null): Party | null => {
    const peer = peerOf(channel)
    if (peer && extension.test(peer)) return { number: peer, internal: true, name: null }
    if (number && extension.test(number)) return { number, internal: true, name: null }
    return number ? { number, internal: false, name: null } : null
  }
  const from = sideOf(row.channel, row.src)
  const reached = reachedOf(row.dstchannel)
  const to =
    reached && extension.test(reached) ? { number: reached, internal: true, name: null } : sideOf(null, row.dst)
  if (from) from.name = callerName(row.clid, row.src)
  const direction: Direction | null =
    from?.internal && to?.internal
      ? "internal"
      : from?.internal && to
        ? "outgoing"
        : from && !from.internal && (to?.internal || FROM_OUTSIDE.test(row.dcontext ?? ""))
          ? "incoming"
          : null
  return { direction, from, to }
}
