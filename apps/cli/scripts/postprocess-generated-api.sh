#!/usr/bin/env bash
# Post-processes OpenAPI-generated TypeScript files:
# 1. Adds .js extensions on relative imports (moduleResolution: NodeNext)
# 2. Adds @ts-nocheck to suppress strict-mode errors in generated code
#
# Usage: bash scripts/postprocess-generated-api.sh [directory]
# Default directory: src/shared/agent-bridge-contract/generated
set -euo pipefail

DIR="${1:-src/shared/agent-bridge-contract/generated}"

for f in "$DIR"/*.ts; do
  # Add @ts-nocheck after the eslint-disable comment block if not present
  if ! grep -q '@ts-nocheck' "$f"; then
    perl -pi -e 'print qq{// \@ts-nocheck\n} if $. == 1' "$f"
  fi
  # Handle relative imports and avoid duplicating an existing extension.
  perl -pi -e "s|from '\./([^']*)'|from './\$1.js'|g" "$f"
  perl -pi -e 's|from "\./([^"]*)"|from "./$1.js"|g' "$f"
  perl -pi -e 's|\.js\.js|.js|g' "$f"

  # Keep generated diffs free of whitespace-only churn from schema descriptions.
  perl -pi -e 's/[ \t]+$//' "$f"
  # Keep the generated file to one trailing newline so git diff --check stays clean.
  LC_ALL=C perl -0pi -e 's/\n+\z/\n/' "$f"

  # OpenAPI Generator maps uniqueItems JSON arrays to JavaScript Set types.
  # Axios serializes Sets as objects, and it does not hydrate response arrays
  # back into Sets. Keep controller reconciliation's wire DTOs JSON-native at
  # both sides of that boundary.
  perl -pi -e "s|'knownControllerCredentialIds': Set<string>;|'knownControllerCredentialIds': Array<string>;|g" "$f"
  perl -pi -e "s|'revokedControllerCredentialIds': Set<string>;|'revokedControllerCredentialIds': Array<string>;|g" "$f"
done

node "$(node scripts/openapi-root.cjs)/scripts/postprocess-project-report-models.js" "$DIR/api.ts"
