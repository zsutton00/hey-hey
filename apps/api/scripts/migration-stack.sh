#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [[ "${1:-}" == '--api-root' ]]; then
  [[ $# -ge 3 && -d "$2" ]] || { echo 'Error: --api-root requires an existing API checkout.' >&2; exit 2; }
  API_ROOT="$(cd "$2" && pwd)"
  shift 2
fi
COMPOSE_FILE="${API_ROOT}/docker-compose.migration-stack.yml"

usage() {
  cat <<'USAGE'
Usage: pnpm migration-stack <bootstrap|prepare|up|status|logs|down|destroy|reset|restart|prune|config|cli> [options] [ARGS...]

Options:
  --name NAME     Isolated Compose project name (default: migration-test)
  --yes           Required by reset because it deletes this stack's volumes
  --refresh       Replace the shared database bootstrap (bootstrap only)
  --from FILE     Use an existing custom-format pg_dump (bootstrap only)
  --empty         Create an empty database bootstrap using Docker (bootstrap only)
  --timeout SEC   Maximum wait for service readiness (up, reset, restart; default: 600)
  --api-env-file FILE  Private API runtime overrides (up and reset)

Repository roots default to siblings of the API repository and can be overridden:
  HEY_HEY_GRAPH_ROOT, HEY_HEY_EMBEDDINGS_ROOT, HEY_HEY_UI_ROOT,
  HEY_HEY_UI_COMMON_ROOT, HEY_HEY_OPENAPI_ROOT, HEY_HEY_CLI_ROOT

Port overrides:
  MIGRATION_API_PORT, MIGRATION_UI_PORT, MIGRATION_GRAPH_PORT,
  MIGRATION_EMBEDDINGS_PORT, MIGRATION_TEMPORAL_UI_PORT,
  MIGRATION_NEO4J_HTTP_PORT, MIGRATION_NEO4J_BOLT_PORT,
  MIGRATION_VESPA_PORT, MIGRATION_CLI_PORT
USAGE
}

command="${1:-}"
if [[ -z "$command" || "$command" == '-h' || "$command" == '--help' || "$command" == 'help' ]]; then
  usage
  exit 0
fi
shift

stack_name="${HEY_HEY_MIGRATION_STACK:-migration-test}"
confirmed=false
refresh_bootstrap=false
bootstrap_source=''
empty_bootstrap=false
readiness_timeout=600
api_env_source=''
services=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      [[ $# -ge 2 ]] || { echo 'Error: --name requires a value.' >&2; exit 1; }
      stack_name="$2"
      shift 2
      ;;
    --yes)
      confirmed=true
      shift
      ;;
    --refresh)
      refresh_bootstrap=true
      shift
      ;;
    --from)
      [[ $# -ge 2 ]] || { echo 'Error: --from requires a file.' >&2; exit 1; }
      bootstrap_source="$2"
      shift 2
      ;;
    --empty)
      empty_bootstrap=true
      shift
      ;;
    --timeout)
      [[ $# -ge 2 && "$2" =~ ^[0-9]+$ && "$2" -gt 0 ]] || { echo 'Error: --timeout requires a positive number of seconds.' >&2; exit 2; }
      readiness_timeout="$2"
      shift 2
      ;;
    --api-env-file)
      [[ $# -ge 2 && -f "$2" ]] || { echo 'Error: --api-env-file requires an existing file.' >&2; exit 2; }
      api_env_source="$2"
      shift 2
      ;;
    -*)
      if [[ "$command" == 'cli' ]]; then
        services+=("$1")
        shift
      else
        echo "Error: unknown option: $1" >&2
        usage >&2
        exit 1
      fi
      ;;
    *)
      services+=("$1")
      shift
      ;;
  esac
done

if [[ ${#services[@]} -gt 0 && "$command" != 'logs' && "$command" != 'cli' && "$command" != 'restart' ]]; then
  echo "Error: trailing arguments are supported only by logs, cli, and restart." >&2
  usage >&2
  exit 1
fi
if [[ "$command" == 'restart' && ${#services[@]} -ne 1 ]]; then
  echo 'Error: restart requires exactly one service name.' >&2
  exit 2
fi
if [[ -n "$api_env_source" && "$command" != 'up' && "$command" != 'reset' ]]; then
  echo 'Error: --api-env-file is supported only by up and reset.' >&2
  exit 2
fi

if [[ "$command" != 'bootstrap' && ( "$refresh_bootstrap" == true || -n "$bootstrap_source" || "$empty_bootstrap" == true ) ]]; then
  echo 'Error: --refresh, --from, and --empty are supported only by bootstrap.' >&2
  exit 1
fi
if [[ "$empty_bootstrap" == true && -n "$bootstrap_source" ]]; then
  echo 'Error: --empty and --from cannot be used together.' >&2
  exit 1
fi

safe_name="$(printf '%s' "$stack_name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//' | cut -c1-40)"
[[ -n "$safe_name" ]] || { echo 'Error: stack name must contain a letter or number.' >&2; exit 1; }

# A distinct Compose/profile identity must also remain a distinct DNS label.
[[ "$safe_name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo 'Error: normalized stack name must be a DNS label (letters, digits, interior hyphens).' >&2
  exit 2
}
export STACK_HOSTNAME="${safe_name}.localhost"

prune_stack_images() {
  # Docker preserves images referenced by any container, including stopped ones.
  docker image prune --force "$@" \
    --filter "label=com.heyhey.migration-stack=heyhey-${safe_name}"
}

# Image cleanup needs neither source checkouts nor a database bootstrap/runtime.
if [[ "$command" == 'prune' ]]; then
  prune_stack_images --all
  exit 0
fi

repositories_root="$(cd "${API_ROOT}/.." && pwd)"
GRAPH_ROOT="${HEY_HEY_GRAPH_ROOT:-${repositories_root}/graphs}"
EMBEDDINGS_ROOT="${HEY_HEY_EMBEDDINGS_ROOT:-${repositories_root}/embeddings}"
UI_ROOT="${HEY_HEY_UI_ROOT:-${repositories_root}/ui}"
UI_COMMON_ROOT="${HEY_HEY_UI_COMMON_ROOT:-${repositories_root}/ui-common}"
OPENAPI_ROOT="${HEY_HEY_OPENAPI_ROOT:-${repositories_root}/openapi}"
CLI_ROOT="${HEY_HEY_CLI_ROOT:-${repositories_root}/cli}"

require_file() {
  [[ -f "$1" ]] || { echo "Error: required source file is missing: $1" >&2; exit 1; }
}

require_sources() {
  require_file "${API_ROOT}/Dockerfile"
  require_file "${GRAPH_ROOT}/pom.xml"
  require_file "${API_ROOT}/docker/migration-stack/embeddings.Dockerfile"
  require_file "${EMBEDDINGS_ROOT}/requirements.txt"
  require_file "${EMBEDDINGS_ROOT}/constraints.txt"
  require_file "${EMBEDDINGS_ROOT}/generated/openapi-models/setup.py"
  require_file "${EMBEDDINGS_ROOT}/generated/openapi-events-models/setup.py"
  require_file "${UI_ROOT}/Dockerfile"
  require_file "${UI_COMMON_ROOT}/package.json"
  require_file "${OPENAPI_ROOT}/specs/api/openapi.yaml"
  require_file "${OPENAPI_ROOT}/specs/graphs/openapi.yaml"
}

if [[ -n "${HEY_HEY_MIGRATION_STATE_ROOT:-}" ]]; then
  shared_state_root="$HEY_HEY_MIGRATION_STATE_ROOT"
else
  git_common_dir="$(git -C "$API_ROOT" rev-parse --path-format=absolute --git-common-dir)"
  main_repository_root="$(cd "${git_common_dir}/.." && pwd)"
  shared_state_root="${main_repository_root}/.tmp/migration-stack"
fi
shared_state_dir="${shared_state_root}/bootstrap"
bootstrap_dump="${shared_state_dir}/application.dump"
bootstrap_metadata="${shared_state_dir}/metadata.txt"
state_dir="${API_ROOT}/.tmp/migration-stack/${safe_name}"
runtime_env="${state_dir}/runtime.env"
api_extra_env="${state_dir}/api-extra.env"
api_extra_compose="${state_dir}/api-extra.compose.yml"
if [[ "$command" == 'destroy' && ! -f "$runtime_env" ]]; then
  # No generated runtime means Compose never had enough state to create a stack.
  containers="$(docker ps -aq --filter "label=com.docker.compose.project=heyhey-${safe_name}")"
  volumes="$(docker volume ls -q --filter "label=com.docker.compose.project=heyhey-${safe_name}")"
  if [[ -n "$containers" || -n "$volumes" ]] ||
     docker volume inspect "heyhey-${safe_name}_api-jwt-keys" >/dev/null 2>&1; then
    echo "Error: resources for heyhey-${safe_name} exist but its runtime file is missing." >&2
    exit 1
  fi
  echo "Migration stack heyhey-${safe_name} is already absent."
  exit 0
fi
mkdir -p "$state_dir"

require_bootstrap() {
  [[ -f "$bootstrap_dump" ]] || {
    echo 'Error: no shared database bootstrap exists.' >&2
    echo 'Create it once with: pnpm migration-stack bootstrap' >&2
    exit 1
  }
}

write_bootstrap_metadata() {
  local source_description="$1"
  local temporary_metadata="${bootstrap_metadata}.tmp"
  {
    printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'source=%s\n' "$source_description"
    printf 'sha256=%s\n' "$(sha256sum "$bootstrap_dump" | cut -d ' ' -f 1)"
  } >"$temporary_metadata"
  chmod 600 "$temporary_metadata"
  mv "$temporary_metadata" "$bootstrap_metadata"
}

capture_current_database() {
  local temporary_dump="$1"
  node --env-file-if-exists="${API_ROOT}/.env" --env-file-if-exists="${API_ROOT}/.env.local" -e '
    const { spawnSync } = require("node:child_process");
    const output = process.argv[1];
    const raw = process.env.PROJECT_DATABASE_URL || process.env.DATABASE_URL;
    if (!raw) throw new Error("PROJECT_DATABASE_URL or DATABASE_URL is required.");
    const url = new URL(raw);
    const schema = url.searchParams.get("schema") || "public";
    if (schema !== "public") throw new Error(`Expected public schema, received ${JSON.stringify(schema)}.`);
    url.searchParams.delete("schema");
    const result = spawnSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--schema=public", `--file=${output}`, url.toString()], { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  ' "$temporary_dump"
}

validate_bootstrap_dump() {
  local source_file="$1"
  local absolute_source

  if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --list "$source_file" >/dev/null
    return
  fi

  command -v docker >/dev/null 2>&1 || {
    echo 'Error: pg_restore or Docker is required to validate a bootstrap dump.' >&2
    return 1
  }
  absolute_source="$(cd "$(dirname "$source_file")" && pwd)/$(basename "$source_file")"
  docker run --rm \
    --mount "type=bind,source=${absolute_source},target=/bootstrap.dump,readonly" \
    postgres:13 pg_restore --list /bootstrap.dump >/dev/null
}

create_empty_database_dump() {
  local temporary_dump="$1"
  local container_name="heyhey-migration-bootstrap-${safe_name}-$$"
  local container_password
  local ready=false
  local attempt

  command -v docker >/dev/null 2>&1 || { echo 'Error: Docker is required for --empty bootstrap.' >&2; return 1; }
  container_password="$(openssl rand -hex 32)"
  docker run --rm --detach --name "$container_name" \
    --env "POSTGRES_PASSWORD=${container_password}" \
    postgres:13 >/dev/null

  for ((attempt = 0; attempt < 60; attempt++)); do
    if docker exec "$container_name" pg_isready --username postgres --dbname postgres >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done

  if [[ "$ready" != true ]]; then
    docker logs "$container_name" >&2 || true
    docker rm --force "$container_name" >/dev/null 2>&1 || true
    echo 'Error: temporary PostgreSQL did not become ready for empty bootstrap.' >&2
    return 1
  fi

  if ! docker exec "$container_name" pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --schema=public \
    --dbname=postgres >"$temporary_dump"; then
    docker rm --force "$container_name" >/dev/null 2>&1 || true
    return 1
  fi

  docker stop "$container_name" >/dev/null
}

random_hex() {
  command -v openssl >/dev/null 2>&1 || { echo 'Error: openssl is required.' >&2; exit 1; }
  openssl rand -hex 32
}

random_ed25519_private_key() {
  command -v openssl >/dev/null 2>&1 || { echo 'Error: openssl is required.' >&2; exit 1; }
  openssl genpkey -algorithm ED25519 2>/dev/null | openssl base64 -A
}

allocate_host_ports() {
  command -v node >/dev/null 2>&1 || { echo 'Error: node is required.' >&2; exit 1; }
  node - <<'NODE'
const net = require('node:net');

const variables = [
  'MIGRATION_API_PORT',
  'MIGRATION_UI_PORT',
  'MIGRATION_GRAPH_PORT',
  'MIGRATION_EMBEDDINGS_PORT',
  'MIGRATION_TEMPORAL_UI_PORT',
  'MIGRATION_NEO4J_HTTP_PORT',
  'MIGRATION_NEO4J_BOLT_PORT',
  'MIGRATION_VESPA_PORT',
  'MIGRATION_CLI_PORT',
];
const servers = [];

function listen(port, variable) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      reject(new Error(`${variable || 'dynamic port'} is unavailable: ${error.message}`));
    });
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      servers.push(server);
      resolve(server.address().port);
    });
  });
}

(async () => {
  try {
    const ports = [];
    for (const variable of variables) {
      const configured = process.env[variable];
      if (configured !== undefined && !/^\d+$/.test(configured)) {
        throw new Error(`${variable} must be an integer port.`);
      }
      const port = configured === undefined ? 0 : Number(configured);
      if (configured !== undefined && (port < 1 || port > 65535)) {
        throw new Error(`${variable} must be between 1 and 65535.`);
      }
      ports.push(await listen(port, configured === undefined ? undefined : variable));
    }
    process.stdout.write(`${ports.join('\n')}\n`);
  } finally {
    for (const server of servers) server.close();
  }
})().catch((error) => {
  console.error(`Error: unable to allocate migration-stack ports: ${error.message}`);
  process.exitCode = 1;
});
NODE
}

if [[ ! -f "$runtime_env" ]]; then
  allocated_ports="$(allocate_host_ports)"
  stack_ports=()
  while IFS= read -r port; do
    stack_ports+=("$port")
  done <<<"$allocated_ports"
  [[ ${#stack_ports[@]} -eq 9 ]] || { echo 'Error: expected nine allocated migration-stack ports.' >&2; exit 1; }
  umask 077
  {
    echo "COMPOSE_PROJECT_NAME=heyhey-${safe_name}"
    echo "API_ROOT=${API_ROOT}"
    echo "GRAPH_ROOT=${GRAPH_ROOT}"
    echo "EMBEDDINGS_ROOT=${EMBEDDINGS_ROOT}"
    echo "UI_ROOT=${UI_ROOT}"
    echo "UI_COMMON_ROOT=${UI_COMMON_ROOT}"
    echo "OPENAPI_ROOT=${OPENAPI_ROOT}"
    echo "API_ENV_FILE=${API_ROOT}/.env"
    echo "API_LOCAL_ENV_FILE=${API_ROOT}/.env.local"
    echo "EMBEDDINGS_ENV_FILE=${EMBEDDINGS_ROOT}/.env"
    echo "STACK_API_PORT=${stack_ports[0]}"
    echo "STACK_UI_PORT=${stack_ports[1]}"
    echo "STACK_GRAPH_PORT=${stack_ports[2]}"
    echo "STACK_EMBEDDINGS_PORT=${stack_ports[3]}"
    echo "STACK_TEMPORAL_UI_PORT=${stack_ports[4]}"
    echo "STACK_NEO4J_HTTP_PORT=${stack_ports[5]}"
    echo "STACK_NEO4J_BOLT_PORT=${stack_ports[6]}"
    echo "STACK_VESPA_PORT=${stack_ports[7]}"
    echo "STACK_CLI_PORT=${stack_ports[8]}"
    echo 'STACK_POSTGRES_USER=migration'
    echo 'STACK_POSTGRES_PASSWORD=migration-local-only'
    echo 'STACK_POSTGRES_DB=migration_test'
    echo "STACK_REDIS_PASSWORD=$(random_hex)"
    echo "STACK_NEO4J_PASSWORD=$(random_hex)"
    echo "STACK_JWT_SECRET=$(random_hex)"
    echo "STACK_SECRET_KEY=$(random_hex)"
    echo "STACK_INTEGRATION_ENCRYPTION_KEY=$(random_hex)"
    echo "STACK_TRIGGER_SIGNING_PRIVATE_KEY=$(random_ed25519_private_key)"
  } >"$runtime_env"
fi

if ! grep -q '^STACK_CLI_PORT=' "$runtime_env"; then
  allocated_ports="$(allocate_host_ports)"
  stack_ports=()
  while IFS= read -r port; do
    stack_ports+=("$port")
  done <<<"$allocated_ports"
  [[ ${#stack_ports[@]} -eq 9 ]] || { echo 'Error: expected nine allocated migration-stack ports.' >&2; exit 1; }
  chmod 600 "$runtime_env"
  printf 'STACK_CLI_PORT=%s\n' "${stack_ports[8]}" >>"$runtime_env"
fi

if ! grep -q '^STACK_MACHINE_ENROLLMENT_CODE_HMAC_KEY=' "$runtime_env"; then
  chmod 600 "$runtime_env"
  printf 'STACK_MACHINE_ENROLLMENT_CODE_HMAC_KEY=%s\n' "$(random_hex)" >>"$runtime_env"
fi

# Upgrade runtime files made by the initial runner, which incorrectly used
# random hex where the API requires a base64-wrapped Ed25519 private key.
if grep -Eq '^STACK_TRIGGER_SIGNING_PRIVATE_KEY=[0-9a-f]{64}$' "$runtime_env"; then
  replacement_key="$(random_ed25519_private_key)"
  upgraded_env="${runtime_env}.upgraded"
  awk -v replacement="STACK_TRIGGER_SIGNING_PRIVATE_KEY=${replacement_key}" \
    '/^STACK_TRIGGER_SIGNING_PRIVATE_KEY=/{print replacement; next} {print}' \
    "$runtime_env" >"$upgraded_env"
  chmod 600 "$upgraded_env"
  mv "$upgraded_env" "$runtime_env"
fi

export STACK_BOOTSTRAP_DUMP="$bootstrap_dump"
if [[ -n "$api_env_source" ]]; then
  umask 077
  if [[ "$api_env_source" != "$api_extra_env" ]]; then
    cp -- "$api_env_source" "${api_extra_env}.tmp"
    chmod 600 "${api_extra_env}.tmp"
    mv "${api_extra_env}.tmp" "$api_extra_env"
  fi
fi
compose=(docker compose --project-name "heyhey-${safe_name}" --env-file "$runtime_env" --file "$COMPOSE_FILE")
# Teardown only needs the project identity from the base Compose file. An
# invalid or interrupted override must not prevent cleanup after a failed up.
if [[ -f "$api_extra_env" && "$command" != 'down' && "$command" != 'destroy' ]]; then
  printf 'services:\n  api:\n    env_file:\n      - path: %s\n        required: true\n' \
    "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$api_extra_env")" >"$api_extra_compose"
  compose+=(--file "$api_extra_compose")
  # The API intentionally disables mock session routing in production. Only
  # an explicitly enabled mock route changes this test stack to development.
  mock_routing="$("${compose[@]}" config --format json | node -e '
    const fs = require("node:fs");
    const config = JSON.parse(fs.readFileSync(0, "utf8"));
    process.stdout.write(config.services.api.environment.MOCK_LLM_SESSION_ROUTING_ENABLED === "true" ? "true" : "false");
  ')"
  if [[ "$mock_routing" == 'true' ]]; then
    printf '    environment:\n      NODE_ENV: development\n' >>"$api_extra_compose"
  fi
fi

ensure_persistent_volumes() {
  # runtime.env is generated by this script and contains only KEY=value lines.
  # shellcheck disable=SC1090
  source "$runtime_env"
  local jwt_volume="${COMPOSE_PROJECT_NAME}_api-jwt-keys"
  if ! docker volume inspect "$jwt_volume" >/dev/null 2>&1; then
    docker volume create "$jwt_volume" >/dev/null
  fi
}

print_endpoints() {
  # runtime.env is generated by this script and contains only KEY=value lines.
  # shellcheck disable=SC1090
  source "$runtime_env"
  printf 'Migration stack: %s\n' "$COMPOSE_PROJECT_NAME"
  printf 'UI:              http://%s:%s\n' "$STACK_HOSTNAME" "$STACK_UI_PORT"
  printf 'API:             http://%s:%s\n' "$STACK_HOSTNAME" "$STACK_API_PORT"
  printf 'Graph:           http://localhost:%s\n' "$STACK_GRAPH_PORT"
  printf 'Embeddings:      http://localhost:%s\n' "$STACK_EMBEDDINGS_PORT"
  printf 'Temporal UI:     http://localhost:%s\n' "$STACK_TEMPORAL_UI_PORT"
  printf 'Neo4j browser:   http://localhost:%s\n' "$STACK_NEO4J_HTTP_PORT"
  printf 'Vespa:           http://localhost:%s\n' "$STACK_VESPA_PORT"
  printf 'CLI bridge:      http://localhost:%s\n' "$STACK_CLI_PORT"
  printf 'CLI command:     HEYHEY_API_URL=http://%s:%s HEYHEY_WEB_ORIGIN=http://%s:%s HEYHEY_CONTROLLER_ORIGIN=http://%s:%s HEYHEY_CONTROLLER_RP_ID=%s pnpm dev --local --api-port %s --port %s --profile %s\n' \
    "$STACK_HOSTNAME" "$STACK_API_PORT" "$STACK_HOSTNAME" "$STACK_UI_PORT" \
    "$STACK_HOSTNAME" "$STACK_UI_PORT" "$STACK_HOSTNAME" "$STACK_API_PORT" "$STACK_CLI_PORT" "$safe_name"
  printf 'Mac hosts entry: 127.0.0.1 %s\n' "$STACK_HOSTNAME"
}

wait_for_web() {
  # Compose --wait checks container health; the UI has no container healthcheck.
  # Probe both externally observable endpoints before declaring the stack ready.
  command -v curl >/dev/null 2>&1 || { echo 'Error: curl is required for migration-stack readiness checks.' >&2; return 1; }
  source "$runtime_env"
  local endpoint deadline=$((SECONDS + readiness_timeout))
  for endpoint in "http://127.0.0.1:${STACK_API_PORT}/api/v1/auth/jwks" \
                  "http://127.0.0.1:${STACK_UI_PORT}/"; do
    until curl --fail --silent --show-error --max-time 3 --output /dev/null "$endpoint" 2>/dev/null; do
      if (( SECONDS >= deadline )); then
        echo "Error: migration stack endpoint did not become ready within ${readiness_timeout}s: ${endpoint}" >&2
        return 1
      fi
      sleep 2
    done
  done
}

case "$command" in
  bootstrap)
    if [[ -f "$bootstrap_dump" && "$refresh_bootstrap" != true ]]; then
      echo "Database bootstrap already exists: ${bootstrap_dump}"
      exit 0
    fi
    mkdir -p "$shared_state_dir"
    temporary_dump="${bootstrap_dump}.tmp"
    if [[ -n "$bootstrap_source" ]]; then
      [[ -f "$bootstrap_source" ]] || { echo "Error: bootstrap source does not exist: ${bootstrap_source}" >&2; exit 1; }
      validate_bootstrap_dump "$bootstrap_source"
      cp "$bootstrap_source" "$temporary_dump"
      source_description="file:$(cd "$(dirname "$bootstrap_source")" && pwd)/$(basename "$bootstrap_source")"
    elif [[ "$empty_bootstrap" == true ]]; then
      create_empty_database_dump "$temporary_dump"
      source_description='empty-postgres-13-docker'
    else
      capture_current_database "$temporary_dump"
      source_description='current-api-database'
    fi
    chmod 600 "$temporary_dump"
    mv "$temporary_dump" "$bootstrap_dump"
    write_bootstrap_metadata "$source_description"
    echo "Database bootstrap ready: ${bootstrap_dump}"
    ;;
  prepare)
    require_bootstrap
    require_sources
    "${compose[@]}" build
    # Keep the tagged images prepare just built for the next up.
    prune_stack_images
    ;;
  up)
    require_bootstrap
    require_sources
    ensure_persistent_volumes
    "${compose[@]}" up --detach --build --wait --wait-timeout "$readiness_timeout"
    wait_for_web
    prune_stack_images --all
    print_endpoints
    ;;
  status)
    print_endpoints
    "${compose[@]}" ps --all
    ;;
  logs)
    "${compose[@]}" logs --follow --tail 200 "${services[@]}"
    ;;
  down)
    "${compose[@]}" down --remove-orphans
    prune_stack_images --all
    ;;
  destroy)
    "${compose[@]}" down --remove-orphans --volumes
    if docker volume inspect "heyhey-${safe_name}_api-jwt-keys" >/dev/null 2>&1; then
      docker volume rm "heyhey-${safe_name}_api-jwt-keys" >/dev/null
    fi
    prune_stack_images --all
    rm -rf -- "$state_dir"
    ;;
  reset)
    [[ "$confirmed" == true ]] || {
      echo "Error: reset deletes volumes for heyhey-${safe_name}; rerun with --yes." >&2
      exit 1
    }
    require_bootstrap
    ensure_persistent_volumes
    "${compose[@]}" down --remove-orphans --volumes
    require_sources
    "${compose[@]}" up --detach --build --wait --wait-timeout "$readiness_timeout"
    wait_for_web
    prune_stack_images --all
    print_endpoints
    ;;
  config)
    require_sources
    "${compose[@]}" config --quiet
    print_endpoints
    printf 'Services:\n'
    "${compose[@]}" config --services
    ;;
  restart)
    require_bootstrap
    service="${services[0]}"
    "${compose[@]}" config --services | grep -Fx -- "$service" >/dev/null || {
      echo "Error: unknown migration-stack service: ${service}" >&2
      exit 2
    }
    "${compose[@]}" up --detach --no-deps --force-recreate --wait --wait-timeout "$readiness_timeout" "$service"
    if [[ "$service" == 'api' || "$service" == 'ui' ]]; then
      wait_for_web
    fi
    ;;
  cli)
    require_file "${CLI_ROOT}/package.json"
    # runtime.env is generated by this script and contains only KEY=value lines.
    # shellcheck disable=SC1090
    source "$runtime_env"
    cd "$CLI_ROOT"
    HEYHEY_API_URL="http://${STACK_HOSTNAME}:${STACK_API_PORT}" \
      HEYHEY_WEB_ORIGIN="http://${STACK_HOSTNAME}:${STACK_UI_PORT}" \
      HEYHEY_CONTROLLER_ORIGIN="http://${STACK_HOSTNAME}:${STACK_UI_PORT}" \
      HEYHEY_CONTROLLER_RP_ID="$STACK_HOSTNAME" \
      pnpm dev --local \
        --api-port "$STACK_API_PORT" \
        --port "$STACK_CLI_PORT" \
        --profile "$safe_name" \
        "${services[@]}"
    ;;
  *)
    echo "Error: unknown command: $command" >&2
    usage >&2
    exit 1
    ;;
esac
