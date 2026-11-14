### Changed — may break callers

- **`meetings list` and `meetings show` take `--backend archive|server|both`** (cli-core 0.663.0, was 0.656.0).
  pbx does not ask Asterisk from these commands, so both answer from the store and say so in `missing`.
  `meetings show` takes the call's number, its `meeting:` ref or Asterisk's own id.
- **`meetings` and `events` commands take the program's `--json [fields]` and `--jsonl`,** not their own on/off flags,
  so `meetings list --json id,title` keeps those fields.
- **`meetings list`, `events list` and `search meetings` without `--limit` show the profile's `defaults.limit`**, 20
  unless set, not 100. `runs list` reads it too.
- **A list query's dates read the computer's zone,** not UTC (`started_at:today`).
- **A `readonly` level no longer stops `meetings sync`.** It only copies call records into the local store; `deny`
  still refuses it.
- **Every time flag takes one grammar** (cli-base 0.100.0, was 0.98.0): ISO with or without seconds and zone, a date
  alone, `today`, `yesterday`, or `30m`, `2h`, `7d` ago. `meetings sync --since-time 2h` now works.

### Fixed

- **`meetings show --json` answers `item`, not `item.item`.**
- **`meetings list` and `meetings show` work for a profile whose call source is not set yet.** They read the store
  and need `cdr_csv_path` only when a command reads Asterisk.
