#!/usr/bin/env bash
#
# kill-test-procs.sh — kill runaway jest/vitest test processes (and their workers).
#
# These are the multi-GB node processes that get orphaned when a `jest --watch`
# run dies badly. This script targets ONLY test runners + their worker pool.
# It explicitly refuses to touch the dev server (nest start / port 3000).
#
# Usage:
#   scripts/kill-test-procs.sh           # kill them
#   scripts/kill-test-procs.sh --dry-run # just show what would be killed
#   scripts/kill-test-procs.sh -n        # same as --dry-run
#
set -euo pipefail

DRY_RUN=0
case "${1:-}" in
  -n|--dry-run) DRY_RUN=1 ;;
  "") ;;
  *) echo "usage: $0 [--dry-run|-n]" >&2; exit 2 ;;
esac

# Patterns that identify a test runner or one of its workers.
#  - jest CLI / jest-worker process pool
#  - vitest CLI / vitest worker / tinypool (vitest's worker pool)
PATTERN='jest|vitest|tinypool|jest-worker'

# Never kill these, even if they somehow match above.
#  - the dev server (nest start) and anything bound to :3000
#  - this script itself
SELF_PID=$$
SCRIPT_NAME="kill-test-procs"

# Collect PIDs bound to :3000 so we never kill the running API.
SERVER_PIDS="$(lsof -ti:3000 2>/dev/null || true)"

# pid rss(KB) command — match pattern, drop protected/self/grep/editor noise.
MATCHES="$(
  ps -Ao pid=,rss=,command= \
    | grep -iE "$PATTERN" \
    | grep -v grep \
    | grep -v "$SCRIPT_NAME" \
    | grep -vE 'nest start|node dist/main' || true
)"

if [[ -z "$MATCHES" ]]; then
  echo "No jest/vitest test processes running."
  exit 0
fi

TO_KILL=""
KILL_COUNT=0
total_kb=0

printf '%-8s %10s  %s\n' "PID" "MEM(MB)" "COMMAND"
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  pid="$(awk '{print $1}' <<<"$line")"
  rss="$(awk '{print $2}' <<<"$line")"
  cmd="$(cut -c1-100 <<<"$line" | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]+[0-9]+[[:space:]]+//')"

  # Skip self.
  [[ "$pid" == "$SELF_PID" ]] && continue
  # Skip anything serving :3000.
  if [[ -n "$SERVER_PIDS" ]] && grep -qw "$pid" <<<"$SERVER_PIDS"; then
    continue
  fi

  mb=$(( rss / 1024 ))
  total_kb=$(( total_kb + rss ))
  printf '%-8s %10s  %s\n' "$pid" "$mb" "$cmd"
  TO_KILL="$TO_KILL $pid"
  KILL_COUNT=$(( KILL_COUNT + 1 ))
done <<<"$MATCHES"

if [[ "$KILL_COUNT" -eq 0 ]]; then
  echo "Nothing to kill (matches were all protected)."
  exit 0
fi

echo "---"
echo "Total: ${KILL_COUNT} process(es), $(( total_kb / 1024 )) MB"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "(dry run — nothing killed)"
  exit 0
fi

# TERM first, then KILL any survivors after a short grace period.
kill -TERM $TO_KILL 2>/dev/null || true
sleep 1
SURVIVORS=""
for pid in $TO_KILL; do
  if kill -0 "$pid" 2>/dev/null; then
    SURVIVORS="$SURVIVORS $pid"
  fi
done
if [[ -n "${SURVIVORS// /}" ]]; then
  kill -KILL $SURVIVORS 2>/dev/null || true
fi

echo "Killed ${KILL_COUNT} process(es)."
