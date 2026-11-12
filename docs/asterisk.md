# Connect your Asterisk

`asterisk` reads two things from your PBX: the call records (CDR) and, when there are any, the recordings. This page
says where to find each, what access to give, and how to set a profile up. It needs no change to the dialplan and no
Asterisk Manager Interface (AMI) or REST Interface (ARI) account.

## What is supported

- **Asterisk 1.8 and later**, and the systems built on it: FreePBX, Issabel, VitalPBX. The CDR fields are those of
  the [CDR specification](https://docs.asterisk.org/Configuration/Reporting/Call-Detail-Records-CDR/CDR-Specification/).
- **Call records** from one of:
  - `Master.csv`, written by the `cdr_csv` module, usually `/var/log/asterisk/cdr-csv/Master.csv`;
  - a MySQL or MariaDB table (`cdr_mysql`, `cdr_adaptive_odbc`; FreePBX keeps it in `asteriskcdrdb.cdr`);
  - a PostgreSQL table (`cdr_pgsql`).
- **Recordings** in a folder this computer can read: a local folder, or the PBX's folder mounted read-only.
  WAV, wav49 (`.WAV`), GSM, MP3, Ogg, Opus, FLAC and M4A are found; WAV and GSM need `ffmpeg` to be transcribed.

Checked so far with the made-up records and recordings in `examples/`, built from the CDR specification and the
`cdr_csv` source, not yet with a live PBX.

## Choose a source

| You have | Set `cdr_source` | You need |
|---|---|---|
| Plain Asterisk, `cdr_csv` on | `csv` (the default) | read access to `Master.csv` |
| FreePBX, Issabel, VitalPBX | `mysql` | a read-only database user |
| CDR in PostgreSQL | `postgres` | a read-only database user |

Not sure? On the PBX, `asterisk -rx "cdr show status"` lists the CDR modules that write records.

## Master.csv

```sh
asterisk office config set cdr_csv_path /var/log/asterisk/cdr-csv/Master.csv
asterisk office config set cdr_timezone Europe/Moscow
```

`Master.csv` has no header line. Which columns it has depends on `loguniqueid`, `loguserfield` and `newcdrcolumns` in
`cdr.conf` (`[csv]`), and `asterisk` tells them apart by their count. Turn on `loguniqueid` and `newcdrcolumns` if
you can: without the `uniqueid`, a recording cannot be found by its name, and without `linkedid` and `sequence` the
legs of a transfer are told apart by their content only. If the guess is wrong, name the columns:

```sh
asterisk office config set cdr_csv_columns "accountcode,src,dst,dcontext,clid,channel,dstchannel,lastapp,lastdata,start,answer,end,duration,billsec,disposition,amaflags,uniqueid"
```

Times in `Master.csv` are the PBX's local time unless `usegmtime=yes`. Set `cdr_timezone` to the PBX's zone, or to
`UTC` when `usegmtime` is on. Without it, this computer's zone is used.

When `asterisk` runs on another computer, copy `Master.csv` there on a schedule, or mount the PBX's log folder
read-only, for example with `sshfs pbx:/var/log/asterisk/cdr-csv ~/pbx-cdr -o ro`.

## A CDR database

Create a user that may only read the CDR table. On MySQL or MariaDB:

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
asterisk office config set cdr_source mysql
asterisk office config set db_host 10.0.0.5
asterisk office config set db_name asteriskcdrdb
asterisk office config set db_user wirecat_reader
asterisk office config set cdr_timezone Europe/Moscow
asterisk office session start
```

`db_port` changes the port (3306 for MySQL, 5432 for PostgreSQL), `db_table` the table (`cdr`), and `db_tls true`
asks for an encrypted connection with a checked certificate. The session is opened read-only, and the only statement
sent is a `SELECT` of the rows that started after the last sync, in pages of 5,000.

FreePBX's database listens on the PBX itself only. Do not open it to the network; reach it through SSH instead, and
point `db_host` at the tunnel:

```sh
ssh -N -L 3306:127.0.0.1:3306 admin@pbx.example.lan &
asterisk office config set db_host 127.0.0.1
```

## Recordings

```sh
asterisk office config set recordings_path /var/spool/asterisk/monitor
```

A call's recording is found in this order:

1. the CDR's `recordingfile` column, which FreePBX fills, under the date folder `YYYY/MM/DD` or the folder itself;
2. a file whose name holds the call's `uniqueid`, in `{yyyy}/{mm}/{dd}/` and then in the folder itself.

A dialplan that names files another way sets its own pattern, with `{uniqueid}`, `{linkedid}`, `{yyyy}`, `{mm}`,
`{dd}` and `*`:

```sh
asterisk office config set recordings_pattern "calls/{yyyy}-{mm}-{dd}/*{linkedid}*"
```

A file changed in the last two minutes may still be written by MixMonitor, so it is left for the next sync. A call
without a recording is imported all the same. The recording is linked by its path: it is never copied, moved or
changed. When the folder is on the PBX, mount it read-only, for example
`sshfs pbx:/var/spool/asterisk/monitor ~/pbx-monitor -o ro`, and set `recordings_path` to the mount.

## Numbers, directions and people

- `phone_region` is the country of numbers written without `+`, such as `ru` for `89161234567`. Numbers are then kept
  as `+79161234567`, the form the other WireCat tools use, so the caller is the same person in calls and chats.
  Without it, only numbers written with `+` or `00` are made international.
- `extension_pattern` is a regular expression for your internal extensions; the default, `^\d{2,5}$`, takes numbers of
  two to five digits. A side of the call is internal when its channel (`PJSIP/101-…`) or its number matches.
- A call is **incoming** when an outside number reached an extension or came in through a `from-trunk`, `from-pstn`
  or `from-did` context, **outgoing** when an extension called an outside number, **internal** between two
  extensions. Otherwise its direction is left empty.
- Each call has two people: the extension as `manager`, the outside number as `client`, with the caller ID name when
  the PBX had one.

## Import the history, then keep it current

```sh
asterisk office meetings sync --since-time 2024-01-01T00:00:00Z   # once: everything since then
asterisk office meetings sync                                     # later: what is new
```

Each sync reads again the six hours before the last one, since a call is written to the CDR only when it ends. A
record already imported is updated, never doubled. A row that cannot be read is skipped and counted on stderr; the
rest are imported. Run the sync by hand, or from cron or a systemd timer.

## Transcribe

```sh
asterisk models download gigaam-v3       # Russian; models list shows the others
asterisk office meetings transcribe --max-meetings 50
```

Recognition runs on this computer. A recording already transcribed is not read again unless the file changed;
`--replace` transcribes again.

## Search the calls with everything else

The calls are in the WireCat store every WireCat tool reads. An agent with `memo` asks about one person across
calls, chats and mail; `search all` in any WireCat CLI searches them together.
