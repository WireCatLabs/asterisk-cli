### Added

- **WireCat Desktop reads pbx's sign-in, MCP port and calls from pbx itself.** The manifest (`pbx --wcat-describe`)
  now names the MCP server's port, 8763, the three ways to sign in (a Master.csv file, MySQL or PostgreSQL, the
  database password typed on stdin), and the provider name `asterisk`, so Desktop opens a client's call with
  `meetings show` and `meetings transcript`. Built on `@wirecat/cli-base` 1.2.0.
