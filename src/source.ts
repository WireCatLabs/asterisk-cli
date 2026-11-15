import { CliError } from "@wirecat/cli-base"
import { fromFile, type Settings } from "@wirecat/cli-core/cli"
import type { SqlSource } from "./cdr/sql.js"
import { SOURCE_SETTINGS, type SourceSetting } from "./config.js"
import { IDENTITY } from "./identity.js"
import { DEFAULT_PATTERNS } from "./recordings.js"

export interface SftpPlace {
  host: string
  port: number | null
  user: string
  keyPath: string | null
  hostKey: string | null
}

/** Who speaks on the first and the second channel of a stereo recording. */
export type RecordingSide = "caller" | "employee"

/** One profile's Asterisk: where its call records and recordings are, and how to read their numbers and times. */
export interface SourceConfig {
  cdr: { kind: "csv"; path: string; columns: string[] | null } | SqlSource
  recordings: { root: string; patterns: string[] } | null
  /** Set by the owner: which side the dialplan records on which channel, so a transcript names who said what. */
  recordingSides: RecordingSide[] | null
  files: { kind: "local" } | ({ kind: "sftp" } & SftpPlace)
  /** A database source only: the SSH server that forwards to a database listening only on its own server. */
  tunnel: SftpPlace | null
  zone: string
  phoneRegions: string[]
  extension: RegExp
}

/** A password `session start` asks for: the database's, the SFTP user's, or the SSH tunnel user's. */
export type SecretKind = "db" | "sftp" | "ssh"

type Values = Partial<Record<SourceSetting, string | number | boolean>>

const valuesOf = (settings: Settings): Values =>
  Object.fromEntries(
    SOURCE_SETTINGS.map((key) => [
      key,
      fromFile<string | number | boolean | undefined>(settings, key, undefined).value,
    ]),
  )

const need = (profile: string, values: Values, key: SourceSetting, example: string): string => {
  const value = values[key]
  if (typeof value === "string" && value.trim()) return value.trim()
  throw new CliError(
    "configuration_error",
    `profile ${profile} has no ${key} yet; set it with ${IDENTITY.command} ${profile} config set ${key} ${example}`,
    { reason: "source.not-configured" },
  )
}

const text = (values: Values, key: SourceSetting): string | null => {
  const value = values[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

const number = (values: Values, key: SourceSetting): number | null => {
  const value = values[key]
  return typeof value === "number" ? value : null
}

const extensionOf = (pattern: string): RegExp => {
  try {
    return new RegExp(pattern)
  } catch {
    throw new CliError("configuration_error", "extension_pattern is not a regular expression", {
      reason: "source.bad-setting",
    })
  }
}

const zoneOf = (zone: string | null): string => {
  const chosen = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    new Intl.DateTimeFormat("en", { timeZone: chosen })
    return chosen
  } catch {
    throw new CliError("configuration_error", `cdr_timezone ${chosen} is not an IANA time zone`, {
      reason: "source.bad-setting",
    })
  }
}

/** The profile's source from its settings, or a configuration error that names the setting to fill. */
export const sourceOf = (settings: Settings): SourceConfig => {
  const { profile } = settings
  const values = valuesOf(settings)
  const kind = text(values, "cdr_source") ?? "csv"
  const filesFrom = text(values, "files_from") ?? "local"
  const cdr: SourceConfig["cdr"] =
    kind === "csv"
      ? {
          kind: "csv",
          path: need(profile, values, "cdr_csv_path", "/var/log/asterisk/cdr-csv/Master.csv"),
          columns:
            text(values, "cdr_csv_columns")
              ?.split(",")
              .map((one) => one.trim().toLowerCase())
              .filter(Boolean) ?? null,
        }
      : {
          kind: kind as SqlSource["kind"],
          host: need(profile, values, "db_host", "pbx.example.lan"),
          port: number(values, "db_port"),
          database: need(profile, values, "db_name", "asteriskcdrdb"),
          user: need(profile, values, "db_user", "wirecat_reader"),
          table: text(values, "db_table") ?? "cdr",
          tls: values.db_tls === true,
        }
  const recordingsRoot = text(values, "recordings_path")
  return {
    cdr,
    recordings: recordingsRoot
      ? {
          root: recordingsRoot,
          patterns: text(values, "recordings_pattern")
            ? [text(values, "recordings_pattern") as string]
            : DEFAULT_PATTERNS,
        }
      : null,
    recordingSides: (text(values, "recordings_channels")?.split(",") as RecordingSide[] | undefined) ?? null,
    files:
      filesFrom === "sftp"
        ? {
            kind: "sftp",
            host: need(profile, values, "sftp_host", "pbx.example.lan"),
            port: number(values, "sftp_port"),
            user: need(profile, values, "sftp_user", "wirecat"),
            keyPath: text(values, "sftp_key_path"),
            hostKey: text(values, "sftp_host_key"),
          }
        : { kind: "local" },
    tunnel:
      kind !== "csv" && text(values, "db_ssh_host")
        ? {
            host: text(values, "db_ssh_host") as string,
            port: number(values, "db_ssh_port"),
            user: need(profile, values, "db_ssh_user", "wirecat"),
            keyPath: text(values, "db_ssh_key_path"),
            hostKey: text(values, "db_ssh_host_key"),
          }
        : null,
    zone: zoneOf(text(values, "cdr_timezone")),
    phoneRegions: [
      ...new Set(
        (text(values, "phone_region") ?? "")
          .toLowerCase()
          .split(/[\s,]+/)
          .filter(Boolean),
      ),
    ],
    extension: extensionOf(text(values, "extension_pattern") ?? "^\\d{2,5}$"),
  }
}

/** Every password the profile's source needs, in the order `session start` asks for them; a key file needs none. */
export const secretKindsOf = (source: SourceConfig): SecretKind[] => [
  ...(source.cdr.kind !== "csv" ? (["db"] as const) : []),
  ...(source.tunnel && !source.tunnel.keyPath ? (["ssh"] as const) : []),
  ...(source.files.kind === "sftp" && !source.files.keyPath ? (["sftp"] as const) : []),
]

/**
 * Where a password is kept: the database's is the profile's token, and so is the SFTP password of a profile on
 * Master.csv, as before a profile could keep two. Any other is a named secret in the same keyring entry.
 */
export const slotOf = (source: SourceConfig, kind: SecretKind): "token" | "sftp" | "ssh" => {
  if (kind === "db" || (kind === "sftp" && source.cdr.kind === "csv")) return "token"
  return kind
}
