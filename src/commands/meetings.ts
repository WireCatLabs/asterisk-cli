import { CliError } from "@wirecat/cli-base"
import { annotate, metaOf } from "@wirecat/cli-base/commands"
import {
  baseContext,
  environmentOf,
  fetchesOnly,
  hasSharedContract,
  inCommandRun,
  itemOf,
  listOf,
  NO_EFFECTS,
  outputFor,
  overrideSharedContract,
  pagingOf,
  type RunOptions,
  readsOverMcp,
  renderAnswer,
  runBudgetOf,
  snakeKeys,
  writeNewFile,
  writesNewFileOnlyWith,
} from "@wirecat/cli-core/cli"
import type { MeetingStore } from "@wirecat/cli-core/meetings"
import { addMeetingCommands, type MeetingCommandDeps } from "@wirecat/cli-core/meetings/cli"
import type { MessageStore } from "@wirecat/cli-core/store"
import { Command } from "commander"
import type { CallSource } from "../call-source.js"
import type { CdrRow } from "../cdr/record.js"
import { configuration } from "../config.js"
import type { OpenedSource } from "../context.js"
import type { FileAccess } from "../files.js"
import { IDENTITY } from "../identity.js"
import type { Recording } from "../recordings.js"
import { sourceOf } from "../source.js"
import { transcribeCommand } from "./transcribe.js"

interface Opened {
  store: MessageStore
  accountId: number
  env: NodeJS.ProcessEnv
  asterisk: () => Promise<OpenedSource>
  files: () => Promise<FileAccess>
  source: () => CallSource
  close: () => Promise<void>
}

const leaves = (command: Command): Command[] => (command.commands.length ? command.commands.flatMap(leaves) : [command])
const pathOf = (command: Command): string[] =>
  command.parent?.parent ? [...pathOf(command.parent), command.name()] : [command.name()]
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const LIST_KEYS = new Set(["items", "page", "limit", "hasMore", "meta"])
const ITEM_KEYS = new Set(["item", "missing", "meta"])

const EXAMPLES: Record<string, string> = {
  "meetings list": "--limit 50",
  "meetings show": "1",
  "meetings transcript": "1",
  "meetings summary": "1",
  "meetings export": "1 --format markdown",
  "meetings people": '"Test Manager"',
  "meetings sync": "--since-time 2026-08-01T00:00:00Z",
  "meetings repair": "",
  "meetings import": "./transcripts",
  "events list": "",
}

const withExample = (leaf: Command) => {
  const path = pathOf(leaf).join(" ")
  const args = EXAMPLES[path]
  if (args === undefined) return
  const change = (one: Command) => {
    annotate(one, { examples: [[IDENTITY.command, "office", path, args, "--json"].filter(Boolean).join(" ")] })
  }
  if (hasSharedContract(leaf))
    overrideSharedContract(leaf, "asterisk's examples name its profile and a call id.", change)
  else change(leaf)
}

const goOn = (command: string, step: string, why: string, safe: boolean) => ({
  meta: { complete: false },
  next: [{ kind: "command" as const, step, command, args: {}, why, safe_to_auto_execute: safe }],
})

/** cli-core's reads answer `{ items, page, limit, hasMore, meta? }` or one value; asterisk prints both in its envelope. */
const bodyOf = (command: Command, value: unknown) => {
  // cli-core 0.498 writes `meetings list` as a finished list, its `page` an object with the next step.
  if (isRecord(value) && Array.isArray(value.items) && isRecord(value.page))
    return value as Parameters<typeof renderAnswer>[2]
  if (isRecord(value) && Array.isArray(value.items) && Object.keys(value).every((key) => LIST_KEYS.has(key))) {
    const { next, ...list } = listOf(pathOf(command).join(" "), {
      items: snakeKeys(value.items) as unknown[],
      limit: Math.max(1, typeof value.limit === "number" ? value.limit : value.items.length),
      has_more: value.hasMore === true,
      ...(isRecord(value.meta) ? { meta: snakeKeys(value.meta) as Parameters<typeof listOf>[1]["meta"] } : {}),
    })
    const kept = next?.filter((one) => one.step !== "page.next") ?? []
    return { ...list, ...(kept.length > 0 ? { next: kept } : {}) }
  }
  if (pathOf(command).join(" ") === "meetings sync" && isRecord(value) && value.stopped)
    return itemOf(
      snakeKeys(value),
      goOn("meetings sync", "sync.continue", `${value.remaining} calls were not reached before the run stopped`, true),
    )
  // cli-core's `meetings show` answers `{ item, missing?, meta? }` already; wrapped again it printed `item.item`.
  if (isRecord(value) && isRecord(value.item) && Object.keys(value).every((key) => ITEM_KEYS.has(key)))
    return itemOf(snakeKeys(value.item), {
      ...(Array.isArray(value.missing) ? { missing: value.missing } : {}),
      ...(isRecord(value.meta) ? { meta: value.meta } : {}),
    })
  return itemOf(snakeKeys(value))
}

/** The shared `meetings` commands over Asterisk's call records: one call is one meeting, for this profile only. */
export const meetingsMount = () => {
  const commands = new Set<Command>()
  let action: Command | undefined
  let opened: Opened | undefined
  const answers: (() => void)[] = []
  const need = (): Opened => {
    if (!opened) throw new CliError("configuration_error", "the call store is not open for this command")
    return opened
  }
  const deps: MeetingCommandDeps = {
    get store(): MeetingStore {
      return need().store.meetings
    },
    get accountId() {
      return need().accountId
    },
    get source() {
      return need().source()
    },
    inRun: inCommandRun,
    newFileOutput: writesNewFileOnlyWith,
    writeFile: writeNewFile,
    budgetOf: runBudgetOf,
    pagingOf,
    write: (value) => {
      const at = action
      if (!at) throw new CliError("configuration_error", "no command is running")
      const body = bodyOf(at, value)
      answers.push(() => renderAnswer(at, outputFor(at), body))
    },
  }
  return {
    commands: (): Command[] => {
      const holder = new Command(IDENTITY.command)
      addMeetingCommands(holder, deps)
      holder.commands
        .find((group) => group.name() === "meetings")
        ?.addCommand(
          transcribeCommand({
            store: () => need().store.meetings,
            accountId: () => need().accountId,
            files: () => need().files(),
            env: () => need().env,
            signal: () => (action ? environmentOf(action).signal : undefined),
            progress: (line) => (action ? environmentOf(action).streams?.diagnostic(line) : undefined),
            write: (report, command) => {
              const resume = report.stopped
                ? goOn(
                    "meetings transcribe",
                    "transcribe.continue",
                    `${report.remaining} calls still have no transcript`,
                    false,
                  )
                : {}
              answers.push(() => renderAnswer(command, outputFor(command), itemOf(report, resume)))
            },
          }),
        )
      for (const group of holder.commands) {
        if (group.commands.length) annotate(group, { effects: NO_EFFECTS })
        for (const leaf of leaves(group)) {
          withExample(leaf)
          commands.add(leaf)
        }
      }
      return [...holder.commands]
    },
    configure: (program: Command) => {
      program.hook("preAction", (_root, chosen) => {
        action = chosen
      })
      // WC-LIFE-4: a close that fails can change the answer, so the store closes before anything is printed.
      program.hook("postAction", async () => {
        if (opened && action && pathOf(action).join(" ") === "meetings sync") {
          const { retireRowMeetings } = await import("../call-source.js")
          const retired = await retireRowMeetings(
            opened.store.meetings,
            opened.accountId,
            opened.source().read(),
            Date.now(),
          )
          if (retired > 0)
            environmentOf(action).streams?.diagnostic(
              `${retired} meetings of single call records, kept by pbx 0.3.0 and older, gave way to whole calls`,
            )
        }
        await opened?.close()
        for (const answer of answers.splice(0)) answer()
      })
    },
    prepare: async (_program: Command, _environment: RunOptions) => {
      const at = action
      if (!at || !commands.has(at)) return
      const run = environmentOf(at)
      const { settings, env } = baseContext(at, configuration.resolveSettings)
      const [{ openProfileStore }, { openFiles, openSource }, { callSource }, { recordingFinder }] = await Promise.all([
        import("../store.js"),
        import("../context.js"),
        import("../call-source.js"),
        import("../recordings.js"),
      ])
      // A command whose only write is a file (`meetings export --output`) leaves the store as it was.
      const reads = metaOf(at).effects?.local === "read" || (readsOverMcp(at) && !fetchesOnly(at))
      const { store, accountId } = await openProfileStore(env, settings.profile, reads)
      let asterisk: Promise<OpenedSource> | undefined
      let files: Promise<FileAccess> | undefined
      let closed: Promise<void> | undefined
      const close = () =>
        (closed ??= Promise.all([
          store.close(),
          asterisk?.then(
            (one) => one.close(),
            () => undefined,
          ),
          files?.then(
            (one) => one.close(),
            () => undefined,
          ),
        ]).then(() => undefined))
      // Still tracked: a command that fails never reaches postAction.
      run.trackCloseable?.({ close })
      const opening = () => (asterisk ??= openSource(at))
      let source: CallSource | undefined
      let finder: ((row: CdrRow) => Promise<Recording | null>) | undefined
      opened = {
        store,
        accountId,
        env,
        close,
        asterisk: opening,
        files: () => (files ??= openFiles(at)),
        source: () => {
          if (source) return source
          // Read on the first fetch: `meetings list` and `show` hold the source but answer from the store, so a
          // profile with no call source set still lists what it has.
          let config: ReturnType<typeof sourceOf> | undefined
          const configured = () => (config ??= sourceOf(settings))
          source = callSource(
            { rows: async (since) => (await opening()).reader.rows(since) },
            {
              profile: settings.profile as string,
              get phoneRegions() {
                return configured().phoneRegions
              },
              get extension() {
                return configured().extension
              },
              get where() {
                return configured().files.kind
              },
              recording: async (row) => {
                const { source: config, files } = await opening()
                if (!config.recordings) return null
                finder ??= recordingFinder(files, { ...config.recordings, zone: config.zone, now: Date.now })
                return finder(row)
              },
              skipped: (count) =>
                environmentOf(at).streams?.diagnostic(`${count} call records could not be read and were skipped`),
              ambiguous: (count) =>
                environmentOf(at).streams?.diagnostic(
                  `${count} callers' numbers fit more than one of phone_region's countries and were kept as written`,
                ),
            },
          )
          return source
        },
      }
    },
  }
}
