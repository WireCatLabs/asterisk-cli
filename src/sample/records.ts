import { type IngestReceipt, ingestLines, jsonlLines } from "@wirecat/cli-core/services"
import type { MessageStore } from "@wirecat/cli-core/store"
import type { Comment } from "./comments.js"

// SAMPLE: a comment has no table of its own, so it is a `custom:` record. Map your service's invoices, payments,
// people and organizations to their own envelope types instead; the schema is
// @wirecat/cli-core/schemas/records-envelope.v1.schema.json.

export interface RecordsSource {
  provider: string
  account: string
  batchId: string
}

/** The JSONL a records import reads, ready for a file or stdout: the header line, then one record per line. */
export async function* commentLines(source: RecordsSource, comments: AsyncIterable<Comment> | Iterable<Comment>) {
  yield `${JSON.stringify({
    schema_version: 1,
    source: { provider: source.provider, account: source.account, batch_id: source.batchId },
  })}\n`
  for await (const comment of comments)
    yield `${JSON.stringify({
      key: comment.id,
      type: "custom:comment",
      external_id: comment.id,
      operation: "upsert",
      fields: { text: comment.text, author: comment.author, created_at: comment.created_at },
    })}\n`
}

/**
 * Takes a JSONL file or stdin into the shared store one line at a time, so memory does not grow with the file. The
 * header's `source.account` must be `account`, or every record is refused.
 */
export const importRecords = (
  store: Pick<MessageStore, "records">,
  input: NodeJS.ReadableStream,
  account: string,
): Promise<IngestReceipt> => ingestLines(store, jsonlLines(input), { account })
