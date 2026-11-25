### Fixed

- **The store opens through cli-core's `openAppStore`.** pbx kept its own copy of it. Nothing changes for a user: the
  store, its provider entry and the read-only open work as before.
