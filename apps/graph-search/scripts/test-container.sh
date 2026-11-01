#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Unique Compose ownership and ephemeral ports avoid existing local stacks.
project="graph-search-smoke-$$"
export GRAPH_SEARCH_DB_PORT=0 GRAPH_SEARCH_PORT=0
export GRAPH_SEARCH_JWKS_URL=http://jwks/jwks.json
export REDIS_URL=redis://redis:6379
export GRAPH_SEARCH_DATABASE_URL=postgres://graph_search:local_graph_search@database:5432/heyhey_graph_search
# The service needs the model to start; fetch it once into the ignored models/ folder.
export GRAPH_SEARCH_MODEL_DIR="$PWD/models/snowflake-arctic-embed-s"
test -f "$GRAPH_SEARCH_MODEL_DIR/model_quantized.onnx" || bash scripts/fetch-model.sh "$GRAPH_SEARCH_MODEL_DIR"
compose=(docker compose -p "$project" -f compose.yaml -f compose.test.yaml)
cleanup() {
  "${compose[@]}" logs service
  "${compose[@]}" down --volumes
}
trap cleanup EXIT
"${compose[@]}" up -d database jwks redis --wait --wait-timeout 90
"${compose[@]}" up -d --no-build --wait --wait-timeout 90
port=$("${compose[@]}" port service 8090)
curl --fail --silent --show-error "http://$port/healthz"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://$port/api/nodes")" = 401
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://$port/embeddings/search")" = 401
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
