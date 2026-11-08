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

# A cron run has no terminal. Fail fast instead of waiting on a credential
# prompt, then let the caller read the exit code from the log.
export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=never

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

# The crawler rewrites two tracked JSON bundles. Commit and publish only those
# files, and only when the content actually changed, so a no-news day leaves the
# checkout clean and the GitHub mirror stays a best-effort step (the NAS has no
# GitHub credential, so auto mode skips it unless one is stored).
sync_jobs_data() {
  STAMP=$(date '+%Y-%m-%d %H:%M:%S')
  if ! command -v git >/dev/null 2>&1; then
    printf '[%s] GIT skip git binary not found\n' "$STAMP" >> "$LOG_FILE"
    return 0
  fi

  CHANGED=$(git status --porcelain -- src/data/jobs_all.json src/data/jobs_recent.json)
  if [ -z "$CHANGED" ]; then
    printf '[%s] GIT no data change\n' "$STAMP" >> "$LOG_FILE"
    return 0
  fi

  DAY=$(date '+%Y-%m-%d')
  if ! git add -- src/data/jobs_all.json src/data/jobs_recent.json >> "$LOG_FILE" 2>&1; then
    printf '[%s] GIT add failed\n' "$STAMP" >> "$LOG_FILE"
    return 1
  fi
  if git diff --cached --quiet -- src/data/jobs_all.json src/data/jobs_recent.json; then
    printf '[%s] GIT nothing staged\n' "$STAMP" >> "$LOG_FILE"
    return 0
  fi
  if ! git commit -m "chore(data): sync incremental jobs ($DAY)" >> "$LOG_FILE" 2>&1; then
    printf '[%s] GIT commit failed\n' "$STAMP" >> "$LOG_FILE"
    return 1
  fi
  COMMIT=$(git rev-parse --short HEAD)
  printf '[%s] GIT commit=%s\n' "$STAMP" "$COMMIT" >> "$LOG_FILE"

  if git push origin master >> "$LOG_FILE" 2>&1; then
    printf '[%s] GIT origin push ok\n' "$STAMP" >> "$LOG_FILE"
  else
    printf '[%s] GIT origin push failed\n' "$STAMP" >> "$LOG_FILE"
    return 1
  fi

  case "${CRON_GITHUB_PUSH:-auto}" in
    0)
      printf '[%s] GITHUB skip disabled by CRON_GITHUB_PUSH=0\n' "$STAMP" >> "$LOG_FILE"
      return 0
      ;;
    1) ;;
    *)
      if ! grep -qs 'github\.com' "${HOME:-/root}/.git-credentials" 2>/dev/null; then
        printf '[%s] GITHUB skip no stored credential (run npm run push:github from the workstation)\n' \
          "$STAMP" >> "$LOG_FILE"
        return 0
      fi
      ;;
  esac

  if "$NODE_BIN" scripts/sync-github.mjs >> "$LOG_FILE" 2>&1; then
    printf '[%s] GITHUB mirror push ok\n' "$STAMP" >> "$LOG_FILE"
  else
    printf '[%s] GITHUB mirror push failed\n' "$STAMP" >> "$LOG_FILE"
    return 1
  fi
}

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

if [ "$STATUS" -eq 0 ]; then
  sync_jobs_data
  SYNC_STATUS=$?
else
  SYNC_STATUS=0
fi

END_EPOCH=$(date '+%s')
ELAPSED=$((END_EPOCH - START_EPOCH))

printf '[%s] END exit=%s sync=%s elapsed=%ss summary="%s" %s %s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "$STATUS" "$SYNC_STATUS" "$ELAPSED" \
  "${SUMMARY:-no-summary}" "${REMOTE:-"remote total=n/a"}" "${EVIDENCE:-""}" >> "$LOG_FILE"

rm -f "$TMP_OUT"
if [ "$STATUS" -ne 0 ]; then
  exit "$STATUS"
fi
exit "$SYNC_STATUS"
