# Distributed staging activity fixture

The distributed series uses the first fifty identities in the existing private
credential file, in stable pairs, across 25 persistent projects in the same
organization. Each project retains fixture v2 (60 features, 192 tasks, 335
edges), ten scratch tasks, and two assigned users with separate scratch targets
and idle agent-session/conversation records. The fixture owner retains setup
access to every project; measured activity uses only each user's assigned project.

## One-time setup

Confirm staging project creation, membership additions and sufficient project
headroom with the operator before applying them. The read-only inspection on
2026-10-12 found three existing projects, a limit of three, and no distributed
projects: raising the limit to 28 is sufficient while preserving all three.
Apply the confirmed limit through the normal organization project-entitlement
API separately; the fixture script never changes entitlements.

Run locally from the API checkout, after confirmation and the limit change:

```sh
K6_BASE_URL=https://staging.heyhey.dev \
K6_BROWSER_ORIGIN=https://staging.heyhey.dev \
K6_AUTH_USERS_FILE="$HOME/.config/hey-hey/api-diagnostic-users.json" \
ACTIVITY_DISTRIBUTED_PROVISION_CONFIRMED=yes \
ACTIVITY_FIXTURE_MANIFEST=artifacts/api-diagnostic/distributed-v1/fixture-manifest.json \
node scripts/k6/distributed-activity-fixture.mjs --provision
```

Project names are deterministic, so an interrupted provision resumes through
normal APIs. Per-project manifests are saved beside the aggregate manifest.
Keep credentials private and preserve the completed aggregate as the pinned
source. The manifest contains IDs and routing only, without credentials.

## Repeated observations

Run the deployment wrapper locally on the Mac:

```sh
API_DIAGNOSTIC_WORKLOAD=activity \
ACTIVITY_PROJECT_DISTRIBUTION=25x2 \
ACTIVITY_EXISTING_FIXTURE_MANIFEST="$PWD/artifacts/api-diagnostic/distributed-v1/fixture-manifest.json" \
K6_AUTH_USERS_FILE="$HOME/.config/hey-hey/api-diagnostic-users.json" \
../deploy/scripts/run-staging-api-diagnostic.sh
```

The wrapper selects fifty users, mix v2, two five-minute repetitions and a
30-second graceful stop by default. The launcher excludes the first 30 seconds.
Verify the staging slice is still four CPUs / 32 GiB before observing; tracing
verification remains read-only and the wrapper does not restart activity services.

Reuse verifies all fifty identity/project/session/conversation assignments before
scratch cleanup and projection/search readiness. It never creates missing
projects, memberships or session records. Missing access or reordered credentials
fails setup before k6 runs. The source manifest is never overwritten.

Run manifests retain project hashes and all fifty assignments. Distribution and
routing hashes distinguish the new comparison series from historical single-project
evidence. Preserve earlier artifacts unchanged. These simulated session requests
do not execute model or Temporal workloads; project separation does not establish
lock waits as the cause of historical latency.
