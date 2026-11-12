import type { Pacer } from "@wirecat/cli-core/sends"
import * as v from "valibot"
import { expect, it } from "vitest"
import { FAKE_TOKEN, fakeComments } from "../testing/fake-comments.js"
import { commentOf, commentsService } from "./comments.js"
import { failureOf, transport } from "./transport.js"

const anything = v.unknown()
const failing = (error: unknown) => async () => Promise.reject(error)
const silent = async (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))

it("maps the wire shape to the answer's own", () => {
  expect(commentOf({ id: "c1", body: "Hi", authorName: "Test Person", createdAt: "2026-01-02T03:04:05Z" })).toEqual({
    id: "c1",
    text: "Hi",
    author: "Test Person",
    created_at: "2026-01-02T03:04:05Z",
  })
})

it.each([
  [401, false, "authentication_error"],
  [404, false, "not_found"],
  [429, true, "rate_limited"],
  [503, false, "provider_unavailable"],
  [503, true, "outcome_unknown"],
  [400, true, "validation_error"],
])("HTTP %i (a write: %s) is %s", (status, writes, code) => {
  expect(failureOf(status, writes).code).toBe(code)
})

it("a write that failed on the service is never marked safe to retry", () => {
  expect(failureOf(500, true).details).toMatchObject({ retryable: false })
  expect(failureOf(429, false, 2000).details).toMatchObject({ retryable: true, retry_after_ms: 2000 })
})

it("sends the token in the Authorization header only, and refuses a redirect", async () => {
  const service = fakeComments()
  const sent: RequestInit[] = []
  await commentsService(
    transport({
      token: FAKE_TOKEN,
      fetch: (input, init = {}) => {
        sent.push(init)
        return service.fetch(input, init)
      },
    }),
  ).me()
  expect(service.calls[0]?.url).not.toContain(FAKE_TOKEN)
  expect(service.calls[0]?.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`)
  expect(sent[0]?.redirect).toBe("error")
})

it('refuses an id of "." or ".." before any request, since it would reach another endpoint', async () => {
  const service = fakeComments()
  const comments = commentsService(transport({ token: FAKE_TOKEN, fetch: service.fetch }))
  await expect(comments.show("..")).rejects.toMatchObject({ code: "validation_error" })
  expect(service.calls).toEqual([])
})

it("a read that got no answer is a retryable timeout or network error; a write is outcome_unknown", async () => {
  const send = (fetch: typeof globalThis.fetch, method: "GET" | "POST") =>
    transport({ token: FAKE_TOKEN, fetch, timeoutMs: 5 }).send({ method, path: "comments", body: {} }, anything)
  await expect(send(silent, "GET")).rejects.toMatchObject({ code: "timeout", details: { retryable: true } })
  await expect(send(failing(new TypeError("fetch failed")), "GET")).rejects.toMatchObject({ code: "network_error" })
  await expect(send(silent, "POST")).rejects.toMatchObject({
    code: "outcome_unknown",
    details: { retryable: false },
  })
})

it("a stop during a read cancels it; during a write it stays outcome_unknown", async () => {
  const stop = new AbortController()
  stop.abort()
  const send = (method: "GET" | "PATCH") =>
    transport({ token: FAKE_TOKEN, fetch: failing(new Error("aborted")), signal: stop.signal }).send(
      { method, path: "comments" },
      anything,
    )
  await expect(send("GET")).rejects.toMatchObject({ code: "cancelled" })
  await expect(send("PATCH")).rejects.toMatchObject({ code: "outcome_unknown" })
})

it("an answer that is not JSON is invalid_response", async () => {
  const fetch = async () => new Response("<html>", { status: 200 })
  await expect(commentsService(transport({ token: FAKE_TOKEN, fetch })).me()).rejects.toMatchObject({
    code: "invalid_response",
  })
})

it("an answer in another shape is invalid_response", async () => {
  const fetch = async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })
  await expect(commentsService(transport({ token: FAKE_TOKEN, fetch })).me()).rejects.toMatchObject({
    code: "invalid_response",
  })
})

it("waits its turn under the profile's pace, and ends the run instead of a long wait", async () => {
  const service = fakeComments()
  const waits: number[] = []
  const paced = (at: number) =>
    commentsService(
      transport({
        token: FAKE_TOKEN,
        fetch: service.fetch,
        now: () => 1_000,
        pacer: { reserve: async () => at } as unknown as Pacer,
        sleep: async (ms) => {
          waits.push(ms)
        },
      }),
    ).me()
  await paced(1_500)
  expect(waits).toEqual([500])
  await expect(paced(1_000 + 120_000)).rejects.toMatchObject({ code: "rate_limited" })
  expect(service.calls).toHaveLength(1)
})
