# Settings

Settings live in one file, `config.json`, in the folder `pbx doctor` shows. Each profile has its own part, and
`defaults` apply to every profile.

```sh
pbx office config show
pbx office config set cdr_csv_path /var/log/asterisk/cdr-csv/Master.csv
pbx office config unset cdr_csv_path
```

`config show` lists each setting and where it came from: the file, a variable or the default.

**On this page:**

1. [The source](#the-source)
2. [Transcription](#transcription)
3. [Permissions](#permissions)
4. [Run records](#run-records)

## The source

What each setting means is on [install and connect](installation.md).

| Setting | Default | What it is |
| --- | --- | --- |
| `cdr_source` | `csv` | `csv`, `mysql` or `postgres` |
| `cdr_csv_path` | — | the path of `Master.csv` |
| `cdr_csv_columns` | counted | the CSV's column names, comma-separated |
| `db_host`, `db_port`, `db_name`, `db_user` | —, 3306 or 5432 | the CDR database; the password is kept by `session start` |
| `db_table` | `cdr` | the CDR table |
| `db_tls` | `false` | an encrypted connection with a checked certificate |
| `db_ssh_host`, `db_ssh_port`, `db_ssh_user` | —, 22, — | the SSH server that reaches a database listening only on the phone system |
| `db_ssh_key_path` | — | a private key file for that SSH server; without it `session start` asks the SSH password |
| `db_ssh_host_key` | — | that SSH server's key fingerprint, `SHA256:…`, that you checked; nothing connects until it is set |
| `recordings_path` | — | the folder of the recordings |
| `recordings_pattern` | FreePBX's, then `*{uniqueid}*` | how a recording's name holds the call |
| `recordings_channels` | — | who speaks on each channel of a stereo recording: `caller,employee` or `employee,caller` |
| `cdr_timezone` | this computer's | the zone of the CDR's times |
| `phone_region` | — | the country of numbers written without `+`, such as `ru`, or several: `es,ru` |
| `extension_pattern` | `^\d{2,5}$` | which numbers are internal extensions |
| `extension_names` | — | names of internal extensions, as `101=Anna Smirnova,103=Vera Orlova`; above FreePBX's names and the caller ID |
| `files_from` | `local` | `local`, or `sftp` to read `Master.csv` and the recordings on the PBX |
| `sftp_host`, `sftp_port`, `sftp_user` | —, 22, — | the PBX's SSH server, for `files_from sftp` |
| `sftp_key_path` | — | a private key file; without it `session start` asks the SFTP password |
| `sftp_host_key` | — | the server's key fingerprint, `SHA256:…`, that you checked; nothing connects until it is set |

## Transcription

These two are read from the profile's own part of the file only. A value in `defaults` does not send any profile's
recordings away. See [cloud transcription](installation.md#cloud-transcription).

| Setting | Default | What it is |
| --- | --- | --- |
| `transcribe_engine` | `local` | `local`, on this computer, or `openai`, which sends the speech to OpenAI |
| `transcribe_model` | `gpt-transcribe` | the service's speech model, for `transcribe_engine openai` |

## Permissions

`permissions` decides what a command may do for this profile: `allow`, `ask`, `readonly` or `deny`, per command path
(`meetings.sync`, `meetings.transcribe`, `tags.add`). Over MCP there is no one to ask, so `ask` lets the command run.
`PBX_READ_ONLY=1` refuses every command that changes your sign-in or settings.

```sh
pbx office config set permissions.meetings.transcribe deny
```

## Run records

A command that fails is kept as a run, for `pbx runs list` and `runs show`. `meetings sync`,
`meetings transcribe` and `session status --check` do their work in a run, so `--record` keeps them when they succeed too.
`record_input` decides whether a run keeps the words you typed. Secrets are masked either way; see
[Security](security.md).
