### Changed — may break callers

- **Built on cli-base 1.0.0-rc.0 and cli-core 1.0.** Store version 73 comes with cli-core 1.0: once a 1.0 tool opens
  the store, a 0.x tool refuses it, so upgrade every WireCat CLI together. The lint exception for the short `pbx`
  command is gone: cli-base 1.0 accepts it beside `wcat-pbx`.
