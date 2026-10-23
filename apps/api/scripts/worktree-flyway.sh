#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Reject collisions before worktree initialization copies any database content.
node "${SCRIPT_DIR}/check-flyway-versions.js" "${REPO_ROOT}/db/flyway"

exec bash "${REPO_ROOT}/scripts/worktree-exec.sh" \
  bash "${REPO_ROOT}/scripts/flyway.sh" "$@"
