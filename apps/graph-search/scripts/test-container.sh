#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Unique Compose ownership and ephemeral ports avoid existing local stacks.
project="graph-search-smoke-$$"
export GRAPH_SEARCH_DB_PORT=0 GRAPH_SEARCH_PORT=0
export GRAPH_SEARCH_DATABASE_URL=postgres://graph_search:local_graph_search@database:5432/heyhey_graph_search
compose=(docker compose -p "$project" -f compose.yaml -f compose.test.yaml)
cleanup() {
  "${compose[@]}" logs service
  "${compose[@]}" down --volumes
}
trap cleanup EXIT
"${compose[@]}" up -d database --wait --wait-timeout 90
"${compose[@]}" up -d --no-build --wait --wait-timeout 90
port=$("${compose[@]}" port service 8090)
curl --fail --silent --show-error "http://$port/healthz"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://$port/api/nodes")" = 501
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://$port/embeddings/search")" = 501
"${compose[@]}" restart service
"${compose[@]}" up -d --no-build --wait --wait-timeout 90
# Docker can assign a new ephemeral host port when the container restarts.
port=$("${compose[@]}" port service 8090)
curl --fail --silent --show-error "http://$port/healthz"

# The same server hosts an API-like database with its own Flyway history.
# Graph/search startup and restart must leave that database untouched.
unchanged=$("${compose[@]}" exec -T database psql -U foundation_test_admin -d project -Atc \
  "SELECT (SELECT count(*) FROM flyway_schema_history WHERE version = 'api-owned') = 1
     AND to_regclass('public._sqlx_migrations') IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('graph', 'search'))")
test "$unchanged" = t
