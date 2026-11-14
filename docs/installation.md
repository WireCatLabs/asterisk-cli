# Install and connect

Asterisk writes a line about every call to its call log and keeps each recording as a sound file, but it gives your AI
agent no way to read them. Services that turn recordings into text usually send them to the cloud. `pbx`, a WireCat
command-line tool, reads the call log and the recordings where Asterisk keeps them, changes nothing on the phone
system, and turns the recordings into text on your computer.

Once it is connected, you can ask your agent who called about an order last week and what was agreed, find every
call from one number, or see a caller's calls next to their chats, mail and CRM card. `pbx` keeps each call in the
local WireCat store, and Memo and the search of every WireCat tool find it there with the rest of your data.

You connect `pbx` once per phone system. It needs read access to the call log, as a file or as a database user that
may only read, and to the recordings folder if you want the text of the calls. WireCat Desktop does this in a form;
from a terminal it takes a few commands.

**On this page:**

1. [How Asterisk keeps calls](#how-asterisk-keeps-calls)
2. [What you need](#what-you-need)
3. [Install](#install)
4. [Connect in WireCat Desktop](#connect-in-wirecat-desktop)
5. [Connect from the terminal](#connect-from-the-terminal)
6. [Numbers, directions and people](#numbers-directions-and-people)
7. [Import the history, then keep it current](#import-the-history-then-keep-it-current)
8. [Transcribe](#transcribe)
9. [Search the calls with everything else](#search-the-calls-with-everything-else)

## How Asterisk keeps calls

Asterisk is a phone system (PBX): the company's phone numbers and its employees' phones run through it. FreePBX,
Issabel and VitalPBX are Asterisk with a web admin panel, and keep calls the same way.

- **Extensions.** Each employee's phone has a short internal number, such as `101`. A ring group (`600`) rings
  several phones at once, and a queue (`700`) keeps a caller waiting until someone is free.
- **Call records (CDR).** When a call ends, Asterisk writes a record of it: who called whom, when, how long, and
  whether someone answered. The records go to the file `Master.csv`, to a database table, or to both. FreePBX
  keeps them in its MySQL database `asteriskcdrdb`.
- **One call, several records.** A ring group writes one record for each phone it rang, and a transfer one for each
  leg. `pbx` joins them back into one call and says what became of it: answered, voicemail, busy or not answered,
  who answered, how long the caller waited and how long they talked.
- **Recordings.** When recording is on, Asterisk saves one sound file per call, usually under
  `/var/spool/asterisk/monitor`. `pbx` finds each call's file by its name and links it to the call. It never copies,
  moves or changes the file.

`pbx` only reads. It needs no change to the dialplan (the rules that route calls), no Asterisk Manager Interface
(AMI) or REST Interface (ARI) account, and nothing installed on the phone system.

## What you need

- **Asterisk 1.8 or later**, or a system built on it: FreePBX, Issabel, VitalPBX. The record fields are those of the
  [CDR specification](https://docs.asterisk.org/Configuration/Reporting/Call-Detail-Records-CDR/CDR-Specification/).
- **The call records**, readable from the computer where `pbx` runs:

  | You have | Records in | You need |
  |---|---|---|
  | Plain Asterisk, `cdr_csv` on | `Master.csv`, usually `/var/log/asterisk/cdr-csv/Master.csv` | read access to the file |
  | FreePBX, Issabel, VitalPBX | MySQL or MariaDB (`cdr_mysql`, `cdr_adaptive_odbc`) | a read-only database user |
  | Records in PostgreSQL | PostgreSQL (`cdr_pgsql`) | a read-only database user |

  Not sure? On the phone system, `asterisk -rx "cdr show status"` lists the modules that write records.
- **The recordings**, if you want the text of the calls: a folder this computer can read, a folder mounted
  read-only, or the phone system's own folder over SFTP. WAV, wav49 (`.WAV`), GSM, MP3, Ogg, Opus, FLAC and M4A are
  found.

## Install

WireCat Desktop installs `pbx` for you: go on to [connect in WireCat Desktop](#connect-in-wirecat-desktop).

In a terminal, install it once on each computer where you or an agent use it. It needs Node.js 22.16 or a later
22.x, or 24 or later; Node 23 is not supported. Turning WAV and GSM recordings into text also needs `ffmpeg` on
`PATH`.

```sh
npm install -g @wirecat/asterisk-cli
pbx --version
pbx doctor
```

The command is `pbx`, and `wcat-pbx` is the same tool. Neither is called `asterisk`, so it can run on the phone
system too without hiding Asterisk's own program. `pbx doctor` needs no network and opens no keyring: it shows the
version, where the settings live, the profiles that exist, and whether other users of the computer can read the
settings.

## Connect in WireCat Desktop

1. On the **Tools** page, choose **Install** beside Asterisk, then **Manage**.
2. Under **Accounts**, add an account with a name for this phone system, such as `office`, and choose
   **Sign in here**.
3. Under **Where are the call records?**, choose **Master.csv file**, **MySQL or MariaDB** or **PostgreSQL**:
   - for **Master.csv file**, type its **Path of Master.csv** on this computer: a copy of the file, or a shared
     folder that holds it;
   - for a database, fill in **Database server**, **Database name**, **User** and the **Password of the database
     user**. **Port (optional)** stays empty for the usual port. Turn on **Encrypted connection** when the database
     is not on your own network.
4. **Recordings folder (optional)** is the folder of the call recordings on this computer. Calls come in without it
   too.
5. Under **Countries of your phone lines**, choose the countries. The form explains: "Callers are matched to your
   contacts by phone number. Asterisk often writes a number without its country code, so pick the countries your
   phone lines serve. Calls from other countries arrive with their + code anyway."
6. Start the sign-in. `pbx` reads the newest hour of calls to check the settings, and changes nothing. A database
   password is kept only once that check works. The sync then brings in the calls of the last 30 days, with their
   recordings.

The time zone of the records and the recordings' file names are on the account's **Settings** page. To turn
recordings into text, see [transcribe](#transcribe).

## Connect from the terminal

A profile is the name you give one phone system, such as `office`. It is the first word of every command that reads
that system's calls. Choose where the records are, set the profile up, then run `session start`, which checks the
settings by reading the newest calls.

### Master.csv

```sh
pbx office config set cdr_csv_path /var/log/asterisk/cdr-csv/Master.csv
pbx office config set cdr_timezone Europe/Moscow
pbx office session start
```

`Master.csv` has no header line. Which columns it has depends on `loguniqueid`, `loguserfield` and `newcdrcolumns` in
`cdr.conf` (`[csv]`), and `pbx` tells them apart by each line's count, so lines written after you turn one on are read
beside the older ones. Turn on `loguniqueid` and `newcdrcolumns` if you can: without the `uniqueid`, a recording
cannot be found by its name, and without `linkedid` and `sequence` the records of one call are joined by their
content only. If the guess is wrong, name the columns:

```sh
pbx office config set cdr_csv_columns "accountcode,src,dst,dcontext,clid,channel,dstchannel,lastapp,lastdata,start,answer,end,duration,billsec,disposition,amaflags,uniqueid"
```

Times in `Master.csv` are the phone system's local time unless `usegmtime=yes`. Set `cdr_timezone` to its zone, or
to `UTC` when `usegmtime` is on. Without it, this computer's zone is used.

When `pbx` runs on another computer, read `Master.csv` over [SFTP](#files-on-the-pbx-over-sftp), or mount the log
folder read-only, for example with `sshfs pbx:/var/log/asterisk/cdr-csv ~/pbx-cdr -o ro`.

### A CDR database

Create a user that may only read the records table. On MySQL or MariaDB:

```sql
CREATE USER 'wirecat_reader'@'10.0.0.%' IDENTIFIED BY 'a long random password';
GRANT SELECT ON asteriskcdrdb.cdr TO 'wirecat_reader'@'10.0.0.%';
```

On PostgreSQL:

```sql
CREATE ROLE wirecat_reader LOGIN PASSWORD 'a long random password';
GRANT SELECT ON cdr TO wirecat_reader;
```

Then set the profile up and sign in. The password is asked hidden and checked before it is kept:

```sh
pbx office config set cdr_source mysql
pbx office config set db_host 10.0.0.5
pbx office config set db_name asteriskcdrdb
pbx office config set db_user wirecat_reader
pbx office config set cdr_timezone Europe/Moscow
pbx office session start
```

`cdr_source postgres` reads PostgreSQL. `db_port` changes the port (3306 for MySQL, 5432 for PostgreSQL), `db_table`
the table (`cdr`), and `db_tls true` asks for an encrypted connection with a checked certificate. The session is
opened read-only, and the only statement sent is a `SELECT` of the records that started after the last sync, in pages
of 5,000.

FreePBX's database listens on the phone system itself only. Do not open it to the network: reach it through SSH, and
point `db_host` at the tunnel:

```sh
ssh -N -L 3306:127.0.0.1:3306 admin@pbx.example.lan &
pbx office config set db_host 127.0.0.1
```

### Recordings

```sh
pbx office config set recordings_path /var/spool/asterisk/monitor
```

A call's recording is found in this order:

1. the record's `recordingfile` column, which FreePBX fills, under the date folder `YYYY/MM/DD` or the folder itself;
   a name that leads outside `recordings_path` is ignored;
2. a file whose name holds the call's `uniqueid`, in `{yyyy}/{mm}/{dd}/` and then in the folder itself.

A dialplan that names files another way sets its own pattern, with `{uniqueid}`, `{linkedid}`, `{yyyy}`, `{mm}`,
`{dd}` and `*`:

```sh
pbx office config set recordings_pattern "calls/{yyyy}-{mm}-{dd}/*{linkedid}*"
```

A file changed in the last two minutes may still be being written, so it waits for the next sync. A call without a
recording is imported all the same. When the folder is on the phone system, read it over
[SFTP](#files-on-the-pbx-over-sftp), or mount it read-only, for example
`sshfs pbx:/var/spool/asterisk/monitor ~/pbx-monitor -o ro`, and set `recordings_path` to the mount.

### Files on the PBX over SFTP

`files_from sftp` reads `Master.csv` and the recordings on the phone system itself, through its SSH server. Nothing
is copied to a folder of its own and nothing is written there. Make a user that may only read those folders, for
example one in the `pbx` group, then:

```sh
pbx office config set files_from sftp
pbx office config set sftp_host pbx.example.lan
pbx office config set sftp_user wirecat
pbx office config set sftp_key_path ~/.ssh/wirecat_pbx      # or leave it out to sign in with a password
pbx office session start
```

The first `session start` connects only far enough to see the server's key, and stops. It prints the key's
fingerprint and the command that pins it. Compare the fingerprint with the phone system's own, from
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` there, and only then run that command
(`config set sftp_host_key SHA256:…`). No password or key is sent to a server whose key is not pinned, and a server
whose key changes is refused. Then `session start` asks the SFTP password, if there is no key file, checks it by
reading the newest call records, and keeps it in the keyring.

Paths are the phone system's: `cdr_csv_path /var/log/asterisk/cdr-csv/Master.csv`, `recordings_path
/var/spool/asterisk/monitor`. A profile keeps one saved password. A profile that reads its records from a database
keeps the database password, so it connects to SFTP with a key file. A dropped connection or a timeout is tried
again; a wrong password, a changed key or a missing file is not.

## Numbers, directions and people

- `phone_region` is the country of numbers written without `+`, such as `ru` for `89161234567`. Numbers are then kept
  as `+79161234567`, the form the other WireCat tools use, so the caller is the same person in calls and chats.
  Without it, only numbers written with `+` or `00` are made international.
- An office that takes calls from several countries lists them: `es,ru`. A number is read in the country it fits.
  A number that fits two of them, as `612345678` fits Spain, Germany and France, is kept as written and linked to
  no one, since a wrong country would join a stranger's contact; `meetings sync` says how many callers that left.
  List only the countries your phone lines serve: a call from anywhere else comes with its `+` or `00`.
- `extension_pattern` is a regular expression for your internal extensions; the default, `^\d{2,5}$`, takes numbers of
  two to five digits. A side of the call is internal when its channel (`PJSIP/101-…`) or its number matches.
- A call is **incoming** when an outside number reached an extension or came in through a `from-trunk`, `from-pstn`
  or `from-did` context, **outgoing** when an extension called an outside number, **internal** between two
  extensions. Otherwise its direction is left empty.
- A call's people are the outside number as `client`, with the caller ID name when the phone system had one, and as
  `manager` the extension that placed it and each extension that answered. A hidden number (`anonymous`,
  `Restricted`) or a dialplan name such as `s` is no person.
- A ring group or queue reaches its members through `Local/<extension>@…` channels; the extension in that channel,
  not the group's number, is the member who answered.

## Import the history, then keep it current

```sh
pbx office meetings sync --since-time 2024-01-01T00:00:00Z   # once: everything since then
pbx office meetings sync                                     # later: what is new
```

Each sync reads again the six hours before the last one, since a call is written to the records only when it ends. A
call already imported is updated, never doubled. A record that cannot be read is skipped and counted on stderr; the
rest are imported. Run the sync by hand, or from cron or a systemd timer.

## Transcribe

```sh
pbx models download gigaam-v3       # Russian; models list shows the others
pbx office meetings transcribe --max-meetings 50
```

Recognition runs on this computer, and the recordings are not sent anywhere. A recording already transcribed is not
read again unless the file changed; `--replace` transcribes again.

A recording can be up to one hour long. A WAV, GSM or M4A file can be up to 2 GB, and an MP3, Ogg or FLAC file up
to 256 MB. `Master.csv` on this computer or in a mounted folder can be of any size. Read over SFTP (the secure file
access of the phone system), it can be up to 512 MB, because it is read into memory whole.

Each line of a transcript can name who said it. Your dialplan records the two sides of a call either as one mixed
track (mono) or on two channels (stereo). A stereo recording in MP3, Ogg or FLAC keeps the channels apart. Tell
`pbx` which side is on the first channel:

```sh
pbx office config set recordings_channels employee,caller    # or caller,employee
pbx office meetings transcribe --replace
```

Each line then names the caller by name and number, such as `Ivan Testov +79000000001`, or the employee by
extension and name, such as `101 Oleg Operatorov`. Without the setting, the lines say `Channel 1` and `Channel 2`.
To find out which side is on which channel, transcribe one call and read it. A mono recording, and a WAV, GSM or
M4A recording, gives the text without names, because ffmpeg mixes the channels into one. A call between two
extensions keeps `Channel 1` and `Channel 2`, since it has no caller from outside.

## Search the calls with everything else

The calls are in the WireCat store every WireCat tool reads. An agent with `memo` asks about one person across
calls, chats and mail; `search all` in any WireCat CLI searches them together. Next: [use it](usage.md), how commands
are built and how an agent reads the calls.
