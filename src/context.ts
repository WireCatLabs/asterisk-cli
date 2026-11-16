import { CliError, type KeyringStore } from "@wirecat/cli-base"
import {
  type BaseEnvironment,
  baseContext,
  environmentOf,
  type GlobalFlags,
  ProfileTokenStore,
  type Settings,
} from "@wirecat/cli-core/cli"
import type { MeetingMeaningApi } from "@wirecat/cli-core/services"
import type { SshTunnel, SshTunnelOptions } from "@wirecat/cli-core/sftp"
import type { Command } from "commander"
import { type CdrReader, cdrReader } from "./cdr/reader.js"
import type { SqlCdr, SqlCdrOptions, SqlSource } from "./cdr/sql.js"
import { configuration } from "./config.js"
import { type FileAccess, localFiles } from "./files.js"
import { IDENTITY } from "./identity.js"
import { authOf, hostKeyRefusal, type OpenSftp, sftpFiles } from "./sftp-files.js"
import { type SecretKind, type SftpPlace, type SourceConfig, secretKindsOf, slotOf, sourceOf } from "./source.js"

/** What a test hands `run()` beside cli-core's own: files and a CDR table in place of the real ones (WC-ARCH-10). */
export interface AsteriskEnvironment extends BaseEnvironment {
  files?: FileAccess
  sql?: (source: SqlSource, password: string, options: SqlCdrOptions) => Promise<SqlCdr>
  sftp?: OpenSftp
  sftpHostKey?: (target: { host: string; port?: number }) => Promise<{ algorithm: string; fingerprint: string }>
  sshTunnel?: (options: SshTunnelOptions) => Promise<SshTunnel>
  /** The text model's code for `search meetings` and `meetings embed`, so a test never downloads one. */
  meaning?: () => Promise<MeetingMeaningApi>
}

/**
 * Settings, keyring and the run come from cli-core's `baseContext` and nowhere else: a command that resolves settings
 * on its own skips `--timeout`, the run record and the profile's permissions (WC-LIFE-5, WC-LIFE-15).
 */
export const contextOf = (command: Command) => {
  const base = baseContext(command, configuration.resolveSettings)
  return {
    ...base,
    environment: environmentOf<AsteriskEnvironment>(command),
    flags: command.optsWithGlobals<GlobalFlags>(),
    profile: base.settings.profile,
    secrets: new ProfileTokenStore({
      app: IDENTITY,
      env: base.env,
      ...(base.keyring ? { keyring: base.keyring } : {}),
      warn: base.renderer.warn,
    }),
  }
}

export const refuseOffline = (offline: boolean | undefined) => {
  if (offline)
    throw new CliError("permission_error", "this reads the Asterisk server; leave out --offline", {
      reason: "offline.refused",
    })
}

export interface OpenedSource {
  source: SourceConfig
  files: FileAccess
  reader: CdrReader
  close(): Promise<void>
}

/** The passwords of one profile's source, by what they open. */
export type Passwords = Partial<Record<SecretKind, string>>

const ASKED_FOR: Record<SecretKind, string> = { db: "database", sftp: "SFTP", ssh: "SSH" }

/** Each password the source needs, from where `session start` kept it; a missing one is the sign-in refusal. */
const storedPasswords = (source: SourceConfig, secrets: ProfileTokenStore, profile: string): Passwords =>
  Object.fromEntries(
    secretKindsOf(source).map((kind) => {
      const slot = slotOf(source, kind)
      if (slot === "token") return [kind, secrets.need(profile)]
      const kept = secrets.readSecret(profile, slot)?.secret
      if (!kept)
        throw new CliError(
          "authentication_error",
          `this profile has no ${ASKED_FOR[kind]} password yet; run ${IDENTITY.command} ${profile} setup`,
          { reason: "profile.not-signed-in" },
        )
      return [kind, kept]
    }),
  )

interface Pinned {
  place: SftpPlace
  setting: "sftp_host_key" | "db_ssh_host_key"
  what: string
}

const pinnedPlaces = (source: SourceConfig): Pinned[] => [
  ...(source.files.kind === "sftp"
    ? [{ place: source.files, setting: "sftp_host_key" as const, what: "SFTP server" }]
    : []),
  ...(source.tunnel ? [{ place: source.tunnel, setting: "db_ssh_host_key" as const, what: "SSH server" }] : []),
]

const unpinned = async (pinned: Pinned, environment: AsteriskEnvironment, profile: string): Promise<never> => {
  const hostKey = environment.sftpHostKey ?? (await import("@wirecat/cli-core/sftp")).sftpHostKey
  const { host, port } = pinned.place
  throw hostKeyRefusal(profile, await hostKey({ host, ...(port ? { port } : {}) }), pinned)
}

/** A server whose key the owner has not pinned is refused before any credential is asked or sent. */
export const refuseUnpinnedHost = async (source: SourceConfig, environment: AsteriskEnvironment, profile: string) => {
  for (const pinned of pinnedPlaces(source)) {
    if (pinned.setting === "sftp_host_key" && environment.files) continue
    if (!pinned.place.hostKey) await unpinned(pinned, environment, profile)
  }
}

interface FileOptions {
  profile: string
  offline: boolean | undefined
  password: string | undefined
}

const filesFor = async (source: SourceConfig, environment: AsteriskEnvironment, options: FileOptions) => {
  if (environment.files) return environment.files
  if (source.files.kind === "local") return localFiles()
  refuseOffline(options.offline)
  const { kind: _, ...place } = source.files
  const hostKey =
    place.hostKey ??
    (await unpinned({ place, setting: "sftp_host_key", what: "SFTP server" }, environment, options.profile))
  return sftpFiles({ ...place, hostKey }, options.password, {
    signal: environment.signal,
    ...(environment.sftp ? { open: environment.sftp } : {}),
  })
}

/** The recordings alone, for `meetings transcribe`: no CDR, so only the SFTP password, when there is one. */
export const openFiles = (command: Command): Promise<FileAccess> => {
  const { settings, environment, secrets, profile } = contextOf(command)
  const source = sourceOf(settings)
  const needsPassword = source.files.kind === "sftp" && !source.files.keyPath && !environment.files
  const password = needsPassword
    ? slotOf(source, "sftp") === "token"
      ? secrets.need(profile)
      : storedPasswords(source, secrets, profile).sftp
    : undefined
  return filesFor(source, environment, { profile, offline: settings.offline, password })
}

const DEFAULT_PORTS = { mysql: 3306, postgres: 5432 } as const

/** The SSH connection a database behind the server is reached through, open for this run only. */
const tunnelFor = async (
  source: SourceConfig,
  environment: AsteriskEnvironment,
  { profile, password }: { profile: string; password: string | undefined },
): Promise<SshTunnel | undefined> => {
  const { tunnel } = source
  if (!tunnel) return undefined
  const hostKey =
    tunnel.hostKey ??
    (await unpinned({ place: tunnel, setting: "db_ssh_host_key", what: "SSH server" }, environment, profile))
  const open = environment.sshTunnel ?? (await import("@wirecat/cli-core/sftp")).openSshTunnel
  return open({
    host: tunnel.host,
    ...(tunnel.port ? { port: tunnel.port } : {}),
    username: tunnel.user,
    auth: await authOf(tunnel, password, "db_ssh_key_path"),
    hostKey,
    ...(environment.signal ? { signal: environment.signal } : {}),
  })
}

/**
 * The profile's Asterisk, opened for one command: its files and its CDR. A database, and the SSH server in front of
 * it, are reached only here: with the passwords `session start` kept, or, while a check runs, with the `given`
 * passwords and the `checking` settings, which are not saved yet.
 */
export const openSource = async (command: Command, given?: Passwords, checking?: Settings): Promise<OpenedSource> => {
  const { environment, secrets, profile, ...context } = contextOf(command)
  const settings = checking ?? context.settings
  const source = sourceOf(settings)
  const passwords = given ?? storedPasswords(source, secrets, profile)
  if (source.cdr.kind !== "csv") refuseOffline(settings.offline)
  const files = await filesFor(source, environment, { profile, offline: settings.offline, password: passwords.sftp })
  const opened: { close(): Promise<void> }[] = [files]
  const closeAll = async () => {
    for (const one of opened.reverse()) await one.close().catch(() => undefined)
  }
  try {
    const tunnel = await tunnelFor(source, environment, { profile, password: passwords.ssh })
    if (tunnel) opened.push(tunnel)
    const cdr = source.cdr
    const reader = await cdrReader(source, files, {
      password: passwords.db,
      ...(environment.signal ? { signal: environment.signal } : {}),
      ...(environment.sql ? { sql: environment.sql } : {}),
      ...(tunnel && cdr.kind !== "csv"
        ? { socket: () => tunnel.connect(cdr.host, cdr.port ?? DEFAULT_PORTS[cdr.kind]) }
        : {}),
    })
    opened.push(reader)
    return { source, files, reader, close: closeAll }
  } catch (error) {
    await closeAll()
    throw error
  }
}

/**
 * Whether a profile can read its calls: its source is set up, and every password that source needs is saved. A
 * profile on a local Master.csv needs none. For `session list` and the MCP server, which name a profile but run no
 * command.
 */
export const readyToRead = (profile: string, env: NodeJS.ProcessEnv, keyring?: KeyringStore): boolean => {
  try {
    // biome-ignore lint/plugin/no-own-settings: no command runs here to give baseContext; this reads another profile
    const settings = configuration.resolveSettings({ profile }, { env, readOnly: true })
    const source = sourceOf(settings)
    const secrets = new ProfileTokenStore({ app: IDENTITY, env, ...(keyring ? { keyring } : {}) })
    return secretKindsOf(source).every((kind) => {
      const slot = slotOf(source, kind)
      return slot === "token" ? secrets.signedIn(profile) : !!secrets.readSecret(profile, slot)?.secret
    })
  } catch {
    return false
  }
}

/**
 * Reads the newest hour of call records: proof that the settings and the passwords reach the CDR, changing nothing.
 * `session start` and the setup flow both check with it, so the two can never disagree about a working profile.
 */
export const checkSource = async (command: Command, settings: Settings, passwords?: Passwords) => {
  const { run, environment, profile } = contextOf(command)
  const source = sourceOf(settings)
  if (source.files.kind === "sftp") refuseOffline(settings.offline)
  await refuseUnpinnedHost(source, environment, profile)
  return run(async () => {
    const opened = await openSource(command, passwords, settings)
    try {
      const { rows } = await opened.reader.rows(Date.now() - 60 * 60 * 1000)
      return { cdr: opened.source.cdr.kind, calls_last_hour: rows.length }
    } finally {
      await opened.close()
    }
  })
}
