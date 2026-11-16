#!/usr/bin/env bash
# The release's live check (WC-TEST-18, WC-REL-17): the built CLI against a real MariaDB and a real PostgreSQL server
# in Docker, each holding the CDR rows of examples/Master.csv in FreePBX's table shape and a user that may only
# SELECT, and against the Master.csv file itself. MariaDB is read once more through an SSH server that only forwards,
# as FreePBX's database is reached, with the recordings over SFTP: three passwords in one profile. The unit tests drive the SQL drivers through stand-ins; this run
# is where mysql2, pg, a read-only session and a password on stdin meet real servers. No PBX and no owner account:
# every folder is temporary, the keyring is out of reach, and the containers are removed at the end.
#   scripts/live.sh
# Record a passed run with `pnpm exec cli-dev live record --script scripts/live.sh`.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
run="asterisk-live-$$"
cleanup() {
  docker rm -f "$run-mariadb" "$run-postgres" "$run-sftp" "$run-ssh" >/dev/null 2>&1 || true
  docker network rm "$run-net" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

export PBX_CONFIG_DIR="$work/config" PBX_STATE_DIR="$work/state" PBX_CACHE_DIR="$work/cache"
export MESSAGING_STORE="$work/wirecat.db"
unset PBX_TOKEN PBX_TOKEN_SFTP PBX_TOKEN_SSH OPENAI_API_KEY
# Only the CLI loses the keyring: docker reads its registry login over D-Bus.
cli=(env DBUS_SESSION_BUS_ADDRESS=disabled: node "$root/dist/bin/pbx.js")
password=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("base64url"))')

pnpm --dir "$root" -s build >/dev/null

"${cli[@]}" --wcat-describe | node -e '
  const answer = JSON.parse(require("fs").readFileSync(0, "utf8"))
  if (answer.wcat_describe !== 2 || !/^[0-9a-f]{64}$/.test(answer.manifest_sha256)) throw new Error("not format 2")'

docker network create "$run-net" >/dev/null
docker run -d --name "$run-mariadb" --network "$run-net" -p 127.0.0.1::3306 -e MARIADB_ROOT_PASSWORD="$password" \
  -e MARIADB_DATABASE=asteriskcdrdb mariadb:11.4 >/dev/null
# An SSH server beside the database, as on a FreePBX box: it may forward to MariaDB and do nothing else.
ssh_password="$password-ssh"
docker run -d --name "$run-ssh" --network "$run-net" -p 127.0.0.1::22 -e SSH_PASSWORD="$ssh_password" alpine:3.22 sh -c \
  'apk add --no-cache -q openssh && ssh-keygen -A && adduser -D -s /sbin/nologin wirecat &&
   echo "wirecat:$SSH_PASSWORD" | chpasswd 2>/dev/null &&
   exec /usr/sbin/sshd -D -e -o AllowTcpForwarding=yes -o PasswordAuthentication=yes -o PermitTTY=no \
     -o ForceCommand=/bin/false' >/dev/null
# The PBX's folders as an SFTP server shows them, read only, to a user with a password.
mkdir -p "$work/pbx/cdr-csv" "$work/pbx/monitor"
cp "$root/examples/Master.csv" "$work/pbx/cdr-csv/"
cp -r "$root/examples/monitor/." "$work/pbx/monitor/"
chmod -R a+rX "$work/pbx"
# A recording changed in the last two minutes counts as still being written.
find "$work/pbx" -type f -exec touch -d "1 hour ago" {} +
docker run -d --name "$run-sftp" -p 127.0.0.1::22 -v "$work/pbx:/home/wirecat/pbx:ro" atmoz/sftp:alpine \
  "wirecat:$password:1001" >/dev/null
docker run -d --name "$run-postgres" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD="$password" \
  -e POSTGRES_DB=asteriskcdrdb postgres:18-alpine >/dev/null

# FreePBX's cdr columns that Asterisk fills, with the example rows; `reader` may only SELECT.
node --input-type=module - "$root/examples/Master.csv" "$work" "$password" <<'EOF'
import { readFileSync, writeFileSync } from "node:fs"
const [csv, work, password] = process.argv.slice(2)
const fields = ["accountcode", "src", "dst", "dcontext", "clid", "channel", "dstchannel", "lastapp", "lastdata",
  "calldate", "answer", "end", "duration", "billsec", "disposition", "amaflags", "uniqueid", "userfield",
  "peeraccount", "linkedid", "sequence"]
const rows = readFileSync(csv, "utf8").trim().split("\n").map((line) =>
  [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map(([, cell]) =>
    cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell).slice(0, fields.length))
// Master.csv writes the AMA flag's name; the database keeps its number.
const FLAGS = { OMIT: "1", BILLING: "2", DOCUMENTATION: "3" }
const kept = fields.filter((field) => !["answer", "end"].includes(field))
const value = (text) => `'${text.replaceAll("'", "''")}'`
const inserts = rows.map((cells) => `INSERT INTO cdr (${kept.join(", ")}) VALUES (${
  kept.map((field) => value(field === "amaflags" ? FLAGS[cells[fields.indexOf(field)]] ?? "3" : cells[fields.indexOf(field)] ?? "")).join(", ")});`).join("\n")
const columns = (time, integer) => kept.map((field) =>
  `${field} ${field === "calldate" ? time : ["duration", "billsec", "amaflags", "sequence"].includes(field) ? integer : "varchar(255) NOT NULL DEFAULT ''"}`
).join(", ")
writeFileSync(`${work}/mariadb.sql`, `CREATE TABLE cdr (${columns("datetime NOT NULL", "int NOT NULL DEFAULT 0")}, recordingfile varchar(255) NOT NULL DEFAULT '');
${inserts}
CREATE USER 'reader'@'%' IDENTIFIED BY ${value(password)};
GRANT SELECT ON asteriskcdrdb.cdr TO 'reader'@'%';
CREATE DATABASE asterisk;
CREATE TABLE asterisk.users (extension varchar(20) NOT NULL, name varchar(50) NOT NULL, secret varchar(50) NOT NULL);
INSERT INTO asterisk.users VALUES ('101', 'Oleg Livetestov', 'not-read'), ('103', 'Vera Livetestova', 'not-read');
GRANT SELECT (extension, name) ON asterisk.users TO 'reader'@'%';
`)
writeFileSync(`${work}/postgres.sql`, `CREATE TABLE cdr (${columns("timestamp NOT NULL", "integer NOT NULL DEFAULT 0")}, recordingfile varchar(255) NOT NULL DEFAULT '');
${inserts}
CREATE ROLE reader LOGIN PASSWORD ${value(password)};
GRANT SELECT ON cdr TO reader;
`)
EOF

for _ in $(seq 90); do
  docker exec "$run-mariadb" mariadb-admin ping -uroot -p"$password" --silent >/dev/null 2>&1 &&
    docker exec "$run-postgres" pg_isready -U postgres -d asteriskcdrdb >/dev/null 2>&1 && break
  sleep 2
done
# Both servers restart once after their first start; loading waits until that restart is over.
loaded() { docker exec -i "$1" "${@:2}" >/dev/null 2>&1; }
for _ in $(seq 60); do
  loaded "$run-mariadb" mariadb -uroot -p"$password" asteriskcdrdb <"$work/mariadb.sql" && break
  sleep 2
done
for _ in $(seq 60); do
  loaded "$run-postgres" psql -q -v ON_ERROR_STOP=1 -U postgres -d asteriskcdrdb <"$work/postgres.sql" && break
  sleep 2
done

count() {
  "${cli[@]}" "$1" meetings list --limit 100 --json | node -e '
    const list = JSON.parse(require("fs").readFileSync(0, "utf8"))
    if (list.items.length !== Number(process.argv[1])) throw new Error(`${list.items.length} calls, not ${process.argv[1]}`)
    const titles = list.items.map(({ title }) => title)
    if (!titles.includes("+79000000001 → 101")) throw new Error("the incoming call is missing")' "$2"
}

check() {
  local profile=$1
  shift
  for setting in "$@"; do "${cli[@]}" "$profile" config set ${setting} >/dev/null; done
  "${cli[@]}" "$profile" config set cdr_timezone UTC >/dev/null
  "${cli[@]}" "$profile" config set phone_region ru >/dev/null
  printf '%s\n' "$password" | "${cli[@]}" "$profile" session start --credential-storage file --json >/dev/null
  "${cli[@]}" "$profile" session status --check --json >/dev/null
  "${cli[@]}" "$profile" meetings sync --since-time 2026-10-01T00:00:00Z --json >/dev/null
  count "$profile" 5
  "${cli[@]}" "$profile" meetings sync --since-time 2026-10-01T00:00:00Z --json >/dev/null
  count "$profile" 5
  "${cli[@]}" "$profile" session end --json >/dev/null
}

port() { docker port "$1" "$2" | head -1 | sed 's/.*://'; }

check live-csv "cdr_csv_path $root/examples/Master.csv" "recordings_path $root/examples/monitor"
check live-mariadb "cdr_source mysql" "db_host 127.0.0.1" "db_port $(port "$run-mariadb" 3306)" \
  "db_name asteriskcdrdb" "db_user reader"
# FreePBX's names, read with the column grant alone: 103 never places a call, so its name comes only from there.
"${cli[@]}" live-mariadb stats calls show --since-time 2026-10-01 --json | node -e '
  const { item } = JSON.parse(require("fs").readFileSync(0, "utf8"))
  const names = Object.fromEntries(item.employees.map(({ extension, name }) => [extension, name]))
  if (names["103"] !== "Vera Livetestova" || names["101"] !== "Oleg Livetestov") throw new Error(JSON.stringify(names))'
check live-postgres "cdr_source postgres" "db_host 127.0.0.1" "db_port $(port "$run-postgres" 5432)" \
  "db_name asteriskcdrdb" "db_user reader"

# SFTP: the first session start shows the server's key and stops; pinned after comparing it with the server's own.
sftp_port=$(port "$run-sftp" 22)
for _ in $(seq 30); do docker exec "$run-sftp" test -f /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null && break; sleep 1; done
sleep 2
for setting in "files_from sftp" "sftp_host 127.0.0.1" "sftp_port $sftp_port" "sftp_user wirecat" \
  "cdr_csv_path /pbx/cdr-csv/Master.csv" "recordings_path /pbx/monitor" "cdr_timezone UTC" "phone_region ru"; do
  "${cli[@]}" live-sftp config set ${setting} >/dev/null
done
if printf '%s\n' "$password" | "${cli[@]}" live-sftp session start --json >"$work/unpinned.json" 2>&1; then
  echo "an unpinned SFTP server was accepted" >&2
  exit 1
fi
shown=$(grep -o 'SHA256:[A-Za-z0-9+/=]*' "$work/unpinned.json" | head -1)
actual=$(docker exec "$run-sftp" ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}')
[ -n "$shown" ] && [ "$shown" = "$actual" ] || { echo "the fingerprint shown is not the server's" >&2; exit 1; }
"${cli[@]}" live-sftp config set sftp_host_key "$shown" >/dev/null
printf '%s\n' "$password" | "${cli[@]}" live-sftp session start --credential-storage file --json >/dev/null
"${cli[@]}" live-sftp meetings sync --since-time 2026-10-01T00:00:00Z --json >/dev/null
count live-sftp 5
incoming=$("${cli[@]}" live-sftp meetings list --limit 100 --json | node -e '
  const list = JSON.parse(require("fs").readFileSync(0, "utf8"))
  console.log(list.items.find(({ title }) => title === "+79000000001 → 101").id)')
"${cli[@]}" live-sftp meetings show "$incoming" --json | grep -q '"kind":"recording"' ||
  { echo "no recording linked over SFTP" >&2; exit 1; }
"${cli[@]}" live-sftp session end --json >/dev/null

if printf 'wrong\n' | "${cli[@]}" live-postgres session start --credential-storage file --json >"$work/wrong.json" 2>&1; then
  echo "a wrong password was accepted" >&2
  exit 1
fi
grep -q '"db.refused"' "$work/wrong.json"
! grep -q "$password" "$work/wrong.json"
# The tunnel: the SSH server's key is shown and pinned as SFTP's was, then three passwords go in, one per line.
ssh_port=$(port "$run-ssh" 22)
for _ in $(seq 60); do docker exec "$run-ssh" pgrep -x sshd >/dev/null 2>&1 && break; sleep 1; done
for setting in "cdr_source mysql" "db_host $run-mariadb" "db_port 3306" "db_name asteriskcdrdb" "db_user reader" \
  "db_ssh_host 127.0.0.1" "db_ssh_port $ssh_port" "db_ssh_user wirecat" "files_from sftp" "sftp_host 127.0.0.1" \
  "sftp_port $sftp_port" "sftp_user wirecat" "sftp_host_key $shown" "recordings_path /pbx/monitor" \
  "cdr_timezone UTC" "phone_region ru"; do
  "${cli[@]}" live-tunnel config set ${setting} >/dev/null
done
three=$(printf '%s\n%s\n%s\n' "$password" "$ssh_password" "$password")
if printf '%s\n' "$three" | "${cli[@]}" live-tunnel session start --json >"$work/unpinned-ssh.json" 2>&1; then
  echo "an unpinned SSH server was accepted" >&2
  exit 1
fi
ssh_shown=$(grep -o 'SHA256:[A-Za-z0-9+/=]*' "$work/unpinned-ssh.json" | head -1)
ssh_actual=$(docker exec "$run-ssh" ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | awk '{print $2}')
[ -n "$ssh_shown" ] && [ "$ssh_shown" = "$ssh_actual" ] || { echo "the SSH fingerprint shown is not the server's" >&2; exit 1; }
! grep -q "$ssh_password" "$work/unpinned-ssh.json"
"${cli[@]}" live-tunnel config set db_ssh_host_key "$ssh_shown" >/dev/null
printf '%s\n' "$three" | "${cli[@]}" live-tunnel session start --credential-storage file --json |
  grep -q '"passwords":\["db","ssh","sftp"\]' || { echo "the tunnel profile did not keep three passwords" >&2; exit 1; }
"${cli[@]}" live-tunnel meetings sync --since-time 2026-10-01T00:00:00Z --json >/dev/null
count live-tunnel 5
tunneled=$("${cli[@]}" live-tunnel meetings list --limit 100 --json | node -e '
  const list = JSON.parse(require("fs").readFileSync(0, "utf8"))
  console.log(list.items.find(({ title }) => title === "+79000000001 → 101").id)')
"${cli[@]}" live-tunnel meetings show "$tunneled" --json | grep -q '"kind":"recording"' ||
  { echo "no recording linked over SFTP beside the tunnel" >&2; exit 1; }
"${cli[@]}" live-tunnel session status --check --json | grep -q '"verified":true'
"${cli[@]}" live-tunnel session end --json >/dev/null

# The setup flow, as WireCat Desktop runs it: every answer as one JSON line on stdin, saved only after the check reads
# MariaDB through the tunnel with the files over SFTP. Passwords go through printf, a builtin, never an argument.
answers() {
  printf '{"cdr_source":"mysql","files_from":"sftp","sftp_host":"127.0.0.1","sftp_port":%s,"sftp_user":"wirecat",' \
    "$sftp_port"
  printf '"sftp":"%s","db_host":"%s","db_port":3306,"db_user":"reader","db":"%s","db_ssh_host":"127.0.0.1",' \
    "$password" "$1" "$password"
  printf '"db_ssh_port":%s,"db_ssh_user":"wirecat","ssh":"%s","recordings_path_remote":"/pbx/monitor",' \
    "$ssh_port" "$ssh_password"
  printf '"phone_region":["RU"]%s}\n' "$2"
}
values() { "${cli[@]}" live-setup setup show --json | node -e '
  process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0, "utf8")).item.values ?? {}))'; }
answers "$run-mariadb" "" | "${cli[@]}" live-setup setup apply --dry-run --json | grep -q '"valid":true' ||
  { echo "the setup answers did not pass the dry run" >&2; exit 1; }
if answers "$run-mariadb" "" | "${cli[@]}" live-setup setup run apply --json --answer-stdin >"$work/setup.json" 2>&1; then
  echo "setup accepted an unpinned SFTP server" >&2
  exit 1
fi
grep -q '"sftp.host-key-missing"' "$work/setup.json" && ! grep -q "$password" "$work/setup.json"
values | grep -q '"db_host"' && { echo "a failed setup saved settings" >&2; exit 1; }
pinned=",\"sftp_host_key\":\"$shown\",\"db_ssh_host_key\":\"$ssh_shown\""
answers "$run-mariadb" "$pinned" | "${cli[@]}" live-setup setup run apply --json --answer-stdin 2>/dev/null |
  grep -q '"outcome":"ok"' || { echo "setup did not save a working profile" >&2; exit 1; }
"${cli[@]}" live-setup meetings sync --since-time 2026-10-01T00:00:00Z --json >/dev/null
count live-setup 5
moved='{"cdr_source":"mysql","files_from":"sftp","db_host":"127.0.0.2","phone_region":["RU"]}'
if printf '%s\n' "$moved" | "${cli[@]}" live-setup setup apply --json >"$work/moved.json" 2>&1; then
  echo "setup tried the old password on a changed database server" >&2
  exit 1
fi
grep -q '"param":"db"' "$work/moved.json"
"${cli[@]}" live-setup session end --json >/dev/null

# The calls' numbers and marks, from the store the CSV profile filled.
"${cli[@]}" live-csv stats calls show --since-time 2026-10-01 --json | node -e '
  const { item } = JSON.parse(require("fs").readFileSync(0, "utf8"))
  if (item.calls !== 5 || item.by_direction.incoming !== 3 || item.missed.calls !== 1) throw new Error("stats are off")'
marked=$("${cli[@]}" live-csv meetings list --limit 100 --json | node -e '
  const list = JSON.parse(require("fs").readFileSync(0, "utf8"))
  console.log(list.items.find(({ title }) => title === "+79000000001 → 101").id)')
"${cli[@]}" live-csv tags add callback --meeting "$marked" --json >/dev/null
"${cli[@]}" live-csv tags list tag:callback --json | node -e '
  const list = JSON.parse(require("fs").readFileSync(0, "utf8"))
  if (list.items.length !== 1) throw new Error(`${list.items.length} marked calls, not 1`)'
"${cli[@]}" live-csv search meetings refund --json >/dev/null

"${cli[@]}" doctor --json >/dev/null

echo "live check passed: describe format 2; Master.csv, MariaDB 11.4 and PostgreSQL 18 each imported 5 calls (6 CDR rows, a transfer joined) twice without doubles; SFTP (atmoz/sftp) shown its key, pinned, read Master.csv and linked recordings; MariaDB through an OpenSSH tunnel, its key shown and pinned, with three passwords in one profile; the setup flow refused an unpinned server, saved the same profile once pinned, and refused a changed server without its password; FreePBX's asterisk.users named the extensions through a column grant; stats, a mark and a search over the stored calls; a wrong password refused"
