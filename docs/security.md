# Security

What WireCat CLIs share — the keyring, permissions, MCP and what never reaches a log — is on the
[shared security page](https://wirecat.dev/en/docs/security). This page keeps only what is particular to `asterisk`.

`asterisk` keeps its settings in `config.json` and its state in the folders `asterisk doctor` shows. It reads the PBX
and never writes to it: Master.csv and the recordings are opened for reading only, and a database session is opened
read-only and sends a `SELECT` of the CDR table, with values as parameters. Give it a user that may do no more, as
[connect your Asterisk](asterisk.md#a-cdr-database) shows, and keep the database and AMI off the internet.

`session start` keeps a database password in the OS keyring, or in a private file where no keyring works. The password
is read hidden or from stdin, never from the command line, and is checked before it is kept. It goes only to the
database driver, never into an answer, an error, a run record or a log. A profile on a local Master.csv keeps none.

## What the store holds

The WireCat store keeps the callers' numbers and caller ID names, the extensions, the call times, the paths of the
recordings and, once transcribed, what was said. It does not keep a copy of a recording. Treat the store like the
calls themselves: it is on this computer, readable by your user only. Transcripts, names and numbers reach an agent
marked as untrusted data, never as instructions.

Speech is recognized on this computer. No recording or transcript goes to an outside service.

## Recordings and consent

Recording a phone call, keeping it and turning it into text may need the consent of the people on the call, and the
law of your country decides how (in Russia, for example, 152-FZ on personal data). Telling callers that the call is
recorded, and keeping recordings only as long as allowed, are the PBX owner's duties. `asterisk` reads only the
recordings the PBX already made, and deletes none of them.

`asterisk personal mcp serve --http` listens on `127.0.0.1` only, for browser apps that reach it through your own
tunnel. Each app logs in with a one-time code, and the server keeps a hash of each login it gives, in the state
folder, readable by you only. `asterisk personal mcp revoke` forgets every one of them.

A run record keeps the command line as you typed it, so `asterisk runs show` tells you what was run. A secret is still
stored as `[redacted]`: an option named like a token or password, a password in a link, a long opaque string. A
phone number is replaced by `[redacted]` inside the word you typed, message text included: one written with its "+" and
country code, or 11 to 15 digits in a row, so a long id of that length is hidden as well. To keep none of the words
you type, run `asterisk personal config set record_input false`.

A secret is also found by what it looks like, in a run record and in a kept error message: a token in a known
format (GitHub, OpenAI, Slack, AWS, Stripe, npm and the like), a `Bearer` credential, a random-looking string of 20 or
more characters, and a random-looking run of 20 or more lower-case hex characters, such as a hex key or a full commit
hash. The value after a secret name is hidden too, whether it follows `=`, `:` or a space: `password=`, `API_TOKEN=`,
`password hunter2`, `pin 1234`. Some secrets look like ordinary words and stay: a value of letters only after a
secret name and a space (`pin this message` stays), a hex key in upper case, a short commit hash or a UUID, a short
password typed without a secret name before it, and a secret inside a link or a file path unless it is in a known
format or after a secret name.

`config.json` is saved readable by you only (`0600`), and its folder is created for you only (`0700`). A file or
folder made by an older version may be open to other users of the computer: `asterisk doctor` lists each under
`files.problems` and prints the `chmod` that fixes it. Windows is not checked. Report a vulnerability as [SECURITY.md](https://github.com/WireCatLabs/asterisk-cli/blob/main/SECURITY.md)
says.
