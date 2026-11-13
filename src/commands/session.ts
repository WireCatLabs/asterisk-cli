import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { readSecret } from "@wirecat/cli-core"
import {
  commandWords,
  environmentOf,
  FETCH,
  itemOf,
  LOCAL_READ,
  LOCAL_WRITE,
  listOf,
  logsInOrOut,
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
import { contextOf, openSource, readyToRead, refuseOffline, refuseUnpinnedHost } from "../context.js"
import { IDENTITY } from "../identity.js"
import { type SecretKind, secretKindOf, sourceOf } from "../source.js"

const CLI = IDENTITY.command

const ASKED: Record<Exclude<SecretKind, null>, string> = {
  db: "password of the CDR database user: ",
  sftp: "password of the SFTP user: ",
}

/** Reads the newest hour of call records: proof that the settings and the password reach the CDR, changing nothing. */
const check = async (command: Command, password?: string) => {
  const { run } = contextOf(command)
  return run(async () => {
    const opened = await openSource(command, password)
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
      "check that this profile reaches its call records, set with config set: a database password, or an SFTP " +
        "password when no key file is set, is asked hidden or read from stdin, never taken as an argument, checked, " +
        "and only then kept in the keyring, or in a private file; Master.csv on this computer needs none",
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
      const kind = secretKindOf(source)
      // A secret is never an argument: it would land in shell history and in the run record (WC-SECR-5).
      const password = kind ? await readSecret(ASKED[kind], secretInputOf(this)) : undefined
      if (kind && !password) throw new CliError("validation_error", "no password was given")
      const checked = await check(this, password)
      const storedIn = kind && password ? secrets.write(profile, password, args.credentialStorage) : null
      rememberAccount(IDENTITY, profile, profile, env)
      answer(this, {
        profile,
        state: "saved",
        password: kind ?? "none",
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
      const { profile, secrets, settings } = contextOf(this)
      const kind = secretKindOf(sourceOf(settings))
      const saved = kind ? secrets.read(profile) : undefined
      const status = {
        profile,
        password: kind ?? "none",
        state: !kind || saved ? "saved" : "missing",
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
