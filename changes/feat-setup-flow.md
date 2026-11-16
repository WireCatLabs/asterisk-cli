### Added

- **`pbx office setup` connects a profile question by question, and WireCat Desktop draws the same flow.** It asks
  where the call records are (Master.csv, MySQL or MariaDB, PostgreSQL), whether the files are on this computer or
  on the PBX over SFTP, the database through the PBX's SSH server when it listens only there, the recordings folder
  and the countries of the phone lines. It reads the newest hour of calls to check the answers, the same check as
  `session start`, and saves the settings and the passwords only when that works. A refused password or setting
  takes it back to the step that has it. `setup show --json`, `setup apply --dry-run` and
  `setup run apply --answer-stdin` give the same flow to WireCat Desktop, in English, Russian and Spanish. See
  [install and connect](../docs/installation.md#connect-from-the-terminal).
- **A changed server never gets the old password.** When `setup` changes a database, SSH or SFTP server, its port,
  its user, or the source, a password left empty is refused (`validation_error`, `param` names the input) instead
  of the kept one being tried on the new place.
- **An unconnected profile points to `setup`.** The message of a profile that was never connected, and the first
  screen of `pbx`, name `pbx <profile> setup`.

### Changed — may break callers

- **`phone_region` also takes a list.** The setup flow keeps the chosen countries as a list (`["RU","ES"]`), and
  `config set phone_region es,ru` now does too. A comma-separated text set earlier reads as before.
