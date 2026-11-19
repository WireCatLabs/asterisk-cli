import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { setupProblems } from "@wirecat/cli-core/cli"
import { beforeEach, expect, it } from "vitest"
import { configuration } from "./config.js"
import { setup } from "./setup.js"
import { sourceOf } from "./source.js"
import {
  fakeServer,
  fakeTable,
  fakeTunnel,
  hostKey,
  KEY,
  PASSWORD,
  SFTP_PASSWORD,
  SSH_KEY,
  SSH_PASSWORD,
} from "./testing/fakes.js"
import { freshFolders, runCli } from "./testing/harness.js"

const SINCE = ["--since-time", "2026-10-31T00:00:00Z"]

const MYSQL = {
  cdr_source: "mysql",
  files_from: "local",
  db_host: "pbx.example.test",
  db_user: "wirecat_reader",
  db: PASSWORD,
  phone_region: ["RU", "ES"],
  extension_names: "103=Vera Orlova",
}

const configFile = () => join(process.env.PBX_CONFIG_DIR as string, "config.json")

/** The file may get the shared defaults on the first run; the profile itself is written only by a passed check. */
const profileSaved = () =>
  existsSync(configFile()) && "office" in JSON.parse(readFileSync(configFile(), "utf8")).profiles

const setupCli = (argv: string[], answers: Record<string, unknown>, options: Parameters<typeof runCli>[1] = {}) =>
  runCli(["office", "setup", ...argv, "--json"], { stdin: JSON.stringify(answers), ...options })

const saved = async (keyring = memoryKeyring()) =>
  (
    (await runCli(["office", "setup", "show", "--json"], { keyring })).json().item as {
      values: Record<string, unknown>
    }
  ).values

beforeEach(() => freshFolders())

it("the flow passes defineSetup's checks, and Russian and Spanish have every English text", () => {
  expect(setupProblems(setup.document, { settings: configuration.allSettings, v1: true })).toEqual([])
  const english = Object.keys(setup.document.texts.en ?? {}).sort()
  for (const language of ["ru", "es"]) expect(Object.keys(setup.document.texts[language] ?? {}).sort()).toEqual(english)
})

it("setup show needs no profile and no settings file, and carries each setting's own schema", async () => {
  const shown = await runCli(["setup", "show", "--json"])
  expect(shown.code, shown.err).toBe(0)
  const document = shown.json().item as { format: string; values?: unknown; steps: Record<string, unknown> }
  expect(document).toMatchObject({ format: "wirecat.setup", tool: "pbx", start: "source" })
  expect(document.values).toBeUndefined()
  expect(JSON.stringify(document.steps.recordings)).toContain('"schema"')
  expect(existsSync(configFile())).toBe(false)
})

it("a dry run names each input to fix on the step it stops at, and saves nothing", async () => {
  const checked = await setupCli(["apply", "--dry-run"], { cdr_source: "mysql", files_from: "local", db_port: 70000 })
  expect(checked.code, checked.err).toBe(0)
  const item = checked.json().item as { valid: boolean; at: string; errors: { input: string }[] }
  expect(item).toMatchObject({ valid: false, at: "database" })
  expect(item.errors.map(({ input }) => input)).toEqual(expect.arrayContaining(["db_host", "db_port", "db_user"]))
  expect(existsSync(configFile())).toBe(false)
})

it("apply checks the database first, saves only a working profile, and that profile then syncs", async () => {
  const table = fakeTable()
  const keyring = memoryKeyring()
  const wrong = await setupCli(["apply"], { ...MYSQL, db: "nope" }, { keyring, sql: table.open })
  expect(wrong.json()).toMatchObject({ error: { code: "authentication_error", reason: "db.refused" } })
  expect(profileSaved()).toBe(false)
  expect(keyring.entries.size).toBe(0)

  const applied = await setupCli(["apply"], MYSQL, { keyring, sql: table.open })
  expect(applied.code, applied.err).toBe(0)
  expect(applied.json().item).toMatchObject({ outcome: "ok", secrets: ["token"], cdr: "mysql" })
  expect(applied.out).not.toContain(PASSWORD)
  expect([...keyring.entries.keys()]).toEqual(["asterisk-cli:token:office"])

  const status = await runCli(["office", "session", "status", "--check", "--json"], { keyring, sql: table.open })
  expect(status.json().item).toMatchObject({ state: "saved", verified: true })
  const synced = await runCli(["office", "meetings", "sync", ...SINCE, "--json"], { keyring, sql: table.open })
  expect(synced.code, synced.err).toBe(0)
})

it("a changed server or user needs its password typed again; an unchanged one keeps the saved password", async () => {
  const table = fakeTable()
  const keyring = memoryKeyring()
  expect((await setupCli(["apply"], MYSQL, { keyring, sql: table.open })).code).toBe(0)
  const { db: _, ...withoutPassword } = MYSQL

  const moved = await setupCli(
    ["apply"],
    { ...withoutPassword, db_host: "other.example.test" },
    { keyring, sql: table.open },
  )
  expect(moved.json()).toMatchObject({ error: { code: "validation_error", param: "db" } })
  const renamed = await setupCli(["apply"], { ...withoutPassword, db_user: "someone" }, { keyring, sql: table.open })
  expect(renamed.json()).toMatchObject({ error: { code: "validation_error", param: "db" } })
  expect(await saved(keyring)).toMatchObject({ db_host: "pbx.example.test", db_user: "wirecat_reader" })

  const kept = await setupCli(["apply"], { ...withoutPassword, db_name: "cdr2" }, { keyring, sql: table.open })
  expect(kept.code, kept.err).toBe(0)
  expect(kept.json().item).toMatchObject({ outcome: "ok", secrets: [] })
})

it("the countries list is kept as a list, and a list, a comma-separated text or one code all read the same", async () => {
  expect((await setupCli(["apply"], MYSQL, { sql: fakeTable().open })).code).toBe(0)
  expect((await saved()).phone_region).toEqual(["RU", "ES"])
  expect((await saved()).extension_names).toBe("103=Vera Orlova")
  const regions = () =>
    sourceOf(configuration.resolveSettings({ profile: "office" }, { env: process.env })).phoneRegions
  expect(regions()).toEqual(["ru", "es"])
  expect((await runCli(["office", "config", "set", "phone_region", "es,ru", "--json"])).code).toBe(0)
  expect(regions()).toEqual(["es", "ru"])
  expect((await runCli(["office", "config", "set", "phone_region", "de", "--json"])).code).toBe(0)
  expect(regions()).toEqual(["de"])
})

it("Master.csv over SFTP: the check shows the server's key to pin, then keeps the SFTP password as the token", async () => {
  const server = fakeServer()
  const keyring = memoryKeyring()
  const answers = {
    cdr_source: "csv",
    files_from: "sftp",
    sftp_host: "pbx.example.test",
    sftp_user: "wirecat",
    sftp_token: SFTP_PASSWORD,
    recordings_path_remote: "/var/spool/asterisk/monitor",
    phone_region: ["RU"],
  }
  const environment = { keyring, sftp: server.open, sftpHostKey: hostKey }
  const unpinned = await setupCli(["apply"], answers, environment)
  expect(unpinned.json()).toMatchObject({ error: { code: "configuration_error", reason: "sftp.host-key-missing" } })
  expect(unpinned.err).toContain(KEY)
  expect(server.opened).toEqual([])
  expect(profileSaved()).toBe(false)

  const applied = await setupCli(["apply"], { ...answers, sftp_host_key: KEY }, environment)
  expect(applied.code, applied.err).toBe(0)
  expect(applied.json().item).toMatchObject({ outcome: "ok", secrets: ["token"], cdr: "csv" })
  expect((await saved(keyring)).cdr_csv_path).toBe("/var/log/asterisk/cdr-csv/Master.csv")
  const synced = await runCli(["office", "meetings", "sync", ...SINCE, "--json"], environment)
  expect(synced.code, synced.err).toBe(0)
})

it("a database behind the PBX's SSH keeps both passwords, and asks for the SSH one when it is missing", async () => {
  const table = fakeTable()
  const tunnel = fakeTunnel()
  const keyring = memoryKeyring()
  const environment = {
    keyring,
    sql: table.open,
    sshTunnel: tunnel.open,
    sftpHostKey: async () => ({ algorithm: "ssh-ed25519", fingerprint: SSH_KEY }),
  }
  const answers = {
    ...MYSQL,
    db_host: "127.0.0.1",
    db_ssh_host: "pbx.example.test",
    db_ssh_user: "wirecat",
    db_ssh_host_key: SSH_KEY,
  }
  const missing = await setupCli(["apply"], answers, environment)
  expect(missing.json()).toMatchObject({ error: { code: "validation_error", param: "ssh" } })
  expect(tunnel.opened).toEqual([])

  const applied = await setupCli(["apply"], { ...answers, ssh: SSH_PASSWORD }, environment)
  expect(applied.code, applied.err).toBe(0)
  expect(applied.json().item).toMatchObject({ outcome: "ok", secrets: ["token", "ssh"] })
  expect(tunnel.forwarded).toEqual(["127.0.0.1:3306"])
  const synced = await runCli(["office", "meetings", "sync", ...SINCE, "--json"], environment)
  expect(synced.code, synced.err).toBe(0)
})

it("pbx office setup asks the same questions in a terminal, and goes back to the database after a wrong password", async () => {
  const table = fakeTable()
  const keyring = memoryKeyring()
  const passwords = ["nope", PASSWORD]
  const asked: string[] = []
  const answer = (question: string): string => {
    asked.push(question)
    if (question.startsWith("Your choice")) return "2"
    if (question.startsWith("Where are Master.csv")) return "1"
    if (question.startsWith("Database server")) return "pbx.example.test"
    if (question.startsWith("User")) return "wirecat_reader"
    if (question.startsWith("Password of the database user")) return passwords.shift() as string
    if (question.startsWith("Countries")) return "ru, es"
    return ""
  }
  const ran = await runCli(["office", "setup", "--json"], {
    keyring,
    sql: table.open,
    answer,
    env: { LANG: "en_US.UTF-8", LC_ALL: "", LANGUAGE: "" },
  })
  expect(ran.code, ran.err).toBe(0)
  expect(ran.json().item).toMatchObject({ finished: "done", path: expect.arrayContaining(["database", "check"]) })
  expect(asked.filter((question) => question.startsWith("Password of the database user"))).toHaveLength(2)
  expect(ran.err).toContain("refused the user or password")
  expect(await saved(keyring)).toMatchObject({ db_host: "pbx.example.test", phone_region: ["RU", "ES"] })
})

it("setup run apply, as Desktop runs it: the answers on stdin's first line, progress on stderr, the result on stdout", async () => {
  const keyring = memoryKeyring()
  const ran = await runCli(["office", "setup", "run", "apply", "--json", "--answer-stdin"], {
    keyring,
    sql: fakeTable().open,
    stdin: `${JSON.stringify(MYSQL)}\n`,
  })
  expect(ran.code, ran.err).toBe(0)
  expect(ran.json().item).toMatchObject({ outcome: "ok", cdr: "mysql", secrets: ["token"] })
  expect(ran.err).toContain('"progress"')
  expect(ran.err + ran.out).not.toContain(PASSWORD)
})
