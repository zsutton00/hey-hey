#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/db/flyway"

usage() {
  cat <<'USAGE'
Usage: scripts/flyway.sh <info|validate|migrate|baseline> [extra flyway args...]

Required env vars:
  FLYWAY_URL
  FLYWAY_USER
  FLYWAY_PASSWORD

Optional env vars:
  FLYWAY_SCHEMAS
  FLYWAY_DEFAULT_SCHEMA
  FLYWAY_OUT_OF_ORDER (default: true)
  FLYWAY_IGNORE_MIGRATION_PATTERNS
  FLYWAY_BASELINE_VERSION
  FLYWAY_BASELINE_DESCRIPTION
USAGE
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" || ${1:-} == "help" ]]; then
  usage
  exit 0
fi

COMMAND="${1:-}"
if [[ -z "$COMMAND" ]]; then
  echo "Error: missing flyway command." >&2
  usage >&2
  exit 1
fi
shift || true

case "$COMMAND" in
  info|validate|migrate|baseline) ;;
  *)
    echo "Error: unsupported flyway command '$COMMAND'." >&2
    usage >&2
    exit 1
    ;;
esac

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "Error: migration directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

node "${SCRIPT_DIR}/check-flyway-versions.js" "$MIGRATIONS_DIR"

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

if [[ -z "${FLYWAY_URL:-}" || -z "${FLYWAY_USER:-}" || -z "${FLYWAY_PASSWORD:-}" ]]; then
  load_env_file "${REPO_ROOT}/.env"
  load_env_file "${REPO_ROOT}/.env.local"
fi

: "${FLYWAY_URL:?FLYWAY_URL is required}"
: "${FLYWAY_USER:?FLYWAY_USER is required}"
: "${FLYWAY_PASSWORD:?FLYWAY_PASSWORD is required}"

# worktree-db.ts marks a database when this process is the first command to
# initialize it. If Flyway cannot validate or migrate the copied database,
# remove that just-created database so a later retry cannot mistake a partial
# initialization for an established worktree. Existing worktree databases are
# never covered by this trap.
cleanup_failed_worktree_initialization() {
  local exit_code=$?
  trap - EXIT
  if [[ $exit_code -ne 0 ]]; then
    echo "Flyway failed during first-time worktree database initialization; removing the partial database." >&2
    if ! node -r ts-node/register/transpile-only \
      "${REPO_ROOT}/scripts/worktree-db.ts" drop; then
      echo "Unable to clean up the partially initialized worktree database; run pnpm db:worktree:drop after checking the target." >&2
    fi
  fi
  exit "$exit_code"
}

if [[ "${HEY_HEY_WORKTREE_DATABASE_INITIALIZED:-}" == "1" ]]; then
  trap cleanup_failed_worktree_initialization EXIT
fi

# A linked worktree must never reach Flyway with the main/shared database.
# Keep the ordinary main/production path independent of local TypeScript
# tooling because production images intentionally prune ts-node. Install the
# first-initialization cleanup trap before this assertion so a failed target
# verification cannot strand a newly copied database.
git_dir="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-dir 2>/dev/null || true)"
common_git_dir="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
IS_LINKED_WORKTREE=false
if [[ -n "$git_dir" && -n "$common_git_dir" && "$git_dir" != "$common_git_dir" ]]; then
  IS_LINKED_WORKTREE=true
  node -r ts-node/register/transpile-only \
    "${REPO_ROOT}/scripts/worktree-db.ts" assert
fi

BASELINE_VERSION_DEFAULT="$(
  ls "${MIGRATIONS_DIR}"/B*__*.sql 2>/dev/null \
    | sed -E 's#^.*/B([^_]+)__.*$#\1#' \
    | sort \
    | tail -n1
)"

COMMON_ARGS=(
  "-url=${FLYWAY_URL}"
  "-user=${FLYWAY_USER}"
  "-password=${FLYWAY_PASSWORD}"
  "-locations=filesystem:${MIGRATIONS_DIR}"
)

# Merges can introduce valid migrations whose versions precede a migration that
# this database has already applied. Keep the local wrapper aligned with the
# production migration runner and make the policy explicit to Flyway.
COMMON_ARGS+=("-outOfOrder=${FLYWAY_OUT_OF_ORDER:-true}")

IGNORE_MIGRATION_PATTERNS="${FLYWAY_IGNORE_MIGRATION_PATTERNS:-}"
if [[ "$IS_LINKED_WORKTREE" == "true" ]]; then
  if [[ -n "$IGNORE_MIGRATION_PATTERNS" ]]; then
    IGNORE_MIGRATION_PATTERNS="${IGNORE_MIGRATION_PATTERNS},*:missing"
  else
    IGNORE_MIGRATION_PATTERNS="*:missing"
  fi
fi
if [[ -n "$IGNORE_MIGRATION_PATTERNS" ]]; then
  COMMON_ARGS+=("-ignoreMigrationPatterns=${IGNORE_MIGRATION_PATTERNS}")
fi

if [[ -n "${FLYWAY_SCHEMAS:-}" ]]; then
  COMMON_ARGS+=("-schemas=${FLYWAY_SCHEMAS}")
fi

if [[ -n "${FLYWAY_DEFAULT_SCHEMA:-}" ]]; then
  COMMON_ARGS+=("-defaultSchema=${FLYWAY_DEFAULT_SCHEMA}")
fi

if [[ "$COMMAND" == "baseline" ]]; then
  BASELINE_VERSION="${FLYWAY_BASELINE_VERSION:-$BASELINE_VERSION_DEFAULT}"
  if [[ -z "$BASELINE_VERSION" ]]; then
    echo "Error: unable to infer baseline version from B* migration; set FLYWAY_BASELINE_VERSION." >&2
    exit 1
  fi
  COMMON_ARGS+=("-baselineVersion=${BASELINE_VERSION}")
  COMMON_ARGS+=("-baselineDescription=${FLYWAY_BASELINE_DESCRIPTION:-baseline_schema}")
fi

run_local_flyway() {
  flyway "${COMMON_ARGS[@]}" "$COMMAND" "$@"
}

run_docker_flyway() {
  local docker_url="$FLYWAY_URL"
  docker_url="${docker_url/localhost/host.docker.internal}"
  docker_url="${docker_url/127.0.0.1/host.docker.internal}"

  local docker_args=(
    "-url=${docker_url}"
    "-user=${FLYWAY_USER}"
    "-password=${FLYWAY_PASSWORD}"
    "-locations=filesystem:/flyway/sql"
  )

  docker_args+=("-outOfOrder=${FLYWAY_OUT_OF_ORDER:-true}")

  if [[ -n "$IGNORE_MIGRATION_PATTERNS" ]]; then
    docker_args+=("-ignoreMigrationPatterns=${IGNORE_MIGRATION_PATTERNS}")
  fi

  if [[ -n "${FLYWAY_SCHEMAS:-}" ]]; then
    docker_args+=("-schemas=${FLYWAY_SCHEMAS}")
  fi

  if [[ -n "${FLYWAY_DEFAULT_SCHEMA:-}" ]]; then
    docker_args+=("-defaultSchema=${FLYWAY_DEFAULT_SCHEMA}")
  fi

  if [[ "$COMMAND" == "baseline" ]]; then
    local baseline_version="${FLYWAY_BASELINE_VERSION:-$BASELINE_VERSION_DEFAULT}"
    docker_args+=("-baselineVersion=${baseline_version}")
    docker_args+=("-baselineDescription=${FLYWAY_BASELINE_DESCRIPTION:-baseline_schema}")
  fi

  docker run --rm \
    --add-host host.docker.internal:host-gateway \
    -v "${MIGRATIONS_DIR}:/flyway/sql" \
    redgate/flyway:11 \
    "${docker_args[@]}" \
    "$COMMAND" \
    "$@"
}

if command -v flyway >/dev/null 2>&1; then
  run_local_flyway "$@"
  exit 0
fi

if command -v docker >/dev/null 2>&1; then
  run_docker_flyway "$@"
  exit 0
fi

echo "Error: Flyway CLI not found and Docker is unavailable." >&2
echo "Install Flyway or Docker, then retry." >&2
exit 1
