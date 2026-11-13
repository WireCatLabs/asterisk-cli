# Changelog

Notable changes to `@wirecat/asterisk-cli`. One section per version, newest first.

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
