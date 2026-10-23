# Authenticated API diagnostic

`pnpm performance:api-diagnostic` runs the versioned authenticated API
journey at the same offered load with tracing disabled and enabled. It requires
at least two repetitions per mode (`K6_REPETITIONS`, default `3`) so the output
contains normal run-to-run variance before any tracing overhead is interpreted.

The runner records a build identity, environment identity, configuration
identity, load settings, Node version, and a credential-free API origin. When
`API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_FILE` is set, it obtains those identities
from the deployment checkout's post-deploy context instead of requiring them
as manually copied values. `API_DIAGNOSTIC_DEPLOYMENT_CONTEXT_COMMAND` remains
available for remote retrieval. Likewise, `K6_AUTH_USERS_FILE` lets the
runner read a local file of dedicated users and pass it only to k6;
`K6_AUTH_USERS_JSON` remains available for one-shot use. Each identity must
have a distinct email. Against staging, run the deployment checkout's
`scripts/run-staging-api-diagnostic.sh`, which supplies every command below
over SSH. Every
repetition gets its own artifact directory
containing:

- the k6 summary and raw JSON metric stream;
- k6, trace-toggle, and evidence-command logs;
- exit status and timestamps for each evidence command.

The evidence commands are responsible for collecting the cross-service
signals. They receive these variables:

| Variable                                                            | Meaning                              |
| ------------------------------------------------------------------- | ------------------------------------ |
| `API_DIAGNOSTIC_EVIDENCE_DIR`                                       | Directory for the current repetition |
| `API_DIAGNOSTIC_TRACE_MODE`                                         | `disabled` or `enabled`              |
| `API_DIAGNOSTIC_RUN_ID`                                             | Stable parent run identifier         |
| `API_DIAGNOSTIC_REPETITION`                                         | One-based repetition number          |
| `API_DIAGNOSTIC_START_AT` / `API_DIAGNOSTIC_END_AT`                 | Journey observation window           |
| `API_DIAGNOSTIC_ENVIRONMENT_ID` / `API_DIAGNOSTIC_CONFIGURATION_ID` | Recorded identity fields             |

The API, Graph, and Embeddings evidence commands should emit bounded,
credential-free JSON or text containing request/service latency and error
observations for that window. The database and container commands should emit
the corresponding demand evidence. The trace-volume command should include
span volume/completeness, and the dropped-telemetry command should include
export/drop counts. The runner preserves their stdout and stderr without
printing it. Each evidence command must exit successfully and produce
non-empty stdout; otherwise the repetition is marked incomplete.

The staging deployment writes a credential-free
`reports/staging-diagnostic-context.json` after the stack passes health checks.
Its build identity comes from the running API, Graph, and Embeddings image
content IDs; its configuration identity covers the effective staging inputs and
Compose files; and its environment identity covers the staging environment,
Compose project, network, and database identity.

For staging, run the deployment checkout's wrapper on the operator machine:

```sh
../deploy/scripts/run-staging-api-diagnostic.sh
```

The wrapper runs `pnpm performance:api-diagnostic` and k6 locally, with the API
origin taken from that staging deployment context. It uses the local API
checkout beside the deployment checkout and the dedicated-user file at
`$HOME/.config/hey-hey/staging-api-diagnostic-users.json` by default. SSH is
used only to read staging context, switch the staging API tracing mode, and
collect staging evidence. Docker Compose does not run k6. Stable paths and the
staging SSH target can be overridden for a different operator setup.

If a remote trace-mode switch fails, the corresponding repetition is marked
incomplete before k6 starts. That is a failed setup attempt, not a performance
measurement.

For direct runner use outside the staging wrapper, provide the explicit
`K6_BASE_URL`, `K6_BUILD_ID`, `K6_ENVIRONMENT_ID`, `K6_CONFIGURATION_ID`,
`K6_BROWSER_ORIGIN`, and `DEPLOYMENT_ENVIRONMENT` inputs, plus the relevant
local authentication and evidence-command settings.

The staging wrapper writes artifacts under its local `K6_OUTPUT_ROOT` (defaulting to the operator machine's temporary directory at
`heyhey-staging-api-diagnostic/<run-id>`). Direct runner use defaults to
`artifacts/api-diagnostic/<run-id>`. The
`run-manifest.json` `baseline` section reports per-mode median, range, mean,
and standard deviation across repetitions, plus disabled-versus-enabled
latency deltas. These are measured signals only; the runner deliberately does
not apply latency thresholds or call a signal an optimization finding.

Rank a finding only after correlating a repeated workload signal with the
preserved trace and service evidence, then record its owning feature/service,
correctness constraint, and matched before/after journey in the owning work
item. A failed repetition or evidence command makes the manifest fail so an
incomplete baseline cannot be mistaken for a completed comparison.

For a fifty-user activity observation against the pinned persistent fixture,
run the following locally on the Mac, from the API checkout:

```sh
API_DIAGNOSTIC_WORKLOAD=activity ACTIVITY_VU_STEPS=50 K6_REPETITIONS=2 \
  K6_DURATION=5m K6_GRACEFUL_STOP=30s \
  K6_AUTH_USERS_FILE="$HOME/.config/hey-hey/api-diagnostic-users.json" \
  ACTIVITY_EXISTING_FIXTURE_MANIFEST="$PWD/artifacts/api-diagnostic/activity-20261010055009/fixture-manifest.json" \
  K6_OUTPUT_ROOT="$PWD/artifacts/api-diagnostic/daily/$(date -u +%F)" \
  sh ../deploy/scripts/run-staging-api-diagnostic.sh
```

`ACTIVITY_EXISTING_FIXTURE_MANIFEST` selects reuse instead of full seeding or
membership creation. Setup checks the pinned project's organization ownership,
archives extra scratch additions and waits for graph/search readiness before
each repetition. The source manifest is preserved; refreshed readiness counts
are written to the run's separate manifest. Missing projects or mismatched
ownership fail setup without creating a replacement. Activity mode verifies
enabled tracing read-only and does not restore tracing or recreate the API.

Verify the shared staging slice's 8 CPU / 32 GiB cap and service membership
before running; Tempo remains outside that slice. The fifty credentials must
already pass normal login and project access. Fifty users share ten scratch
write targets by modulo mapping, with 2–8-second pauses. Analysis excludes the
first thirty seconds. Fifty-user observations form a new comparison series;
the ten-user recordings remain historical evidence. This command is a manual
observation; daily scheduling and automatic comparison findings are separate
work still to be completed.

### Mixed session workload (mix v2)

Set `ACTIVITY_MIX_FILE=scripts/k6/activity-mix-v2.json` on the command above
to run the mixed workload; without it the launcher keeps mix v1, so the
original fifty-user baseline stays reproducible. Every tenth user is heavy
(90/10 split at 50 and 100 users). Each user is paced open-loop at about 50
requests/minute; heavy users burst to about 180/minute for one minute every
four minutes, with offsets staggered across heavy users. Two scheduled slots
per user per minute are searches; session, conversation, queued-input and
message traffic share the remaining slots by weight. The calibration source is
recorded in the mix file.

Setup gives each identity one persistent `NOT_STARTED` agent session bound to
an `agent-session` conversation, reused across runs. That workflow is not
Temporal-backed and message writes are passive `NOOP` SYSTEM messages, so the
mix exercises session API traffic only; it never starts model or workflow
execution and is not a capacity profile. MCP calls are not simulated. NOOP
messages accumulate in each identity's conversation across runs.

When a response arrives after later slots were due, those slots are counted as
missed; the report shows offered versus completed request rates per cohort.
Each mix version and user count is its own comparison series
(`mix-v<version>-u<users>`).

Run `ACTIVITY_VU_STEPS=100` only after the credential set holds one hundred
identities. `provision-diagnostic-users.mjs check` reads the staging schema,
project ownership and existing memberships; `apply` (an outward staging write,
run only with explicit approval) creates the missing numbered identities with
MEMBER organization and project roles in one transaction, and `verify` logs in
every identity and reads the fixture project. `DIAGNOSTIC_USER_COUNT` defaults
to 100 and accepts 50 or 100.

### Read-only staging log and trace collection

The deployment wrapper runs `collect-staging-api-evidence.mjs` locally using
the staging Grafana Viewer token at
`~/.config/hey-hey/grafana-mcp/staging-token` (override with
`STAGING_GRAFANA_TOKEN_FILE`). It checks Loki and Tempo read access before
launching k6; no Grafana administrator password is required by this path.

For recovery without running a benchmark, set `API_DIAGNOSTIC_START_AT`,
`API_DIAGNOSTIC_END_AT`, and the repetition's `K6_RUN_ID`, then invoke
`node scripts/k6/collect-staging-api-evidence.mjs api` or `tempo` and redirect
stdout to a file under the gitignored artifacts directory. Each window must
be positive and at most two hours. `preflight` verifies read access independently.

Loki queries are scoped to staging/API and the run ID, exclude login/setup,
and retrieve at most 50 lines per call. Tempo exports only span identifiers,
timing and status for traces correlated to that run in Loki. Its bounded
window search exports a count, not unrelated trace records. Missing trace
lookups and truncation are recorded explicitly. A recovered sample is not
a complete recording or a latency distribution. Smaller windows can recover
additional samples. Zero recovered traces or non-404 lookup errors fail the
collector; partial recovery with 404 gaps preserves those gaps in the JSON.
