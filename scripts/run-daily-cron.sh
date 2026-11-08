#!/bin/sh
# Daily incremental jobs crawl for the NAS host.
#
# Run from crontab or n8n once a day:
#   17 4 * * * /volume1/workspace/dev/5060do/scripts/run-daily-cron.sh
#
# The NAS package ships a node binary but no npm, so this wrapper calls the
# script directly. It also serializes runs with flock and appends a readable
# summary to docs/logs/cron-jobs.log on every attempt.

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
LOG_DIR="$REPO_ROOT/docs/logs"
LOG_FILE="$LOG_DIR/cron-jobs.log"
LOCK_FILE="${CRON_JOBS_LOCK:-/tmp/5060do-cron-jobs.lock}"

mkdir -p "$LOG_DIR" || exit 2

resolve_node() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "${NODE_BIN}" ]; then
    printf '%s' "${NODE_BIN}"
    return 0
  fi
  for candidate in \
    /volume1/@appstore/Node.js_v22/usr/local/bin/node \
    /volume1/@appstore/Node.js_v20/usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  command -v node 2>/dev/null || true
}

NODE_BIN=$(resolve_node)
if [ -z "$NODE_BIN" ]; then
  printf '[%s] ERROR node binary not found\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
  exit 2
fi

# A slow crawl must not overlap the next cron tick.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf '[%s] SKIP previous run still holds %s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$LOCK_FILE" >> "$LOG_FILE"
  exit 0
fi

cd "$REPO_ROOT" || exit 2

STAMP_START=$(date '+%Y-%m-%d %H:%M:%S')
START_EPOCH=$(date '+%s')
TMP_OUT=$(mktemp "${TMPDIR:-/tmp}/5060do-cron-jobs.XXXXXX") || exit 2

printf '\n[%s] START daily cron:jobs node=%s repo=%s\n' \
  "$STAMP_START" "$NODE_BIN" "$REPO_ROOT" >> "$LOG_FILE"

"$NODE_BIN" --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/crawl-incremental-jobs.mjs --update-local >"$TMP_OUT" 2>&1
STATUS=$?

cat "$TMP_OUT" >> "$LOG_FILE"

SUMMARY=$(grep -E 'new=.*upserted=' "$TMP_OUT" | tail -n 1)
REMOTE=$(grep -E 'remote total=' "$TMP_OUT" | tail -n 1)
EVIDENCE=$(grep -E '^evidence=' "$TMP_OUT" | tail -n 1)
END_EPOCH=$(date '+%s')
ELAPSED=$((END_EPOCH - START_EPOCH))

printf '[%s] END exit=%s elapsed=%ss summary="%s" %s %s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$STATUS" "$ELAPSED" \
  "${SUMMARY:-no-summary}" "${REMOTE:-"remote total=n/a"}" "${EVIDENCE:-""}" >> "$LOG_FILE"

rm -f "$TMP_OUT"
exit "$STATUS"
