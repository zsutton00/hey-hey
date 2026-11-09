#!/usr/bin/env bash
set -euo pipefail

DIR="${1:-src/shared/agent-bridge-contract/generated}"
node scripts/postprocess-generated-api.cjs "$DIR"
