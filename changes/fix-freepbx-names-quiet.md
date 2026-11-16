### Fixed

- **A sync no longer prints the note about `asterisk.users`.** On a MySQL source that may not read FreePBX's
  `asterisk.users`, as on a plain Asterisk, every sync printed that the extension names were not read, cron runs too.
  Now the check in `pbx office setup`, `session start` and `session status --check` prints the note once, where you
  are looking, and a sync stays quiet. A grant given later works on the next sync. See
  [names of the extensions](../docs/installation.md#names-of-the-extensions).
- **The docs say WireCat Desktop plays a call's recording.** Desktop plays it on the call's card when the recordings
  folder is on this computer, and the link `meetings show` prints opens the call. A recording read over SFTP stays on
  the phone system.
