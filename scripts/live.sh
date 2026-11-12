#!/usr/bin/env bash
# The release's live check (WC-TEST-18, WC-REL-17): the built CLI against a real MariaDB and a real PostgreSQL server
# in Docker, each holding the CDR rows of examples/Master.csv in FreePBX's table shape and a user that may only
# SELECT, and against the Master.csv file itself. The unit tests drive the SQL drivers through stand-ins; this run
# is where mysql2, pg, a read-only session and a password on stdin meet real servers. No PBX and no owner account:
# every folder is temporary, the keyring is out of reach, and the containers are removed at the end.
#   scripts/live.sh
# Record a passed run with `pnpm exec cli-dev live record --script scripts/live.sh`.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
run="asterisk-live-$$"
cleanup() {
  docker rm -f "$run-mariadb" "$run-postgres" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

export ASTERISK_CONFIG_DIR="$work/config" ASTERISK_STATE_DIR="$work/state" ASTERISK_CACHE_DIR="$work/cache"
export MESSAGING_STORE="$work/wirecat.db"
unset ASTERISK_TOKEN
# Only the CLI loses the keyring: docker reads its registry login over D-Bus.
cli=(env DBUS_SESSION_BUS_ADDRESS=disabled: node "$root/dist/bin/asterisk.js")
password=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(18).toString("base64url"))')

pnpm --dir "$root" -s build >/dev/null

"${cli[@]}" --wcat-describe | node -e '
  const answer = JSON.parse(require("fs").readFileSync(0, "utf8"))
  if (answer.wcat_describe !== 2 || !/^[0-9a-f]{64}$/.test(answer.manifest_sha256)) throw new Error("not format 2")'

docker run -d --name "$run-mariadb" -p 127.0.0.1::3306 -e MARIADB_ROOT_PASSWORD="$password" \
  -e MARIADB_DATABASE=asteriskcdrdb mariadb:11.4 >/dev/null
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
sleep 3
docker exec -i "$run-mariadb" mariadb -uroot -p"$password" asteriskcdrdb <"$work/mariadb.sql"
docker exec -i "$run-postgres" psql -q -v ON_ERROR_STOP=1 -U postgres -d asteriskcdrdb <"$work/postgres.sql" >/dev/null

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
  count "$profile" 6
  "${cli[@]}" "$profile" meetings sync --since-time 2026-10-01T00:00:00Z --json >/dev/null
  count "$profile" 6
  "${cli[@]}" "$profile" session end --json >/dev/null
}

port() { docker port "$1" "$2" | head -1 | sed 's/.*://'; }

check live-csv "cdr_csv_path $root/examples/Master.csv" "recordings_path $root/examples/monitor"
check live-mariadb "cdr_source mysql" "db_host 127.0.0.1" "db_port $(port "$run-mariadb" 3306)" \
  "db_name asteriskcdrdb" "db_user reader"
check live-postgres "cdr_source postgres" "db_host 127.0.0.1" "db_port $(port "$run-postgres" 5432)" \
  "db_name asteriskcdrdb" "db_user reader"

if printf 'wrong\n' | "${cli[@]}" live-postgres session start --credential-storage file --json >"$work/wrong.json" 2>&1; then
  echo "a wrong password was accepted" >&2
  exit 1
fi
grep -q '"db.refused"' "$work/wrong.json"
! grep -q "$password" "$work/wrong.json"
"${cli[@]}" doctor --json >/dev/null

echo "live check passed: describe format 2; Master.csv, MariaDB 11.4 and PostgreSQL 18 each imported 6 calls twice without doubles; a wrong password refused"
