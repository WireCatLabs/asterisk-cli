import { readFileSync } from "node:fs"
import { join } from "node:path"
import { syncAfterInstallCases } from "@wirecat/cli-core/testing"
import { beforeEach, describe, it } from "vitest"
import { asteriskFolder, configure, freshFolders, runCli } from "./testing/harness.js"

const MASTER = readFileSync(new URL("../examples/Master.csv", import.meta.url), "utf8")

beforeEach(async () => {
  freshFolders()
  const root = asteriskFolder({ "Master.csv": MASTER })
  await configure({
    cdr_csv_path: join(root, "Master.csv"),
    recordings_path: join(root, "monitor"),
    cdr_timezone: "Europe/Moscow",
    phone_region: "ru",
  })
})

describe("sync runs right after install, whatever the shared WireCat config holds", () => {
  for (const one of syncAfterInstallCases({
    sync: ["office", "meetings", "sync", "--since-time", "2026-10-01T00:00:00Z"],
    run: (argv, env) => runCli(argv, { env }),
  }))
    it(one.name, () => one.run())
})
