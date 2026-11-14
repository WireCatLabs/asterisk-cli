# Use it

This page explains how a command is built, and how an agent uses the tool. Read it before your first command.

## The profile comes first

A profile is a name you choose for one PBX. It is the first word of every command that uses an account:

```sh
pbx office meetings list
```

`PBX_PROFILE=office` does the same for one shell session. No profile is ever assumed, not even the only one: a
command without one stops with exit code 2 and lists the profiles on this computer.

## Calls are meetings

Each call is one meeting in the WireCat store, however many CDR rows its ring group, queue or transfer wrote. Its title
is the two sides, `+79000000001 → 101`; its people are the outside number (`client`) and each extension that placed
or answered it (`manager`); its recordings are attachments. Its description says what became of it:

```text
Incoming call to 600: answered by 101 Анна Смирнова after 0:03, talk 0:24. 102 Борис Кузнецов did not answer.
Incoming call to 600: went to voicemail after ringing 101 Анна Смирнова, 102 Борис Кузнецов.
```

```sh
pbx office meetings sync                                  # import what is new
pbx office meetings list "started_at>=2026-11-01"          # newest first
pbx office meetings list "title:*79000000001*"             # the calls of one number
pbx office meetings show 42                                 # times, people, recording
pbx office meetings transcribe                              # recordings to text, on this computer
pbx office meetings transcript 42                           # what was said
```

`pbx office meetings list --help` lists the fields a query takes.

## Output for scripts

Every command except `mcp serve` on stdin and stdout takes `--json`, and prints one JSON value on stdout. Errors are
JSON on stderr, with a code and a reason to branch on. The [command reference](commands.md) lists the codes.

## Agents

`pbx skill install` puts the tool's skill where Claude Code, Codex, Gemini CLI and OpenClaw look for it.
`pbx skill install --for hermes` also adds that folder to Hermes Agent's own settings, so a bare `skill install`
leaves Hermes out. `pbx office mcp serve` serves the profile's commands over MCP, on stdin and stdout:

```sh
claude mcp add pbx -- pbx office mcp serve
```

The server offers every command but `session start` and `session end`. The profile's permissions decide what runs;
see [settings](configuration.md#permissions). Text from a call — a transcript, a caller name, a number — reaches the
agent marked as untrusted data.

For ChatGPT and Claude in the browser,
`pbx office mcp serve --http --public-url https://laptop.example.ts.net` serves on `127.0.0.1` (port 8765, or
`--port`) behind your own tunnel. A browser app logs in with a one-time code that the command prints;
`pbx office mcp revoke` ends every login.
