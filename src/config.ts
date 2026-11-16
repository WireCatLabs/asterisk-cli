import { type Configuration, commandPermissions, plain, settingsFor } from "@wirecat/cli-core/cli"
import * as v from "valibot"
import { IDENTITY } from "./identity.js"

/** Each command is checked against its own path (`meetings.sync`); add the keys a command checks inside itself. */
export const permissions = commandPermissions()

const text = (what: string) => v.pipe(v.string(plain(`has to be ${what}, in quotes`)), v.trim(), v.minLength(1))
const port = v.pipe(v.number(plain("has to be a port number")), v.integer(), v.minValue(1), v.maxValue(65535))

/** Where a profile's call records and recordings are. The passwords are never here: `session start` keeps them. */
const SOURCE_ENTRIES = {
  cdr_source: v.optional(v.picklist(["csv", "mysql", "postgres"], plain("has to be csv, mysql or postgres"))),
  cdr_csv_path: v.optional(text("the path of Master.csv")),
  cdr_csv_columns: v.optional(text("the CSV's column names, comma-separated")),
  db_host: v.optional(text("the database server's host name")),
  db_port: v.optional(port),
  db_name: v.optional(text("the database name, such as asteriskcdrdb")),
  db_user: v.optional(text("the database user")),
  db_table: v.optional(v.pipe(text("the table name"), v.regex(/^[A-Za-z_][\w.]{0,127}$/, "has to be a table name"))),
  db_tls: v.optional(v.boolean(plain("has to be true or false"))),
  db_ssh_host: v.optional(text("the SSH server's host name, the PBX itself for a FreePBX database")),
  db_ssh_port: v.optional(port),
  db_ssh_user: v.optional(text("the SSH user")),
  db_ssh_key_path: v.optional(text("the path of a private key")),
  db_ssh_host_key: v.optional(text("the SSH server's SHA256 host key fingerprint")),
  recordings_path: v.optional(text("the folder of the call recordings")),
  recordings_pattern: v.optional(text("a file pattern with {uniqueid}, {linkedid} or {yyyy}/{mm}/{dd}")),
  recordings_channels: v.optional(
    v.picklist(["caller,employee", "employee,caller"], plain("has to be caller,employee or employee,caller")),
  ),
  files_from: v.optional(v.picklist(["local", "sftp"], plain("has to be local or sftp"))),
  sftp_host: v.optional(text("the SFTP server's host name")),
  sftp_port: v.optional(port),
  sftp_user: v.optional(text("the SFTP user")),
  sftp_key_path: v.optional(text("the path of a private key")),
  sftp_host_key: v.optional(text("the server's SHA256 host key fingerprint")),
  cdr_timezone: v.optional(text("an IANA time zone, such as Europe/Moscow")),
  // A list is what `config set phone_region es,ru` and the setup flow's countries input write; text is how it was kept.
  phone_region: v.optional(
    v.union(
      [
        v.pipe(
          text("two-letter country codes"),
          v.regex(/^\s*[a-z]{2}(\s*,\s*[a-z]{2})*\s*$/i, "has to be a country code, or several: es,ru"),
        ),
        v.pipe(v.array(v.pipe(v.string(), v.regex(/^[a-z]{2}$/i))), v.minLength(1)),
      ],
      plain("has to be a country code, or several: es,ru"),
    ),
  ),
  extension_pattern: v.optional(text("a regular expression for internal extensions")),
  // Read from the profile's own section only, so it has no shared default: sending a business's calls away is
  // decided for one profile at a time. `transcribe_with` is cli-core's messenger setting, which pbx cannot set.
  transcribe_engine: v.optional(v.picklist(["local", "openai"], plain("has to be local or openai"))),
  transcribe_model: v.optional(text("the speech model of the service, such as gpt-transcribe")),
}

export type SourceSetting = keyof typeof SOURCE_ENTRIES

export const SOURCE_SETTINGS = Object.keys(SOURCE_ENTRIES) as SourceSetting[]

export const configuration: Configuration = settingsFor(IDENTITY, {
  permissions,
  profile: SOURCE_ENTRIES,
  settings: [
    { key: "cdr_source", default: "csv", description: "where call records come from: csv, mysql or postgres" },
    { key: "files_from", default: "local", description: "where Master.csv and the recordings are: local or sftp" },
    { key: "db_table", default: "cdr", description: "the CDR table of a mysql or postgres source" },

    {
      key: "extension_pattern",
      default: "^\\d{2,5}$",
      description: "a number this regular expression matches is an internal extension, any other an outside party",
    },
  ],
})
