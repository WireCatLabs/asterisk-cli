# Asterisk

Know what every client asked for on the phone and which calls nobody returned, without listening to a single
recording. `pbx` gives the AI agent you already use, such as Claude Code or Codex, the calls of your Asterisk phone
system: each call on your computer, with what became of it and what was said, turned into text there.

Your agent can then prepare you for a callback, list the missed calls, report a week of calls by employee and find
the calls where a client was unhappy, quoting the call behind every answer. It works with plain Asterisk, FreePBX,
Issabel and VitalPBX, and installs nothing on the phone system.

**On this page:**

1. [What you get](#what-you-get)
2. [Things a newcomer would not guess](#things-a-newcomer-would-not-guess)
3. [How it looks](#how-it-looks)
4. [Why pbx](#why-pbx)
5. [What it can do](#what-it-can-do)
6. [With your other WireCat tools](#with-your-other-wirecat-tools)
7. [How it works](#how-it-works)
8. [Start](#start)
9. [Limits](#limits)
10. [Find a guide for your task](#find-a-guide-for-your-task)

## What you get

- **Each call as one call.** A ring group, a queue or a transfer writes several records. You get one call with its
  outcome, who answered, and how long the caller waited and talked.
- **Calls you can read.** Recordings become text on your computer. No recording or transcript goes to a speech service,
  unless you turn on cloud transcription for one profile.
- **No missed client forgotten.** Missed calls come with whether someone called back, next to the calls by employee,
  hour and day.
- **A call found by what was said.** "A client unhappy with the delivery" finds a call where nobody said those words.
- **Calls marked for you.** Mark every call about refunds once, and the next run marks only the new ones.
- **The caller recognised.** A caller whose mobile number is in your CRM or your chats is the same person there.
- **The phone system untouched.** `pbx` only reads: a database user that may only read, a file, or a folder over
  SFTP.

## Things a newcomer would not guess

- **`office` is a name you choose.** It names one phone system, and it is the first word of every command. No command
  picks a phone system for you.
- **It reads the call log, not live calls.** Asterisk writes a record of each finished call, the call detail record
  or CDR. `pbx` reads those records and the recordings.
- **The first sync reads 30 days back.** Each later sync reads only what is new, and a call is never stored twice.
  Ask for an earlier date when you want more.
- **Recordings become text on your computer** with a speech model you download once. Cloud transcription is a choice
  you make for one profile.
- **Over MCP, "ask" goes ahead.** MCP is the way apps such as Claude Desktop call a tool, and nobody sits there to
  answer a question. Set what an agent must not do to read only or refuse before you connect it
  ([permissions](permissions.md)).

## How it looks

```text
You:    Which calls did nobody return on 31 October?
Agent:  (runs pbx office stats calls show --since-time 2026-10-31 --until-time 2026-10-31)
        One: +7 900 000-00-03 at 14:00, call 3. It rang Oleg Operatorov on 101, and nobody called back.
You:    Mark every call about a refund as a complaint.
Agent:  (runs pbx office tags add complaint --matching "refund")
        Done. The next run marks only the new calls.
```

## Why pbx

- **Recordings stay with you.** Speech is recognised on your computer. FreePBX's Scribe module sends recordings to
  Deepgram, a cloud speech service, as the [comparison](compare.md) shows.
- **No root login, nothing installed on the phone system.** Frogman's MCP setup connects to the PBX over SSH as root.
  `pbx` runs on your computer with a user that may only read.
- **One caller across calls, chats, mail and the CRM.** No other tool on the comparison documents it.
- **Works without FreePBX.** FreePBX's own tools and Frogman need FreePBX. `pbx` reads plain Asterisk too.
- **A permission on every command.** Allow, ask, read only or refuse, for each profile.
- **Free and open source.** Apache 2.0.

Another tool fits better when you want summaries and sentiment inside FreePBX's own portal and a cloud service is
fine (FreePBX with Scribe), or an agent that changes the phone system itself, such as ring groups and routes
(Frogman).

## What it can do

- **List and read calls:** by time, duration or number, one call with its recording and transcript, and an export to
  Markdown or WebVTT subtitles. [Use it](usage.md)
- **Transcribe:** every new recorded call, newest first, with each line named by caller or employee when the recording
  is stereo. [Install and connect](installation.md)
- **Count:** calls by direction and outcome, per employee, by hour and by day, and the missed calls with their
  callbacks. [Use it](usage.md)
- **Search and mark:** by words or by meaning, and a tag on every call the search finds. [Use it](usage.md)
- **Agents:** a skill for agents with a terminal, and an MCP server for Claude Desktop, Cursor and other apps.
  [MCP](mcp.md)

## With your other WireCat tools

- **Memo** answers questions about one person across calls, chats, mail and notes.
- **The CRM tools**, such as Bitrix24's `b24`, bring contacts and deals, so a caller's calls appear beside their deal.
- **WireCat Desktop** connects the phone system in a form, keeps the sync on a timer and plays a call's recording when
  the recordings folder is on your computer.

## How it works

- **A copy on your computer.** `meetings sync` reads the call records and links their recordings in the WireCat local
  store that every WireCat tool shares.
- **Three places Asterisk keeps calls.** `Master.csv`, MySQL or MariaDB, and PostgreSQL. A database password is kept
  in your system keyring.
- **Made for scripts and agents.** `--json` gives a JSON answer. Words said on a call reach the agent as data, never
  as instructions.
- **What is stored, and the consent a recording may need.** [Security](security.md)

## Start

Connect it in [WireCat Desktop](https://wirecat.dev/en/docs/desktop) with a form, or paste this into your agent:

```text prompt
Install pbx with npm install -g @wirecat/asterisk-cli. Help me connect our Asterisk call log and recordings as the profile office, sync the last 30 days and transcribe the new calls.
```

Or in a terminal, on a computer that can read the call log and the recordings:

```sh
npm install -g @wirecat/asterisk-cli
pbx office config set cdr_csv_path /var/log/asterisk/cdr-csv/Master.csv
pbx office config set recordings_path /var/spool/asterisk/monitor
pbx office config set cdr_timezone Europe/Moscow    # the phone system's time zone
pbx office config set phone_region ru               # the country of numbers written without +
pbx office session start          # checks the source
pbx office meetings sync          # the last 30 days of calls
pbx models download gigaam-v3     # the local Russian speech model, once
pbx office meetings transcribe    # up to 20 recorded calls
```

You need Node.js 22.16 or a later 22.x, or Node.js 24 or later. To turn WAV, GSM or M4A recordings into text, you also need `ffmpeg`. A database or SFTP connection instead
of local files: [install and connect](installation.md).

## Limits

- **No summaries of its own.** Your agent reads a transcript and writes the summary.
- **Playing a recording.** WireCat Desktop plays it when the recordings folder is on your computer. A recording read
  over SFTP stays on the phone system, and no link plays a recording in a browser.
- **Who said what in a mono recording.** A stereo recording names the caller and the employee on each line when you
  set [`recordings_channels`](installation.md#transcribe). A mono recording gives the text without names.
- **Long recordings.** A recording longer than one hour is not transcribed. The call is listed with the reason, and
  the rest go on.
- **Recognition quality** depends on the recording and the model. A noisy line or a call in two languages gives weaker
  text.

## Find a guide for your task

| Task | Guide |
|---|---|
| Install and connect, in WireCat Desktop or a terminal | [Install and connect](installation.md) |
| Requests for your agent, and a schedule | [Use it](usage.md) |
| Every command and option | [Commands](commands.md) |
| Connect an app such as Claude Desktop | [MCP](mcp.md) |
| What an agent may do | [Permissions](permissions.md) |
| Every setting | [Settings](configuration.md) |
| Something does not work | [When something goes wrong](troubleshooting.md) |
| What is stored, and recordings and consent | [Security](security.md) |
| How pbx differs from other Asterisk tools | [Compared with other tools](compare.md) |
| What comes next | [Roadmap](roadmap.md) |
