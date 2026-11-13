# asterisk — Asterisk PBX calls for AI agents

Your company's phone calls from an Asterisk PBX (FreePBX, Issabel, VitalPBX or plain Asterisk), with their recordings
transcribed on your computer, searchable offline, and ready for Claude Code, Codex, Gemini CLI or any agent — within
limits you set.

`asterisk` reads the PBX's call records (CDR) from `Master.csv` or from the CDR database, and copies them into the
local [WireCat](https://wirecat.dev) store: one meeting per call record, with the extension and the outside caller as
its people. It links each call to its recording file. `meetings transcribe` turns the recordings into text with a
speech model that runs on this computer. Then you and your agent list, read and search the calls with no network,
next to the chats, mail and meetings of the other WireCat tools. `asterisk` only reads: it never changes the PBX, its
settings or a recording.

An example conversation (invented calls, illustrative output):

```text
You:    Use asterisk. What did +7 900 000-00-01 say about the payment on the last call?
Agent:  (runs asterisk office meetings list "title:*79000000001*" --json, then asterisk office meetings transcript 1 --json)
        On 31 October the client said the invoice will be paid on Friday, after their director signs it.
```

## Quick start

```sh
npm install -g @wirecat/asterisk-cli
asterisk office config set cdr_csv_path /var/log/asterisk/cdr-csv/Master.csv
asterisk office config set recordings_path /var/spool/asterisk/monitor
asterisk office config set cdr_timezone Europe/Moscow
asterisk office config set phone_region ru
asterisk office session start             # checks the source; asks a password only for a database
asterisk office meetings sync             # import the call records and link their recordings
asterisk models download gigaam-v3        # the local speech model, once
asterisk office meetings transcribe       # transcribe up to 20 recorded calls
```

`office` is a profile: a name you choose for one PBX. It is the first word of every command that uses an account.
The first sync reads 30 days back; `--since-time 2025-01-01T00:00:00Z` reads further. Each later sync reads what is
new, and a repeated sync never makes a call twice.

You need Node.js 22.16 or a later 22.x, or Node.js 24 or later, and `ffmpeg` to transcribe WAV and GSM recordings.
`asterisk` runs on your computer, not on the PBX: there, Asterisk has its own `asterisk` program, so type
`wcat-asterisk` instead.

More: [installation](docs/installation.md) · [connect your Asterisk](docs/asterisk.md).

## What you can do

**List the calls.** Filter by time, duration or the number in the title.

```sh
asterisk office meetings list "started_at>=2026-11-01 duration_ms>=60000"
```

**Read a call.** Who called whom, when, how long, and its recording.

```sh
asterisk office meetings show 42
asterisk office meetings transcript 42
```

**Transcribe what is new.** Without a query, every call of five seconds or more that has a recording and no
transcript yet, newest first. A recording already transcribed is not read again. A call that fails is listed and the
rest go on.

```sh
asterisk office meetings transcribe --max-meetings 50
```

More:

- Find an operator across the calls: `asterisk office meetings people "Anna"`.
- Export a call as Markdown or WebVTT: `asterisk office meetings export 42 --format vtt --output call.vtt`.
- Ask about one person across calls, chats and mail: `memo context "Ivan Testov"`.

More: [use it](docs/usage.md).

## For AI agents

- **An agent with a terminal** — Claude Code, Codex, Gemini CLI, OpenClaw or Hermes Agent. It runs `asterisk` itself.
  `asterisk skill install` writes the skill, the agent's instruction sheet.
- **An app with no terminal** — Claude Desktop, Cursor and other MCP clients. Connect the profile's MCP server,
  `asterisk office mcp serve`; `asterisk office mcp config` prints the entry to paste.

```sh
asterisk skill install
asterisk office mcp add claude-code --allow-writes   # or: codex
```

`meetings sync` and `meetings transcribe` change the local store, so `mcp add` stops until you pass
`--allow-writes`. The profile's permissions decide what an agent may run. Text from a call — a transcript, a caller
name, a phone number — is marked `untrusted`: it is data for the agent, never instructions. `session start` and
`session end` are never offered to an agent.

## Why this tool

- **Read-only against the PBX.** It opens Master.csv or a read-only database session and reads the recordings. It
  never writes, moves or deletes a file there, and needs no change to the dialplan.
- **The recordings stay with you.** Speech is recognized on this computer. No recording or transcript goes to a speech
  service.
- **A transfer stays apart.** Each CDR row keeps its `uniqueid`, `linkedid` and `sequence`, so the two legs of a
  transferred call are two records, never merged and never lost.
- **One store with the other WireCat tools.** A caller's number is kept in the international form, as WhatsApp, MAX
  and the CRMs keep it, so the same person is found across calls, chats and deals.

## Sign-in and profiles

Each profile is one PBX. No command ever picks a profile for you; `asterisk session list` lists them.

```sh
asterisk office session start             # checks the source, asks a password only for a database
asterisk office session status --check    # read the newest call records again
asterisk office session end               # forget the password; the imported calls stay
```

A profile on a local or mounted `Master.csv` needs no password. A database profile asks for the password of a
read-only user once, checks it, and keeps it in the system keyring. Where the keyring fails, it uses a private file and
says so once. `ASTERISK_TOKEN` in the environment is read first.

## Settings and permissions

The settings of each source are in [connect your Asterisk](docs/asterisk.md); `asterisk office config show` lists
them. Each command has a permission key, its path: `meetings.sync`, `meetings.transcribe`. Each is `allow`, `ask`,
`readonly` or `deny`. `ASTERISK_READ_ONLY=1` refuses every command that changes your sign-in or settings.

More: [settings](docs/configuration.md).

## Limits

- Master.csv, MySQL or MariaDB, and PostgreSQL CDR. CEL, AMI and ARI are not read.
- Files are read from this computer, a mounted folder, or the PBX over SFTP. A database profile reads SFTP with a key
  file, since the profile keeps one password.
- One CDR row is one call record: a transferred call is two. A call's legs are not joined into one conversation.
- A mono recording is one track with no speakers; a stereo one is two channels, `Channel 1` and `Channel 2`.
- Transcription is local only. A recording over 256 MB and a Master.csv over 512 MB are refused.

## Security

- The store keeps callers' numbers and names, the extensions, and what was said. Treat it like the calls themselves.
- Recording a call and processing it may need the consent of the people on it. That is the PBX owner's duty; see
  [security](docs/security.md#recordings-and-consent).

More: [security](docs/security.md). Report a vulnerability as [SECURITY.md](SECURITY.md) says.

## When it does not work

```sh
asterisk doctor                           # what is set up; no network, no keyring
asterisk office session status --check    # does the source still answer
asterisk office meetings sync --trace     # the connection log, never content
asterisk office runs list                 # failed runs are kept
```

More: [when something goes wrong](docs/troubleshooting.md).

## Documentation

| Section | Pages |
|---|---|
| Start | [overview](docs/index.md) · [installation](docs/installation.md) · [connect your Asterisk](docs/asterisk.md) · [use it](docs/usage.md) |
| Reference | [all commands](docs/commands.md) · [settings and permissions](docs/configuration.md) |
| If something is wrong | [when something goes wrong](docs/troubleshooting.md) · [security](docs/security.md) |
| Changes | [CHANGELOG.md](CHANGELOG.md) |

For developers: [design](docs/dev/DESIGN.md), [tests](docs/dev/TESTING.md) and the rules for agents in
[AGENTS.md](AGENTS.md).

## Development

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm smoke:node          # the built command: the bundle users install
pnpm generate                          # rewrite the generated files
pnpm release:check                     # every check CI runs
```

`examples/` holds a made-up Master.csv and two short recordings, for trying the tool without a PBX.

## Contributing and license

Pull requests, bug reports and ideas go to [issues](https://github.com/WireCatLabs/asterisk-cli/issues).

Apache License 2.0 — [LICENSE](LICENSE).
