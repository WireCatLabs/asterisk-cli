import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { annotate } from "@wirecat/cli-base/commands"
import { REMOTE_READ, run as runShared } from "@wirecat/cli-core/cli"
import { Command } from "commander"
import { expect, it } from "vitest"
import { IDENTITY } from "./identity.js"
import { definition, run } from "./program.js"

const ran = async (argv: string[]) => {
  const out: string[] = []
  const err: string[] = []
  const code = await run(argv, {
    streams: { data: (text) => out.push(text), diagnostic: (text) => err.push(text) },
    tty: false,
  })
  return { code, out: out.join("\n"), err: err.join("\n") }
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const json = (text: string) => {
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed) || !isRecord(parsed.item)) throw new Error(`not an answer with one item: ${text}`)
  return { item: parsed.item }
}

it("lists the required root commands and config", async () => {
  const { code, out } = await ran(["commands", "--json"])
  expect(code).toBe(0)
  const required = ["commands", "doctor", "skill", "mcp", "upgrade", "config", "runs"]
  expect(JSON.parse(out).commands).toEqual(
    expect.arrayContaining(required.map((name) => expect.objectContaining({ name }))),
  )
})

it("doctor answers without a config file", async () => {
  const { code, out } = await ran(["doctor", "--json"])
  expect(code).toBe(0)
  expect(json(out).item).toMatchObject({ config: { found: false, issues: [] }, profiles: [], read_only: null })
})

const withConfig = async (text: string, check: (config: unknown) => void) => {
  const dir = process.env.PBX_CONFIG_DIR ?? ""
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "config.json"), text)
  try {
    const { code, out } = await ran(["doctor", "--json"])
    expect(code).toBe(0)
    check(json(out).item.config)
  } finally {
    rmSync(join(dir, "config.json"))
  }
}

it("doctor reports invalid JSON as an issue", async () => {
  await withConfig('{\n  "defaults": {\n', (config) =>
    expect(config).toMatchObject({ found: true, issues: [{ kind: "invalid_json", line: 3 }] }),
  )
})

it("doctor reports an unknown setting with the command that removes it", async () => {
  await withConfig('{ "defaults": { "limt": 3 } }', (config) =>
    expect(config).toMatchObject({
      found: true,
      issues: [{ kind: "unknown_setting", key: "limt", fix: "pbx config unset --defaults limt" }],
    }),
  )
})

it("doctor reports settings an environment variable breaks, and still answers", async () => {
  const out: string[] = []
  const code = await run(["doctor", "--json"], {
    streams: { data: (text) => out.push(text), diagnostic: () => {} },
    tty: false,
    env: { ...process.env, PBX_EMBEDDING_DIMS: "many" },
  })
  expect(code).toBe(0)
  expect(json(out.join("")).item).toMatchObject({ config: { issues: [] }, version: IDENTITY.version })
})

it.skipIf(process.platform === "win32")(
  "doctor names a config file and folder others can read, with the chmod that fixes each",
  async () => {
    const dir = process.env.PBX_CONFIG_DIR ?? ""
    const file = join(dir, "config.json")
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, "{}")
    chmodSync(file, 0o644)
    chmodSync(dir, 0o775)
    try {
      const { code, out, err } = await ran(["doctor", "--json"])
      expect(code).toBe(0)
      expect(json(out).item.files).toEqual({
        checked: true,
        ok: false,
        problems: [
          { path: file, mode: "0644", want: "0600" },
          { path: dir, mode: "0775", want: "0700" },
        ],
      })
      expect(err).toContain(`to make it private: chmod 600 '${file}'`)
      expect(err).toContain(`to make it private: chmod 700 '${dir}'`)

      chmodSync(dir, 0o700)
      expect((await ran(["personal", "config", "set", "--defaults", "limit", "5"])).code).toBe(0)
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(json((await ran(["doctor", "--json"])).out).item.files).toEqual({ checked: true, ok: true, problems: [] })
    } finally {
      rmSync(file)
    }
  },
)

it("config show names the profile it was given", async () => {
  const { code, out } = await ran(["personal", "config", "show", "--json"])
  expect(code).toBe(0)
  expect(json(out).item).toMatchObject({ profile: "personal", profile_from: "first word" })
})

it("skill show prints the packaged skill", async () => {
  const { code, out } = await ran(["skill", "show"])
  expect(code).toBe(0)
  expect(out).toContain(
    readFileSync(new URL("../skills/asterisk-cli/SKILL.md", import.meta.url), "utf8").split("\n")[0],
  )
})

it("mcp serve without a profile stops and says so", async () => {
  const { code, err } = await ran(["mcp", "serve", "--json"])
  expect(code).toBe(2)
  expect(err).toContain("validation_error")
})

it("mcp alone only names its commands", async () => {
  const { code, err } = await ran(["personal", "mcp", "--json"])
  expect(code).toBe(2)
  expect(err).toContain("--help")
})

it("upgrade --check installs nothing when npm cannot be reached", async () => {
  const { code, out } = await ran(["upgrade", "--check", "--json"])
  expect(code).toBe(0)
  expect(json(out).item).toMatchObject({ current: IDENTITY.version, latest: null, updated: false })
})

it("keeps a failed command as a run, and runs list, show and path read it back", async () => {
  expect((await ran(["--no-such-flag"])).code).toBe(2)
  const listed = await ran(["runs", "list", "--limit", "5", "--page", "1", "--json"])
  expect(listed.code).toBe(0)
  const failed: unknown = JSON.parse(listed.out).items.find((run: { status: string }) => run.status === "failed")
  if (!isRecord(failed) || typeof failed.run_id !== "string") throw new Error(`no failed run in ${listed.out}`)
  const id = failed.run_id
  const shown = await ran(["runs", "show", id, "--json"])
  expect(shown.code).toBe(0)
  expect(shown.out).toContain(id)
  expect((await ran(["runs", "show", id, "--problems", "--json"])).code).toBe(0)
  const path = await ran(["runs", "path", id])
  expect(path.code).toBe(0)
  expect(path.out).toContain(id)
})

it("a failed run keeps the words typed, and record_input false masks them", async () => {
  const keptArgv = async (words: string) => {
    expect((await ran(["personal", "skill", "show", words])).code).toBe(2)
    const { out } = await ran(["runs", "list", "--limit", "50", "--json"])
    return JSON.parse(out).items.map((run: { argv: string[] }) => run.argv)
  }
  expect(await keptArgv("weekly report")).toContainEqual(["personal", "skill", "show", "weekly report"])
  expect((await ran(["personal", "config", "set", "record_input", "false"])).code).toBe(0)
  try {
    const masked = await keptArgv("monthly report")
    expect(JSON.stringify(masked)).not.toContain("monthly report")
    expect(masked).toContainEqual(["personal", "skill", "show", "[redacted]"])
  } finally {
    expect((await ran(["personal", "config", "unset", "record_input"])).code).toBe(0)
  }
})

it("runs list --compact prints one plain line per run and the next page as a # line, not JSON", async () => {
  for (const _ of [1, 2]) expect((await ran(["--no-such-flag"])).code).toBe(2)
  const { code, out } = await ran(["runs", "list", "--limit", "1", "--compact"])
  expect(code).toBe(0)
  expect(out.trim().split("\n")).toEqual([
    expect.stringContaining("failed"),
    "# more: pbx runs list --page 2 --limit 1 --compact",
  ])
  expect(() => JSON.parse(out)).toThrow()
})

it("config migrate writes the missing defaults, keeps the owner's value, and repeats as a no-op", async () => {
  const file = join(process.env.PBX_CONFIG_DIR ?? "", "config.json")
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, '{ "defaults": { "limit": 5 } }')
  try {
    const first = await ran(["config", "migrate", "--json"])
    expect(first.code).toBe(0)
    expect(json(first.out).item.added).toContain("defaults.record")
    expect(JSON.parse(readFileSync(file, "utf8")).defaults).toMatchObject({ limit: 5, record: expect.any(Boolean) })
    const again = await ran(["config", "migrate", "--json"])
    expect(json(again.out).item.added).toEqual([])
  } finally {
    rmSync(file)
  }
})

it("config repair --dry-run changes nothing, and config repair fixes the JSON with a backup", async () => {
  const dir = process.env.PBX_CONFIG_DIR ?? ""
  const file = join(dir, "config.json")
  const broken = '{ "defaults": { "limit": 5, }, }'
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, broken)
  let backup = ""
  try {
    const preview = await ran(["config", "repair", "--dry-run", "--json"])
    expect(preview.code).toBe(0)
    expect(json(preview.out).item).toMatchObject({ dry_run: true, repaired: false, backup: null })
    expect(readFileSync(file, "utf8")).toBe(broken)

    const fixed = await ran(["config", "repair", "--json"])
    expect(fixed.code).toBe(0)
    const item = json(fixed.out).item
    expect(item).toMatchObject({
      repaired: true,
      changes: expect.arrayContaining([{ kind: "trailing_comma", line: 1 }]),
    })
    backup = String(item.backup)
    expect(readFileSync(backup, "utf8")).toBe(broken)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ defaults: { limit: 5 } })
  } finally {
    rmSync(file)
    if (backup) rmSync(backup)
  }
})

it("a deny in the profile stops a read command before its action runs", async () => {
  const reached: string[] = []
  const probe = annotate(new Command("probe"), { effects: REMOTE_READ, offline: false }).action(() => {
    reached.push("probe")
  })
  const withProbe = { ...definition(), commands: () => [...definition().commands(), probe] }
  const dir = process.env.PBX_CONFIG_DIR ?? ""
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ profiles: { personal: { permissions: { probe: "deny" } } } }),
  )
  const err: string[] = []
  try {
    const code = await runShared(["personal", "probe", "--json"], withProbe, {
      streams: { data: () => {}, diagnostic: (text) => err.push(text) },
      tty: false,
    })
    expect(code).not.toBe(0)
    expect(err.join("\n")).toContain("permission_error")
    expect(reached).toEqual([])
  } finally {
    rmSync(join(dir, "config.json"))
  }
})
