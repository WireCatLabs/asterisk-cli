# Use it

You have [connected your Asterisk](installation.md), and the calls are in the WireCat store. Here you will find the
everyday work a team can hand to an AI agent with them: getting ready for a callback, catching the calls nobody
answered, reviewing a day of calls by employee, and passing the calls to another system. Each task has a request you
can copy, and [Run it on a schedule](#run-it-on-a-schedule) shows how to make it happen every day without you.

**On this page:**

1. [What you get from each call](#what-you-get-from-each-call)
2. [Ask your agent](#ask-your-agent)
3. [Run it on a schedule](#run-it-on-a-schedule)
4. [Find and read calls yourself](#find-and-read-calls-yourself)
5. [Output for scripts](#output-for-scripts)
6. [Agents](#agents)

## What you get from each call

A ring group, a queue or a transfer writes several records for one call. You see it as one call, with:

- **What became of it:** answered, voicemail, busy or not answered, in one sentence an agent can read:

  ```text
  Incoming call to 600: answered by 101 Анна Смирнова after 0:03, talk 0:24. 102 Борис Кузнецов did not answer.
  Incoming call to 600: went to voicemail after ringing 101 Анна Смирнова, 102 Борис Кузнецов.
  ```

- **The people:** the caller, the employee who placed the call and each one who answered. Employees are named from
  the caller ID of the calls they make.
- **The same person everywhere:** a caller whose mobile number is in your CRM or your chats is the same person
  there, so their calls sit next to their deals, messages and mail. A landline is only proposed as a match, since
  many people share one office number.
- **What was said:** the recording, turned into text on your computer, with no recording sent to any service.

## Ask your agent

Requests start with "Use pbx CLI" for an agent with a terminal, such as Claude Code or Codex. In an app connected
over [MCP](#agents), name the connected tool instead.

**Before you call a client back.** The agent reads the client's calls, what was said in them, and what they wrote in
chats or mail:

```text prompt
Use pbx CLI and memo. What did +7 916 123-45-67 call us about this month, what did we promise them, and did they
write to us anywhere else? Quote the calls and messages you rely on.
```

**Calls nobody answered.** The agent lists the incoming calls that went to voicemail or were not answered, and
checks each against the calls after it:

```text prompt
Use pbx CLI. List today's incoming calls that nobody answered or that went to voicemail, with the number and the
time. For each, say whether we called the number back or they reached someone later, and list the ones still open.
```

**A day of calls by employee.** The agent counts from the outcome of each call:

```text prompt
Use pbx CLI. For yesterday's calls, give each employee the calls they answered, the calls that rang them and were
not answered, their total talk time and the longest wait before they picked up. Show it as a table.
```

**What a call was about.** The agent reads the transcript and writes a summary:

```text prompt
Use pbx CLI. Read the transcript of the longest call with Ольга Новикова this week. Summarise what she asked for,
what was agreed and what we still owe her.
```

Each answer comes from the local store, and the agent can show the call behind every line. When a call has no
transcript yet, the agent says so and can [transcribe](installation.md#transcribe) it.

## Run it on a schedule

The calls stay current when the sync and the transcription run on their own, for example every fifteen minutes from
cron:

```sh
*/15 * * * * pbx office meetings sync && pbx office meetings transcribe --max-meetings 20
```

A request like the ones in [Ask your agent](#ask-your-agent) can run on a schedule too, in an agent that runs tasks
on a timer: every evening the list of calls still not returned, or every Monday the week by employee. WireCat Desktop
keeps the sync on a timer without cron: **Sync on a schedule** on the account.

## Find and read calls yourself

A profile is the name you gave the phone system, the first word of every command. No profile is ever assumed, not
even the only one: a command without one stops and lists the profiles on this computer. `PBX_PROFILE=office` sets it
for one shell session.

```sh
pbx office meetings sync                                  # import what is new
pbx office meetings list "started_at>=2026-11-01"          # newest first
pbx office meetings list "title:*79161234567*"             # the calls of one number
pbx office meetings show 42                                # times, people, recording
pbx office meetings transcript 42                          # what was said
pbx office meetings export 42 --format vtt --output call-42.vtt
```

A call's title is its two sides, `+79161234567 → 101`. `pbx office meetings list --help` lists the fields a query
takes, and `meetings export` saves a call as Markdown or its transcript as WebVTT.

## Output for scripts

Every command except `mcp serve` on stdin and stdout takes `--json`, and prints one JSON value on stdout;
`meetings list --jsonl` prints one call per line, with its description, for another system to read. Errors are JSON
on stderr, with a code and a reason to branch on. The [command reference](commands.md) lists the codes.

## Agents

`pbx skill install` puts the tool's skill where Claude Code, Codex, Gemini CLI and OpenClaw look for it.
`pbx skill install --for hermes` also adds that folder to Hermes Agent's own settings, so a bare `skill install`
leaves Hermes out. `pbx office mcp serve` serves the profile's commands over MCP, on stdin and stdout:

```sh
claude mcp add pbx -- pbx office mcp serve
```

The server offers every command but `session start` and `session end`. The profile's permissions decide what runs;
see [settings](configuration.md#permissions). Text from a call — a transcript, a caller name, a number — reaches the
agent marked as untrusted data, so words said on a call cannot instruct the agent.

For ChatGPT and Claude in the browser,
`pbx office mcp serve --http --public-url https://laptop.example.ts.net` serves on `127.0.0.1` (port 8765, or
`--port`) behind your own tunnel. A browser app logs in with a one-time code that the command prints;
`pbx office mcp revoke` ends every login.
