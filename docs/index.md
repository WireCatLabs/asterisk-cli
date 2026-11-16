# Asterisk

A company's phone calls hold what clients asked for and what employees promised, but on an Asterisk phone system
they sit in a call log and a folder of recordings that no AI agent can read. `pbx`, the WireCat command-line tool for
Asterisk, reads them where they are and keeps each call on your computer, with what became of it and what was said.

Your agent can then prepare you for a callback, list the calls nobody returned, report a week of calls by employee,
find the calls where a client was unhappy, and quote the call behind every answer. Each call sits next to the same person's chats, mail and CRM deals, because
all WireCat tools keep their data in one local store.

**On this page:**

1. [What you can do](#what-you-can-do)
2. [How it fits with the rest of WireCat](#how-it-fits-with-the-rest-of-wirecat)
3. [What it does not do yet](#what-it-does-not-do-yet)
4. [Where to start](#where-to-start)

## What you can do

- **See each call as one call.** A ring group, a queue or a transfer writes several records; you get one call with
  its outcome (answered, voicemail, busy, not answered), who answered, how long the caller waited and talked.
- **Read what was said.** Recordings are turned into text on your computer. No recording or transcript leaves it,
  unless you turn on cloud transcription for one profile.
- **Count the calls.** `stats calls show` gives the calls by direction and outcome, per employee, by hour and by day,
  and the missed calls with whether the client was called back.
- **Find a call by what was said.** `search meetings` finds the calls by their words, or by their meaning with a text
  model on your computer: "a client unhappy with the delivery" finds a call where nobody said those words.
- **Mark calls.** `tags add complaint --matching "refund"` marks every call the search finds. Run it again after new
  calls are transcribed, and it marks only those.
- **Know who called.** A caller whose mobile number is in your CRM or your chats is the same person there. An office
  that serves several countries lists them, and a number that could belong to two of them is never guessed.
- **Hand the work to an agent.** Callbacks, missed calls and the day by employee become requests in plain words; the
  agent answers from the local store and shows its sources. [Use it](usage.md) has the requests.
- **Keep the phone system untouched.** `pbx` only reads: a database user that may only read, a file, or a folder over
  SFTP with a pinned server key. Nothing is installed on the phone system, and it works with plain Asterisk as well as
  FreePBX, Issabel and VitalPBX.

## How it fits with the rest of WireCat

- **Memo** answers questions about one person or project across calls, chats, mail and notes.
- **The CRM tools**, such as Bitrix24's `b24`, bring contacts and deals, so a caller's calls appear beside their
  deal.
- **The messenger tools** (`tg`, `max`, `wa`) bring the chats with the same people.
- **WireCat Desktop** connects the phone system in a form, keeps the sync on a timer and shows the calls with their
  recordings.
- **Your agent** reaches it from a terminal with the tool's skill, or from an app over MCP, with each command allowed,
  asked or denied per profile. Words said on a call reach the agent as data, never as instructions.

## What it does not do yet

- **Summaries.** Your agent reads a transcript and writes the summary. `pbx` writes none of its own.
- **Playing a recording over SFTP.** WireCat Desktop plays a call's recording on the call's card when the
  recordings folder is on this computer. When `pbx` reads the recordings over SFTP, the file stays on the phone
  system, and the card cannot play it. There is no link that plays a recording in a browser.
- **Who said what in a mono recording.** A stereo recording names the caller and the employee on each line when you
  set [`recordings_channels`](installation.md#transcribe). A mono recording, one mixed track, gives the text without
  names.
- **Long recordings.** A recording longer than one hour is not transcribed. The call is listed with the reason, and
  the rest go on.
- **Recognition quality.** The result depends on the recording and the model. A noisy line or a call in two
  languages gives weaker text.

[Compared with other tools](compare.md) puts these next to FreePBX's own tools, Frogman and asterisk-ai-call-notes.

## Where to start

- **New here:** [install and connect](installation.md), in WireCat Desktop or from a terminal.
- **Already connected:** [use it](usage.md), with requests for your agent and a schedule.
- **Something went wrong:** [troubleshooting](troubleshooting.md).
