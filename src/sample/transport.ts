import { CliError, isCliError, realSleep, type SleepLike, wallClock } from "@wirecat/cli-base"
import { hostFetch, providerWaitMs, readJsonResponse, statusToCode } from "@wirecat/cli-base/http"
import { type EventSink, providerRequest } from "@wirecat/cli-core/cli"
import type { Pacer } from "@wirecat/cli-core/sends"
import * as v from "valibot"
import { DESKTOP } from "../identity.js"

// SAMPLE: the Example Comments service does not exist; `.invalid` never resolves, so a real run reaches nothing.
// Replace the address, the paths and the answer shapes with your service's, each from its docs or a captured answer.
export const SERVICE_URL = "https://comments.example.invalid/v1/"
export const SERVICE = "Example Comments"

const TIMEOUT_MS = 30_000
const LARGEST_ANSWER = 8 * 1024 * 1024
/** A pace wait longer than this ends the run with `rate_limited` instead of sitting in it. */
const LONGEST_PACE_WAIT_MS = 60_000

export interface Request {
  method: "GET" | "POST" | "PATCH"
  /** The path as a template, `comments/{id}`: the run record keeps the template, never an id. */
  path: string
  ids?: Record<string, string>
  query?: Record<string, string | number | undefined>
  body?: Record<string, unknown>
}

export interface TransportOptions {
  token: string
  fetch?: typeof fetch
  signal?: AbortSignal | undefined
  /** The run's sink from `baseContext(...).run(events => …)`, so each request lands in the run record (WC-LIFE-15). */
  events?: EventSink
  /** cli-core's per-profile pace, shared by every process of the profile through a file. */
  pacer?: Pacer
  sleep?: SleepLike
  now?: () => number
  timeoutMs?: number
}

/** `new URL` folds a `.` or `..` segment into its parent, so such an id would reach another endpoint. */
const segment = (name: string, value: string) => {
  if (value === "" || value === "." || value === "..")
    throw new CliError("validation_error", `${name} must name one item; an empty, "." or ".." id is refused`)
  return encodeURIComponent(value)
}

const urlOf = ({ path, ids = {}, query = {} }: Request) => {
  const url = new URL(
    path.replace(/\{(\w+)\}/g, (_, name: string) => segment(name, ids[name] ?? "")),
    SERVICE_URL,
  )
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value))
  return url
}

/**
 * A refusal as a CliError with cli-base's code for its status. The service's own message is never repeated: it can
 * quote what was sent (WC-SECR-6). A write that failed on the service's side may have happened, so it is
 * `outcome_unknown` and never retryable (WC-OUT-20, WC-LIFE-9).
 */
export const failureOf = (status: number, writes: boolean, retryAfterMs?: number): CliError => {
  if (status === 401)
    return new CliError("authentication_error", `${SERVICE} refused the token; sign in again with session start`, {
      status,
    })
  if (status === 429)
    return new CliError("rate_limited", `${SERVICE} asked to slow down; retry the command later`, {
      status,
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retry_after_ms: retryAfterMs }),
    })
  if (status >= 500 && writes)
    return new CliError("outcome_unknown", `${SERVICE} failed during a write; check it before repeating the write`, {
      status,
      retryable: false,
    })
  if (status === 404) return new CliError("not_found", `${SERVICE} has no such item, or this token cannot see it`)
  return new CliError(statusToCode(status), `${SERVICE} refused the request (HTTP ${status})`, {
    status,
    retryable: status >= 500,
  })
}

/**
 * The only code that holds the token: it goes in the Authorization header, never in an address, an error or a run
 * record (WC-SECR-7). Nothing here retries. A read the caller may run again; a write is never sent twice, since the
 * first may have landed (WC-OUT-20).
 */
export const transport = (options: TransportOptions) => {
  const fetchOf = hostFetch({ hosts: DESKTOP.hosts ?? [], ...(options.fetch ? { fetch: options.fetch } : {}) })
  const sleep = options.sleep ?? realSleep
  const now = options.now ?? Date.now

  const turn = async () => {
    if (!options.pacer) return
    const wait = (await options.pacer.reserve()) - now()
    if (wait <= 0) return
    if (wait > LONGEST_PACE_WAIT_MS)
      throw new CliError("rate_limited", `this profile must wait ${Math.ceil(wait / 1000)} s before its next request`, {
        retry_after_ms: wait,
      })
    await sleep(wait, options.signal, "retry")
  }

  const unanswered = (writes: boolean, error: unknown): CliError => {
    // Before the stop check: a write stopped in flight may still have landed (WC-LIFE-9).
    if (writes)
      return new CliError("outcome_unknown", `${SERVICE} did not answer a write; check it before repeating the write`, {
        retryable: false,
      })
    if (options.signal?.aborted) return new CliError("cancelled", `the ${SERVICE} request was stopped`)
    const timedOut = (error as { name?: string } | undefined)?.name === "TimeoutError"
    return timedOut
      ? new CliError("timeout", `${SERVICE} did not answer in time`, { retryable: true })
      : new CliError("network_error", `${SERVICE} could not be reached`, { retryable: true })
  }

  const send = async <T>(request: Request, answer: v.GenericSchema<unknown, T>): Promise<T> => {
    const writes = request.method !== "GET"
    const url = urlOf(request)
    await turn()
    // Not AbortSignal.timeout: its timer keeps the run's async context alive until it fires.
    const deadline = new AbortController()
    const timer = setTimeout(
      () => deadline.abort(new DOMException("timed out", "TimeoutError")),
      options.timeoutMs ?? TIMEOUT_MS,
    )
    timer.unref()
    const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal
    const end = providerRequest(`${request.method} /${request.path}`, options.events, {
      method: request.method,
      transport: "http",
    })
    try {
      let response: Response
      try {
        response = await fetchOf(url, {
          method: request.method,
          headers: {
            authorization: `Bearer ${options.token}`,
            accept: "application/json",
            ...(request.body ? { "content-type": "application/json" } : {}),
          },
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
          // A redirect would carry the Authorization header to an address we did not choose.
          redirect: "error",
          signal,
        })
      } catch (error) {
        const failure = unanswered(writes, deadline.signal.reason ?? error)
        end({ errorCode: failure.code })
        throw failure
      }
      if (!response.ok) {
        const failure = failureOf(response.status, writes, providerWaitMs(response.headers, wallClock))
        end({ status: response.status, errorCode: failure.code })
        throw failure
      }
      let body: unknown
      try {
        body = await readJsonResponse(response, { maxBytes: LARGEST_ANSWER, signal })
      } catch (error) {
        const failure =
          isCliError(error) && error.code !== "invalid_response"
            ? error
            : new CliError("invalid_response", `${SERVICE} answered with something other than bounded JSON`)
        end({ status: response.status, errorCode: failure.code })
        throw failure
      }
      const parsed = v.safeParse(answer, body)
      if (!parsed.success) {
        end({ status: response.status, errorCode: "invalid_response" })
        throw new CliError("invalid_response", `${SERVICE}'s answer does not have the documented shape`)
      }
      end({ status: response.status })
      return parsed.output
    } finally {
      clearTimeout(timer)
    }
  }

  return { send }
}

export type Transport = ReturnType<typeof transport>
