#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
git_common_dir="$(git -C "$API_ROOT" rev-parse --path-format=absolute --git-common-dir)"
main_api_root="$(cd "${git_common_dir}/.." && pwd)"
REPOSITORIES_ROOT="$(cd "${main_api_root}/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: migration-stack-remote.sh [STACK_NAME] [--worktree WORKTREE_NAME]
       migration-stack-remote.sh up STACK_NAME [--worktree NAME] [--timeout SEC]
           [--api-env KEY=VALUE ... | --api-env-file FILE]
       migration-stack-remote.sh down STACK_NAME
       migration-stack-remote.sh restart STACK_NAME SERVICE [--timeout SEC]
       migration-stack-remote.sh tunnel STACK_NAME
       migration-stack-remote.sh db-tunnel STACK_NAME --local-port PORT
       migration-stack-remote.sh reverse-tunnel STACK_NAME --local-port PORT --remote-port PORT
       migration-stack-remote.sh status STACK_NAME

Syncs the current local source checkouts to the configured Linux Docker host,
starts the named migration stack there, and forwards its UI/API ports locally.
The explicit up command exits after API and UI readiness; tunnel commands keep
their SSH connection open until interrupted.

Set HEY_HEY_MIGRATION_REMOTE_TARGET to an SSH target (user@host or SSH config
host). The Linux host's existing migration-stack bootstrap is copied into the
isolated synced stack state.
USAGE
}

if [[ "${1:-}" == '-h' || "${1:-}" == '--help' ]]; then
  usage
  exit 0
fi
operation=interactive
case "${1:-}" in
  up|down|restart|tunnel|db-tunnel|reverse-tunnel|status)
    operation="$1"
    shift
    ;;
esac
stack_name="${1:-mac-test}"
[[ $# -eq 0 ]] || shift
worktree_name=''
readiness_timeout=600
api_env_file=''
api_env_assignments=()
service=''
local_port=''
remote_port=''
if [[ "$operation" == 'restart' ]]; then
  [[ $# -gt 0 ]] || { echo 'Error: restart requires a service name.' >&2; exit 2; }
  service="$1"
  shift
  [[ "$service" =~ ^[a-z][a-z0-9-]*$ ]] || { echo 'Error: invalid service name.' >&2; exit 2; }
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --worktree)
      [[ "$operation" == 'up' || "$operation" == 'interactive' ]] &&
        [[ $# -ge 2 && -n "$2" && "$2" != -* && "$2" != */* ]] || { usage >&2; exit 2; }
      worktree_name="$2"
      shift 2
      ;;
    --timeout)
      [[ "$operation" == 'up' || "$operation" == 'interactive' || "$operation" == 'restart' ]] &&
        [[ $# -ge 2 && "$2" =~ ^[0-9]+$ && "$2" -gt 0 ]] || { echo 'Error: --timeout requires positive seconds.' >&2; exit 2; }
      readiness_timeout="$2"
      shift 2
      ;;
    --api-env)
      [[ "$operation" == 'up' || "$operation" == 'interactive' ]] && [[ $# -ge 2 && "$2" == *=* ]] || { usage >&2; exit 2; }
      api_env_assignments+=("$2")
      shift 2
      ;;
    --api-env-file)
      [[ "$operation" == 'up' || "$operation" == 'interactive' ]] && [[ $# -ge 2 && -f "$2" ]] || { usage >&2; exit 2; }
      api_env_file="$2"
      shift 2
      ;;
    --local-port)
      [[ "$operation" == 'db-tunnel' || "$operation" == 'reverse-tunnel' ]] && [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      local_port="$2"
      shift 2
      ;;
    --remote-port)
      [[ "$operation" == 'reverse-tunnel' && $# -ge 2 ]] || { usage >&2; exit 2; }
      remote_port="$2"
      shift 2
      ;;
    *) usage >&2; exit 2 ;;
  esac
done
valid_port() { [[ "$1" =~ ^[0-9]+$ && "$1" -ge 1 && "$1" -le 65535 ]]; }
if [[ "$operation" == 'db-tunnel' || "$operation" == 'reverse-tunnel' ]]; then
  valid_port "$local_port" || { echo 'Error: --local-port must be between 1 and 65535.' >&2; exit 2; }
fi
if [[ "$operation" == 'reverse-tunnel' ]]; then
  valid_port "$remote_port" || { echo 'Error: --remote-port must be between 1 and 65535.' >&2; exit 2; }
fi
if [[ -n "$api_env_file" && ${#api_env_assignments[@]} -gt 0 ]]; then
  echo 'Error: use --api-env or --api-env-file, not both.' >&2
  exit 2
fi
[[ "$stack_name" != -* ]] || { usage >&2; exit 2; }
safe_name="$(printf '%s' "$stack_name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^-+//; s/-+$//' | cut -c1-40)"
[[ -n "$safe_name" ]] || { echo 'Error: stack name must contain a letter or number.' >&2; exit 2; }

# Do not alias underscores to hyphens and merge distinct stack identities.
[[ "$safe_name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || {
  echo 'Error: normalized stack name must be a DNS label (letters, digits, interior hyphens).' >&2
  exit 2
}
export STACK_HOSTNAME="${safe_name}.localhost"

log_phase() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

remote_target="${HEY_HEY_MIGRATION_REMOTE_TARGET:-}"
[[ -n "$remote_target" ]] || {
  echo 'Error: set HEY_HEY_MIGRATION_REMOTE_TARGET in your shell configuration.' >&2
  exit 2
}
command -v ssh >/dev/null 2>&1 || { echo 'Error: ssh is required.' >&2; exit 1; }

remote_root=".cache/hey-hey/migration-stack/${safe_name}"
remote_sources="${remote_root}/sources"
remote_state="${remote_root}/state"
remote_runtime="${remote_sources}/api/.tmp/migration-stack/${safe_name}/runtime.env"

sync_control_script() {
  # The selected API worktree supplies application source. Lifecycle commands
  # use this launcher's current script even when that source predates them.
  ssh "$remote_target" \
    "umask 077; mkdir -p \"\$HOME/${remote_root}/control\"; cat > \"\$HOME/${remote_root}/control/migration-stack.sh\" && chmod 600 \"\$HOME/${remote_root}/control/migration-stack.sh\"" \
    <"${SCRIPT_DIR}/migration-stack.sh"
}

read_remote_ports() {
  ssh "$remote_target" "bash -se" <<EOF
runtime="\$HOME/${remote_runtime}"
[[ -f "\$runtime" ]] || { echo 'Error: named stack has no runtime file.' >&2; exit 1; }
sed -n -e '/^STACK_UI_PORT=/p' -e '/^STACK_API_PORT=/p' "\$runtime"
EOF
}

read_container_network_field() {
  local selected_service="$1"
  local field="$2"
  ssh "$remote_target" "bash -se" <<EOF
set -euo pipefail
container="\$(docker ps -q --filter 'label=com.docker.compose.project=heyhey-${safe_name}' --filter 'label=com.docker.compose.service=${selected_service}')"
[[ -n "\$container" ]] || { echo 'Error: ${selected_service} is not running in this stack.' >&2; exit 1; }
docker inspect --format '{{range .NetworkSettings.Networks}}{{.${field}}}{{end}}' "\$container"
EOF
}

read_api_host_gateway() {
  ssh "$remote_target" "bash -se" <<EOF
set -euo pipefail
container="\$(docker ps -q --filter 'label=com.docker.compose.project=heyhey-${safe_name}' --filter 'label=com.docker.compose.service=api')"
[[ -n "\$container" ]] || { echo 'Error: api is not running in this stack.' >&2; exit 1; }
# host.docker.internal:host-gateway resolves to Docker's configured host
# gateway, which is not necessarily this stack network's gateway.
docker exec "\$container" cat /etc/hosts | awk '
  {
    for (i = 2; i <= NF; i++) {
      if (\$i == "host.docker.internal" && \$1 ~ /^[0-9.]+\$/) {
        print \$1
        found = 1
        exit
      }
    }
  }
  END { if (!found) exit 1 }
'
EOF
}

if [[ "$operation" == 'down' ]]; then
  sync_control_script
  ssh "$remote_target" "bash -se" <<EOF
set -euo pipefail
stack_root="\$HOME/${remote_root}"
runtime="\$HOME/${remote_runtime}"
if [[ -f "\$runtime" ]]; then
  cd "\$stack_root/sources/api"
  export HEY_HEY_MIGRATION_STATE_ROOT="\$stack_root/state"
  bash "\$stack_root/control/migration-stack.sh" --api-root "\$PWD" destroy --name '${safe_name}'
else
  containers="\$(docker ps -aq --filter 'label=com.docker.compose.project=heyhey-${safe_name}')"
  volumes="\$(docker volume ls -q --filter 'label=com.docker.compose.project=heyhey-${safe_name}')"
  if [[ -n "\$containers" || -n "\$volumes" ]] || docker volume inspect 'heyhey-${safe_name}_api-jwt-keys' >/dev/null 2>&1; then
    echo 'Error: stack resources exist but its runtime file is missing.' >&2
    exit 1
  fi
  echo 'Migration stack heyhey-${safe_name} is already absent.'
fi
rm -rf -- "\$stack_root"
EOF
  exit
fi

if [[ "$operation" == 'restart' || "$operation" == 'status' ]]; then
  sync_control_script
  ssh "$remote_target" "bash -se" <<EOF
set -euo pipefail
stack_root="\$HOME/${remote_root}"
[[ -f "\$HOME/${remote_runtime}" ]] || { echo 'Error: named stack has no runtime file.' >&2; exit 1; }
cd "\$stack_root/sources/api"
export HEY_HEY_MIGRATION_STATE_ROOT="\$stack_root/state"
$(if [[ "$operation" == 'restart' ]]; then printf "bash \"\$stack_root/control/migration-stack.sh\" --api-root \"\$PWD\" restart --name '%s' --timeout '%s' '%s'" "$safe_name" "$readiness_timeout" "$service"; else printf "bash \"\$stack_root/control/migration-stack.sh\" --api-root \"\$PWD\" status --name '%s'" "$safe_name"; fi)
EOF
  exit
fi

if [[ "$operation" == 'db-tunnel' ]]; then
  database_ip="$(read_container_network_field postgres IPAddress)"
  [[ "$database_ip" =~ ^[0-9.]+$ ]] || { echo 'Error: could not identify the stack Postgres address.' >&2; exit 1; }
  log_phase "Forwarding local 127.0.0.1:${local_port} to ${safe_name} Postgres (Ctrl-C closes the tunnel)."
  ssh -N -o ExitOnForwardFailure=yes -L "127.0.0.1:${local_port}:${database_ip}:5432" "$remote_target"
  exit
fi

if [[ "$operation" == 'reverse-tunnel' ]]; then
  api_host_gateway="$(read_api_host_gateway)"
  [[ "$api_host_gateway" =~ ^[0-9.]+$ ]] || { echo 'Error: could not identify the API host.docker.internal address.' >&2; exit 1; }
  log_phase "Forwarding ${safe_name} API host gateway port ${remote_port} to Mac 127.0.0.1:${local_port} (Ctrl-C closes the tunnel)."
  ssh -N -o ExitOnForwardFailure=yes -R "${api_host_gateway}:${remote_port}:127.0.0.1:${local_port}" "$remote_target"
  exit
fi

if [[ "$operation" == 'tunnel' ]]; then
  port_output="$(read_remote_ports)"
  ui_port=''
  api_port=''
  while IFS='=' read -r key value; do
    case "$key" in
      STACK_UI_PORT) ui_port="$value" ;;
      STACK_API_PORT) api_port="$value" ;;
    esac
  done <<<"$port_output"
  [[ "$ui_port" =~ ^[0-9]+$ && "$api_port" =~ ^[0-9]+$ ]] || { echo 'Error: invalid remote UI/API ports.' >&2; exit 1; }
  log_phase "Forwarding ${safe_name} UI/API (Ctrl-C closes the tunnel)."
  ssh -N -o ExitOnForwardFailure=yes \
    -L "127.0.0.1:${ui_port}:127.0.0.1:${ui_port}" \
    -L "127.0.0.1:${api_port}:127.0.0.1:${api_port}" \
    "$remote_target"
  exit
fi

log_phase "Starting migration stack ${safe_name} (worktree: ${worktree_name:-development checkouts})"
command -v rsync >/dev/null 2>&1 || { echo 'Error: rsync is required on the Mac and Linux host.' >&2; exit 1; }

GRAPH_ROOT="${HEY_HEY_GRAPH_ROOT:-${REPOSITORIES_ROOT}/graphs}"
EMBEDDINGS_ROOT="${HEY_HEY_EMBEDDINGS_ROOT:-${REPOSITORIES_ROOT}/embeddings}"
UI_ROOT="${HEY_HEY_UI_ROOT:-${REPOSITORIES_ROOT}/ui}"
UI_COMMON_ROOT="${HEY_HEY_UI_COMMON_ROOT:-${REPOSITORIES_ROOT}/ui-common}"
OPENAPI_ROOT="${HEY_HEY_OPENAPI_ROOT:-${REPOSITORIES_ROOT}/openapi}"

# Worktree selection never changes the credential sources.
API_ENV_ROOT="$API_ROOT"
EMBEDDINGS_ENV_ROOT="$EMBEDDINGS_ROOT"
command -v node >/dev/null 2>&1 || { echo 'Error: node is required.' >&2; exit 1; }
source_scratch="$(mktemp -d "${TMPDIR:-/tmp}/heyhey-mstack.XXXXXX")"
trap 'rm -rf -- "$source_scratch"' EXIT
api_extra_source="${source_scratch}/api-extra.env"
umask 077
if [[ -n "$api_env_file" ]]; then
  cp -- "$api_env_file" "$api_extra_source"
else
  : >"$api_extra_source"
  # macOS Bash 3.2 treats expansion of an empty array as unset under set -u.
  for ((assignment_index = 0; assignment_index < ${#api_env_assignments[@]}; assignment_index++)); do
    assignment="${api_env_assignments[assignment_index]}"
    key="${assignment%%=*}"
    value="${assignment#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && "$value" != *$'\n'* ]] || {
      echo 'Error: --api-env requires KEY=VALUE on one line.' >&2
      exit 2
    }
    # The API's existing provider settings use BASE_URL. These two CLI names
    # are accepted for the unattended harness without adding API settings.
    case "$key" in
      ANTHROPIC_API_URL) key=ANTHROPIC_BASE_URL ;;
      OPENAI_API_URL) key=OPENAI_BASE_URL ;;
    esac
    printf '%s=%s\n' "$key" "$value" >>"$api_extra_source"
  done
fi
log_phase 'Selecting sources and generating Embeddings packages...'
node "${SCRIPT_DIR}/migration-stack-sources.js" "$source_scratch" "$worktree_name" \
  "$API_ROOT" "$GRAPH_ROOT" "$EMBEDDINGS_ROOT" "$UI_ROOT" "$UI_COMMON_ROOT" "$OPENAPI_ROOT"
{
  IFS= read -r -d '' API_ROOT
  IFS= read -r -d '' GRAPH_ROOT
  IFS= read -r -d '' EMBEDDINGS_ROOT
  IFS= read -r -d '' UI_ROOT
  IFS= read -r -d '' UI_COMMON_ROOT
  IFS= read -r -d '' OPENAPI_ROOT
} <"$source_scratch/sources"

log_phase "Preparing remote staging area for stack ${safe_name} on ${remote_target}..."
ssh "$remote_target" "umask 077; for source in api graphs embeddings ui ui-common openapi; do mkdir -p \"\$HOME/${remote_sources}/\$source\"; done; mkdir -p \"\$HOME/${remote_state}/bootstrap\""
sync_control_script

sync_source() {
  local source_root="$1"
  local source_name="$2"
  log_phase "Syncing ${source_name}..."
  rsync -a --delete --quiet -e ssh \
    --exclude='.git' \
    --exclude='.tmp/' \
    --exclude='.worktrees/' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='target/' \
    --exclude='build/' \
    --exclude='.next/' \
    --exclude='.turbo/' \
    --exclude='coverage/' \
    --exclude='.cache/' \
    --exclude='.venv/' \
    --exclude='venv/' \
    --exclude='__pycache__/' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='.npmrc' \
    --exclude='.pypirc' \
    --exclude='backups/' \
    --exclude='logs/' \
    --exclude='tmp/' \
    --exclude='*.sqlite' \
    --exclude='*.sqlite3' \
    --exclude='*.log' \
    --exclude='config/keys/*.pem' \
    --exclude='config/keys/*.key' \
    --exclude='config/keys/*private*' \
    --exclude='.DS_Store' \
    -- "$source_root/" "${remote_target}:${remote_sources}/${source_name}/"
}

log_phase 'Syncing local API and sibling sources...'
sync_source "$API_ROOT" api
sync_source "$GRAPH_ROOT" graphs
sync_source "$EMBEDDINGS_ROOT" embeddings
ssh "$remote_target" "mkdir -p \"\$HOME/${remote_sources}/embeddings/generated\""
sync_source "$source_scratch/embeddings-generated/openapi-models" embeddings/generated/openapi-models
sync_source "$source_scratch/embeddings-generated/openapi-events-models" embeddings/generated/openapi-events-models
sync_source "$UI_ROOT" ui
sync_source "$UI_COMMON_ROOT" ui-common
sync_source "$OPENAPI_ROOT" openapi

sync_private_file() {
  local source_file="$1"
  local remote_file="$2"
  if [[ -f "$source_file" ]]; then
    ssh "$remote_target" \
      "umask 077; cat > \"\$HOME/${remote_file}\" && chmod 600 \"\$HOME/${remote_file}\"" \
      <"$source_file"
  else
    ssh "$remote_target" "rm -f \"\$HOME/${remote_file}\""
  fi
}

log_phase 'Syncing Compose environment files over SSH...'
sync_private_file "${API_ENV_ROOT}/.env" "${remote_sources}/api/.env"
sync_private_file "${API_ENV_ROOT}/.env.local" "${remote_sources}/api/.env.local"
sync_private_file "${EMBEDDINGS_ENV_ROOT}/.env" "${remote_sources}/embeddings/.env"
ssh "$remote_target" "umask 077; mkdir -p \"\$HOME/${remote_sources}/api/.tmp/migration-stack/${safe_name}\""
sync_private_file "$api_extra_source" "${remote_sources}/api/.tmp/migration-stack/${safe_name}/api-extra.env"

remote_command="$(cat <<EOF
set -e
remote_root="\$HOME/${remote_root}"
source_root="\$remote_root/sources"
api_root="\$source_root/api"
cd "\$api_root"
export HEY_HEY_MIGRATION_STATE_ROOT="\$remote_root/state"
export HEY_HEY_GRAPH_ROOT="\$source_root/graphs"
export HEY_HEY_EMBEDDINGS_ROOT="\$source_root/embeddings"
export HEY_HEY_UI_ROOT="\$source_root/ui"
export HEY_HEY_UI_COMMON_ROOT="\$source_root/ui-common"
export HEY_HEY_OPENAPI_ROOT="\$source_root/openapi"
if [[ ! -s "\$remote_root/state/bootstrap/application.dump" ]]; then
  if ! existing_bootstraps="\$(find "\$HOME" -maxdepth 9 -type f \\
    -path '*/.tmp/migration-stack/bootstrap/application.dump' -size +0c -print 2>/dev/null)"; then
    echo 'Warning: bootstrap search could not inspect every directory; checking the dumps it found.' >&2
  fi
  if [[ -z "\$existing_bootstraps" ]]; then
    echo 'Error: no existing Linux migration-stack bootstrap dump was found under the home directory.' >&2
    echo 'Run pnpm migration-stack bootstrap on Linux once, then retry mstack.' >&2
    exit 1
  fi
  bootstrap_count="\$(printf '%s\\n' "\$existing_bootstraps" | wc -l | tr -d ' ')"
  if [[ "\$bootstrap_count" != 1 ]]; then
    echo 'Error: found multiple Linux migration-stack bootstrap dumps; select the intended one:' >&2
    printf '%s\\n' "\$existing_bootstraps" >&2
    exit 1
  fi
  printf '[%s] Copying the existing Linux migration-stack bootstrap into this stack...\\n' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  # Bootstrap import belongs to this launcher, not the selected API revision.
  # Older source checkouts require a host pg_restore even on Docker-only hosts.
  docker run --rm \\
    --mount "type=bind,source=\$existing_bootstraps,target=/bootstrap.dump,readonly" \\
    postgres:13 pg_restore --list /bootstrap.dump >/dev/null
  bootstrap_dir="\$remote_root/state/bootstrap"
  umask 077
  cp "\$existing_bootstraps" "\$bootstrap_dir/application.dump.tmp"
  chmod 600 "\$bootstrap_dir/application.dump.tmp"
  {
    printf 'created_at=%s\\n' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'source=file:%s\\n' "\$existing_bootstraps"
    printf 'sha256=%s\\n' "\$(sha256sum "\$bootstrap_dir/application.dump.tmp" | cut -d ' ' -f 1)"
  } >"\$bootstrap_dir/metadata.txt.tmp"
  chmod 600 "\$bootstrap_dir/metadata.txt.tmp"
  mv "\$bootstrap_dir/metadata.txt.tmp" "\$bootstrap_dir/metadata.txt"
  mv "\$bootstrap_dir/application.dump.tmp" "\$bootstrap_dir/application.dump"
fi
printf '[%s] Building and starting stack ${safe_name}; waiting for health checks...\\n' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
bash "\$remote_root/control/migration-stack.sh" --api-root "\$api_root" up --name '${safe_name}' --timeout '${readiness_timeout}' >&2
printf '[%s] Stack ${safe_name} startup completed.\\n' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
sed -n -e '/^STACK_UI_PORT=/p' -e '/^STACK_API_PORT=/p' "\$api_root/.tmp/migration-stack/${safe_name}/runtime.env"
EOF
)"

port_output="$(ssh "$remote_target" "$remote_command")" || exit $?
ui_port=''
api_port=''
while IFS='=' read -r key value; do
  case "$key" in
    STACK_UI_PORT) ui_port="$value" ;;
    STACK_API_PORT) api_port="$value" ;;
  esac
done <<<"$port_output"

[[ "$ui_port" =~ ^[0-9]+$ && "$api_port" =~ ^[0-9]+$ ]] || {
  echo 'Error: could not read UI/API ports from the remote runtime file.' >&2
  exit 1
}

printf 'UI: http://%s:%s\nAPI: http://%s:%s\n' "$STACK_HOSTNAME" "$ui_port" "$STACK_HOSTNAME" "$api_port"
printf 'Mac hosts entry: 127.0.0.1 %s\n' "$STACK_HOSTNAME"
if [[ "$operation" == 'up' ]]; then
  log_phase "Stack ${safe_name} is ready. Run mstack tunnel ${safe_name} to open UI/API forwards."
  exit 0
fi
log_phase "Opening local forwards for ${safe_name} (Ctrl-C closes the tunnel)."
ssh -N -o ExitOnForwardFailure=yes \
  -L "127.0.0.1:${ui_port}:127.0.0.1:${ui_port}" \
  -L "127.0.0.1:${api_port}:127.0.0.1:${api_port}" \
  "$remote_target"
