### Added

- **`pbx <profile> account remove` signs a profile out and forgets it on this computer.** It forgets the saved
  database or SFTP password and the profile's settings. `--keep-data` leaves its calls in the store, where search still
  finds them; `--delete-data` deletes them. It asks first, or takes `--yes`; `--dry-run` lists what it would remove.
  Why: WireCat Desktop removes an account with this command, and pbx could only sign out with `session end`. The
  password itself stays valid on the server: only the server's owner changes it.
