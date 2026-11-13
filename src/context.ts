import { CliError, type KeyringStore } from "@wirecat/cli-base"
import {
  type BaseEnvironment,
  baseContext,
  environmentOf,
  type GlobalFlags,
  ProfileTokenStore,
} from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { type CdrReader, cdrReader } from "./cdr/reader.js"
import type { SqlCdr, SqlSource } from "./cdr/sql.js"
import { configuration } from "./config.js"
import { type FileAccess, localFiles } from "./files.js"
import { IDENTITY } from "./identity.js"
import { hostKeyRefusal, type OpenSftp, sftpFiles } from "./sftp-files.js"
import { type SecretKind, type SftpPlace, type SourceConfig, secretKindOf, sourceOf } from "./source.js"

/** What a test hands `run()` beside cli-core's own: files and a CDR table in place of the real ones (WC-ARCH-10). */
export interface AsteriskEnvironment extends BaseEnvironment {
  files?: FileAccess
  sql?: (source: SqlSource, password: string) => Promise<SqlCdr>
  sftp?: OpenSftp
  sftpHostKey?: (target: { host: string; port?: number }) => Promise<{ algorithm: string; fingerprint: string }>
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

const unpinned = async (place: SftpPlace, environment: AsteriskEnvironment, profile: string): Promise<never> => {
  const hostKey = environment.sftpHostKey ?? (await import("@wirecat/cli-core/sftp")).sftpHostKey
  throw hostKeyRefusal(profile, await hostKey({ host: place.host, ...(place.port ? { port: place.port } : {}) }))
}

/** An SFTP server whose key the owner has not pinned is refused before any credential is asked or sent. */
export const refuseUnpinnedHost = async (source: SourceConfig, environment: AsteriskEnvironment, profile: string) => {
  if (!environment.files && source.files.kind === "sftp" && !source.files.hostKey)
    await unpinned(source.files, environment, profile)
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
  const hostKey = place.hostKey ?? (await unpinned(place, environment, options.profile))
  // One password per profile: a database profile's is the database's, so its SFTP side signs in with a key.
  if (source.cdr.kind !== "csv" && !place.keyPath)
    throw new CliError(
      "configuration_error",
      "a database profile reads files over SFTP with a key; set sftp_key_path",
      {
        reason: "source.not-configured",
      },
    )
  return sftpFiles({ ...place, hostKey }, secretKindOf(source) === "sftp" ? options.password : undefined, {
    signal: environment.signal,
    ...(environment.sftp ? { open: environment.sftp } : {}),
  })
}

/** The recordings alone, for `meetings transcribe`: no CDR, so no database password. */
export const openFiles = (command: Command): Promise<FileAccess> => {
  const { settings, environment, secrets, profile } = contextOf(command)
  const source = sourceOf(settings)
  const password = secretKindOf(source) === "sftp" ? secrets.need(profile) : undefined
  return filesFor(source, environment, { profile, offline: settings.offline, password })
}

/**
 * The profile's Asterisk, opened for one command: its files and its CDR. A database is reached only here, with the
 * password `session start` kept, or `password` while it is being checked.
 */
export const openSource = async (command: Command, password?: string): Promise<OpenedSource> => {
  const { settings, environment, secrets, profile } = contextOf(command)
  const source = sourceOf(settings)
  const kind: SecretKind = secretKindOf(source)
  const secret = password ?? (kind ? secrets.need(profile) : undefined)
  if (source.cdr.kind !== "csv") refuseOffline(settings.offline)
  const files = await filesFor(source, environment, { profile, offline: settings.offline, password: secret })
  const reader = await cdrReader(source, files, {
    password: kind === "db" ? secret : undefined,
    ...(environment.signal ? { signal: environment.signal } : {}),
    ...(environment.sql ? { sql: environment.sql } : {}),
  }).catch(async (error: unknown) => {
    await files.close()
    throw error
  })
  return {
    source,
    files,
    reader,
    close: async () => {
      await reader.close()
      await files.close()
    },
  }
}

/**
 * Whether a profile can read its calls: its source is set up, and the password that source needs is saved. A profile
 * on a local Master.csv needs none. For `session list` and the MCP server, which name a profile but run no command.
 */
export const readyToRead = (profile: string, env: NodeJS.ProcessEnv, keyring?: KeyringStore): boolean => {
  try {
    // biome-ignore lint/plugin/no-own-settings: no command runs here to give baseContext; this reads another profile
    const settings = configuration.resolveSettings({ profile }, { env, readOnly: true })
    const kind = secretKindOf(sourceOf(settings))
    return (
      kind === null || new ProfileTokenStore({ app: IDENTITY, env, ...(keyring ? { keyring } : {}) }).signedIn(profile)
    )
  } catch {
    return false
  }
}
