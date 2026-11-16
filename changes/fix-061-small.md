### Fixed

- **`session start` no longer waits for ever on a pipe that stays open.** It reads one line per password it needs and
  stops there, so a program that keeps stdin open after the last password, as WireCat Desktop once did, gets its
  answer. A pipe that sends nothing gives up after 30 seconds with "no password was given".
- **A profile that was never connected says so.** `meetings sync` and the other commands that read the phone system
  no longer ask for `cdr_csv_path` on a profile with no source settings of its own. They say the profile is not
  connected, point to [install and connect](../docs/installation.md), and list the profiles on this computer. A
  profile that chose `cdr_source csv` still gets the missing setting by name. The reason stays
  `source.not-configured`.
- **The docs:** troubleshooting names the reason `network.failed`, as the error gives it; the settings and security
  pages have a contents list; the MCP server, the run record and the files on this computer have their own sections
  on the security page, out of "Recordings and consent"; two code spans no longer break across a line.
