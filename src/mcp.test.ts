import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import type { RunOptions } from "@wirecat/cli-core/cli"
import { mcpOverStdio } from "@wirecat/cli-core/testing"
import { expect, it } from "vitest"
import type { AsteriskEnvironment } from "./context.js"
import { IDENTITY } from "./identity.js"
import { run } from "./program.js"
import { runCli } from "./testing/harness.js"

it("mcp serve offers search, read and write, and runs a command through the CLI", async () => {
  const mcp = await mcpOverStdio((streams) => run(["personal", "mcp", "serve"], { tty: false, ...streams }))
  try {
    expect((await mcp.tools()).sort()).toEqual(["asterisk_read", "asterisk_tools_search", "asterisk_write"])
    const doctor = await mcp.call("asterisk_read", { command: "doctor" })
    expect(doctor.body).toMatchObject({ item: { version: IDENTITY.version } })
  } finally {
    expect(await mcp.close()).toBe(0)
  }
})

it("mcp serve refuses a --permission that names no command, and a --profiles this computer lacks", async () => {
  const unknown = await runCli(["personal", "mcp", "serve", "--permission", "meetings.nope=deny"])
  expect(unknown.code).toBe(2)
  expect(unknown.err).toContain("meetings.nope")
  const missing = await runCli(["mcp", "serve", "--profiles", "nope"])
  expect(missing.code).toBe(2)
  expect(missing.err).toContain("nope")
})

it("mcp config prints an entry that serves the named profile, or every profile only when told", async () => {
  const one = await runCli(["personal", "mcp", "config", "--permission", "meetings.sync=deny", "--json"])
  const entry = one.json().item as { config: { mcpServers: Record<string, { args: string[] }> } }
  expect(entry.config.mcpServers["asterisk-personal"]?.args.slice(-5)).toEqual([
    "personal",
    "mcp",
    "serve",
    "--permission",
    "meetings.sync=deny",
  ])
  const all = await runCli(["mcp", "config", "--profiles", "all", "--json"])
  expect(JSON.stringify(all.json())).toContain('"--profiles","all"')
})

it("mcp revoke answers for the profile it names", async () => {
  const revoked = await runCli(["personal", "mcp", "revoke", "--json"])
  expect(revoked.code).toBe(0)
  expect(revoked.json().item).toMatchObject({ profile: "personal" })
})

it("doctor --online answers even when npm cannot be reached", async () => {
  const online = await runCli(["doctor", "--online", "--json"])
  expect(online.code).toBe(0)
  expect(online.json().item).toMatchObject({ version: IDENTITY.version, online: expect.any(Object) })
})

it("a denied command is offered as unavailable and refused before any request (WC-PERM-23)", async () => {
  const file = join(process.env.ASTERISK_CONFIG_DIR ?? "", "config.json")
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, JSON.stringify({ profiles: { personal: { permissions: { "meetings.sync": "deny" } } } }))
  const opened: string[] = []
  const options: RunOptions & AsteriskEnvironment = {
    tty: false,
    keyring: memoryKeyring(),
    sql: async () => {
      opened.push("sql")
      throw new Error("never reached")
    },
  }
  const mcp = await mcpOverStdio((streams) => run(["personal", "mcp", "serve"], { ...options, ...streams }))
  try {
    const found = await mcp.call("asterisk_tools_search", { query: "meetings sync" })
    expect(found.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          command: "meetings sync",
          availability: expect.objectContaining({ available: false }),
        }),
      ]),
    })
    const synced = await mcp.call("asterisk_read", { command: "meetings sync" })
    expect(synced.isError).toBe(true)
    expect(JSON.stringify(synced.body)).toContain("permission_error")
    expect(opened).toEqual([])
  } finally {
    expect(await mcp.close()).toBe(0)
    rmSync(file, { force: true })
  }
})
