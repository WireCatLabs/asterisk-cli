<!-- Generated from the command tree by pnpm generate. Do not edit. -->

# Commands

Every command, option and exit code, generated from the program itself. For the same list as JSON, run
`asterisk commands --json`.

**The first word is the profile**, a name you choose: `asterisk personal config show`. `ASTERISK_PROFILE`
does the same for a whole shell session. No profile is assumed: a command that uses an account stops without one and
lists the profiles on this computer.

## Options for every command

| Option | What it does |
|---|---|
| `-V, --version` | output the version number. |
| `-v, --verbose` | more detail in what is shown: -v ids, -vv everything we know. Default: `0`. |
| `--json` | machine-readable output: one JSON value on stdout; --json=id,text keeps only those fields. |
| `--jsonl` | machine-readable output: one JSON object per line, for streaming and jq. |
| `--quiet` | diagnostics off; a failure is still said. |
| `--trace` | the connection's own log lines on stderr — never content. |
| `--debug` | on a failure, its whole record — cause and stack — in place of the short line. |
| `--timeout <duration>` | give up on the whole command after this — 30s, 2m, 500ms. |
| `--offline` | answer from what was recorded and never connect; fails if nothing was. |
| `--no-input` | never prompt or open interactive login; piped input remains available. |
| `--max-input-bytes <bytes>` | maximum buffered input bytes (default: 16777216). |
| `--max-output-bytes <bytes>` | maximum machine output bytes (default: 4194304; 0 disables). |
| `--brief` | found items as reference, title, time, author and excerpt only. |
| `--full` | found items with their whole text and every provider field. |
| `--compact` | one line per item for an agent: reference first, text last, paging and next steps as # lines. |
| `--dry-run` | preview parsed arguments and permissions before running the action. |
| `--yes` | go ahead without the question an ask level puts before a write. |
| `--record` | keep this run even where the config says record false; record_input false leaves the typed words out. |
| `--no-record` | do not keep this run, even if it fails. |

## `asterisk commands`

every command by section; --json prints its contract, one path per call

### `asterisk commands info`

one command contract, or all schemas, error reasons and explicit overrides

```sh
asterisk commands info [path]
```

| Argument | | What it is |
|---|---|---|
| `path` | optional | one command path; without one, export schemas, error reasons and explicit overrides. |

**Returns:** one command contract, or all schemas, error reasons and explicit overrides

**Example:** `asterisk commands info commands`

## `asterisk session`

keep this profile's Example Comments token in the OS keyring

### `asterisk session start`

sign this profile in: the Example Comments API token is asked hidden or read from stdin, never taken as an argument, checked against the service, and only then kept in the keyring, or in a private file

**Changes something on this computer only.**

```sh
asterisk session start [options]
```

| Option | What it does |
|---|---|
| `--credential-storage <storage>` | where the token is kept: keyring, which falls back to a private file by itself, or file. Default: `keyring`. |

**Returns:** sign in to Example Comments with an API token

**Example:** `asterisk personal session start`, `asterisk personal session start --credential-storage file`

### `asterisk session status`

show where this profile's token comes from: ASTERISK_TOKEN, the keyring or a file, never the token; --check asks Example Comments whose token it is

```sh
asterisk session status [options]
```

| Option | What it does |
|---|---|
| `--check` | ask Example Comments whether the token still works, and whose it is. |

**Returns:** show where this profile's token comes from; never the token

**Example:** `asterisk personal session status`, `asterisk personal session status --check --json`

### `asterisk session end`

forget this profile's token on this computer; the token itself stays valid in Example Comments

**Changes something on this computer only.**

```sh
asterisk session end
```

**Returns:** forget this profile's token on this computer

**Example:** `asterisk personal session end`

### `asterisk session list`

list the profiles on this computer and whether each has a token; picks none

```sh
asterisk session list
```

**Returns:** list the profiles here and whether each is signed in

**Example:** `asterisk session list`, `asterisk session list --json`

## `asterisk comments`

read and write comments in Example Comments, the sample service

### `asterisk comments list`

list the comments in Example Comments, newest first

```sh
asterisk comments list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** comment — id, text, author, created_at; every field: asterisk commands info comments list

**Example:** `asterisk personal comments list`, `asterisk personal comments list author:u2 --json=id,text`

### `asterisk comments show`

show one comment in Example Comments

```sh
asterisk comments show <id>
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the comment's id, as list prints it. |

**Returns:** comment — id, text, author, created_at; every field: asterisk commands info comments show

**Example:** `asterisk personal comments show c1`, `asterisk personal comments show c1 --json`

### `asterisk comments create`

post a comment in Example Comments

**Changes something in the service.**

```sh
asterisk comments create [options]
```

| Option | What it does |
|---|---|
| `--text <text>` | the comment's text. |

**Returns:** post a comment in Example Comments

**Example:** `asterisk personal comments create --text "Looks good to me"`, `asterisk personal comments create --text "Looks good to me" --dry-run`

### `asterisk comments update`

change the text of your comment in Example Comments

**Changes something in the service.**

```sh
asterisk comments update <id> [options]
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the comment's id, as list prints it. |

| Option | What it does |
|---|---|
| `--text <text>` | the new text. |

**Returns:** change the text of your comment in Example Comments

**Example:** `asterisk personal comments update c1 --text "Looks good now"`

## `asterisk doctor`

the state this installation is in, without connecting unless --online

```sh
asterisk doctor [options]
```

| Option | What it does |
|---|---|
| `--online` | also connect once and read the account; sends nothing. |

**Returns:** the state this installation is in, without connecting unless --online

**Example:** `asterisk doctor`, `asterisk doctor --json`

## `asterisk skill`

the instructions an agent is given for this tool

### `asterisk skill show`

print SKILL.md — `asterisk skill install` puts it where Claude Code, Codex, Gemini CLI and OpenClaw look for it, and where Hermes does on request; --for prints the copy already there

```sh
asterisk skill show [options]
```

| Option | What it does |
|---|---|
| `--for <agents>` | print the copy installed for these agents instead of this version's. One of: `claude`, `agents`. |

**Returns:** print the tool's instructions for AI agents

**Example:** `asterisk skill show`

### `asterisk skill install`

write SKILL.md to \~/.claude/skills/asterisk-cli/ (Claude Code) and \~/.agents/skills/asterisk-cli/ (Codex, Gemini CLI, OpenClaw); --for hermes also has Hermes read \~/.agents/skills, which changes Hermes's own settings, so all leaves it out

**Changes something on this computer only.**

```sh
asterisk skill install [options]
```

| Option | What it does |
|---|---|
| `--for <agents>` | which agents to install for. One of: `claude`, `agents`, `hermes`, `all`. Default: `all`. |

**Returns:** install the tool's instructions for AI agents

**Example:** `asterisk skill install --for agents`

### `asterisk skill status`

for each place `asterisk skill install` writes to, and for the copy Hermes reads: the path, the version installed there, and whether it is current, stale, missing or unversioned

```sh
asterisk skill status
```

**Returns:** whether the installed instructions for AI agents match this version

**Example:** `asterisk skill status`, `asterisk skill status --json`

## `asterisk mcp`

serve this profile to an agent over MCP and set it up — `claude mcp add asterisk -- asterisk <profile> mcp serve`

### `asterisk mcp serve`

serve this profile to an agent over MCP, on stdin and stdout — `claude mcp add asterisk -- asterisk <profile> mcp serve`; `asterisk mcp serve --profiles a,b` or `--profiles all` serves those profiles from one server and each tool asks which

**Changes something in the service.**

```sh
asterisk mcp serve [options]
```

| Option | What it does |
|---|---|
| `--permission <key=level>` | make a permission stricter for this server only, like comments.create=deny; it never loosens the profile; repeat for more keys. |
| `--profiles <names\|all>` | serve several profiles from one server instead of one: names, comma-separated, or all for every profile. |
| `--http` | serve over HTTP on 127.0.0.1 for ChatGPT and Claude in the browser, behind your tunnel; the profile's permissions decide. |
| `--port <port>` | the local port for --http (default 8765). |
| `--public-url <url>` | the tunnel's https address the browser apps use, e.g. https://<name>.ts.net or https://<name>.ts.net/tg. |

**Returns:** serve this profile's commands to an AI agent

**Example:** `asterisk personal mcp serve`, `asterisk mcp serve --profiles work,personal`, `asterisk personal mcp serve --http --public-url https://laptop.example.ts.net`

### `asterisk mcp revoke`

forget every login `mcp serve --http` gave a browser app, of this profile or of the server `--profiles` names; each app must log in again

**Changes something on this computer only.**

```sh
asterisk mcp revoke [options]
```

| Option | What it does |
|---|---|
| `--profiles <names\|all>` | serve several profiles from one server instead of one: names, comma-separated, or all for every profile. |

**Returns:** forget every login given to a browser app

**Example:** `asterisk personal mcp revoke`, `asterisk mcp revoke --profiles all`

### `asterisk mcp server`

start, stop and check `mcp serve --http` in the background; status shows the login code for a browser app

#### `asterisk mcp server start`

start `mcp serve --http` apart from this shell and answer once it listens, with its login code

**Changes something on this computer only.**

```sh
asterisk mcp server start [options]
```

| Option | What it does |
|---|---|
| `--port <port>` | the local port (default 8765). |
| `--public-url <url>` | the tunnel's https address the browser apps use, e.g. https://<name>.ts.net or https://<name>.ts.net/tg. |
| `--permission <key=level>` | make a permission stricter for this server only; repeat for more keys. |
| `--profiles <names\|all>` | the server of several profiles that `mcp serve --profiles` serves: names, comma-separated, or all. |

**Returns:** start the HTTP MCP server in the background

**Example:** `asterisk personal mcp server start --public-url https://laptop.example.ts.net`

#### `asterisk mcp server stop`

stop `mcp serve --http` — only one that `mcp server start` started

**Changes something on this computer only.**

```sh
asterisk mcp server stop [options]
```

| Option | What it does |
|---|---|
| `--profiles <names\|all>` | the server of several profiles that `mcp serve --profiles` serves: names, comma-separated, or all. |

**Returns:** stop the background HTTP MCP server

**Example:** `asterisk personal mcp server stop`

#### `asterisk mcp server status`

whether `mcp serve --http` runs, on which port and address, the login code for a new browser app, and the apps logged in

```sh
asterisk mcp server status [options]
```

| Option | What it does |
|---|---|
| `--profiles <names\|all>` | the server of several profiles that `mcp serve --profiles` serves: names, comma-separated, or all. |

**Returns:** whether the HTTP MCP server runs, its login code and the apps logged in

**Example:** `asterisk personal mcp server status --json`

### `asterisk mcp config`

print the mcpServers entry for Claude Desktop, Cursor and others, with full paths; writes nothing

```sh
asterisk mcp config [options]
```

| Option | What it does |
|---|---|
| `--permission <key=level>` | make a permission stricter for this server only, like comments.create=deny; it never loosens the profile; repeat for more keys. |
| `--profiles <names\|all>` | serve several profiles from one server instead of one: names, comma-separated, or all for every profile. |

**Returns:** print the local MCP configuration of this profile, or of those --profiles names

**Example:** `asterisk personal mcp config`, `asterisk mcp config --profiles all`

### `asterisk mcp add`

add this profile's local MCP server to Codex or Claude Code

**Changes something on this computer only.**

```sh
asterisk mcp add <client> [options]
```

| Argument | | What it is |
|---|---|---|
| `client` | required | codex or claude-code. |

| Option | What it does |
|---|---|
| `--allow-writes` | acknowledge that this profile offers writing tools. |
| `--permission <key=level>` | make a permission stricter for this server only, like comments.create=deny; it never loosens the profile; repeat for more keys. |

**Returns:** add this profile's local MCP server to Codex or Claude Code

**Example:** `asterisk personal mcp add codex --allow-writes`

### `asterisk mcp check`

check this profile's local MCP handshake and tool list

```sh
asterisk mcp check [options]
```

| Option | What it does |
|---|---|
| `--permission <key=level>` | make a permission stricter for this server only, like comments.create=deny; it never loosens the profile; repeat for more keys. |

**Returns:** check this profile's local MCP handshake and tool list

**Example:** `asterisk personal mcp check`

## `asterisk upgrade`

upgrade asterisk with the package manager that installed it; --check only looks

**Changes something on this computer only.**

```sh
asterisk upgrade [options]
```

| Option | What it does |
|---|---|
| `--check` | say whether a newer version exists, and install nothing. |

**Returns:** upgrade asterisk with the package manager that installed it; --check only looks

**Example:** `asterisk upgrade --check`

## `asterisk config`

the settings in force, and where each one came from

### `asterisk config show`

the profile, the profiles that exist, and each setting with where it came from

```sh
asterisk config show
```

**Returns:** the profile, the profiles that exist, and each setting with where it came from

**Example:** `asterisk personal config show`

### `asterisk config set`

save a setting to the configuration file

**Changes something on this computer only.**

```sh
asterisk config set <setting> <value> [options]
```

| Argument | | What it is |
|---|---|---|
| `setting` | required | one of: limit, timeout_ms, color, record, record_input, keep_runs_for_days, keep_successful_runs_for_days, keep_store_runs_for_days, runs_size_limit_mb, permissions, requests_per_minute, search_reranker, embedding_provider, embedding_model, embedding_base_url, embedding_dims, models, update_check, skill_hint, search_stemmers.cyrillic, search_stemmers.latin, owner_languages, crm.<provider>:<account>.links, crm.<provider>:<account>.company-types, crm.<provider>:<account>.scope, crm.<provider>:<account>.unassigned, crm.<provider>:<account>.self. |
| `value` | required | a number, true or false; for a group tg:work,max:Alice,email:me@x. |

| Option | What it does |
|---|---|
| `--defaults` | change what every profile gets, rather than this profile. |

**Returns:** save a setting to the configuration file

**Example:** `asterisk personal config set limit 20`

### `asterisk config unset`

remove a setting from the configuration file

**Changes something on this computer only.**

```sh
asterisk config unset <setting> [options]
```

| Argument | | What it is |
|---|---|---|
| `setting` | required | one of: limit, timeout_ms, color, record, record_input, keep_runs_for_days, keep_successful_runs_for_days, keep_store_runs_for_days, runs_size_limit_mb, permissions, requests_per_minute, search_reranker, embedding_provider, embedding_model, embedding_base_url, embedding_dims, models, update_check, skill_hint, search_stemmers.cyrillic, search_stemmers.latin, owner_languages, crm.<provider>:<account>.links, crm.<provider>:<account>.company-types, crm.<provider>:<account>.scope, crm.<provider>:<account>.unassigned, crm.<provider>:<account>.self. |

| Option | What it does |
|---|---|
| `--defaults` | change what every profile gets, rather than this profile. |

**Returns:** remove a setting from the configuration file

**Example:** `asterisk personal config unset limit`

### `asterisk config migrate`

write each setting the file lacks at its default, keeping yours

**Changes something on this computer only.**

```sh
asterisk config migrate
```

**Returns:** write each setting the file lacks at its default, keeping yours

**Example:** `asterisk config migrate`

### `asterisk config repair`

fix broken JSON syntax in the settings file — comments, a missing or extra comma, unquoted keys, single quotes, missing closing brackets at the end — keeping every value, with a backup beside it; refuses anything with more than one reading and changes nothing then

**Changes something on this computer only.**

```sh
asterisk config repair [options]
```

| Option | What it does |
|---|---|
| `--dry-run` | say what it would fix, and change nothing. |

**Returns:** fix the settings file's JSON syntax, keeping every value

**Example:** `asterisk config repair`, `asterisk config repair --dry-run`

## `asterisk runs`

recorded runs — what this tool did, and when

### `asterisk runs list`

recorded runs, newest first

```sh
asterisk runs list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. Default: `20`. |
| `--page <n>` | which page, starting at 1. Default: `1`. |

**Returns:** run — run_id, command, started_at, status, cli_version, profile, completed_at, requests, and 23 more; every field: asterisk commands info runs list

**Example:** `asterisk personal runs list --limit 10`

### `asterisk runs show`

one run: what it was, how it ended, and every event it logged

```sh
asterisk runs show <run-id> [options]
```

| Argument | | What it is |
|---|---|---|
| `run-id` | required | an id from `asterisk runs list`. |

| Option | What it does |
|---|---|
| `--problems` | only failed responses, warnings and crashes. |

**Returns:** run details — run_id, command, started_at, status, cli_version, directory, event_count, events, and 22 more; every field: asterisk commands info runs show

**Example:** `asterisk personal runs show run-101`

### `asterisk runs path`

the directory holding one run

```sh
asterisk runs path <run-id>
```

| Argument | | What it is |
|---|---|---|
| `run-id` | required | an id from `asterisk runs list`. |

**Returns:** run location — path; every field: asterisk commands info runs path

**Example:** `asterisk personal runs path run-101`

## Exit codes

Branch on the code, not on the text: the text can change, the code does not.

| Code | When |
|---|---|
| `0` | it worked |
| `2` | `validation_error` |
| `3` | `configuration_error` |
| `4` | `authentication_error` |
| `5` | `permission_error` |
| `6` | `not_found` |
| `7` | `confirmation_required` |
| `8` | `rate_limited` |
| `9` | `timeout` |
| `10` | `network_error` |
| `11` | `provider_error` |
| `12` | `provider_unavailable` |
| `13` | `invalid_response` |
| `14` | `outcome_unknown` |
| `15` | `conflict` |
| `130` | `cancelled` |
| `1` | anything else |
