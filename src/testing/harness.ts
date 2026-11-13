import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { type KeyringStore, memoryKeyring } from "@wirecat/cli-base"
import type { RunOptions } from "@wirecat/cli-core/cli"
import type { SpeechEnvironment } from "../commands/transcribe.js"
import type { AsteriskEnvironment } from "../context.js"
import { run } from "../program.js"

export interface Ran {
  code: number
  out: string
  err: string
  /** stdout parsed, or the error object from stderr. */
  json: () => Record<string, unknown>
}

/** The CLI through its own `run()`, as a person or an agent types it, with a memory keyring (WC-TEST-2, WC-TEST-6). */
export const runCli = async (
  argv: string[],
  {
    keyring = memoryKeyring(),
    stdin,
    env,
    sql,
    sftp,
    sftpHostKey,
    speech,
    answer,
  }: {
    keyring?: KeyringStore
    stdin?: string
    env?: NodeJS.ProcessEnv
    sql?: AsteriskEnvironment["sql"]
    sftp?: AsteriskEnvironment["sftp"]
    sftpHostKey?: AsteriskEnvironment["sftpHostKey"]
    speech?: SpeechEnvironment["speech"]
    answer?: (question: string) => string | null
  } = {},
): Promise<Ran> => {
  const out: string[] = []
  const err: string[] = []
  const options: RunOptions & AsteriskEnvironment & SpeechEnvironment = {
    streams: { data: (text: string) => out.push(text), diagnostic: (text: string) => err.push(text) },
    tty: false,
    keyring,
    ...(sql ? { sql } : {}),
    ...(sftp ? { sftp } : {}),
    ...(sftpHostKey ? { sftpHostKey } : {}),
    ...(speech ? { speech } : {}),
    ...(env ? { env: { ...process.env, ...env } } : {}),
    ...(answer ? { answer } : {}),
    ...(stdin === undefined ? {} : { stdin: Object.assign(Readable.from([stdin]), { isTTY: false }) }),
  }
  const code = await run(argv, options)
  const text = { out: out.join(""), err: err.join("") }
  return { code, ...text, json: () => JSON.parse(text.out.trim() || text.err.trim()) as Record<string, unknown> }
}

/** A folder with an Asterisk's files: Master.csv and recordings, each written an hour ago so none is still being written. */
export const asteriskFolder = (files: Record<string, string | Uint8Array>): string => {
  const root = mkdtempSync(join(tmpdir(), "asterisk-"))
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
    utimesSync(full, hourAgo, hourAgo)
  }
  return root
}

/** A store and a config folder of the test's own, so no test sees another's calls or settings (WC-TEST-9). */
export const freshFolders = () => {
  const folder = mkdtempSync(join(tmpdir(), "asterisk-run-"))
  process.env.MESSAGING_STORE = join(folder, "store.db")
  process.env.ASTERISK_CONFIG_DIR = join(folder, "config")
}

/** Settings for profile `office`, written as `config set` would. */
export const configure = async (settings: Record<string, string>) => {
  for (const [key, value] of Object.entries(settings)) {
    const set = await runCli(["office", "config", "set", key, value, "--json"])
    if (set.code !== 0) throw new Error(`config set ${key}: ${set.err}`)
  }
}
