import { defineReasons } from "@wirecat/cli-base/standards"
import { CORE_REASONS } from "@wirecat/cli-core"

/** cli-core's registry refuses a reason listed twice, and a reason it already has is its own to describe. */
const CORE = new Set(CORE_REASONS.map((one) => one.reason))

/** asterisk's own reasons; the shared ones, `offline.refused` among them, are cli-core's and cli-base's. */
const OWN: [reason: string, code: string, message: string][] = [
  ["profile.not-signed-in", "authentication_error", "this profile has no password for its source yet; sign in first"],
  ["source.not-configured", "configuration_error", "a setting the profile's source needs is missing"],
  ["source.bad-setting", "configuration_error", "a setting of the profile's source has a wrong value"],
  ["cdr.bad-row", "invalid_response", "a call record has no start time"],
  ["cdr.unknown-columns", "validation_error", "Master.csv has a column count cdr_csv never writes"],
  ["cdr.no-time-column", "invalid_response", "the CDR table has neither a calldate nor a start column"],
  ["db.refused", "authentication_error", "the database refused the user or password"],
  ["db.no-database", "not_found", "the database server has no such database"],
  ["db.no-table", "not_found", "the database has no such CDR table"],
  ["db.no-select", "permission_error", "the database user may not read the CDR table"],
  ["file.missing", "not_found", "the file is not there"],
  ["file.denied", "permission_error", "this user may not read the file or folder"],
  ["file.unreadable", "provider_error", "the file or folder could not be read"],
  ["file.too-large", "validation_error", "the file is larger than the limit"],
  ["recording.missing", "not_found", "the call has no recording"],
  ["model.not-downloaded", "not_found", "the speech model is not on this computer; download it first"],
]

export const REASONS = defineReasons(
  OWN.filter(([reason]) => !CORE.has(reason)).map(([reason, code, message]) => ({
    reason,
    code,
    message,
    details: [],
  })),
)
