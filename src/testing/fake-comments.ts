// SAMPLE: a strict fake of the Example Comments service. Replace it with a fake of your service, built from its docs
// or a captured answer. It refuses what the real service would refuse, so a field name typed from memory fails a test
// instead of reaching the owner's account. Visibly fake data only (WC-TEST-8).

/** Spelled so gitleaks lets it through; never a real token. */
export const FAKE_TOKEN = "wirecatfake0token42"
const HOST = "comments.example.invalid"

export interface FakeCall {
  method: string
  path: string
  query: Record<string, string>
  body: Record<string, unknown> | undefined
  url: string
  headers: Record<string, string>
}

interface Answer {
  status: number
  body: unknown
}

interface Route {
  method: string
  path: RegExp
  query: readonly string[]
  /** The body's documented fields, all required here; a route without it takes no body. */
  body?: readonly string[]
  answer: (id: string, call: FakeCall) => Answer
}

interface WireComment {
  id: string
  body: string
  authorName: string
  authorId: string
  createdAt: string
}

export interface FakeOptions {
  comments?: WireComment[]
  /** The next write lands, then its answer is lost, as a dropped connection loses it. */
  loseNextWriteAnswer?: boolean
  /** Every request is answered with this status. */
  failWith?: number
  /** A write is never answered; it fails only when the caller stops waiting. */
  hangWrites?: boolean
}

export const fakeComment = (id: string, text: string, authorId = "u2"): WireComment => ({
  id,
  body: text,
  authorName: `Test Person ${authorId}`,
  authorId,
  createdAt: "2026-01-02T03:04:05Z",
})

const refused = (error: string, detail: string): Answer => ({ status: 400, body: { error, detail } })
const shown = ({ authorId: _, ...comment }: WireComment) => comment

/** The service, answering through `fetch`. `calls` holds every request; `refusals` every one it turned away. */
export const fakeComments = (options: FakeOptions = {}) => {
  const comments = [...(options.comments ?? [fakeComment("c1", "First!"), fakeComment("c2", "Agreed", "u3")])]
  const calls: FakeCall[] = []
  const refusals: string[] = []
  let loseNext = options.loseNextWriteAnswer === true
  const find = (id: string) => comments.find((one) => one.id === id)

  const routes: Route[] = [
    {
      method: "GET",
      path: /^\/v1\/me$/,
      query: [],
      answer: () => ({ status: 200, body: { id: "u1", name: "Owner" } }),
    },
    {
      method: "GET",
      path: /^\/v1\/comments$/,
      query: ["limit", "offset", "by"],
      answer: (_, { query }) => {
        const limit = Number(query.limit ?? 50)
        const offset = Number(query.offset ?? 0)
        const matching = comments.filter((one) => query.by === undefined || one.authorId === query.by)
        const page = matching.slice(offset, offset + limit).map(shown)
        return { status: 200, body: { comments: page, hasMore: offset + limit < matching.length } }
      },
    },
    {
      method: "GET",
      path: /^\/v1\/comments\/([^/]+)$/,
      query: [],
      answer: (id) => {
        const comment = find(id)
        return comment ? { status: 200, body: shown(comment) } : { status: 404, body: { error: "not_found" } }
      },
    },
    {
      method: "POST",
      path: /^\/v1\/comments$/,
      query: [],
      body: ["body"],
      answer: (_, call) => {
        const comment = fakeComment(`c${comments.length + 1}`, String(call.body?.body), "u1")
        comments.unshift(comment)
        return { status: 201, body: shown(comment) }
      },
    },
    {
      method: "PATCH",
      path: /^\/v1\/comments\/([^/]+)$/,
      query: [],
      body: ["body"],
      answer: (id, call) => {
        const comment = find(id)
        if (!comment) return { status: 404, body: { error: "not_found" } }
        comment.body = String(call.body?.body)
        return { status: 200, body: shown(comment) }
      },
    },
  ]

  const reply = (call: FakeCall): Answer => {
    if (call.headers.authorization !== `Bearer ${FAKE_TOKEN}`) return { status: 401, body: { error: "unauthorized" } }
    if (options.failWith) return { status: options.failWith, body: { error: "scripted" } }
    const route = routes.find((one) => one.method === call.method && one.path.test(call.path))
    if (!route) return refused("unknown_endpoint", `${call.method} ${call.path}`)
    const unknownParam = Object.keys(call.query).find((key) => !route.query.includes(key))
    if (unknownParam) return refused("unknown_parameter", unknownParam)
    const fields = Object.keys(call.body ?? {})
    if (!route.body && call.body !== undefined) return refused("unexpected_body", call.path)
    const unknownField = fields.find((key) => !route.body?.includes(key))
    if (unknownField) return refused("unknown_field", unknownField)
    const missing = route.body?.find((key) => !fields.includes(key))
    if (missing) return refused("missing_field", missing)
    return route.answer(decodeURIComponent(call.path.match(route.path)?.[1] ?? ""), call)
  }

  const fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input)
    const call: FakeCall = {
      method: init.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: init.body === undefined ? undefined : (JSON.parse(String(init.body)) as Record<string, unknown>),
      url: url.href,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    }
    calls.push(call)
    if (url.host !== HOST) throw new TypeError("fetch failed")
    if (options.hangWrites && call.method !== "GET")
      return new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
      )
    const answered = reply(call)
    if (answered.status === 400) refusals.push(JSON.stringify(answered.body))
    if (loseNext && call.method !== "GET") {
      loseNext = false
      throw new TypeError("fetch failed")
    }
    return new Response(JSON.stringify(answered.body), {
      status: answered.status,
      headers: { "content-type": "application/json" },
    })
  }

  return { fetch: fetch as typeof globalThis.fetch, calls, refusals, comments }
}
