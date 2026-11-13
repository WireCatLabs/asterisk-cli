# pbx

`pbx` brings the phone calls of an Asterisk PBX into WireCat, for the terminal, for scripts and for AI agents. It
reads the call records (CDR) from `Master.csv` or the CDR database, links each call to its recording, and keeps them
in the local WireCat store as meetings. `meetings transcribe` turns the recordings into text on this computer.

It reads only: it never changes the PBX, its settings or a recording. It has the commands every WireCat CLI shares:
`doctor`, `commands`, `config`, `skill`, `mcp`, `runs` and `upgrade`, with `session`, `meetings`, `events` and
`models`.

Start with [installation](installation.md), then [connect your Asterisk](asterisk.md) and [use it](usage.md).
