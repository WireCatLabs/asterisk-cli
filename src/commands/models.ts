import { environmentOf, modelCatalogueCommand, outputFor, profileFree, renderAnswer } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { IDENTITY } from "../identity.js"

export const DEFAULT_SPEECH_MODEL = "gigaam-v3"

/** The speech models `meetings transcribe` uses, in the folder every WireCat CLI shares. */
export const modelsCommand = (): Command => {
  let running: Command | undefined
  const environment = () => (running ? environmentOf(running) : {})
  const models = modelCatalogueCommand(IDENTITY, {
    kinds: ["audio"],
    env: () => environment().env ?? process.env,
    output: (answer, command) => renderAnswer(command, outputFor(command), answer),
    diagnostic: (line) => environment().streams?.diagnostic(line),
    defaultAudio: () => DEFAULT_SPEECH_MODEL,
  })
  models.hook("preAction", (_models, action) => {
    running = action
  })
  for (const command of models.commands) profileFree(command)
  return profileFree(models)
}
