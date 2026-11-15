### Added

- **`stats calls show` counts the stored calls.** It gives the calls by direction and outcome, per employee, by hour
  and by day, the missed incoming calls and whether the client was called back, and the short calls. It reads only
  the local store. See [a report of the week](../docs/usage.md#a-report-of-the-week).
- **`search meetings` finds a call by what was said.** By words, and with `--model embeddinggemma` by meaning too,
  with a text model on this computer. `meetings embed --yes` builds the search data ahead of time, one batch per run.
  `models list` and `models download` now also offer the text models. See
  [find calls by what was meant](../docs/usage.md#find-calls-by-what-was-meant).
- **`tags add`, `tags remove` and `tags list` mark calls.** `tags add complaint --matching "refund OR complaint"`
  marks every call the search finds, and a rerun marks only the new ones; `--meeting <id>` marks one call. See
  [mark every call about refunds](../docs/usage.md#mark-every-call-about-refunds).
- **A database that listens only on the phone system is reached through its SSH.** Set `db_ssh_host`, `db_ssh_user`
  and a key file in `db_ssh_key_path`, or a password; the server's key is pinned in `db_ssh_host_key` first. `pbx`
  opens the tunnel for each command and closes it after. See
  [a database behind the phone system's SSH](../docs/installation.md#a-database-behind-the-phone-systems-ssh).
- **A profile can keep more than one password.** A database profile can sign in to SFTP or SSH with a password too.
  `session start` asks each password it needs; piped, one per line. They are kept in the profile's one keyring
  entry.
- **Cloud transcription, for one profile at a time.** `config set transcribe_engine openai` sends the speech of the
  recordings to OpenAI in place of the local model, with the key in `OPENAI_API_KEY`. The run says where the audio
  goes before the first piece leaves. It stays off unless the profile's own settings turn it on. See
  [cloud transcription](../docs/installation.md#cloud-transcription).
- **`meetings show` prints a WireCat Desktop link for the call** in the terminal, `wirecat://open/v1/meeting/…`. It
  opens the call once Desktop supports links to calls.
- **`meetings show` names each recording's file on this computer** in `local_path`, so WireCat Desktop can play it.
  It is `null` when the recording is read over SFTP. This comes with cli-core 0.668.0.
- **Master.csv and the recordings of any size over SFTP.** They are read in pieces, and a connection that breaks is
  opened again where it stopped. A recording on the phone system is copied into a private temporary file for the
  time it is read, and deleted after. A WAV, GSM or M4A recording of any size is transcribed, up to an hour of audio.
- **A stereo WAV, GSM or M4A recording keeps its two channels,** so `recordings_channels` names the caller and the
  employee on each line for these formats too.

### Changed — may break callers

- **A stereo WAV, GSM or M4A call is transcribed as two channels.** Its lines say `Channel 1` and `Channel 2`, or the
  names `recordings_channels` gives, where they were one mixed text. `meetings transcribe --replace` does it for the
  calls already transcribed.
- **An MP3, Ogg or FLAC recording can be up to 64 MB,** not 256 MB. That is more than an hour at usual phone quality,
  and a recording longer than an hour was never transcribed.
- **The run record names the database's requests `sql.connect`, `sql.columns` and `sql.rows`,** not `cdr.connect`,
  `cdr.columns` and `cdr.rows`. A database that does not answer in time now has the reason `db.timeout`, and one that
  cannot be reached `network.failed`.
