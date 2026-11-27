### Changed — may break callers

- **Built on cli-core 2.0.0.** The store migrates to version 78 on first open: agents become `agent:<id>` and sender
  bots `bot:<id>`. Once a 2.0 tool opens the store, a 1.x tool refuses it, so upgrade every WireCat CLI together.
- **A new profile's calls are work.** pbx saved a new account as personal, beeline as work. Now both save it as work,
  so a work search (b24's `search all`) finds the calls. An account already saved keeps the scope it has.

### Fixed

- **The profile's store opens through cli-core's `openProfileStore`.** pbx kept its own copy. A read still finds an
  account an older build saved, under `PBX_READ_ONLY` too.
- **`bin/release` is cli-template's again.** The old copy raised the version to a minor for fixes and needed an
  `## Unreleased` section beside the `changes/` fragments.
