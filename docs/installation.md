# Install

Install `pbx` once on each computer where you or an agent use it. You need Node.js 22.16 or a later 22.x, or 24
or later; Node 23 is not supported. Transcribing WAV and GSM recordings needs `ffmpeg` on `PATH`.

```sh
npm install -g @wirecat/asterisk-cli
pbx --version
```

The command is `pbx`, and `wcat-pbx` is the same tool. Neither name is `asterisk`, so you can install it on the PBX
too without hiding Asterisk's own program.

Check the installation:

```sh
pbx doctor
```

`doctor` needs no network and opens no keyring. It shows the version, where settings live, the profiles that exist,
and whether other users of the computer can read the settings. Next: [connect your Asterisk](asterisk.md).
