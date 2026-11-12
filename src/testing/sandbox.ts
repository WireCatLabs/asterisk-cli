import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"
import { ARGV_LOG } from "./argv-log.js"

const saved = { ...process.env }

// cli-base's setup already gave this file a fresh TMPDIR and HOME, a keyring that throws and no network, and points
// every folder and store variable at them (WC-TEST-1, WC-STORE-14). The config folder is set only because tests
// write into it by name.
process.env.ASTERISK_CONFIG_DIR = join(tmpdir(), "config")
process.env.ASTERISK_NO_UPDATE_CHECK = "1"
process.env.ASTERISK_TEST_ARGV_LOG = ARGV_LOG
delete process.env.ASTERISK_PROFILE
delete process.env.ASTERISK_READ_ONLY
delete process.env.AI_AGENT
delete process.env.CLAUDECODE

afterAll(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})
