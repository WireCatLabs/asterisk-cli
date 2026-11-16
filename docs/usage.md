# Use it

You have [connected your Asterisk](installation.md), and the calls are in the WireCat store. Here you will find the
everyday work a team can hand to an AI agent with them: getting ready for a callback, catching the calls nobody
answered, a report of the week, finding the calls where a client was unhappy, marking the calls about refunds, and
passing the calls to another system. Each task has a request you can copy, and
[Run it on a schedule](#run-it-on-a-schedule) shows how to make it happen every day without you.

**On this page:**

1. [What you get from each call](#what-you-get-from-each-call)
2. [Ask your agent](#ask-your-agent)
3. [A report of the week](#a-report-of-the-week)
4. [Find calls by what was meant](#find-calls-by-what-was-meant)
5. [Mark every call about refunds](#mark-every-call-about-refunds)
6. [Run it on a schedule](#run-it-on-a-schedule)
7. [Find and read calls yourself](#find-and-read-calls-yourself)
8. [Output for scripts](#output-for-scripts)
9. [Agents](#agents)

## What you get from each call

A ring group, a queue or a transfer writes several records for one call. You see it as one call, with:

- **What became of it:** answered, voicemail, busy or not answered, in one sentence an agent can read:

  ```text
  Incoming call to 600: answered by 101 Анна Смирнова after 0:03, talk 0:24. 102 Борис Кузнецов did not answer.
  Incoming call to 600: went to voicemail after ringing 101 Анна Смирнова, 102 Борис Кузнецов.
  ```

- **The people:** the caller, the employee who placed the call and each one who answered. Employees are named from
  the caller ID of the calls they make. `memo context` and WireCat Desktop show each call's direction, the employee
  and the caller's number.
- **The same person everywhere:** a caller whose mobile number is in your CRM or your chats is the same person
  there, so their calls sit next to their deals, messages and mail. A landline is only proposed as a match, since
  many people share one office number.
- **What was said:** the recording, turned into text on your computer. No recording goes to a service unless you
  turn on [cloud transcription](installation.md#cloud-transcription) for the profile.

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

## A report of the week

`stats calls show` counts the stored calls: by direction and outcome, per employee, by hour and by day. It also
lists the missed incoming calls and says whether someone called the client back within a day. It reads only the
local store, so it is fast and needs no connection to the phone system.

```sh
pbx office stats calls show --since-time 7d --timezone Europe/Moscow
```

`--timezone` is the zone that hours and days are counted in; without it, this computer's zone. `--within 2h` changes
how soon a callback must come to count.

```text prompt
Use pbx CLI. Make a report of last week's calls from pbx office stats calls show: the calls per day, the share
answered, each employee's answered calls and talk time, the busiest hours, and the missed calls nobody returned,
with the number and the time. Show it as tables, then list the three things to fix first.
```

## Find calls by what was meant

`search meetings` finds a call by the words said in it. With `--model`, it also finds a call by its meaning: a
request for "a client unhappy with the delivery" can find a call where the client said "the courier came three days
late", with no word in common. The text model runs on this computer, so no transcript leaves it.

Download the text model once, and build the search data for the calls you have:

```sh
pbx models download embeddinggemma
pbx office meetings embed            # shows what it would do, and changes nothing
pbx office meetings embed --yes      # builds one batch; run it again until nothing is left
pbx office search meetings "a client unhappy with the delivery" --model embeddinggemma
```

A hit says how it was found, by words or by meaning, and quotes the passage of the transcript. A search with
`--model` also builds the data for the calls transcribed since the last `meetings embed`, so it never misses a new
call, but it is faster when [the schedule](#run-it-on-a-schedule) runs `meetings embed --yes`.

```text prompt
Use pbx CLI. Find this month's calls where a client was unhappy with the delivery, search by meaning with
--model embeddinggemma. For each call give the date, the client's number, what went wrong in their words, and
whether we promised anything. Quote the passage behind each line.
```

## Mark every call about refunds

`tags add` puts a mark on calls: on every call a search finds with `--matching`, or on the calls you name with
`--meeting`. `--matching` takes the same words as `search meetings`, with `OR` between alternatives.

```sh
pbx office tags add refund --matching "refund OR возврат"
pbx office tags add vip --meeting 42
pbx office tags list tag:refund
pbx office search meetings "delivery" --tag refund
```

A second run marks only the calls that are new since the first, and the answer lists what changed. A mark stays when
a call is transcribed again. Memo and the other WireCat tools see the same marks. `tags remove refund --meeting 42`
takes a mark off.

```text prompt
Use pbx CLI. Mark every call about a refund with the tag refund, using tags add --matching. Then list the marked
calls of this week with the client, the amount if they said one, and whether the refund was agreed.
```

## Run it on a schedule

The calls stay current when the sync, the transcription and the marks run on their own, for example every fifteen
minutes from cron:

```sh
*/15 * * * * pbx office meetings sync && pbx office meetings transcribe --max-meetings 20 && pbx office tags add refund --matching "refund OR возврат" && pbx office meetings embed --yes
```

Each step works on what is new since the last run: new calls, new recordings, new transcripts. `meetings embed --yes`
keeps the search by meaning fast; leave it out if you search only by words.

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
