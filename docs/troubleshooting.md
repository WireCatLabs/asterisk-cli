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
| `network_error` from the database | The server is not reachable from here. Use an SSH tunnel, as [connect your Asterisk](asterisk.md#a-cdr-database) shows. |
| A call has no recording | Check `recordings_path`, then `recordings_pattern`. A file changed in the last two minutes is left for the next sync. |
| `model.not-downloaded` | Run `pbx models download gigaam-v3`, or the model the message names. |
| A WAV or GSM call fails to transcribe | Install `ffmpeg`. |
| The settings file does not read | `doctor` lists every problem in the file under `config.issues`. Run the `config unset` each one gives. |

Never paste a password, a recording or a transcript into a support request.
