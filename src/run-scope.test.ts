import { Readable } from "node:stream"
import { neverAnswers, runScopeCases } from "@wirecat/cli-core/testing"
import { describe, it } from "vitest"
import { definition } from "./program.js"
import { FAKE_TOKEN, fakeComments } from "./testing/fake-comments.js"
import { signedIn } from "./testing/harness.js"

const stdin = () => Object.assign(Readable.from([FAKE_TOKEN]), { isTTY: false })

// SAMPLE: give each of your remote commands the words that make it succeed against your fake.
describe("each remote command runs inside cli-core's run", () => {
  const cases = runScopeCases({
    definition: definition(),
    commands: {
      "comments list": ["personal", "comments", "list"],
      "comments show": ["personal", "comments", "show", "c1"],
      "comments create": ["personal", "comments", "create", "--text", "Plan"],
      "comments update": ["personal", "comments", "update", "c1", "--text", "Plans"],
      "session start": ["personal", "session", "start"],
      "session status": ["personal", "session", "status", "--check"],
    },
    skip: {
      "mcp serve": "listens until stopped",
      doctor:
        "cli-core's appDoctorCommand answers --online outside a run of its own; drop this once core runs it inside",
    },
    answering: () => ({ keyring: signedIn(), fetch: fakeComments().fetch, stdin: stdin() }),
    silent: () => ({ keyring: signedIn(), fetch: neverAnswers, stdin: stdin() }),
  })
  for (const one of cases) it(one.name, () => one.run())
})
