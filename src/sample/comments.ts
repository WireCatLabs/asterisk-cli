import * as v from "valibot"
import type { Transport } from "./transport.js"

// SAMPLE: replace these shapes with your service's. Each wire name comes from the service's docs or a captured answer,
// never from memory; the strict fake in src/testing/fake-comments.ts refuses any other.
const wireComment = v.object({
  id: v.string(),
  body: v.string(),
  authorName: v.string(),
  createdAt: v.string(),
})
const wirePage = v.object({ comments: v.array(wireComment), hasMore: v.boolean() })
const wireUser = v.object({ id: v.string(), name: v.string() })

/**
 * The answer's own shape, in snake_case (WC-OUT-12). `answerEntity` publishes it, so `--json=id,text` and the MCP
 * schema both come from here (WC-CMD-19). No wire type leaves this file (WC-ARCH-3).
 */
export const commentSchema = v.strictObject({
  id: v.string(),
  text: v.string(),
  author: v.string(),
  created_at: v.string(),
})
export type Comment = v.InferOutput<typeof commentSchema>

export const commentOf = (wire: v.InferOutput<typeof wireComment>): Comment => ({
  id: wire.id,
  text: wire.body,
  author: wire.authorName,
  created_at: wire.createdAt,
})

/** Every call the sample makes: a method, a path template and only the fields the service documents. */
export const commentsService = (api: Transport) => ({
  me: () => api.send({ method: "GET", path: "me" }, wireUser),
  list: async ({ limit, offset, author }: { limit: number; offset: number; author?: string | undefined }) => {
    const page = await api.send({ method: "GET", path: "comments", query: { limit, offset, by: author } }, wirePage)
    return { items: page.comments.map(commentOf), has_more: page.hasMore }
  },
  show: async (id: string) =>
    commentOf(await api.send({ method: "GET", path: "comments/{id}", ids: { id } }, wireComment)),
  create: async (text: string) =>
    commentOf(await api.send({ method: "POST", path: "comments", body: { body: text } }, wireComment)),
  update: async (id: string, text: string) =>
    commentOf(
      await api.send({ method: "PATCH", path: "comments/{id}", ids: { id }, body: { body: text } }, wireComment),
    ),
})

export type CommentsService = ReturnType<typeof commentsService>
