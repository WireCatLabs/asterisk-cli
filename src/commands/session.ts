import { StringDecoder } from "node:string_decoder"
import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { readSecret } from "@wirecat/cli-core"
import {
  commandWords,
  environmentOf,
  FETCH,
  inputPolicy,
  itemOf,
  LOCAL_READ,
  LOCAL_WRITE,
  listOf,
  logsInOrOut,
  MAX_SECRET_INPUT,
  outputFor,
  ProfileTokenStore,
  profileFree,
  profilesHere,
  REMOTE_READ,
  refuseCommandName,
  refuseUnderReadOnly,
  rememberAccount,
  renderAnswer,
  rootOf,
  secretInputOf,
  type TokenStorage,
} from "@wirecat/cli-core/cli"
import { Command } from "commander"
import { configuration } from "../config.js"
import { contextOf, openSource, type Passwords, readyToRead, refuseOffline, refuseUnpinnedHost } from "../context.js"
import { IDENTITY } from "../identity.js"
import { type SecretKind, secretKindsOf, slotOf, sourceOf } from "../source.js"

const CLI = IDENTITY.command

const ASKED: Record<SecretKind, string> = {
  db: "password of the CDR database user: ",
  ssh: "password of the SSH user: ",
  sftp: "password of the SFTP user: ",
}

const PIPE_WAIT_MS = 30_000

/**
 * The first `count` lines of a pipe. It stops once they are in, since a caller such as WireCat Desktop may keep the
 * pipe open after the last one, and gives up after 30 seconds with whatever arrived.
 */
const pipedLines = (input: NodeJS.ReadableStream, count: number): Promise<string[]> => {
  const { maxBytes, signal } = inputPolicy(input)
  const limit = Math.min(maxBytes ?? MAX_SECRET_INPUT, MAX_SECRET_INPUT)
  const decoder = new StringDecoder("utf8")
  return new Promise((resolve, reject) => {
    let text = ""
    let bytes = 0
    const settle = (failure?: CliError) => {
      clearTimeout(timer)
      input.off("data", data).off("end", end).off("error", error)
      signal?.removeEventListener("abort", aborted)
      input.pause()
      // A paused pipe still keeps Node running until the writer closes it.
      ;(input as { unref?: () => void }).unref?.()
      if (failure) reject(failure)
      else resolve(text.trim().split(/\r?\n/))
    }
    const data = (chunk: Buffer | string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > limit)
        return settle(
          new CliError("validation_error", "secret input exceeds its byte limit", { reason: "input.too-large" }),
        )
      text += typeof chunk === "string" ? chunk : decoder.write(chunk)
      if ((text.trimStart().match(/\n/g)?.length ?? 0) >= count) settle()
    }
    const end = () => {
      text += decoder.end()
      settle()
    }
    const error = () =>
      settle(new CliError("validation_error", "the password input failed", { reason: "input.closed" }))
    const aborted = () => settle(new CliError("cancelled", "cancelled — nothing was stored"))
    const timer = setTimeout(() => settle(), PIPE_WAIT_MS)
    if (signal?.aborted) return aborted()
    input.on("data", data).once("end", end).once("error", error)
    signal?.addEventListener("abort", aborted, { once: true })
    input.resume()
  })
}

/** Each password the source needs: asked one by one at a terminal; from a pipe, one per line in the order asked. */
const askPasswords = async (command: Command, kinds: readonly SecretKind[]): Promise<Passwords> => {
  if (kinds.length === 0) return {}
  const input = secretInputOf(command)
  const stdin = input.input ?? process.stdin
  let answers: string[] = []
  if (stdin.isTTY) for (const kind of kinds) answers.push(await readSecret(ASKED[kind], input))
  else answers = await pipedLines(stdin, kinds.length)
  if (kinds.some((_, index) => !answers[index]))
    throw new CliError(
      "validation_error",
      kinds.length > 1
        ? `this profile needs ${kinds.length} passwords, one per line in this order: ${kinds.join(", ")}`
        : "no password was given",
    )
  return Object.fromEntries(kinds.map((kind, index) => [kind, answers[index]]))
}

/** Reads the newest hour of call records: proof that the settings and the passwords reach the CDR, changing nothing. */
const check = async (command: Command, passwords?: Passwords) => {
  const { run } = contextOf(command)
  return run(async () => {
    const opened = await openSource(command, passwords)
    try {
      const { rows } = await opened.reader.rows(Date.now() - 60 * 60 * 1000)
      return { cdr: opened.source.cdr.kind, calls_last_hour: rows.length }
    } finally {
      await opened.close()
    }
  })
}

const answer = (command: Command, item: unknown) => renderAnswer(command, outputFor(command), itemOf(item))

const storageOf = (raw: string): TokenStorage => {
  if (raw === "keyring" || raw === "file") return raw
  throw new CliError("validation_error", `--credential-storage takes keyring or file; got ${raw}`)
}

const startCommand = () =>
  logsInOrOut(
    annotate(new Command("start"), {
      effects: FETCH,
      lifetime: "interactive",
      mcp: false,
      examples: [`${CLI} office session start`, `${CLI} office session start --credential-storage file`],
    }),
  )
    .summary("check the profile's Asterisk source and keep its password")
    .description(
      "check that this profile reaches its call records, set with config set: each password it needs (the " +
        "database's, the SSH tunnel's, the SFTP server's, when no key file is set) is asked hidden, or read from " +
        "stdin one per line, never taken as an argument, checked, and only then kept in the keyring, or in a " +
        "private file; Master.csv on this computer needs none",
    )
    .option(
      "--credential-storage <storage>",
      "where the password is kept: keyring, which falls back to a private file by itself, or file",
      storageOf,
      "keyring" as TokenStorage,
    )
    .action(async function (this: Command, args: { credentialStorage: TokenStorage }) {
      const { env, profile, secrets, settings } = contextOf(this)
      refuseCommandName(profile, commandWords(rootOf(this)), CLI)
      const source = sourceOf(settings)
      if (source.files.kind === "sftp") refuseOffline(settings.offline)
      await refuseUnpinnedHost(source, contextOf(this).environment, profile)
      const kinds = secretKindsOf(source)
      // A secret is never an argument: it would land in shell history and in the run record (WC-SECR-5).
      const passwords = await askPasswords(this, kinds)
      const checked = await check(this, passwords)
      let storedIn: string | null = null
      for (const kind of kinds) {
        const slot = slotOf(source, kind)
        const secret = passwords[kind] as string
        storedIn =
          slot === "token"
            ? secrets.write(profile, secret, args.credentialStorage)
            : secrets.writeSecret(profile, slot, secret, args.credentialStorage)
      }
      rememberAccount(IDENTITY, profile, profile, env)
      answer(this, {
        profile,
        state: "saved",
        password: kinds[0] ?? "none",
        passwords: kinds,
        stored_in: storedIn,
        verified: true,
        ...checked,
      })
    })

const statusCommand = () =>
  annotate(new Command("status"), {
    effects: REMOTE_READ,
    examples: [`${CLI} office session status`, `${CLI} office session status --check --json`],
  })
    .summary("show where this profile's password comes from; never the password")
    .description(
      `show which password this profile's source needs and where it comes from: ${IDENTITY.envPrefix}_TOKEN, the ` +
        "keyring or a file, never the password; --check reads the newest call records to prove it works",
    )
    .option("--check", "read the newest call records to prove the settings and the password work")
    .action(async function (this: Command, args: { check?: boolean }) {
      const { env, profile, secrets, settings, environment } = contextOf(this)
      const source = sourceOf(settings)
      const kinds = secretKindsOf(source)
      const saved = kinds[0] ? secrets.read(profile) : undefined
      const status = {
        profile,
        password: kinds[0] ?? "none",
        passwords: kinds,
        state: readyToRead(profile, env, environment.keyring) ? "saved" : "missing",
        password_from: saved?.source ?? null,
      }
      if (!args.check || status.state === "missing") return answer(this, { ...status, verified: false })
      answer(this, { ...status, verified: true, ...(await check(this)) })
    })

const endCommand = () =>
  logsInOrOut(
    annotate(new Command("end"), {
      effects: LOCAL_WRITE,
      mcp: false,
      examples: [`${CLI} personal session end`],
    }),
  )
    .summary("forget this profile's password on this computer; imported calls stay")
    .description(
      "forget this profile's password on this computer; the imported calls stay, and the server is not touched",
    )
    .action(function (this: Command) {
      refuseUnderReadOnly(this, "session end")
      const { profile, secrets } = contextOf(this)
      answer(this, { profile, ended: secrets.remove(profile), calls: "retained" })
    })

const listCommand = () =>
  profileFree(
    annotate(new Command("list"), {
      effects: LOCAL_READ,
      examples: [`${CLI} session list`, `${CLI} session list --json`],
    }),
  )
    .summary("list the profiles here and whether each is signed in")
    .description("list the profiles on this computer and whether each has a password; picks none")
    .action(function (this: Command) {
      const environment = environmentOf(this)
      const env = environment.env ?? process.env
      // biome-ignore lint/plugin/no-own-settings: baseContext needs a profile, and this local read names none
      const { configuredProfiles } = configuration.resolveSettings({}, { env, needsProfile: false })
      const tokens = new ProfileTokenStore({
        app: IDENTITY,
        env,
        ...(environment.keyring ? { keyring: environment.keyring } : {}),
        warn: outputFor(this).renderer.warn,
      })
      const items = profilesHere(IDENTITY, configuredProfiles, env).map((profile) => ({
        profile,
        signed_in: readyToRead(profile, env, environment.keyring),
        password_from: tokens.read(profile)?.source ?? null,
      }))
      renderAnswer(
        this,
        outputFor(this),
        listOf("session list", { items, limit: Math.max(1, items.length), has_more: false }),
      )
    })

export const sessionCommand = (): Command =>
  annotate(new Command("session"), { effects: LOCAL_READ })
    .description("check this profile's Asterisk source and keep its password in the OS keyring")
    .addCommand(startCommand())
    .addCommand(statusCommand())
    .addCommand(endCommand())
    .addCommand(listCommand())
