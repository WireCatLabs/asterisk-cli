# asterisk — design

Written by `npx @wirecat/cli-template new`. The agent reads it first, asks the further questions the reference CLI
does not answer, and starts building only after the owner has read it.

## First task

Delete this section once every step is done (WC-DOC-3).

1. If an answer below is missing, ask the owner the [design interview](skills/design-interview/SKILL.md).
2. Learn how a command reaches a service from the sample (`AGENTS.md`, "The sample"), and the domain, the
   store and its commands from the reference CLI below. Build the first command on the sample.
3. Ask the further questions in the interview that the reference CLI does not answer, and write the answers here.
   Build only after the owner has read this page.
4. When the first command reaches the service, rewrite `README.md`, `docs/index.md` and the description in
   `package.json` and `skills/asterisk-cli/SKILL.md` to say what the tool does and who it is for. Rewrite
   `appMcpCommand`'s `name` and `untrusted` in `src/program.ts` too: name the kinds of outside text the CLI
   carries (WC-MCP-11). Rewrite the tagline and the sign-in texts of `DESKTOP` in `src/identity.ts`, then run
   `pnpm generate`: WireCat Desktop shows them before it installs the tool.

## Answers

- **Category:** meetings
- **Content languages:** ru, en
- **Sign-in:** an API token or key
- **The API:** official API documentation only
- **How people filter:** by time, by person, by status or label
- **Never in the store, a log or the output:** tokens and passwords
- **Untrusted input:** files and attachments, names and titles set by others, what other attendees said or wrote

## Reference CLI

Learn from [zoom-cli](https://github.com/WireCatLabs/zoom-cli).

## Content languages

Languages: ru, en.

## Further answers

## Open questions for the owner
