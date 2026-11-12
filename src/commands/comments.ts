import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import {
  answerEntity,
  commandPath,
  itemOf,
  outputFor,
  pagedList,
  pageOf,
  queryTerms,
  REMOTE_READ,
  REMOTE_WRITE,
  renderAnswer,
  termField,
  terminalAsker,
  withPaging,
  withQuery,
} from "@wirecat/cli-core/cli"
import { guardedWrite, guardFor, keyedGuard, levelFor, newOperationId } from "@wirecat/cli-core/sends"
import { Command } from "commander"
import { permissions } from "../config.js"
import { contextOf, withService } from "../context.js"
import { IDENTITY } from "../identity.js"
import { type Comment, type CommentsService, commentSchema } from "../sample/comments.js"
import { SERVICE } from "../sample/transport.js"

// SAMPLE: `comments` is the reference command group. Keep its shape; replace the noun and the calls with your
// service's. Every command path is its own permission key (`comments.create`), from `commandPermissions()`.

const CLI = IDENTITY.command

/** The list's query: one field the service filters itself (WC-CMD-20). Nothing is filtered in memory. */
const COMMENTS_QUERY = {
  entity: "comment",
  backend: "native",
  fields: [termField("author", "kw", "author:u2")],
} as const

/** --all walks pages until the service has no more, at most this many, so a huge account cannot hold the run open. */
const ALL_PAGES = 20
const ALL_PAGE_SIZE = 100

const listAll = async (service: CommentsService, author: string | undefined) => {
  const items: Comment[] = []
  for (let page = 0; page < ALL_PAGES; page++) {
    const found = await service.list({ limit: ALL_PAGE_SIZE, offset: page * ALL_PAGE_SIZE, author })
    for (const item of found.items) items.push(item)
    if (!found.has_more) return { items, has_more: false }
  }
  return { items, has_more: true }
}

const listCommand = () =>
  withPaging(
    withQuery(
      answerEntity(
        annotate(new Command("list"), {
          effects: REMOTE_READ,
          offline: false,
          examples: [`${CLI} personal comments list`, `${CLI} personal comments list author:u2 --json=id,text`],
        }),
        "comment",
        commentSchema,
      ),
      COMMENTS_QUERY,
    ),
  )
    .description(`list the comments in ${SERVICE}, newest first`)
    .action(async function (this: Command, words: string[]) {
      const path = commandPath(this)
      const author = queryTerms(words, COMMENTS_QUERY, path).get("author")
      const { settings } = contextOf(this)
      const found = await withService(this, (service) =>
        settings.all ? listAll(service, author) : service.list({ ...pageOf(settings), author }),
      )
      renderAnswer(this, outputFor(this), pagedList(path, settings, found))
    })

const showCommand = () =>
  answerEntity(
    annotate(new Command("show"), {
      effects: REMOTE_READ,
      offline: false,
      examples: [`${CLI} personal comments show c1`, `${CLI} personal comments show c1 --json`],
    }),
    "comment",
    commentSchema,
  )
    .description(`show one comment in ${SERVICE}`)
    .argument("<id>", "the comment's id, as list prints it")
    .action(async function (this: Command, id: string) {
      renderAnswer(this, outputFor(this), itemOf(await withService(this, (service) => service.show(id))))
    })

/**
 * Every write's one path (WC-PERM-13). The profile's level for the command's key refuses, or asks once; the send
 * journal records the attempt and its outcome, never its content (WC-PERM-17); the answer carries the `operation_id`
 * (WC-OUT-10). cli-core's `run` has already answered `--dry-run` and refused under `<PREFIX>_READ_ONLY` before this
 * runs. Never retried: a write that got no answer is `outcome_unknown`, with the id to look it up by (WC-LIFE-9).
 */
const write = async (command: Command, act: (service: CommentsService) => Promise<Comment>) => {
  const { settings, env, renderer } = contextOf(command)
  const key = commandPath(command).replaceAll(" ", ".")
  const operationId = newOperationId()
  const levelOf = (one: string) => levelFor(settings.permissions, one, permissions.defaults).level
  const guard = keyedGuard(
    (ask) =>
      guardFor(
        IDENTITY,
        // SAMPLE: the service limits its own rate, so this guard keeps the levels and the journal, not a send cap.
        { ...settings, sendsPerHour: Number.MAX_SAFE_INTEGER, permissionDefaults: permissions.defaults },
        renderer.warn,
        env,
        ask,
      ),
    terminalAsker(command),
    levelOf,
    [],
  )
  const request = { chatId: null, kind: "edit" as const, key, operationId }
  guard.refuse(request)
  let comment: Comment
  try {
    comment = await guardedWrite(guard, request, () => withService(command, act))
  } catch (error) {
    if (error instanceof CliError && error.code === "outcome_unknown")
      throw new CliError("outcome_unknown", error.message, { ...error.details, operation_id: operationId })
    throw error
  }
  renderAnswer(command, outputFor(command), itemOf({ operation_id: operationId, comment }))
}

const createCommand = () =>
  annotate(new Command("create"), {
    effects: REMOTE_WRITE,
    offline: false,
    examples: [
      `${CLI} personal comments create --text "Looks good to me"`,
      `${CLI} personal comments create --text "Looks good to me" --dry-run`,
    ],
  })
    .description(`post a comment in ${SERVICE}`)
    .requiredOption("--text <text>", "the comment's text")
    .action(async function (this: Command, args: { text: string }) {
      await write(this, (service) => service.create(args.text))
    })

const updateCommand = () =>
  annotate(new Command("update"), {
    effects: REMOTE_WRITE,
    offline: false,
    examples: [`${CLI} personal comments update c1 --text "Looks good now"`],
  })
    .description(`change the text of your comment in ${SERVICE}`)
    .argument("<id>", "the comment's id, as list prints it")
    .requiredOption("--text <text>", "the new text")
    .action(async function (this: Command, id: string, args: { text: string }) {
      await write(this, (service) => service.update(id, args.text))
    })

export const commentsCommand = (): Command =>
  annotate(new Command("comments"), { effects: REMOTE_READ })
    .description(`read and write comments in ${SERVICE}, the sample service`)
    .addCommand(listCommand())
    .addCommand(showCommand())
    .addCommand(createCommand())
    .addCommand(updateCommand())
