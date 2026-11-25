### Changed — may break callers

- **Built on cli-core 1.0 and cli-base 1.0.** The store migrates to version 73 on first open: once a 1.0 tool opens
  the store, a 0.x tool refuses it, so upgrade every WireCat CLI together. The lint exception for the short `pbx`
  command is gone: cli-base 1.0 accepts it beside `wcat-pbx`.
