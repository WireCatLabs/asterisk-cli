# Changelog

Notable changes to `@wirecat/asterisk-cli`. One section per version, newest first.

## Unreleased

### Added

- Asterisk call records as meetings in the WireCat store: `meetings sync` reads `Master.csv` or a MySQL, MariaDB or
  PostgreSQL CDR table, read only, one meeting per CDR row, so the legs of a transferred call stay apart.
- A call's recording is found by FreePBX's `recordingfile` or by its `uniqueid`, and linked by its path; a file still
  being written waits for the next sync.
- `meetings transcribe` turns recordings into text with a local speech model, once per unchanged file.
- `session start` checks the source and keeps a database password in the keyring; a local `Master.csv` needs none.
- Outside numbers are kept in the international form with `phone_region`, as the other WireCat tools keep them.
- `examples/` holds a made-up Master.csv and two short recordings.
