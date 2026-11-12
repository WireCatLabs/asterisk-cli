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
  const { ensureSqlite } = await import("@wirecat/cli-core/sqlite-runtime")
  await ensureSqlite()
  const { openStore, storePath } = await import("@wirecat/cli-core/store")
  const store = await openStore({
    path: storePath(env),
    env,
    command: IDENTITY.command,
    version: IDENTITY.version,
    ...(readOnly ? { readOnly } : {}),
  })
  try {
    if (!readOnly) await store.accounts.registerProvider(PROVIDER)
    return store
  } catch (error) {
    await store.close()
    throw error
  }
}

/**
 * A read finds the profile's account among the rows an earlier sync saved and writes nothing. The first read of a
 * profile, a store that is missing or needs a migration, and every sync and transcription open it for writing, as
 * bitrix24-cli does.
 */
export const openProfileStore = async (
  env: NodeJS.ProcessEnv,
  profile: string,
  reads: boolean,
): Promise<{ store: MessageStore; accountId: number }> => {
  const key = { provider: PROVIDER.name, account: profile }
  if (reads) {
    const store = await openAsteriskStore(env, { readOnly: true }).catch(() => undefined)
    if (store) {
      const saved = await store.accounts.storedAccount(key).catch(() => undefined)
      if (saved) return { store, accountId: saved.id }
      await store.close()
    }
  }
  const store = await openAsteriskStore(env)
  const closing = (error: unknown) => store.close().then(() => Promise.reject(error))
  return { store, accountId: await store.accounts.saveAccount(key, { name: profile }).catch(closing) }
}
