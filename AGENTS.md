# Working rules for agents

The [WireCat CLI standards](node_modules/@wirecat/cli-base/docs/standards/README.md) apply here and win over this
file and over every other document in this repository. The handbook ships inside `@wirecat/cli-base`; run
`pnpm install` first. Read the page for the area you change before changing it, and cite the rule ids the change
touches (`WC-<AREA>-<n>`) in the commit message and the pull request. The rules of this CLI alone are in
[CLAUDE.md](CLAUDE.md).

## Design

[docs/dev/DESIGN.md](docs/dev/DESIGN.md) holds the owner's answers to the
[design interview](docs/dev/skills/design-interview/SKILL.md) and the decisions made since. Read it before changing
what a command does, and write a new decision there. Learn how a command reaches a service from the sample below,
and the domain, the store and its commands from the reference CLI.

<!-- cli-template:reference-cli:start -->
## Reference CLI

Learn from [zoom-cli](https://github.com/WireCatLabs/zoom-cli).
<!-- cli-template:reference-cli:end -->

## The sample: what to keep, what to replace

<!-- cspell:words gcal SECR -->

The template ships one working command group, `comments`, against a made-up service, Example Comments, whose address
never resolves. It shows every pattern a command that reaches a service needs, each tested against a strict fake of
the service. Build your first command on it: keep the patterns, replace the service. Delete the rest of the sample
once your own commands cover every pattern below; until then `pnpm test` keeps it working. The paths below are where
the template puts each part. A CLI made from it may keep a part elsewhere, have deleted the sample, or predate a file;
read that file in [cli-template](https://github.com/WireCatLabs/cli-template/tree/main/src) and keep its role.
Comments marked `SAMPLE:` in the code say what to replace.

Keep, the same for every service:

- **Token storage**, cli-core's `ProfileTokenStore` (`@wirecat/cli-core/cli`), built in `src/context.ts`: the
  environment variable, then the keyring, then a private file; a run with moved folders never replaces the owner's
  entry (WC-SECR-4, WC-SECR-24). `need(profile)` is the one `session.missing` refusal every token CLI gives.
- **Sign-in**, `src/commands/session.ts`: `session start | status | end | list`. The token is read hidden or from
  stdin, never as an argument, and checked against the service before it is kept (WC-ACCT-12, WC-SECR-5). Replace
  the `me` check with your service's. A service with OAuth signs in through cli-core's oauth module instead, as
  [gcal-cli](https://github.com/WireCatLabs/gcal-cli) does (WC-SECR-22).
- **The command context**, `src/context.ts`: settings, the keyring and the run come from cli-core's `baseContext`
  only, and every request runs inside its `run()`, with the `events` it gives passed to the transport. That is what
  bounds a command by `--timeout` and records a run named after it (WC-LIFE-5, WC-LIFE-15).
- **Permissions**, `src/program.ts` and `src/config.ts`: the program hands cli-core the whole `configuration`, and
  each command path is its own key (WC-PERM-22). A command that reaches the service another way, such as an
  `api call`, also checks the key of the command it does the same as, with `alsoChecks`.
- **Writes**, `write` in `src/commands/comments.ts`: the guard asks or refuses by the command's key, the send journal
  records the attempt, the answer carries `operation_id`, and a write is never retried: one that got no answer is
  `outcome_unknown` (WC-PERM-13, WC-PERM-17, WC-OUT-10, WC-LIFE-9). `--dry-run` and `<PREFIX>_READ_ONLY` are
  cli-core's; declare no `--dry-run` of your own.
- **MCP and doctor**, `src/program.ts`: cli-core's `appMcpCommand` and `appDoctorCommand`, never a copy of them.
  Rewrite `name` and `untrusted` for your service (WC-MCP-11).
- **The test harness**, `src/testing/harness.ts`: the CLI through its own `run()`, with a memory keyring and the fake
  in place of the network (WC-TEST-2, WC-TEST-3, WC-TEST-6).

Replace, your service's own:

- **The transport**, `src/sample/transport.ts`: the token in a header only, no redirects, a timeout, cli-core's
  `Pacer`, cli-base's error codes and no retry (WC-SECR-6, WC-SECR-7, WC-OUT-20). Keep its shape; take the address,
  the header and the error mapping from your service's documentation.
- **Wire shapes and the mapper**, `src/sample/comments.ts`: each field name from the documentation or a captured
  answer, never from memory; no wire type leaves this file (WC-ARCH-3).
- **The commands**, `src/commands/comments.ts`: a list with `withPaging`, `withQuery` and `answerEntity`, so
  `--json=a,b` and the MCP schema come from one schema (WC-CMD-19, WC-CMD-20); `show`; `create` and `update`.
- **The strict fake**, `src/testing/fake-comments.ts`: it refuses an unknown path, parameter or field, so a name typed
  from memory fails a test instead of reaching the owner's account. Build yours from the documentation.
- **The tests**, `src/comments.test.ts` and `src/sample/transport.test.ts`. Keep each case for your commands: a deny
  stops a read before any request, `--dry-run` sends nothing, a lost write is `outcome_unknown`, a recorded run is
  named after its command, and the token reaches no output, run record or file.

Remove the sample only once your own commands and their tests cover each pattern above: the skeleton alone is below
the coverage floor, and the floor is never lowered (WC-TEST-11). To remove it, unmount `commentsCommand` in `src/program.ts` and delete `src/sample/`,
`src/commands/comments.ts`, `src/testing/fake-comments.ts` and their tests. Then run `pnpm generate`,
`pnpm exec cli-contract contracts/plan.json --update` and `pnpm test:matrix`.

## Template-owned files

This CLI was made from [cli-template](https://github.com/WireCatLabs/cli-template). `template.json` names the files
`npx @wirecat/cli-template upgrade` keeps in step with the template. Change one of them here only when this CLI needs
to differ; `upgrade` asks before it touches your change. Text that holds for this CLI alone goes into the pages it
owns, such as `DESIGN.md`, `CLAUDE.md` and `README.md`, not into a template-owned page.
