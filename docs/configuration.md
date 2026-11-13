# Settings

Settings live in one file, `config.json`, in the folder `pbx doctor` shows. Each profile has its own part, and
`defaults` apply to every profile.

```sh
pbx office config show
pbx office config set cdr_csv_path /var/log/asterisk/cdr-csv/Master.csv
pbx office config unset cdr_csv_path
```

`config show` lists each setting and where it came from: the file, a variable or the default.

## The source

What each setting means is on [connect your Asterisk](asterisk.md).

| Setting | Default | What it is |
| --- | --- | --- |
| `cdr_source` | `csv` | `csv`, `mysql` or `postgres` |
| `cdr_csv_path` | — | the path of `Master.csv` |
| `cdr_csv_columns` | counted | the CSV's column names, comma-separated |
| `db_host`, `db_port`, `db_name`, `db_user` | —, 3306 or 5432 | the CDR database; the password is kept by `session start` |
| `db_table` | `cdr` | the CDR table |
| `db_tls` | `false` | an encrypted connection with a checked certificate |
| `recordings_path` | — | the folder of the recordings |
| `recordings_pattern` | FreePBX's, then `*{uniqueid}*` | how a recording's name holds the call |
| `cdr_timezone` | this computer's | the zone of the CDR's times |
| `phone_region` | — | the country of numbers written without `+`, such as `ru` |
| `extension_pattern` | `^\d{2,5}$` | which numbers are internal extensions |
| `files_from` | `local` | `local`, or `sftp` to read `Master.csv` and the recordings on the PBX |
| `sftp_host`, `sftp_port`, `sftp_user` | —, 22, — | the PBX's SSH server, for `files_from sftp` |
| `sftp_key_path` | — | a private key file; without it `session start` asks the SFTP password |
| `sftp_host_key` | — | the server's key fingerprint, `SHA256:…`, that you checked; nothing connects until it is set |

## Permissions

`permissions` decides what a command may do for this profile: `allow`, `ask`, `readonly` or `deny`, per command path
(`meetings.sync`, `meetings.transcribe`). Over MCP there is no one to ask, so `ask` lets the command run.
`PBX_READ_ONLY=1` refuses every command that changes your sign-in or settings.

```sh
pbx office config set permissions.meetings.transcribe deny
```

## Run records

A command that fails is kept as a run, for `pbx runs list` and `runs show`. `meetings sync`, `meetings
transcribe` and `session status --check` do their work in a run, so `--record` keeps them when they succeed too.
`record_input` decides whether a run keeps the words you typed. Secrets are masked either way; see
[Security](security.md).
