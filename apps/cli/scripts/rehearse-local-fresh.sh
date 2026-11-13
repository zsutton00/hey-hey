#!/usr/bin/env bash
# Fresh local rehearsal from this worktree: wipe Hey Hey local state, build the
# api/ui/graph-search images from the working tree (uncommitted changes included),
# package the CLI against a throwaway registry, install it as a new user, and run
# `heyhey local`.
#
# Usage: apps/cli/scripts/rehearse-local-fresh.sh [ui-marker ...]
#   Each ui-marker is a string (e.g. a data-testid) that must appear in the
#   running UI bundle. The run fails if any marker is missing.
#
# The build fails if any source file changes while images are building, because
# such a build cannot be trusted to contain the current tree.
set -euo pipefail

WORKTREE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CLI_DIR="$WORKTREE/apps/cli"
OCI_DIR=/tmp/heyhey-oci
REGISTRY_IMAGE='registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373'
UI_MARKERS=("local-pairing-screen" "$@")
RUN="$(date +%H%M%S)"

step() { echo; echo "=== $* ($(date +%T))"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

trap 'echo "ERROR: stopped at line $LINENO: $BASH_COMMAND" >&2' ERR

# Fingerprint of the files present in the tree (tracked + untracked, respecting .gitignore).
# Tracked files deleted in the working tree are skipped; their absence is part of the state.
source_fingerprint() {
  git -C "$WORKTREE" ls-files -co --exclude-standard -z |
    while IFS= read -r -d '' path; do
      if [ -f "$WORKTREE/$path" ]; then printf '%s\n' "$path"; fi
    done |
    (cd "$WORKTREE" && git hash-object --stdin-paths) |
    shasum | cut -d' ' -f1
}

command -v skopeo >/dev/null || fail "skopeo is required"
step "1. Clearing old Hey Hey local install and rehearsal leftovers"
echo "disk free before: $(df -h /System/Volumes/Data | awk 'NR==2 {print $4}')"
containers="$(docker ps -aq --filter name=heyhey-local- --filter name=heyhey-rehearsal-)"
[ -z "$containers" ] || docker rm -f $containers >/dev/null
docker volume rm heyhey-local_api-keys heyhey-local_postgres-data heyhey-local_redis-data >/dev/null 2>&1 || true
docker network rm heyhey-local_default >/dev/null 2>&1 || true
images="$(docker images -q 'localhost:5055/*' | sort -u)"
[ -z "$images" ] || docker rmi -f $images >/dev/null
# Build cache of the dedicated rehearsal builder (grows by GBs per two-platform build),
# plus untagged layers left behind by earlier runs.
docker buildx prune --builder heyhey-oci -af >/dev/null
docker image prune -f >/dev/null
# Earlier rehearsal packages, installs and new-user profiles, and all unpacked images.
rm -rf ~/.heyhey/local-application "$OCI_DIR" \
  /tmp/heyhey-rehearsal-* /tmp/heyhey-try-* /tmp/heyhey-newuser-*
mkdir -p "$OCI_DIR"
leftover="$(docker ps -a --format '{{.Names}}' | grep -E 'heyhey-(local|rehearsal)' || true)"
[ -z "$leftover" ] || fail "containers still present: $leftover"

# Images, registry copies and the running stack need roughly 20 GB; Docker fails with
# opaque I/O errors (e.g. registry HTTP 500) when the host disk fills.
free_gb="$(df -g /System/Volumes/Data | awk 'NR==2 {print $4}')"
echo "disk free after: ${free_gb} GB"
[ "$free_gb" -ge 20 ] || fail "only ${free_gb} GB free after clean-up; something outside Hey Hey is using the disk"

step "2. Building images from the worktree"
cd "$WORKTREE"
fingerprint_before="$(source_fingerprint)"
version="$(node -p "require('./apps/cli/package.json').version")"
revision="$(git rev-parse HEAD)"
for image in api ui graph-search; do
  echo "--- building $image ($(date +%T))"
  docker buildx build --builder heyhey-oci --platform linux/amd64,linux/arm64 \
    --build-arg APP_VERSION="$version" --build-arg SOURCE_REVISION="$revision" \
    -f "apps/$image/Dockerfile" --output "type=oci,dest=$OCI_DIR/$image.tar" . \
    >"$OCI_DIR/build-$image.log" 2>&1 || fail "$image build failed; see $OCI_DIR/build-$image.log"
  mkdir "$OCI_DIR/$image"
  tar -xf "$OCI_DIR/$image.tar" -C "$OCI_DIR/$image"
  rm -f "$OCI_DIR/$image.tar"
done
[ "$(source_fingerprint)" = "$fingerprint_before" ] ||
  fail "source files changed during the build; the images may not contain the current tree. Re-run."

step "3. Packaging the CLI and starting the registry"
cat >"$OCI_DIR/rehearsal-sources.json" <<JSON
{
  "api": "oci:$OCI_DIR/api",
  "ui": "oci:$OCI_DIR/ui",
  "graphSearch": "oci:$OCI_DIR/graph-search",
  "postgres": "docker://pgvector/pgvector@sha256:01215e09bd4bd582d20230e025b6c971deeeffee49ceef1aae167e839cb62a7e",
  "redis": "docker://redis@sha256:21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537"
}
JSON
cd "$CLI_DIR"
pnpm exec tsx scripts/rehearse-local.ts "$OCI_DIR/rehearsal-sources.json" "/tmp/heyhey-rehearsal-$RUN" "$REGISTRY_IMAGE"

step "4. Installing as a new user"
npm install -g --prefix "/tmp/heyhey-try-$RUN" "/tmp/heyhey-rehearsal-$RUN/hey-hey-cli-$version.tgz"
export HEYHEY_LOCAL_export HEYHEY_PROFILE="newuser-$RUN"
export HEYHEY_AUTHORIZATION_DIR="/tmp/heyhey-newuser-$RUN/authorization"

# Verify the running UI once its container is up, while `heyhey local` keeps running.
(
  for _ in $(seq 1 180); do
    docker exec heyhey-local-ui-1 true >/dev/null 2>&1 && break
    sleep 2
  done
  echo
  echo "=== 5. Checking the running UI"
  label="$(docker inspect heyhey-local-ui-1 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
  [ "$label" = "$revision" ] && echo "revision OK ($revision)" || echo "ERROR: UI revision $label, expected $revision"
  for marker in "${UI_MARKERS[@]}"; do
    if docker exec heyhey-local-ui-1 sh -c "grep -rlq -- '$marker' /app/dist"; then
      echo "marker OK: $marker"
    else
      echo "ERROR: marker missing from running UI: $marker"
    fi
  done
) &

step "Running heyhey local (profile newuser-$RUN)"
"/tmp/heyhey-try-$RUN/bin/heyhey" local
