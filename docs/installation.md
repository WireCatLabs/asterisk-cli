# Install

Install `asterisk` once on each computer where you or an agent use it. You need Node.js 22.16 or a later 22.x, or 24
or later; Node 23 is not supported. Transcribing WAV and GSM recordings needs `ffmpeg` on `PATH`.

```sh
npm install -g @wirecat/asterisk-cli
asterisk --version
```

Install it on your own computer, not on the PBX. On the PBX, Asterisk's own `asterisk` program comes first on `PATH`;
type `wcat-asterisk` there, the same tool under a name no other program has.

Check the installation:

```sh
asterisk doctor
```

`doctor` needs no network and opens no keyring. It shows the version, where settings live, the profiles that exist,
and whether other users of the computer can read the settings. Next: [connect your Asterisk](asterisk.md).
