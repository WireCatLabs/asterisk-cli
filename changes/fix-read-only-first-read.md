### Fixed

- **A read under `PBX_READ_ONLY` creates no store.** Before any sync, a read such as `meetings list` opened the shared
  store for writing and created `wirecat.db`. Now it answers from an empty store in a temporary folder, as beeline
  does. A store that needs a migration is refused under the lock, not migrated.
