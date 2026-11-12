import { createReadStream, mkdtempSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openStore } from "@wirecat/cli-core/store"
import { afterEach, expect, it } from "vitest"
import { commentLines, importRecords } from "./sample/records.js"

const SOURCE = { provider: "example-comments", account: "personal", batchId: "2026-11-08" }
const COMMENTS = [
  { id: "c1", text: "First!", author: "Test Person u2", created_at: "2026-01-02T03:04:05Z" },
  { id: "c2", text: "Agreed", author: "Test Person u3", created_at: "2026-01-02T03:04:05Z" },
]

const opened: { close(): Promise<void> }[] = []
afterEach(async () => {
  for (const store of opened.splice(0)) await store.close()
})

it("streams a JSONL file into the store, and the same file again changes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "records-"))
  const store = await openStore({ path: join(dir, "store.db") })
  opened.push(store)
  const file = join(dir, "comments.jsonl")
  await writeFile(file, commentLines(SOURCE, COMMENTS))

  const first = await importRecords(store, createReadStream(file), SOURCE.account)
  expect(first).toMatchObject({ created: 2, refused: 0, errors: [], truncated: false })
  expect(
    await store.records.get({
      provider: SOURCE.provider,
      account: SOURCE.account,
      type: "custom:comment",
      externalId: "c2",
    }),
  ).toMatchObject({ fields: { text: "Agreed" } })

  const again = await importRecords(store, createReadStream(file), SOURCE.account)
  expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, refused: 0 })
})

it("refuses every record when the header names another account", async () => {
  const dir = mkdtempSync(join(tmpdir(), "records-"))
  const store = await openStore({ path: join(dir, "store.db") })
  opened.push(store)
  const file = join(dir, "comments.jsonl")
  await writeFile(file, commentLines(SOURCE, COMMENTS))

  const receipt = await importRecords(store, createReadStream(file), "work")
  expect(receipt.errors).toEqual([expect.objectContaining({ code: "envelope.account-mismatch" })])
  expect(await store.records.list({ provider: SOURCE.provider, account: SOURCE.account })).toEqual([])
})
