import { CliError } from "@wirecat/cli-base"
import {
  defineSetup,
  fromFile,
  type SetupBlock,
  type SetupCheckInput,
  type SetupCondition,
} from "@wirecat/cli-core/cli"
import type { SourceSetting } from "./config.js"
import { configuration } from "./config.js"
import { checkSource, contextOf, type Passwords } from "./context.js"
import { DESKTOP, IDENTITY } from "./identity.js"
import en from "./setup/texts.en.json" with { type: "json" }
import es from "./setup/texts.es.json" with { type: "json" }
import ru from "./setup/texts.ru.json" with { type: "json" }
import { type SecretKind, type SourceConfig, secretKindsOf, slotOf, sourceOf } from "./source.js"

const DATABASE = { field: "cdr_source", in: ["mysql", "postgres"] }
const OVER_SFTP = { field: "files_from", is: "sftp" }
const ON_THIS_COMPUTER = { field: "files_from", is: "local" }
const THROUGH_SSH = { field: "db_ssh_host", set: true }

const password = (
  id: string,
  secret: string,
  label: string,
  extra: { when?: SetupCondition; optional?: boolean } = {},
) => ({ type: "input", id, secret, input: "password", label, hint: "password.hint", ...extra }) satisfies SetupBlock

/**
 * The input that gives each password. The SFTP password of a profile on Master.csv is its token, as `session start`
 * keeps it (`slotOf`), so the SFTP step has one input per slot and shows the one the chosen source uses.
 */
const inputOf = (source: SourceConfig, kind: SecretKind): string =>
  kind === "sftp" ? (slotOf(source, "sftp") === "token" ? "sftp_token" : "sftp") : kind

/** The settings a kept password belongs to: when one of them changes, the old password is not tried on the new place. */
const OWNED_BY: Record<SecretKind, SourceSetting[]> = {
  db: ["cdr_source", "db_host", "db_port", "db_user", "db_ssh_host"],
  ssh: ["db_ssh_host", "db_ssh_port", "db_ssh_user"],
  sftp: ["cdr_source", "files_from", "sftp_host", "sftp_port", "sftp_user"],
}

const refused = (input: string, message: string) =>
  new CliError("validation_error", `${input} ${message}`, { reason: "input.invalid", param: input })

/**
 * Each password the answers' source needs: the one typed now, or the one kept, but only while the place it opens is
 * the same. A secret left alone reaches the check as absent, and a changed host must never get the old one silently.
 */
const passwordsFor = ({ command, profile, settings, secrets }: SetupCheckInput, source: SourceConfig): Passwords => {
  const { settings: saved, secrets: store } = contextOf(command)
  const same = (key: SourceSetting) =>
    JSON.stringify(fromFile(settings, key, null).value) === JSON.stringify(fromFile(saved, key, null).value)
  const passwords: Passwords = {}
  for (const kind of secretKindsOf(source)) {
    const slot = slotOf(source, kind)
    const input = inputOf(source, kind)
    const typed = secrets[slot]
    if (typed) {
      passwords[kind] = typed
      continue
    }
    if (!OWNED_BY[kind].every(same)) throw refused(input, "has to be typed again: the server or the user changed")
    const kept = slot === "token" ? store.read(profile)?.secret : store.readSecret(profile, slot)?.secret
    if (!kept) throw refused(input, "is needed")
    passwords[kind] = kept
  }
  return passwords
}

const check = async (input: SetupCheckInput) => {
  const source = sourceOf(input.settings)
  return checkSource(input.command, input.settings, passwordsFor(input, source))
}

// The SFTP server's key is checked before anything else is opened, so its refusal comes first.
const sftpKeyMissing = { all: [OVER_SFTP, { field: "sftp_host_key", set: false }] }
const fixable = {
  any: [
    { result: "check", error: "authentication_error" },
    { result: "check", error: "validation_error" },
    { result: "check", error: "configuration_error" },
  ],
}

/** WireCat Desktop draws this flow, `pbx <profile> setup` asks it in a terminal; both save only after `check`. */
export const setup = defineSetup({
  app: IDENTITY,
  configuration,
  requires: ["run", "input.countries"],
  start: "source",
  steps: {
    source: {
      title: "source.title",
      blocks: [
        { type: "text", text: "source.intro" },
        {
          type: "choice",
          id: "cdr_source",
          setting: "cdr_source",
          options: [
            { value: "csv", label: "source.csv", hint: "source.csv.hint", icon: "file" },
            { value: "mysql", label: "source.mysql", hint: "source.mysql.hint", icon: "database" },
            { value: "postgres", label: "source.postgres", hint: "source.postgres.hint", icon: "database" },
          ],
        },
        {
          type: "choice",
          id: "files_from",
          setting: "files_from",
          label: "files.label",
          options: [
            { value: "local", label: "files.local", hint: "files.local.hint", icon: "folder" },
            { value: "sftp", label: "files.sftp", hint: "files.sftp.hint", icon: "server" },
          ],
        },
      ],
      next: [{ when: OVER_SFTP, to: "sftp" }, { when: DATABASE, to: "database" }, { to: "csv" }],
    },
    sftp: {
      title: "sftp.title",
      blocks: [
        { type: "text", text: "sftp.intro" },
        {
          type: "group",
          role: "row",
          class: ["gap-sm"],
          blocks: [
            {
              type: "input",
              id: "sftp_host",
              setting: "sftp_host",
              input: "text",
              label: "sftp.host",
              hint: "sftp.host.hint",
              class: ["grow-3"],
            },
            {
              type: "input",
              id: "sftp_port",
              setting: "sftp_port",
              input: "port",
              label: "sftp.port",
              hint: "sftp.port.hint",
              optional: true,
              class: ["grow-1"],
            },
          ],
        },
        { type: "input", id: "sftp_user", setting: "sftp_user", input: "text", label: "sftp.user" },
        password("sftp_token", "token", "sftp.password", { when: { field: "cdr_source", is: "csv" } }),
        password("sftp", "sftp", "sftp.password", { when: DATABASE }),
        {
          type: "input",
          id: "sftp_host_key",
          setting: "sftp_host_key",
          input: "text",
          label: "sftp.host-key",
          hint: "key.hint",
          optional: true,
          class: ["mono"],
        },
      ],
      next: [{ when: DATABASE, to: "database" }, { to: "csv" }],
    },
    csv: {
      title: "csv.title",
      blocks: [
        {
          type: "input",
          id: "cdr_csv_path",
          setting: "cdr_csv_path",
          input: "file",
          accept: [".csv"],
          label: "csv.path",
          hint: "csv.path.hint",
          when: ON_THIS_COMPUTER,
        },
        {
          type: "input",
          id: "cdr_csv_path_remote",
          setting: "cdr_csv_path",
          input: "text",
          label: "csv.path",
          hint: "csv.path.remote.hint",
          default: "/var/log/asterisk/cdr-csv/Master.csv",
          when: OVER_SFTP,
        },
      ],
      next: "recordings",
    },
    database: {
      title: "db.title",
      blocks: [
        { type: "text", text: "db.intro" },
        {
          type: "group",
          role: "row",
          class: ["gap-sm"],
          blocks: [
            {
              type: "input",
              id: "db_host",
              setting: "db_host",
              input: "text",
              label: "db.host",
              hint: "db.host.hint",
              class: ["grow-3"],
            },
            {
              type: "input",
              id: "db_port",
              setting: "db_port",
              input: "port",
              label: "db.port",
              hint: "db.port.hint",
              optional: true,
              class: ["grow-1"],
            },
          ],
        },
        {
          type: "input",
          id: "db_name",
          setting: "db_name",
          input: "text",
          label: "db.name",
          hint: "db.name.hint",
          default: "asteriskcdrdb",
        },
        { type: "input", id: "db_user", setting: "db_user", input: "text", label: "db.user", hint: "db.user.hint" },
        password("db", "token", "db.password"),
        { type: "input", id: "db_tls", setting: "db_tls", input: "toggle", label: "db.tls", hint: "db.tls.hint" },
        {
          type: "group",
          role: "details",
          title: "db.ssh.title",
          blocks: [
            { type: "text", text: "db.ssh.intro" },
            {
              type: "group",
              role: "row",
              class: ["gap-sm"],
              blocks: [
                {
                  type: "input",
                  id: "db_ssh_host",
                  setting: "db_ssh_host",
                  input: "text",
                  label: "db.ssh.host",
                  optional: true,
                  class: ["grow-3"],
                },
                {
                  type: "input",
                  id: "db_ssh_port",
                  setting: "db_ssh_port",
                  input: "port",
                  label: "db.ssh.port",
                  optional: true,
                  class: ["grow-1"],
                },
              ],
            },
            {
              type: "group",
              when: THROUGH_SSH,
              blocks: [
                { type: "input", id: "db_ssh_user", setting: "db_ssh_user", input: "text", label: "db.ssh.user" },
                // A key file set with config set needs no password; without one, the check asks for it by name.
                password("ssh", "ssh", "db.ssh.password", { optional: true }),
                {
                  type: "input",
                  id: "db_ssh_host_key",
                  setting: "db_ssh_host_key",
                  input: "text",
                  label: "db.ssh.host-key",
                  hint: "key.hint",
                  optional: true,
                  class: ["mono"],
                },
              ],
            },
          ],
        },
      ],
      next: "recordings",
    },
    recordings: {
      title: "rec.title",
      blocks: [
        {
          type: "input",
          id: "recordings_path",
          setting: "recordings_path",
          input: "folder",
          label: "rec.path",
          hint: "rec.path.hint",
          optional: true,
          when: ON_THIS_COMPUTER,
        },
        {
          type: "input",
          id: "recordings_path_remote",
          setting: "recordings_path",
          input: "text",
          label: "rec.path",
          hint: "rec.path.remote.hint",
          optional: true,
          when: OVER_SFTP,
        },
        {
          type: "input",
          id: "phone_region",
          setting: "phone_region",
          input: "countries",
          label: "region.label",
          hint: "region.hint",
          min: 1,
        },
        {
          type: "input",
          id: "extension_names",
          setting: "extension_names",
          input: "text",
          label: "names.label",
          hint: "names.hint",
          placeholder: "names.placeholder",
          optional: true,
        },
      ],
      next: "check",
    },
    check: {
      kind: "run",
      title: "check.title",
      action: "apply",
      blocks: [{ type: "text", text: "check.body" }],
      next: [
        { when: { result: "check", is: "ok" }, to: "done" },
        { when: { all: [fixable, sftpKeyMissing] }, to: "sftp" },
        { when: { all: [fixable, DATABASE] }, to: "database" },
        { when: { all: [fixable, OVER_SFTP] }, to: "sftp" },
        { when: fixable, to: "csv" },
        { to: "check-failed" },
      ],
    },
    "check-failed": {
      kind: "done",
      title: "failed.title",
      blocks: [
        { type: "note", role: "danger", text: "failed.body" },
        { type: "link", role: "button", href: `${DESKTOP.docs}/troubleshooting`, text: "failed.help" },
      ],
    },
    done: {
      kind: "done",
      title: "done.title",
      blocks: [
        { type: "text", text: "done.body" },
        { type: "requirement", check: "ffmpeg", text: "req.ffmpeg", fix: "req.ffmpeg.fix" },
        { type: "requirement", check: "speech-model", text: "req.model", fix: "req.model.fix" },
      ],
    },
  },
  texts: { en, ru, es },
  check,
})
