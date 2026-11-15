# When something goes wrong

Start with the symptom, run the check, then retry the command. Keep the error code, the reason and the profile name
for a support request.

| Symptom | What to do |
| --- | --- |
| Not sure what is set up | Run `pbx doctor`. It reads no keyring and uses no network. |
| `pbx` is not found | Open a new terminal, and check that npm's global folder is on `PATH`. |
| `pbx` runs another program | Another tool took the name. Type `wcat-pbx` instead. |
| "name a profile" | Put the profile first, as in `pbx office meetings list`, or set `PBX_PROFILE`. |
| `source.not-configured` | The message names the setting and the `config set` that fills it. |
| `cdr.unknown-columns` | Master.csv has a column count `cdr_csv` never writes. Name the columns with `cdr_csv_columns`. |
| Times are off by hours | Set `cdr_timezone` to the PBX's zone, or to `UTC` when `cdr.conf` has `usegmtime=yes`. Then `meetings sync --since-time` again: the records are updated, not doubled. |
| "N call records could not be read" | Those rows have no start time; the rest were imported. |
| `db.refused` | The database refused the user or the password. Run `session start` again. |
| `db.no-table`, `db.no-select` | Set `db_table`, or grant the user `SELECT` on the table. |
| `network_error` from the database | The server is not reachable from here. Reach it through the phone system's SSH, as [a database behind the phone system's SSH](installation.md#a-database-behind-the-phone-systems-ssh) shows. |
| `sftp.host-key-missing` | The SFTP or SSH server's key is not pinned yet. Compare the fingerprint in the message with `ssh-keygen -lf` on the server, then run the `config set` it names. |
| "this profile needs 2 passwords" | Type each password when asked, or pipe them one per line in the order the message gives. |
| `transcription.no-key` | The profile transcribes with OpenAI and has no key. Give it in `OPENAI_API_KEY`, or `config set transcribe_engine local`. |
| A call has no recording | Check `recordings_path`, then `recordings_pattern`. A file changed in the last two minutes is left for the next sync. |
| `model.not-downloaded` | Run `pbx models download gigaam-v3`, or the model the message names. |
| A WAV, GSM or M4A call fails to transcribe | Install `ffmpeg`. |
| A recording is listed as too long | A recording longer than one hour, or an MP3, Ogg or FLAC file over 64 MB, is not transcribed. |
| `search meetings --model` or `meetings embed` says the model is missing | Run `pbx models download embeddinggemma`, or the model you named. |
| The settings file does not read | `doctor` lists every problem in the file under `config.issues`. Run the `config unset` each one gives. |

Never paste a password, a recording or a transcript into a support request.
