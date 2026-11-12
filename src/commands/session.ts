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
import { contextOf, refuseOffline, serviceFor, withService } from "../context.js"
import { IDENTITY } from "../identity.js"
import { SERVICE } from "../sample/transport.js"

// `session start | status | end | list` is every provider CLI's sign-in (WC-ACCT-12). Keep it; replace the token
// prompt and the `me` check with your service's. A service with OAuth signs in through cli-core's oauth module
// instead (WC-SECR-22); see gcal-cli's src/commands/session.ts.

const CLI = IDENTITY.command

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
      examples: [`${CLI} personal session start`, `${CLI} personal session start --credential-storage file`],
    }),
  )
    .summary(`sign in to ${SERVICE} with an API token`)
    .description(
      `sign this profile in: the ${SERVICE} API token is asked hidden or read from stdin, never taken as an ` +
        "argument, checked against the service, and only then kept in the keyring, or in a private file",
    )
    .option(
      "--credential-storage <storage>",
      "where the token is kept: keyring, which falls back to a private file by itself, or file",
      storageOf,
      "keyring" as TokenStorage,
    )
    .action(async function (this: Command, args: { credentialStorage: TokenStorage }) {
      const { env, flags, profile, tokens, run } = contextOf(this)
      refuseCommandName(profile, commandWords(rootOf(this)), CLI)
      refuseOffline(flags)
      // A secret is never an argument: it would land in shell history and in the run record (WC-SECR-5).
      const token = (await readSecret(`${SERVICE} API token: `, secretInputOf(this))).trim()
      if (!token) throw new CliError("validation_error", "no token was given")
      const user = await run((events) => serviceFor(this, token, events).me())
      const storedIn = tokens.write(profile, token, args.credentialStorage)
      rememberAccount(IDENTITY, profile, user.id, env)
      answer(this, { profile, state: "saved", stored_in: storedIn, verified: true, user })
    })

const statusCommand = () =>
  annotate(new Command("status"), {
    effects: REMOTE_READ,
    examples: [`${CLI} personal session status`, `${CLI} personal session status --check --json`],
  })
    .summary("show where this profile's token comes from; never the token")
    .description(
      `show where this profile's token comes from: ${IDENTITY.envPrefix}_TOKEN, the keyring or a file, never the token; ` +
        `--check asks ${SERVICE} whose token it is`,
    )
    .option("--check", `ask ${SERVICE} whether the token still works, and whose it is`)
    .action(async function (this: Command, args: { check?: boolean }) {
      const { profile, tokens } = contextOf(this)
      const saved = tokens.read(profile)
      const status = { profile, state: saved ? "saved" : "missing", token_from: saved?.source ?? null }
      if (!args.check || !saved) return answer(this, { ...status, verified: false })
      answer(this, { ...status, verified: true, user: await withService(this, (service) => service.me()) })
    })

const endCommand = () =>
  logsInOrOut(
    annotate(new Command("end"), {
      effects: LOCAL_WRITE,
      mcp: false,
      examples: [`${CLI} personal session end`],
    }),
  )
    .summary("forget this profile's token on this computer")
    .description(`forget this profile's token on this computer; the token itself stays valid in ${SERVICE}`)
    .action(function (this: Command) {
      refuseUnderReadOnly(this, "session end")
      const { profile, tokens } = contextOf(this)
      answer(this, { profile, ended: tokens.remove(profile) })
    })

const listCommand = () =>
  profileFree(
    annotate(new Command("list"), {
      effects: LOCAL_READ,
      examples: [`${CLI} session list`, `${CLI} session list --json`],
    }),
  )
    .summary("list the profiles here and whether each is signed in")
    .description("list the profiles on this computer and whether each has a token; picks none")
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
      const items = profilesHere(IDENTITY, configuredProfiles, env).map((profile) => {
        const saved = tokens.read(profile)
        return { profile, signed_in: saved !== undefined, token_from: saved?.source ?? null }
      })
      renderAnswer(
        this,
        outputFor(this),
        listOf("session list", { items, limit: Math.max(1, items.length), has_more: false }),
      )
    })

export const sessionCommand = (): Command =>
  annotate(new Command("session"), { effects: LOCAL_READ })
    .description(`keep this profile's ${SERVICE} token in the OS keyring`)
    .addCommand(startCommand())
    .addCommand(statusCommand())
    .addCommand(endCommand())
    .addCommand(listCommand())
