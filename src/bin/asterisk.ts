#!/usr/bin/env node
import { enableCompileCache } from "node:module"
import { catchCrashes } from "@wirecat/cli-base"
import { wcatStart } from "@wirecat/cli-base/wcat/start"
import { DESKTOP } from "../identity.js"

enableCompileCache()
// Stopped only on success: a try/finally would remove the handler before a thrown start reached it.
const stopCatching = catchCrashes({ cli: DESKTOP.command, interactive: process.stdout.isTTY === true })
const wcat = await wcatStart(DESKTOP)
if (wcat.code !== undefined) {
  process.exitCode = wcat.code
} else {
  const { run } = await import("../program.js")
  process.exitCode = await run(process.argv.slice(2))
}
stopCatching()
