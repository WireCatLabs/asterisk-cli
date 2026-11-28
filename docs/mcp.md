# MCP

Give your phone system's calls to an AI agent that cannot run commands, such as Claude Desktop, Cursor, or ChatGPT and
Claude in the browser. MCP (Model Context Protocol) is the way such an agent asks a program what it can do and then
calls it, and `pbx` serves its commands that way.

The agent then finds calls, reads their transcripts and counts the week by employee, quoting the call behind every
answer. It can also import new calls, transcribe them and mark them, as far as the profile's permissions allow.

`pbx office mcp add` adds the server to Claude Code or Codex, and `pbx office mcp config` prints the entry for any
other client. An agent with a terminal, such as Claude Code or Codex, does better with the commands and the skill
(`pbx skill install`). You need a [connected profile](installation.md), and a look at [permissions](permissions.md)
first: over MCP a command at `ask` goes ahead.

**On this page:**

1. [Add pbx to an agent](#add-pbx-to-an-agent)
2. [What the agent sees](#what-the-agent-sees)
3. [Keep the agent to what you want](#keep-the-agent-to-what-you-want)
4. [ChatGPT and Claude in the browser](#chatgpt-and-claude-in-the-browser)

## Add pbx to an agent

```sh
pbx office mcp add claude-code --allow-writes   # or codex
pbx office mcp check                            # the handshake and the tool list, as the client sees them
```

`--allow-writes` says you know the profile offers commands that change something, such as `tags add`. For Claude Desktop, Cursor and other clients, `pbx office mcp config` prints the `mcpServers` entry to
paste into their settings, with full paths, and writes nothing. By hand, for Claude Code:

```sh
claude mcp add pbx -- pbx office mcp serve
```

One server can serve several phone systems: `pbx mcp serve --profiles office,warehouse`, or `--profiles all`. Each
call then names its profile.

## What the agent sees

The server has three tools:

- `pbx_tools_search` finds a command by words, with its arguments and whether this profile lets it run.
- `pbx_read` runs a command that only reads: `{ "command": "meetings list", "arguments": { "query": "title:*79161234567*" } }`.
- `pbx_write` runs a command that changes something on this computer, such as `tags add`.

A command is named as on the command line, without the profile, and checks the same permission key. `session start`
and `session end` are never offered: the agent asks you to run them in a terminal. The commands that change what a
later run may do, such as `config set` and `skill install`, are refused unless `permissions.mcp.authority` is `ask`
or `allow`. It is `deny` until you change it.

Text from a call reaches the agent marked as untrusted data: a transcript, a caller name, a number. Words said on a
call cannot instruct the agent.

## Keep the agent to what you want

`pbx` never changes the phone system, so an agent can only change things on your computer. Two of them still matter:

- `meetings transcribe` sends the speech of each recording to OpenAI when the profile has `transcribe_engine openai`.
- `tags add` and `tags remove` change the marks that Memo and the other WireCat tools see.

Over MCP nobody is at a terminal to answer `ask`, so set `readonly` or `deny` for each command the agent must not
run:

```sh
pbx office config set permissions.meetings.transcribe deny
```

To make one server stricter than the profile, give it its own levels. They never loosen the profile:

```sh
pbx office mcp add claude-code --allow-writes --permission tags=readonly
pbx office mcp serve --permission meetings.transcribe=deny
```

## ChatGPT and Claude in the browser

A browser app reaches the server over HTTP through your own tunnel, such as Tailscale Funnel:

```sh
pbx office mcp serve --http --public-url https://laptop.example.ts.net
```

The server listens on `127.0.0.1` only, port 8765 (`--port` changes it). A browser app logs in with a one-time code
the command prints. `pbx office mcp revoke` ends every login.

`pbx office mcp server start` runs the same server in the background. `mcp server status` shows its port, the login
code and the apps logged in, and `mcp server stop` ends it.

More: [permissions](permissions.md), [security](security.md#the-mcp-server), [the command reference](commands.md#pbx-mcp).
