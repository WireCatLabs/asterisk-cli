import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isCliError } from "@wirecat/cli-base"
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

/**
 * A read finds the profile's account among the rows an earlier sync saved and writes nothing. The first read of a
 * profile, a store that is missing or needs a migration, and every sync and transcription open it for writing, as
 * bitrix24-cli does. Under `PBX_READ_ONLY` a read with no store or no saved account reads an empty store in a
 * temporary folder, so the lock creates no `wirecat.db`, and a store that needs a migration is refused.
 */
export const openProfileStore = async (
  env: NodeJS.ProcessEnv,
  profile: string,
  reads: boolean,
): Promise<{ store: MessageStore; accountId: number }> => {
  const key = { provider: PROVIDER.name, account: profile }
  const { readOnlyLockOf } = await import("@wirecat/cli-core/cli")
  const locked = reads && readOnlyLockOf(IDENTITY, env) !== undefined
  if (reads) {
    const store = await openAsteriskStore(env, { readOnly: true }).catch((error: unknown) => {
      if (locked && !(isCliError(error) && error.code === "not_found")) throw error
      return undefined
    })
    if (store) {
      const saved = await store.accounts.storedAccount(key).catch(() => undefined)
      if (saved) return { store, accountId: saved.id }
      await store.close()
    }
  }
  return locked ? openEmptyStore(env, profile) : openWritable(env, profile)
}

const openWritable = async (env: NodeJS.ProcessEnv, profile: string) => {
  const store = await openAsteriskStore(env)
  const closing = (error: unknown) => store.close().then(() => Promise.reject(error))
  const key = { provider: PROVIDER.name, account: profile }
  return { store, accountId: await store.accounts.saveAccount(key, { name: profile }).catch(closing) }
}

const openEmptyStore = async (env: NodeJS.ProcessEnv, profile: string) => {
  const folder = mkdtempSync(join(tmpdir(), "pbx-empty-"))
  const removing = () => rmSync(folder, { recursive: true, force: true })
  try {
    const { store, accountId } = await openWritable({ ...env, MESSAGING_STORE: join(folder, "wirecat.db") }, profile)
    const close = store.close.bind(store)
    store.close = () => close().finally(removing)
    return { store, accountId }
  } catch (error) {
    removing()
    throw error
  }
}
