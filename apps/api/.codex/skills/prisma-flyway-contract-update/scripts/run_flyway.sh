#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: run_flyway.sh <info|validate|migrate|baseline>

Required env vars:
  FLYWAY_URL
  FLYWAY_USER
  FLYWAY_PASSWORD

Optional env vars:
  FLYWAY_BASELINE_VERSION       (default: 2026.02.18.0)
  FLYWAY_BASELINE_DESCRIPTION   (default: Prisma cutover)
  FLYWAY_MIGRATIONS_DIR         (default: db/flyway)
EOF
}

if [[ "${1:-}" == "" ]]; then
  usage
  exit 1
fi

ACTION="$1"
case "$ACTION" in
  info|validate|migrate|baseline) ;;
  *)
    usage
    exit 1
    ;;
esac

if ! command -v flyway >/dev/null 2>&1; then
  echo "flyway binary not found in PATH" >&2
  exit 1
fi

: "${FLYWAY_URL:?FLYWAY_URL is required}"
: "${FLYWAY_USER:?FLYWAY_USER is required}"
: "${FLYWAY_PASSWORD:?FLYWAY_PASSWORD is required}"

MIGRATIONS_DIR="${FLYWAY_MIGRATIONS_DIR:-db/flyway}"

COMMON_ARGS=(
  "-url=${FLYWAY_URL}"
  "-user=${FLYWAY_USER}"
  "-password=${FLYWAY_PASSWORD}"
  "-locations=filesystem:${MIGRATIONS_DIR}"
  "-baselineMigrationPrefix=B"
  "-sqlMigrationPrefix=V"
  "-sqlMigrationSeparator=__"
  "-sqlMigrationSuffixes=.sql"
  "-table=flyway_schema_history"
  "-schemas=public"
)

if [[ "$ACTION" == "baseline" ]]; then
  BASELINE_VERSION="${FLYWAY_BASELINE_VERSION:-2026.02.18.0}"
  BASELINE_DESCRIPTION="${FLYWAY_BASELINE_DESCRIPTION:-Prisma cutover}"
  flyway "${COMMON_ARGS[@]}" \
    "-baselineVersion=${BASELINE_VERSION}" \
    "-baselineDescription=${BASELINE_DESCRIPTION}" \
    baseline
  exit 0
fi

flyway "${COMMON_ARGS[@]}" "$ACTION"
