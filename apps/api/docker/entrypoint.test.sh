#!/bin/sh
set -eu

entrypoint="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/entrypoint.sh"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

assert_failure() {
  expected="$1"
  shift
  if output="$($@ 2>&1)"; then
    echo "expected entrypoint failure" >&2
    exit 1
  fi
  case "$output" in
    *"$expected"*) ;;
    *) echo "missing expected error: $expected" >&2; exit 1 ;;
  esac
}

printf '%s' 'integration-test-value' > "$temporary/integration"
resolved="$({
  INTEGRATION_ENCRYPTION_KEY_FILE="$temporary/integration" \
    sh "$entrypoint" sh -c 'printf %s "$INTEGRATION_ENCRYPTION_KEY"'
})"
[ "$resolved" = integration-test-value ] || { echo "file-backed secret was not resolved" >&2; exit 1; }

assert_failure "both INTEGRATION_ENCRYPTION_KEY and INTEGRATION_ENCRYPTION_KEY_FILE are set" \
  env INTEGRATION_ENCRYPTION_KEY=direct INTEGRATION_ENCRYPTION_KEY_FILE="$temporary/integration" \
  sh "$entrypoint" true

assert_failure "points to missing file" \
  env INTEGRATION_ENCRYPTION_KEY_FILE="$temporary/missing" sh "$entrypoint" true

: > "$temporary/empty"
assert_failure "points to an empty file" \
  env INTEGRATION_ENCRYPTION_KEY_FILE="$temporary/empty" sh "$entrypoint" true

echo "API entrypoint file-secret tests passed"
