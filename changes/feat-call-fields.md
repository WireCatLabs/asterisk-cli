### Fixed

- **A call shows its direction, the employee and the caller's number in `memo context` and WireCat Desktop.** `pbx`
  kept them only in the call's details, so other tools showed a call as a bare title. A call synced before this
  version gets them on a sync that reads it again: `pbx office meetings sync --since-time <the first call's date>`.
  An internal call, between two extensions, has none. See [what you get from each call](../docs/usage.md#what-you-get-from-each-call).
