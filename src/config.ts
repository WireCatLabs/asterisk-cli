import { type Configuration, commandPermissions, settingsFor } from "@wirecat/cli-core/cli"
import { IDENTITY } from "./identity.js"

/** Each command is checked against its own path (`notes.list`); add the keys a command checks inside itself. */
export const permissions = commandPermissions()

export const configuration: Configuration = settingsFor(IDENTITY, { permissions })
