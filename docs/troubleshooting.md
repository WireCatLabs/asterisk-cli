# When something goes wrong

Get your calls coming in again from the message `pbx` shows. Times off by hours, a database that refuses the user and a
call with no recording each have their own message and their own fix.

Find your symptom in the table, run the check it gives, and retry the command. If it still fails, you have the error
code and the profile name ready for a support request. Your agent can do the same: each error names its reason, such
as `db.refused`, so it knows what happened.

`pbx doctor` shows what is set up without the network or the keyring, and `pbx office session status --check` checks
the connection to the call records.

**On this page:**

1. [Symptoms and what to do](#symptoms-and-what-to-do)
2. [Asking for help](#asking-for-help)

## Symptoms and what to do

| Symptom | What to do |
| --- | --- |
| Not sure what is set up | Run `pbx doctor`. It reads no keyring and uses no network. |
| `pbx` is not found | Open a new terminal, and check that npm's global folder is on `PATH`. |
| `pbx` runs another program | Another tool took the name. Type `wcat-pbx` instead. |
| "name a profile" | Put the profile first, as in `pbx office meetings list`, or set `PBX_PROFILE`. |
| `source.not-configured` | A profile that was never connected says so: connect it in WireCat Desktop, or set its source as [connect from the terminal](installation.md#connect-from-the-terminal) shows. Otherwise the message names the missing setting and the `config set` that fills it. |
| `cdr.unknown-columns` | Master.csv has a column count `cdr_csv` never writes. Name the columns with `cdr_csv_columns`. |
| Times are off by hours | Set `cdr_timezone` to the PBX's zone, or to `UTC` when `cdr.conf` has `usegmtime=yes`. Then `meetings sync --since-time` again: the records are updated, not doubled. |
| "N call records could not be read" | Those rows have no start time; the rest were imported. |
| `db.refused` | The database refused the user or the password. Run `session start` again. |
| `db.no-table`, `db.no-select` | Set `db_table`, or grant the user `SELECT` on the table. |
| `network.failed` from the database | The server is not reachable from here. Reach it through the phone system's SSH, as [a database behind the phone system's SSH](installation.md#a-database-behind-the-phone-systems-ssh) shows. |
| `sftp.host-key-missing` | The SFTP or SSH server's key is not pinned yet. Compare the fingerprint in the message with `ssh-keygen -lf` on the server, then run the `config set` it names. |
| "this profile needs 2 passwords" | Type each password when asked, or pipe them one per line in the order the message gives. |
| `transcription.no-key` | The profile transcribes with OpenAI and has no key. Give it in `OPENAI_API_KEY`, or `config set transcribe_engine local`. |
| A call has no recording | Check `recordings_path`, then `recordings_pattern`. A file changed in the last two minutes is left for the next sync. |
| `model.not-downloaded` | Run `pbx models download gigaam-v3`, or the model the message names. |
| A WAV, GSM or M4A call fails to transcribe | Install `ffmpeg`. |
| A recording is listed as too long | A recording longer than one hour, or an MP3, Ogg or FLAC file over 640 MB, is not transcribed. |
| `search meetings --model` or `meetings embed` says the model is missing | Run `pbx models download embeddinggemma`, or the model you named. |
| The settings file does not read | `doctor` lists every problem in the file under `config.issues`. Run the `config unset` each one gives. |

## Asking for help

Keep the error code and the profile name. `pbx doctor reports create` writes a problem report to a file and says
where to send it. Ask on [Discord](https://discord.gg/DebENqbRrJ), or open an issue in the
[asterisk-cli repository](https://github.com/WireCatLabs/asterisk-cli/issues).

Never paste a password, a recording or a transcript into a support request.
