### Added

- **A transcript can name who said each line.** Set `recordings_channels` to `caller,employee` or `employee,caller`,
  as your dialplan records the two sides, and each line of a stereo MP3, Ogg or FLAC recording names the caller by
  name and number, or the employee by extension and name. Without the setting the lines say `Channel 1` and
  `Channel 2`, as before. `meetings transcribe --replace` labels the calls already transcribed. A WAV or GSM
  recording is still one mixed track. See [transcribe](../docs/installation.md#transcribe).
- **Master.csv of any size.** A `Master.csv` on this computer or in a mounted folder is read line by line, so a file
  over 512 MB is no longer refused, and only the calls a sync needs stay in memory. Over SFTP it is still read whole,
  up to 512 MB.
- **Hour-long recordings in WAV, GSM and M4A.** These recordings can be up to 2 GB, instead of 256 MB, so an hour of
  48 kHz stereo WAV is transcribed. Every recording can still be up to one hour, and MP3, Ogg and FLAC up to 256 MB.
- A call's metadata keeps the caller's number as `client`, the same form as in its title.

### Fixed

- The README's limits and the overview's "What it does not do yet" say first what you can do, then what not, in
  plain words: the three call record sources `pbx` reads, SFTP and the one saved password, who said what in mono
  and stereo recordings, and the sizes. [Install and connect](../docs/installation.md#connect-in-wirecat-desktop)
  names the **Countries of your phone lines** field of WireCat Desktop's connect form.
