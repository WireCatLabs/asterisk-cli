# Changelog

Notable changes to `@wirecat/asterisk-cli`. One section per version, newest first.

## 0.7.0 — 16.11.2026

### Added

- **`pbx office setup` connects a profile question by question, and WireCat Desktop draws the same flow.** It asks
  where the call records are (Master.csv, MySQL or MariaDB, PostgreSQL), whether the files are on this computer or
  on the PBX over SFTP, the database through the PBX's SSH server when it listens only there, the recordings folder
  and the countries of the phone lines. It reads the newest hour of calls to check the answers, the same check as
  `session start`, and saves the settings and the passwords only when that works. A refused password or setting
  takes it back to the step that has it. `setup show --json`, `setup apply --dry-run` and
  `setup run apply --answer-stdin` give the same flow to WireCat Desktop, in English, Russian and Spanish. See
  [install and connect](docs/installation.md#connect-from-the-terminal).
- **A changed server never gets the old password.** When `setup` changes a database, SSH or SFTP server, its port,
  its user, or the source, a password left empty is refused (`validation_error`, `param` names the input) instead
  of the kept one being tried on the new place.
- **An unconnected profile points to `setup`.** The message of a profile that was never connected, and the first
  screen of `pbx`, name `pbx <profile> setup`.

### Changed — may break callers

- **`phone_region` also takes a list.** The setup flow keeps the chosen countries as a list (`["RU","ES"]`), and
  `config set phone_region es,ru` now does too. A comma-separated text set earlier reads as before.

## 0.6.1 — 16.11.2026

### Fixed

- **`session start` no longer waits for ever on a pipe that stays open.** It reads one line per password it needs and
  stops there, so a program that keeps stdin open after the last password, as WireCat Desktop once did, gets its
  answer. A pipe that sends nothing gives up after 30 seconds with "no password was given".
- **A profile that was never connected says so.** `meetings sync` and the other commands that read the phone system
  no longer ask for `cdr_csv_path` on a profile with no source settings of its own. They say the profile is not
  connected, point to [install and connect](docs/installation.md), and list the profiles on this computer. A
  profile that chose `cdr_source csv` still gets the missing setting by name. The reason stays
  `source.not-configured`.
- **The docs:** troubleshooting names the reason `network.failed`, as the error gives it; the settings and security
  pages have a contents list; the MCP server, the run record and the files on this computer have their own sections
  on the security page, out of "Recordings and consent"; two code spans no longer break across a line.

## 0.6.0 — 15.11.2026

### Added

- **`stats calls show` counts the stored calls.** It gives the calls by direction and outcome, per employee, by hour
  and by day, the missed incoming calls and whether the client was called back, and the short calls. It reads only
  the local store. See [a report of the week](docs/usage.md#a-report-of-the-week).
- **`search meetings` finds a call by what was said.** By words, and with `--model embeddinggemma` by meaning too,
  with a text model on this computer. `meetings embed --yes` builds the search data ahead of time, one batch per run.
  `models list` and `models download` now also offer the text models. See
  [find calls by what was meant](docs/usage.md#find-calls-by-what-was-meant).
- **`tags add`, `tags remove` and `tags list` mark calls.** `tags add complaint --matching "refund OR complaint"`
  marks every call the search finds, and a rerun marks only the new ones; `--meeting <id>` marks one call. See
  [mark every call about refunds](docs/usage.md#mark-every-call-about-refunds).
- **A database that listens only on the phone system is reached through its SSH.** Set `db_ssh_host`, `db_ssh_user`
  and a key file in `db_ssh_key_path`, or a password; the server's key is pinned in `db_ssh_host_key` first. `pbx`
  opens the tunnel for each command and closes it after. See
  [a database behind the phone system's SSH](docs/installation.md#a-database-behind-the-phone-systems-ssh).
- **A profile can keep more than one password.** A database profile can sign in to SFTP or SSH with a password too.
  `session start` asks each password it needs; piped, one per line. They are kept in the profile's one keyring
  entry.
- **Cloud transcription, for one profile at a time.** `config set transcribe_engine openai` sends the speech of the
  recordings to OpenAI in place of the local model, with the key in `OPENAI_API_KEY`. The run says where the audio
  goes before the first piece leaves. It stays off unless the profile's own settings turn it on. See
  [cloud transcription](docs/installation.md#cloud-transcription).
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

## 0.5.0 — 14.11.2026

### Added

- **A transcript can name who said each line.** Set `recordings_channels` to `caller,employee` or `employee,caller`,
  as your dialplan records the two sides, and each line of a stereo MP3, Ogg or FLAC recording names the caller by
  name and number, or the employee by extension and name. Without the setting the lines say `Channel 1` and
  `Channel 2`, as before. `meetings transcribe --replace` labels the calls already transcribed. A call imported by
  an earlier version gets the caller's number in its label only after a sync reads it again: run `meetings sync`
  with `--since-time` at your first call before `--replace`. A WAV, GSM or M4A recording is still one mixed track.
  See [transcribe](docs/installation.md#transcribe).
- **Master.csv of any size.** A `Master.csv` on this computer or in a mounted folder is read line by line, so a file
  over 512 MB is no longer refused, and only the calls a sync needs stay in memory. Over SFTP it is still read whole,
  up to 512 MB.
- **Hour-long recordings in WAV, GSM and M4A.** These recordings can be up to 2 GB, instead of 256 MB, so an hour of
  48 kHz stereo WAV is transcribed. Every recording can still be up to one hour, and MP3, Ogg and FLAC up to 256 MB.
- A call's metadata keeps the caller's number as `client`, the same form as in its title.

### Changed — may break callers

- **`meetings list` and `meetings show` take `--backend archive|server|both`** (cli-core 0.663.0, was 0.656.0).
  pbx does not ask Asterisk from these commands, so both answer from the store and say so in `missing`.
  `meetings show` takes the call's number, its `meeting:` ref or Asterisk's own id.
- **The `meetings` and `events` commands take the program's `--json [fields]` and `--jsonl`.** They no longer have
  on/off flags of their own, so `meetings list --json id,title` keeps those fields.
- **A list without `--limit` shows the profile's `defaults.limit`, 20 unless set.** This holds for `meetings list`,
  `events list`, `search meetings` and `runs list`; the meetings lists showed 100 before.
- **A list query's dates read the computer's zone, not UTC** (`started_at:today`).
- **A `readonly` level no longer stops `meetings sync`.** It only copies call records into the local store; `deny`
  still refuses it.
- **Every time flag takes one grammar** (cli-base 0.100.0, was 0.98.0): ISO with or without seconds and zone, a date
  alone, `today`, `yesterday`, or `30m`, `2h`, `7d` ago. `meetings sync --since-time 2h` now works.

### Fixed

- The README's limits and the overview's "What it does not do yet" say first what you can do, then what not, in
  plain words: the three call record sources `pbx` reads, SFTP and the one saved password, who said what in mono
  and stereo recordings, and the sizes. [Install and connect](docs/installation.md#connect-in-wirecat-desktop)
  names the **Countries of your phone lines** field of WireCat Desktop's connect form.

## 0.4.0 — 14.11.2026

### Added

- Each call's description says what became of it, for `meetings show`, WireCat Desktop and an agent: `Incoming
  call to 600: answered by 101 Анна Смирнова after 0:03, talk 0:24. 102 Борис Кузнецов did not answer.`
- `phone_region` takes several countries, `es,ru`, for an office whose phone lines serve more than one. A number
  written without `+` is read in the country it fits; one that fits two of them is kept as written, linked to no
  one, and `meetings sync` says how many callers that left. See
  [numbers, directions and people](docs/installation.md#numbers-directions-and-people).

### Changed — may break callers

- One call is one meeting. Every CDR row of a call (a ring group's members, a queue, a transfer) is joined by its
  `linkedid`, and the meeting's id is that `linkedid`. Its people are the caller, the employee who placed it and each
  one who answered; its metadata says what became of it (`outcome`: answered, voicemail, busy, no_answer, failed),
  who placed it (`placedBy`), who answered (`answeredBy`), who rang without answering (`rang`), what was dialled,
  the wait before the first answer (`waitMs`), the talk time (`talkMs`) and every leg. The one-row meetings of 0.3.0 and older are marked
  deleted once a sync reads their rows again into a call; `meetings sync --since-time <first call>` reads them all.
  A transcript made of a row meeting is made again by `meetings transcribe`.
- An employee's identity is now `extension:<profile>/<number>` (was `extension:<number>`), so extension 101 of one
  profile and 101 of another are two people, not one. A script that looked people up by `extension:101` adds the
  profile: `extension:office/101`.
- A ring group's or queue's member who answered is named by the channel that reached them (`Local/101@…`), not by the
  group's number (`600`), and employees are named from the caller ID of the calls they make.
- `meetings show --json` answers `{ "item": { … } }`; 0.3.0 wrapped the meeting twice, as `item.item`.
- **Built on cli-core 0.656.0** (was 0.648.0). See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).

### Fixed

- WireCat Desktop and the README link to the guide on [wirecat.dev](https://wirecat.dev/en/docs/pbx), now that it is
  published, instead of the README on GitHub.
- A caller is linked to the CRM contact or messenger person with the same mobile number, as Beeline's are: the
  caller's participant now carries its phone number.
- A recording with nothing but its header, which MixMonitor leaves when nobody talked, is no longer linked or sent to
  transcription.
- A build starts from an empty `dist/`, so a renamed file no longer ships: 0.3.0 carried an unused
  `dist/bin/asterisk.js`.
- **Sync runs on a fresh install.** A shared WireCat config (`~/.config/WireCat/config.json`) that could not be
  read (a byte-order mark, broken JSON, a folder in its place, an older `setup` shape) made every WireCat tool
  read-only and refused `sync`. Now only the owner's own "read only" answer limits a tool, and even then a sync runs:
  it only reads the service into the local store (cli-core 0.656.0).
- The guide starts with what you get from your calls and the work an agent can take over: the overview says what
  `pbx` does and does not do yet, [install and connect](docs/installation.md) is one page from installation to
  the first sync, in WireCat Desktop or a terminal, and [use it](docs/usage.md) is built around a team's daily
  tasks, with requests to copy and a schedule.

## 0.3.0 — 13.11.2026

### Changed — may break callers

- The command is now `pbx`, also installed as `wcat-pbx`. `asterisk` hid the PBX's own program on a server that runs
  both. Variables start with `PBX_` (`PBX_PROFILE`, `PBX_READ_ONLY`), the MCP entry is `pbx-<profile>`, and its tools
  are `pbx_read`, `pbx_write` and `pbx_tools_search`. The package, its settings and the saved passwords keep the name
  `asterisk-cli`, so nothing is set up again.

## 0.2.0 — 13.11.2026

### Added

- `files_from sftp` reads `Master.csv` and the recordings on the PBX over SFTP, read only, through cli-core's SFTP
  client: retries for a dropped connection, timeouts, and each request in the run's trace. The server's key is pinned
  with `sftp_host_key` before any password or key is sent; the first `session start` shows the fingerprint to check.
  See [connect your Asterisk](docs/asterisk.md#files-on-the-pbx-over-sftp).

### Fixed

- `phone_region` now makes numbers international for every country, not only `ru`: the rules are cli-core's (0.648.0).

## 0.1.0 — 13.11.2026

### Added

- Started from `@wirecat/cli-template` 0.23.0.
- Asterisk call records as meetings in the WireCat store: `meetings sync` reads `Master.csv` or a MySQL, MariaDB or
  PostgreSQL CDR table, read only, one meeting per CDR row, so the legs of a transferred call stay apart.
- A call's recording is found by FreePBX's `recordingfile` or by its `uniqueid`, and linked by its path; a file still
  being written waits for the next sync.
- `meetings transcribe` turns recordings into text with a local speech model, once per unchanged file.
- `session start` checks the source and keeps a database password in the keyring; a local `Master.csv` needs none.
- Outside numbers are kept in the international form with `phone_region`, as the other WireCat tools keep them.
- `examples/` holds a made-up Master.csv and two short recordings.
