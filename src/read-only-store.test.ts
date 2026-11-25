import { existsSync } from "node:fs"
import { beforeEach, expect, it } from "vitest"
import { configure, freshFolders, runCli } from "./testing/harness.js"

beforeEach(freshFolders)

it("creates no wirecat.db when a read runs under PBX_READ_ONLY before any sync", async () => {
  await configure({ cdr_csv_path: "/nonexistent/Master.csv" })
  const list = await runCli(["office", "meetings", "list", "--json"], { env: { PBX_READ_ONLY: "1" } })
  expect(list.code, list.err).toBe(0)
  expect(list.json().items).toEqual([])
  expect(existsSync(process.env.MESSAGING_STORE as string)).toBe(false)
})
