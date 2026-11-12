#!/usr/bin/env bash
# The release's live check against the real service (WC-TEST-18, WC-REL-17): a person runs it with a real token on
# stdin, then records it with `pnpm exec cli-dev live record --script scripts/live.sh`. Every folder is a temporary
# one and the keyring is out of reach, so nothing touches the owner's store, keyring or settings.
#   scripts/live.sh < token-file
# SAMPLE: replace the comments reads with your own commands; checked against the sample, it fails at sign-in.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

export ASTERISK_CONFIG_DIR="$work/config" ASTERISK_STATE_DIR="$work/state" ASTERISK_CACHE_DIR="$work/cache"
export MESSAGING_STORE="$work/wirecat.db"
export DBUS_SESSION_BUS_ADDRESS="disabled:"
unset ASTERISK_TOKEN
cli=(node "$root/dist/bin/asterisk.js")

pnpm --dir "$root" -s build >/dev/null

"${cli[@]}" --wcat-describe | node -e '
  const answer = JSON.parse(require("fs").readFileSync(0, "utf8"))
  if (answer.wcat_describe !== 2 || !/^[0-9a-f]{64}$/.test(answer.manifest_sha256)) throw new Error("not format 2")'

"${cli[@]}" live session start --credential-storage file --json >/dev/null
trap '"${cli[@]}" live session end --json >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

"${cli[@]}" live comments list --json >"$work/list.json"
node -e '
  const list = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  if (!Array.isArray(list.items)) throw new Error(`no items: ${JSON.stringify(list).slice(0, 200)}`)' "$work/list.json"
"${cli[@]}" live doctor --json >/dev/null

"${cli[@]}" live session end --json >/dev/null
echo "live check passed: describe format 2, sign-in, comments list, doctor, sign-out"
