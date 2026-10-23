#!/usr/bin/env bash
set -euo pipefail

: "${NEO4J_URI:?NEO4J_URI is required}"
: "${NEO4J_USERNAME:?NEO4J_USERNAME is required}"
: "${NEO4J_PASSWORD:?NEO4J_PASSWORD is required}"
: "${NEO4J_EXPECTED_ENVIRONMENT:?NEO4J_EXPECTED_ENVIRONMENT is required}"
: "${NEO4J_EXPECTED_DATABASE_IDENTITY:?NEO4J_EXPECTED_DATABASE_IDENTITY is required}"

identity_pattern='^[A-Za-z0-9._-]+$'
if [[ ! "$NEO4J_EXPECTED_ENVIRONMENT" =~ $identity_pattern ]] ||
  [[ ! "$NEO4J_EXPECTED_DATABASE_IDENTITY" =~ $identity_pattern ]]; then
  echo 'Neo4j identity values may contain only letters, numbers, dots, underscores, and hyphens.' >&2
  exit 1
fi

cypher_shell=(
  cypher-shell
  --non-interactive
  --format plain
  --address "$NEO4J_URI"
  --username "$NEO4J_USERNAME"
  --password "$NEO4J_PASSWORD"
)

"${cypher_shell[@]}" \
  'MERGE (identity:DeploymentIdentity {key: "graph-service"})
   ON CREATE SET identity.environment = $environment,
                 identity.databaseIdentity = $databaseIdentity' \
  --param "{environment: '$NEO4J_EXPECTED_ENVIRONMENT', databaseIdentity: '$NEO4J_EXPECTED_DATABASE_IDENTITY'}"

matching_count="$("${cypher_shell[@]}" \
  'MATCH (identity:DeploymentIdentity {key: "graph-service"})
   WHERE identity.environment = $environment
     AND identity.databaseIdentity = $databaseIdentity
   RETURN count(identity) AS matchingIdentityCount' \
  --param "{environment: '$NEO4J_EXPECTED_ENVIRONMENT', databaseIdentity: '$NEO4J_EXPECTED_DATABASE_IDENTITY'}" \
  | tr -d '\r' | tail -n 1)"

if [[ "$matching_count" != '1' ]]; then
  echo 'Neo4j deployment identity does not match this migration stack.' >&2
  exit 1
fi
