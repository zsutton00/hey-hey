#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/worktree-exec.sh <command> [args...]" >&2
  exit 1
fi

git_dir="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-dir 2>/dev/null || true)"
common_git_dir="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"

if [[ -n "$git_dir" && -n "$common_git_dir" && "$git_dir" != "$common_git_dir" ]]; then
  exec node -r ts-node/register/transpile-only \
    "${REPO_ROOT}/scripts/worktree-db.ts" exec --ensure -- "$@"
fi

exec "$@"
