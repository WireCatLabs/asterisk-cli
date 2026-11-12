import { join } from "node:path"
import { resolvePaths } from "@wirecat/cli-base"
import {
  appDoctorCommand,
  appMcpCommand,
  commandsCommand,
  configCommand,
  createProgram as createSharedProgram,
  type FirstScreen,
  outputFor,
  type ProgramDefinition,
  type ProgramOptions,
  type RunOptions,
  run as runShared,
  runsCommand,
  skillCommand,
  upgradeCommand,
} from "@wirecat/cli-core/cli"
import { appUpdate } from "@wirecat/cli-core/update"
import type { Command } from "commander"
import { meetingsMount } from "./commands/meetings.js"
import { modelsCommand } from "./commands/models.js"
import { sessionCommand } from "./commands/session.js"
import { configuration } from "./config.js"
import { readyToRead } from "./context.js"
import { IDENTITY, PACKAGE, SKILL } from "./identity.js"

const update = appUpdate({
  packageName: PACKAGE,
  command: IDENTITY.command,
  version: IDENTITY.version,
  entry: import.meta.url,
  statePath: (env) =>
    join(resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).state, "update-check.json"),
  // biome-ignore lint/plugin/no-own-settings: the update check runs before any command exists to give baseContext
  enabled: (env) => configuration.resolveSettings({}, { env, needsProfile: false }).updateCheck,
  offVariables: [`${IDENTITY.envPrefix}_NO_UPDATE_CHECK`],
})

const mcpCommand = () =>
  appMcpCommand(IDENTITY, configuration, {
    name: "Asterisk",
    untrusted: [
      "call transcripts",
      "caller names from caller ID",
      "phone numbers",
      "recording file names",
      "CDR user fields",
    ],
    permissionExample: "meetings.sync=deny",
    skill: SKILL,
    signedIn: (profile, env, keyring) => readyToRead(profile, env, keyring),
  })

const FIRST_SCREEN: FirstScreen = {
  pitch:
    "Asterisk PBX calls in a local store: transcribe the recordings on this computer, then read and search offline.",
  can: [
    { command: "meetings sync", does: "import the call records and link their recordings" },
    { command: "meetings transcribe", does: "turn new recordings into text, locally" },
    { command: 'meetings list "duration_ms>=60000"', does: "the calls of a minute or more, newest first" },
    { command: "meetings transcript <meeting>", does: "what was said in one call" },
    { command: "mcp serve", does: "the calls for an agent, within the profile's permissions" },
  ],
  start: `${IDENTITY.command} office config set cdr_csv_path /var/log/asterisk/cdr-csv/Master.csv`,
}

export const definition = (): ProgramDefinition => {
  const meetings = meetingsMount()
  return {
    app: IDENTITY,
    // The whole object: cli-core refuses a command by its key only when it gets the permission table too.
    configuration,
    firstScreen: FIRST_SCREEN,
    configure: meetings.configure,
    prepare: meetings.prepare,
    commands: () => [
      commandsCommand(IDENTITY),
      sessionCommand(),
      ...meetings.commands(),
      modelsCommand(),
      appDoctorCommand(IDENTITY, configuration, { packageName: PACKAGE }),
      skillCommand(IDENTITY, SKILL),
      mcpCommand(),
      upgradeCommand(IDENTITY, PACKAGE, (command) => ({
        ...outputFor(command),
        installer: () => update.installer({}),
        latest: () => update.latest({}),
        install: (argv) => update.runUpdate(argv, {}),
      })),
      configCommand(IDENTITY, configuration),
      runsCommand(IDENTITY),
    ],
  }
}

export const createProgram = (options?: ProgramOptions): Command => createSharedProgram(definition(), options)

export const run = (argv: string[], options?: RunOptions): Promise<number> => runShared(argv, definition(), options)
