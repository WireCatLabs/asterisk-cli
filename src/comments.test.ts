import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { brokenKeyring, memoryKeyring } from "@wirecat/cli-base"
import { ProfileTokenStore, type RunOptions } from "@wirecat/cli-core/cli"
import { mcpOverStdio } from "@wirecat/cli-core/testing"
import { afterEach, expect, it } from "vitest"
import type { ServiceEnvironment } from "./context.js"
import { IDENTITY } from "./identity.js"
import { run } from "./program.js"
import { FAKE_TOKEN, fakeComments } from "./testing/fake-comments.js"
import { runCli, signedIn } from "./testing/harness.js"

const configFile = join(process.env.ASTERISK_CONFIG_DIR ?? "", "config.json")
const withPermissions = (permissions: Record<string, string>) => {
  mkdirSync(join(configFile, ".."), { recursive: true })
  writeFileSync(configFile, JSON.stringify({ profiles: { personal: { permissions } } }))
}
afterEach(() => rmSync(configFile, { force: true }))

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())

it("lists comments in the answer's own shape, asking the service only what it documents", async () => {
  const service = fakeComments()
  const listed = await runCli(["personal", "comments", "list", "--json"], { service })
  expect(listed.code).toBe(0)
  expect(listed.json().items).toEqual([
    { id: "c1", text: "First!", author: "Test Person u2", created_at: "2026-01-02T03:04:05Z" },
    { id: "c2", text: "Agreed", author: "Test Person u3", created_at: "2026-01-02T03:04:05Z" },
  ])
  expect(service.refusals).toEqual([])
  expect(service.calls.map((call) => call.url)).toEqual([
    "https://comments.example.invalid/v1/comments?limit=20&offset=0",
  ])
})

it("narrows the list with its query, pages it, and keeps only the --json fields asked for", async () => {
  const service = fakeComments()
  const narrowed = await runCli(["personal", "comments", "list", "author:u3", "--json=id,text"], { service })
  expect(narrowed.json().items).toEqual([{ id: "c2", text: "Agreed" }])
  const paged = await runCli(["personal", "comments", "list", "--limit", "1", "--page", "2", "--json"], { service })
  expect(paged.json()).toMatchObject({ items: [{ id: "c2" }] })
  expect(service.calls.at(-1)?.query).toEqual({ limit: "1", offset: "1" })
  const all = await runCli(["personal", "comments", "list", "--all", "--json"], { service })
  expect(all.json()).toMatchObject({ items: [{ id: "c1" }, { id: "c2" }] })
  expect(service.refusals).toEqual([])
})

it("refuses a query field the list does not have, before any request", async () => {
  const service = fakeComments()
  const { code, json } = await runCli(["personal", "comments", "list", "colour:red", "--json"], { service })
  expect(code).toBe(2)
  expect(json()).toMatchObject({ error: { code: "validation_error" } })
  expect(service.calls).toEqual([])
})

it("shows one comment, and says not_found for an id the service does not have", async () => {
  expect((await runCli(["personal", "comments", "show", "c2", "--json"])).json().item).toMatchObject({ id: "c2" })
  const missing = await runCli(["personal", "comments", "show", "c9", "--json"])
  expect(missing.json()).toMatchObject({ error: { code: "not_found" } })
})

it("creates and updates a comment, each answer with its operation_id", async () => {
  const service = fakeComments()
  const created = await runCli(["personal", "comments", "create", "--text", "Plan", "--json"], { service })
  expect(created.code).toBe(0)
  expect(created.json().item).toMatchObject({ operation_id: expect.any(String), comment: { id: "c3", text: "Plan" } })
  const updated = await runCli(["personal", "comments", "update", "c3", "--text", "Plans", "--json"], { service })
  expect(updated.json().item).toMatchObject({ operation_id: expect.any(String), comment: { text: "Plans" } })
  expect(service.refusals).toEqual([])
  expect(service.calls.map((call) => call.body)).toEqual([{ body: "Plan" }, { body: "Plans" }])
})

it("--dry-run names the write's permission and sends nothing", async () => {
  const service = fakeComments()
  const preview = await runCli(["personal", "comments", "create", "--text", "Plan", "--dry-run", "--json"], { service })
  expect(preview.code).toBe(0)
  expect(preview.json().item).toMatchObject({ permission: { key: "comments.create" } })
  expect(service.calls).toEqual([])
})

it("a deny on a read stops it before any request", async () => {
  withPermissions({ "comments.list": "deny" })
  const service = fakeComments()
  const { code, json } = await runCli(["personal", "comments", "list", "--json"], { service })
  expect(code).toBe(5)
  expect(json()).toMatchObject({ error: { code: "permission_error" } })
  expect(service.calls).toEqual([])
})

it("a deny on a write, or the read-only lock, stops it before any request", async () => {
  const service = fakeComments()
  withPermissions({ "comments.create": "deny" })
  expect((await runCli(["personal", "comments", "create", "--text", "Plan", "--json"], { service })).code).toBe(5)
  rmSync(configFile)
  const locked = await runCli(["personal", "comments", "create", "--text", "Plan", "--json"], {
    service,
    env: { ASTERISK_READ_ONLY: "1" },
  })
  expect(locked.code).toBe(5)
  expect(service.calls).toEqual([])
})

it("a write at ask asks once; no sends nothing, yes sends it", async () => {
  withPermissions({ "comments.create": "ask" })
  const service = fakeComments()
  const asked: string[] = []
  const answering = (reply: string) => (question: string) => {
    asked.push(question)
    return reply
  }
  const no = await runCli(["personal", "comments", "create", "--text", "Plan"], { service, answer: answering("n") })
  expect(no.code).not.toBe(0)
  expect(asked).toHaveLength(1)
  expect(service.calls).toEqual([])
  const yes = await runCli(["personal", "comments", "create", "--text", "Plan"], { service, answer: answering("y") })
  expect(yes.code).toBe(0)
  expect(asked).toHaveLength(2)
  expect(service.calls).toHaveLength(1)
})

it("a write whose answer is lost is outcome_unknown with its operation_id, and is sent once", async () => {
  const service = fakeComments({ loseNextWriteAnswer: true })
  const lost = await runCli(["personal", "comments", "create", "--text", "Plan", "--json"], { service })
  expect(lost.json()).toMatchObject({
    error: { code: "outcome_unknown", details: { operation_id: expect.any(String) } },
  })
  expect(service.calls).toHaveLength(1)
  expect(service.comments[0]?.body).toBe("Plan")
})

it("a write still in flight when --timeout ends the run is outcome_unknown, never a plain timeout", async () => {
  const service = fakeComments({ hangWrites: true })
  const cut = await runCli(["--timeout", "50ms", "personal", "comments", "create", "--text", "Plan", "--json"], {
    service,
  })
  expect(cut.json()).toMatchObject({
    error: { code: "outcome_unknown", details: { operation_id: expect.any(String) } },
  })
  expect(service.calls).toHaveLength(1)
})

it("a server failure is outcome_unknown for a write and retryable for a read", async () => {
  const service = fakeComments({ failWith: 503 })
  const write = await runCli(["personal", "comments", "create", "--text", "Plan", "--json"], { service })
  expect(write.json()).toMatchObject({ error: { code: "outcome_unknown" } })
  const read = await runCli(["personal", "comments", "list", "--json"], { service })
  expect(read.json()).toMatchObject({ error: { code: "provider_unavailable", retry: { safe: true } } })
  expect(service.calls).toHaveLength(2)
})

it("without a sign-in a command says how to sign in and sends nothing", async () => {
  const service = fakeComments()
  const { json } = await runCli(["personal", "comments", "list", "--json"], { service, keyring: memoryKeyring() })
  expect(json()).toMatchObject({ error: { code: "authentication_error", reason: "session.missing" } })
  expect(JSON.stringify(json())).toContain("session start")
  expect(service.calls).toEqual([])
})

it("--offline refuses a command that needs the service", async () => {
  const service = fakeComments()
  expect((await runCli(["--offline", "personal", "comments", "list", "--json"], { service })).code).toBe(5)
  expect(service.calls).toEqual([])
})

it("a recorded run is named after the command and holds its request", async () => {
  const listed = await runCli(["--record", "personal", "comments", "list", "--json"])
  const runId = String((listed.json().meta as Record<string, unknown>).run_id)
  expect(runId).toContain("comments")
  expect(runId).not.toContain("-process-")
  expect((await runCli(["runs", "show", runId, "--json"])).out).toContain("GET /comments")
})

it("session start reads the token from stdin and checks it before keeping it; status, list and end", async () => {
  const keyring = memoryKeyring()
  const service = fakeComments()
  const started = await runCli(["personal", "session", "start", "--json"], { keyring, service, stdin: FAKE_TOKEN })
  expect(started.json().item).toMatchObject({ verified: true, user: { id: "u1" } })
  const status = await runCli(["personal", "session", "status", "--check", "--json"], { keyring, service })
  expect(status.json().item).toMatchObject({ state: "saved", token_from: "keyring", verified: true })
  expect((await runCli(["session", "list", "--json"], { keyring })).json().items).toContainEqual(
    expect.objectContaining({ profile: "personal", signed_in: true }),
  )
  expect((await runCli(["personal", "session", "end", "--json"], { keyring })).code).toBe(0)
  const ended = await runCli(["personal", "session", "status", "--json"], { keyring })
  expect(ended.json().item).toMatchObject({ state: "missing" })
})

it("session start --credential-storage file keeps the token in a private file instead of the keyring", async () => {
  const keyring = memoryKeyring()
  const started = await runCli(["personal", "session", "start", "--credential-storage", "file", "--json"], {
    keyring,
    stdin: FAKE_TOKEN,
  })
  expect(started.json().item).toMatchObject({ stored_in: "file" })
  const status = await runCli(["personal", "session", "status", "--json"], { keyring })
  expect(status.json().item).toMatchObject({ token_from: "file" })
  expect((await runCli(["personal", "session", "end", "--json"], { keyring })).json().item).toMatchObject({
    ended: expect.arrayContaining(["file"]),
  })
})

it("session start without a working keyring keeps the token in a private file, and says so on stderr", async () => {
  const keyring = brokenKeyring()
  const started = await runCli(["personal", "session", "start", "--json"], { keyring, stdin: FAKE_TOKEN })
  expect(started.json().item).toMatchObject({ stored_in: "file" })
  expect(started.err).toContain("keyring")
  expect(new ProfileTokenStore({ app: IDENTITY, keyring }).signedIn("personal")).toBe(true)
  expect((await runCli(["personal", "session", "end", "--json"], { keyring })).code).toBe(0)
  expect(new ProfileTokenStore({ app: IDENTITY, keyring }).signedIn("personal")).toBe(false)
})

it("session start refuses a storage it does not know, before asking for the token", async () => {
  const { code, err } = await runCli(["personal", "session", "start", "--credential-storage", "vault", "--json"])
  expect(code).toBe(2)
  expect(err).toContain("--credential-storage takes keyring or file")
})

it("session start keeps nothing when the service refuses the token", async () => {
  const keyring = memoryKeyring()
  const refused = await runCli(["personal", "session", "start", "--json"], { keyring, stdin: "wrong0token" })
  expect(refused.json()).toMatchObject({ error: { code: "authentication_error" } })
  const status = await runCli(["personal", "session", "status", "--json"], { keyring })
  expect(status.json().item).toMatchObject({ state: "missing" })
})

it("the token reaches no address, output, run record or journal, whatever the outcome", async () => {
  const service = fakeComments({ loseNextWriteAnswer: true })
  const runs = [
    await runCli(["personal", "session", "start", "--json"], { keyring: memoryKeyring(), stdin: FAKE_TOKEN }),
    await runCli(["--record", "personal", "comments", "list", "--json"], { service }),
    await runCli(["personal", "comments", "create", "--text", "Plan", "--json"], { service }),
    await runCli(["personal", "comments", "show", "c9", "--json"], { service }),
    await runCli(["personal", "comments", "list", "--json"], { service: fakeComments({ failWith: 401 }) }),
  ]
  for (const ran of runs) expect(ran.out + ran.err).not.toContain(FAKE_TOKEN)
  for (const call of service.calls) expect(call.url).not.toContain(FAKE_TOKEN)
  const folders = [...new Set([process.env.HOME ?? "", tmpdir()])]
  const written = folders.flatMap(filesUnder).map((path) => readFileSync(path, "utf8"))
  expect(written.some((text) => text.includes("GET /comments"))).toBe(true)
  expect(written.some((text) => text.includes("comments.create"))).toBe(true)
  expect(written.filter((text) => text.includes(FAKE_TOKEN))).toEqual([])
})

it("mcp serve runs a read for an agent with the run's keyring", async () => {
  const service = fakeComments()
  const options: RunOptions & ServiceEnvironment = { tty: false, keyring: signedIn(), fetch: service.fetch }
  const mcp = await mcpOverStdio((streams) => run(["personal", "mcp", "serve"], { ...options, ...streams }))
  try {
    const listed = await mcp.call("asterisk_read", { command: "comments list", arguments: { query: "author:u2" } })
    expect(listed.body).toMatchObject({ items: [{ id: "c1" }] })
  } finally {
    expect(await mcp.close()).toBe(0)
  }
})
