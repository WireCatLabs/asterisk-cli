import { CliError } from "@wirecat/cli-base"
import {
  type BaseEnvironment,
  baseContext,
  type EventSink,
  environmentOf,
  type GlobalFlags,
  ProfileTokenStore,
} from "@wirecat/cli-core/cli"
import { Pacer, pacePathFor } from "@wirecat/cli-core/sends"
import type { Command } from "commander"
import { configuration } from "./config.js"
import { IDENTITY } from "./identity.js"
import { type CommentsService, commentsService } from "./sample/comments.js"
import { SERVICE, transport } from "./sample/transport.js"

/** What a test hands `run()` beside cli-core's own: the fake service in place of the network (WC-ARCH-10). */
export interface ServiceEnvironment extends BaseEnvironment {
  fetch?: typeof fetch
}

// SAMPLE: your service's documented limit; this one is made up.
const PACE = { perMinute: 120, burst: 20 }

/**
 * Settings, keyring and the run come from cli-core's `baseContext` and nowhere else: a command that resolves settings
 * on its own skips `--timeout`, the run record and the profile's permissions (WC-LIFE-5, WC-LIFE-15).
 */
export const contextOf = (command: Command) => {
  const base = baseContext(command, configuration.resolveSettings)
  return {
    ...base,
    environment: environmentOf<ServiceEnvironment>(command),
    flags: command.optsWithGlobals<GlobalFlags>(),
    profile: base.settings.profile,
    tokens: new ProfileTokenStore({
      app: IDENTITY,
      env: base.env,
      ...(base.keyring ? { keyring: base.keyring } : {}),
      warn: base.renderer.warn,
    }),
  }
}

export const refuseOffline = (flags: GlobalFlags) => {
  if (flags.offline)
    throw new CliError("permission_error", `this needs ${SERVICE}; leave out --offline`, { reason: "offline.refused" })
}

/** The service for one run, with the token it was given; `events` comes from `run()`, so each request is recorded. */
export const serviceFor = (command: Command, token: string, events: EventSink) => {
  const { environment, env, profile } = contextOf(command)
  return commentsService(
    transport({
      token,
      events,
      signal: environment.signal,
      ...(environment.fetch ? { fetch: environment.fetch } : {}),
      pacer: new Pacer(pacePathFor(IDENTITY, profile, env), PACE),
    }),
  )
}

/** The profile's saved token, or an authentication error that says how to sign in. Read before any request. */
export const tokenOf = (command: Command): string => {
  const { flags, profile, tokens } = contextOf(command)
  refuseOffline(flags)
  return tokens.need(profile)
}

/**
 * Every remote call goes through here: inside cli-core's run, so `--timeout` bounds it, a failure or `--record` keeps
 * a run named after the command, and the transport's requests land in that run (WC-LIFE-5, WC-LIFE-15).
 */
export const withService = <T>(command: Command, body: (service: CommentsService) => Promise<T>): Promise<T> => {
  const token = tokenOf(command)
  return contextOf(command).run((events) => body(serviceFor(command, token, events)))
}
