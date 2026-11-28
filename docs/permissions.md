# Permissions

Let an AI agent work with your calls and keep the say over what it may do. `pbx` never changes the phone system, but
an agent could still send recordings to a cloud speech service or change the marks on your calls.

For each profile, the name you gave one phone system, you decide what an agent may run, what asks you first and what
it may not touch. You can keep every recording on your computer whatever the agent asks, or let it read calls and
nothing else.

Each command has a permission key, its path such as `meetings.transcribe`, or a group such as `tags`, where the
longer key wins. Each key has a level: `deny`, `readonly`, `ask` or `allow`. `pbx office config set` sets them, and
`--dry-run` shows which keys a command checks.

**On this page:**

1. [The levels](#the-levels)
2. [What is set before you change anything](#what-is-set-before-you-change-anything)
3. [Agents and MCP](#agents-and-mcp)
4. [Checks that hold whatever the permissions say](#checks-that-hold-whatever-the-permissions-say)

## The levels

| Level | What happens |
|---|---|
| `deny` | The command is refused, a read too. |
| `readonly` | Reads work. A command that changes something is refused. |
| `ask` | The command asks first at a terminal. Without one it is refused unless `--yes` is given. **Over MCP it runs.** |
| `allow` | The command runs without a question. |

```sh
pbx office config set permissions.meetings.transcribe deny   # no recording is transcribed through this profile
pbx office config set permissions.tags readonly              # marks can be read, never added or removed
pbx office config show                                       # each setting with where it came from
```

A refusal is `permission_error` (exit code 5) and names the key. It does not mean the connection to the phone system
is broken.

## What is set before you change anything

| Key | Built-in level | Why |
|---|---|---|
| `models.download`, `models.add` | `ask` | A model is a large download from the internet. |
| `doctor.reports.create` | `ask` | A problem report is a file you may send to someone. |
| `mcp.authority` | `deny` | An agent that changes settings could lift its own limits. |
| Every other command | `allow` | `pbx` only reads the phone system. |

## Agents and MCP

Over MCP nobody is at a terminal to answer `ask`, so a command at `ask` goes ahead. Set `readonly` or `deny` for
each command the agent must not run before you connect it, as [MCP](mcp.md#keep-the-agent-to-what-you-want) shows.

The commands that change what a later run may do, such as `config set`, `config unset` and `skill install`, are not
offered over MCP while `mcp.authority` is `deny`. An agent then cannot change a permission or a setting for you.

## Checks that hold whatever the permissions say

- **The phone system is only read.** Master.csv and the recordings are opened for reading, and a database session is
  opened read-only and sends only a `SELECT`. See [security](security.md).
- **Cloud transcription is a choice for one profile.** `transcribe_engine` is read from the profile's own settings
  only, so a value in `defaults` sends no profile's recordings away.
- **`PBX_READ_ONLY=1`** refuses every command that changes your sign-in or settings.
- **No password reaches the agent.** `session start` and `session end` are never offered over MCP.
