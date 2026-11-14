# Changelog

Notable changes to `@wirecat/asterisk-cli`. One section per version, newest first.

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
  See [connect your Asterisk](docs/installation.md#files-on-the-pbx-over-sftp).

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
