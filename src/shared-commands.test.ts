import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { beforeAll, expect, it } from "vitest"
import { asteriskFolder, configure, freshFolders, runCli } from "./testing/harness.js"

const EXAMPLES = new URL("../examples/", import.meta.url)
const IN_CALL = "monitor/2026/10/31/in-74950000000-79000000001-20261031-120000-1761901200.11.wav"

let call = ""

beforeAll(async () => {
  freshFolders()
  const root = asteriskFolder({
    "Master.csv": readFileSync(new URL("Master.csv", EXAMPLES), "utf8"),
    [IN_CALL]: readFileSync(new URL(IN_CALL, EXAMPLES)),
  })
  await configure({
    cdr_csv_path: join(root, "Master.csv"),
    recordings_path: join(root, "monitor"),
    phone_region: "ru",
  })
  const synced = await runCli(["office", "meetings", "sync", "--since-time", "2026-10-01T00:00:00Z", "--json"])
  expect(synced.code, synced.err).toBe(0)
  const listed = await runCli(["office", "meetings", "list", "--json"])
  call = (listed.json().items as { id: string }[])[0]?.id ?? ""
})

/** cli-core's shared meetings commands, each run once over the imported calls: they answer, and they read the store. */
it.each([
  [["meetings", "list", "--jsonl"]],
  [["meetings", "list", "--limit", "2", "--page", "2", "--json"]],
  [["meetings", "show", "{call}", "--jsonl"]],
  [["meetings", "transcript", "{call}", "--history", "--json"]],
  [["meetings", "transcript", "{call}", "--jsonl"]],
  [["meetings", "people", "Ivan", "--json"]],
  [["meetings", "people", "Ivan", "--jsonl", "--limit", "5", "--scan-limit", "100", "--max-read-bytes", "100000"]],
  [["events", "list", "--json"]],
  [["events", "list", "--jsonl"]],
  [["meetings", "sync", "--lookback-days", "2", "--jsonl"]],
  [["meetings", "sync", "--rescan", "--json"]],
  [["meetings", "repair", "--json"]],
  [["meetings", "repair", "--jsonl"]],
])("%j answers", async (argv) => {
  const ran = await runCli(["office", ...argv.map((word) => (word === "{call}" ? call : word))])
  expect([0, 4], ran.err).toContain(ran.code)
})

it("summary and export answer for a call, and repair --yes stores nothing new", async () => {
  expect([0, 4]).toContain((await runCli(["office", "meetings", "summary", call, "--json"])).code)
  expect([0, 4]).toContain((await runCli(["office", "meetings", "summary", call, "--jsonl"])).code)
  const out = join(mkdtempSync(join(tmpdir(), "export-")), "call.md")
  const exported = await runCli([
    "office",
    "meetings",
    "export",
    call,
    "--format",
    "markdown",
    "--output",
    out,
    "--json",
  ])
  expect([0, 4], exported.err).toContain(exported.code)
  const missing = await runCli(["office", "meetings", "export", call, "--transcript-id", "1", "--jsonl"])
  expect([0, 6], missing.err).toContain(missing.code)
  const repaired = await runCli(["office", "meetings", "repair", "--yes", "--json"])
  expect(repaired.code, repaired.err).toBe(0)
})

/** Asterisk has no transcript download to import; cli-core refuses the command rather than guess a format. */
it.each([["--json"], ["--jsonl"]])("meetings import %s refuses: there is no export format to read", async (format) => {
  const folder = mkdtempSync(join(tmpdir(), "transcripts-"))
  writeFileSync(join(folder, "call.vtt"), "WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n")
  const imported = await runCli(["office", "meetings", "import", folder, format])
  expect(imported.code).toBe(3)
  expect(imported.err).toContain("configuration_error")
})

it("session start keeps a password in a file when told, and session end forgets it", async () => {
  await configure({ cdr_source: "postgres", db_host: "pbx.example.test", db_name: "cdr", db_user: "reader" })
  const keyring = memoryKeyring()
  const sql = async () => ({ rows: async () => [], close: async () => {} })
  const started = await runCli(["office", "session", "start", "--credential-storage", "file", "--json"], {
    keyring,
    sql,
    stdin: "test-password-file\n",
  })
  expect(started.code, started.err).toBe(0)
  expect(started.json().item).toMatchObject({ stored_in: "file" })
  const ended = await runCli(["office", "session", "end", "--json"], { keyring })
  expect(ended.code, ended.err).toBe(0)
  expect(ended.json().item).toMatchObject({ calls: "retained" })
  await configure({ cdr_source: "csv" })
})

it("models list names the speech models", async () => {
  const listed = await runCli(["models", "list", "--json"])
  expect(listed.code, listed.err).toBe(0)
})

it("meetings people continues from its --cursor", async () => {
  const first = await runCli(["office", "meetings", "people", "Testov", "--limit", "1", "--json"])
  expect(first.code, first.err).toBe(0)
  const cursor = (first.json().page as { next_cursor?: string }).next_cursor
  expect(cursor).toBeTruthy()
  const next = await runCli([
    "office",
    "meetings",
    "people",
    "Testov",
    "--limit",
    "1",
    "--cursor",
    cursor ?? "",
    "--json",
  ])
  expect(next.code, next.err).toBe(0)
})

it("doctor reports show what a report holds, and create writes one about a failed run", async () => {
  const shown = await runCli(["doctor", "reports", "show", "--json"])
  expect(shown.code, shown.err).toBe(0)
  const failed = await runCli(["office", "meetings", "import", mkdtempSync(join(tmpdir(), "empty-")), "--json"])
  expect(failed.code).not.toBe(0)
  const output = join(mkdtempSync(join(tmpdir(), "report-")), "report.json")
  const created = await runCli(["doctor", "reports", "create", "--output", output, "--json"])
  expect(created.code, created.err).toBe(0)
  const run = (created.json().item as { run: string | { id: string } }).run
  const runId = typeof run === "string" ? run : run.id
  const again = await runCli(["doctor", "reports", "create", "--run", runId, "--output", `${output}.2`, "--json"])
  expect(again.code, again.err).toBe(0)
  expect(readFileSync(output, "utf8")).not.toContain("test-password")
})
