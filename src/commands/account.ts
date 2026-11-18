import { resolvePaths } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type AccountRemoval, accountRemoveCommand, LOCAL_READ, LOCAL_WRITE } from "@wirecat/cli-core/cli"
import { Command } from "commander"
import { PROVIDER_NAME } from "../call-source.js"
import { configuration } from "../config.js"
import { IDENTITY } from "../identity.js"

const removal: AccountRemoval = {
  // The password belongs to a database or SFTP user on the owner's server; only that server can change it.
  signOut: async (profile) => ({
    revoked: null,
    removed: [`the saved password of ${profile} (the user on the server keeps it)`],
  }),
  secrets: (profile, { env, keyring }) => [
    {
      credentials: {
        configDir: resolvePaths({ appName: IDENTITY.appName, prefix: IDENTITY.envPrefix, env }).config,
        service: IDENTITY.appName,
        envVar: `${IDENTITY.envPrefix}_TOKEN`,
        env,
        ...(keyring ? { keyring } : {}),
      },
      accounts: [`token:${profile}`],
    },
  ],
}

export const accountCommand = (): Command =>
  annotate(new Command("account"), { effects: LOCAL_READ })
    .description("this profile on this computer")
    .addCommand(
      annotate(
        accountRemoveCommand(IDENTITY, removal, {
          provider: PROVIDER_NAME,
          resolveSettings: configuration.resolveSettings,
        }),
        { effects: LOCAL_WRITE },
      ),
    )
