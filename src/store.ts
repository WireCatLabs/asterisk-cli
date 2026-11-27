import type { MessageStore } from "@wirecat/cli-core/store"
import { PROVIDER_NAME } from "./call-source.js"
import { IDENTITY } from "./identity.js"

export const PROVIDER = {
  name: PROVIDER_NAME,
  kind: "meetings",
  aliases: ["asterisk-pbx"],
  command: IDENTITY.command,
} as const

/**
 * The shared store, with asterisk's provider entry written, so every other CLI's search knows it (WC-ARCH-21). A
 * read-only open writes nothing, the entry included, and fails when the file is missing or needs a migration.
 */
export const openAsteriskStore = async (env: NodeJS.ProcessEnv, { readOnly = false } = {}): Promise<MessageStore> => {
  const { openAppStore } = await import("@wirecat/cli-core/cli")
  return openAppStore(env, { app: IDENTITY, provider: PROVIDER, readOnly })
}
