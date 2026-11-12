import { describeProgram } from "@wirecat/cli-base/commands"
import { buildManifest, manifestSchema } from "@wirecat/cli-base/wcat/manifest"
import * as v from "valibot"
import { describe, expect, it } from "vitest"
import { createProgram } from "./program.js"
import { WCAT } from "./wcat.js"

describe("WCAT", () => {
  it("builds a manifest WireCat Desktop accepts", () => {
    const manifest = buildManifest({
      identity: WCAT,
      commands: describeProgram(createProgram()),
      pkg: { name: "@wirecat/asterisk-cli", bin: { "wcat-asterisk": "dist/bin/asterisk.js" } },
      skills: true,
    })

    expect(v.safeParse(manifestSchema, manifest).issues).toBeUndefined()
    expect(manifest.desktop.tagline).toBe(WCAT.tagline)
  })
})
