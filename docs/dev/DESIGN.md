# pbx — design

What `pbx` is for and the decisions that shape it. Started from `npx @wirecat/cli-template new`; the answers below
are the owner's.

## Answers

- **Category:** meetings
- **Content languages:** ru, en
- **Sign-in:** a database or SFTP password where the source needs one; none for a local Master.csv
- **The API:** official documentation only (the Asterisk CDR specification and the `cdr_csv` source)
- **How people filter:** by time, by person, by status or label
- **Never in the store, a log or the output:** tokens and passwords
- **Untrusted input:** files and attachments, names and titles set by others, what other attendees said or wrote

## Reference CLI

Learn from [zoom-cli](https://github.com/WireCatLabs/zoom-cli), and from beeline-cli, the other PBX: this CLI keeps
its shape (calls as meetings, local transcription, the same commands).

## Content languages

Languages: ru, en.

## Further answers

Owner, 2026-11-12.

- **Purpose:** make a business's Asterisk calls available to AI agents beside its messages, mail, meetings and CRM: a
  source connector, not a PBX tool. The first user connects Asterisk, WhatsApp, MAX, mail and a CRM.
- **Calls go into the existing tables.** A call is a meeting in cli-core's shared store, as in beeline and zoom: the
  same `meetings` commands, transcripts and search. The brief asked for Memo's Generic Import (the records envelope
  in cli-core); the owner chose the meetings tables, which already hold recordings, transcripts and people, and
  which every WireCat tool reads. No second ingestion path is built.
- **Sources:** Master.csv, MySQL or MariaDB, PostgreSQL, and SFTP for remote files. The SFTP client belongs in
  cli-core, with retries, timeouts and tracing, for every CLI (`@wirecat/cli-core/sftp`, 0.648.0); pbx reads
  through it from 0.2.0. The server's key is pinned by the owner (`sftp_host_key`) before any credential is sent.
- **Names:** the command is `pbx`, the package `@wirecat/asterisk-cli`; `wcat-pbx` is the same program.
- **Release:** a repository, merged pull requests and a release to npm; WireCat Desktop gets the tool next.

## Decisions

- **One call is one meeting** (NEED-2607, 14.11.2026). The rows that share a `linkedid`, or a `uniqueid` without one,
  are one call, and the meeting's external id is that value. A ring group, a queue and a transfer each write a row per
  leg, so one row per meeting showed the twelve calls of `bin/dev-pbx` as 29. A leg counts as answered only when Dial
  or Queue bridged it with talk time: VoiceMail, Busy and Hangup rows also say `ANSWERED`. The wait is taken from the
  first answered Dial leg, since a queue answers the caller before any person does. The outcome, who answered, who
  rang, the wait, the talk time and the legs are in the metadata, and a sentence in the description, which is what
  `meetings show`, Desktop and agents read. 0.3.0 kept `uniqueid#sequence` meetings; a sync marks one deleted when
  it reads that row into a call, so a call older than the sync's window is never lost.
- **No series.** A meeting series in cli-core is a recurring meeting; the legs of a call are not that.
- **Direction** comes from the extension pattern applied to the channel's peer, then to the number, and from the
  `from-trunk`, `from-pstn`, `from-did` contexts. Nothing else is guessed.
- **People:** the extension is `extension:<n>` with the role `manager`; the outside number is `phone:<E.164>` with the
  role `client` when `phone_region` makes it international, else `number:<as written>`, which matches nothing in other
  sources. With several countries, a number that two of them read differently stays `number:`: no guess. The roles are beeline's.
- **The cursor** is cli-core's: when the last sync began, read again six hours earlier, since a CDR row is written when
  the call ends. Master.csv is read whole and filtered; a database is asked from the cursor, in its wall time, in pages
  of 5,000 ordered by time and uniqueid.
- **Times** without a zone are read in `cdr_timezone` with cli-core's `localMoment` (WC-TIME-3). The SQL drivers
  return the wall time as text, never a `Date` made in this computer's zone.
- **Recordings** are attachments that keep the file's path; nothing is copied. A file changed in the last two minutes
  is skipped. The transcript receipt keys a recording by its content hash, so an unchanged file is never transcribed
  twice.
- **Mono is fine.** MixMonitor writes one mixed track by default; it is one transcript with no speakers. Two separate
  channels are named `Channel 1` and `Channel 2`, since which side is which depends on the dialplan.
- **One password per profile:** the database's, or the SFTP user's when no key file is set.
- **The SQL drivers** (`mysql2`, `pg`) live here, not in cli-core: no other CLI reads a SQL server, and they would make
  every CLI's install heavier. They stay outside the bundle (`--external`) and load only for a database source.
- **The transcription loop** is beeline's, adapted. A third copy should move into cli-core instead.

## Open questions for the owner

- Whether `files_from sftp` should also read the CDR database through an SSH tunnel of its own.
