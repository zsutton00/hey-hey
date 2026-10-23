# Multi-stack migration development

This document describes the local workflow for running two isolated Hey Hey
application stacks at the same time. The primary use case is testing large,
cross-repository migrations before merging them.

## Mental model

Each test stack has:

- its own Docker Compose project;
- isolated PostgreSQL, Redis, Temporal, Neo4j, and Vespa resources;
- unique host ports;
- one source checkout for each application repository; and
- an optional local CLI process connected to that stack.

A convenient setup is one Tilix window per stack, with a pane for every service
being changed:

```text
Tilix: migration-one
  infrastructure   heyhey/api
  api              api/.worktrees/migration-one
  graph            graphs/.worktrees/migration-one
  embeddings       isolated embeddings/dev fallback
  ui               ui/.worktrees/migration-one
  cli --local      cli/.worktrees/migration-one

Tilix: migration-two
  infrastructure   heyhey/api
  api              api/.worktrees/migration-two
  graph            isolated graphs/dev fallback
  embeddings       embeddings/.worktrees/migration-two
  ui               ui/.worktrees/migration-two
  cli --local      isolated cli/dev fallback

Shared separately
  cli --staging    cli-stable
```

## Source selection

The user should select one worktree name for the whole stack. For each
repository, the launcher should resolve source in this order:

1. the explicitly configured source root, when provided;
2. the same-named linked worktree, when it exists; or
3. an isolated fallback checkout at the repository's integration baseline.

The normal baseline is the locally available `origin/dev`, then `dev`. When a
repository has no `dev` branch, use its remote default branch. OpenAPI currently
falls back to `origin/master`.

Repositories have independent Git histories, so there is no meaningful
cross-repository merge base. The launcher must print the resolved path, revision,
and source type for every repository before starting anything.

Example resolution:

```text
Selected: migration-one

api         worktree  api/.worktrees/migration-one
graphs      worktree  graphs/.worktrees/migration-one
embeddings  baseline  origin/dev @ abc1234
ui          worktree  ui/.worktrees/migration-one
ui-common   baseline  origin/dev @ def5678
openapi     baseline  origin/master @ 123abcd
cli         worktree  cli/.worktrees/migration-one
```

Do not run two development processes from the same primary checkout. Build
outputs, watcher caches, Maven `target/` directories, and PID locks can collide.
A missing worktree therefore gets a disposable isolated checkout rather than
reusing the repository root concurrently.

## Stack lifecycle

The current runner is invoked from an API checkout:

```bash
pnpm migration-stack bootstrap
pnpm migration-stack prepare --name migration-one
pnpm migration-stack up --name migration-one
pnpm migration-stack status --name migration-one
pnpm migration-stack logs api --name migration-one
pnpm migration-stack cli --name migration-one
pnpm migration-stack down --name migration-one
pnpm migration-stack restart --name migration-one api --timeout 600
```

`up` waits for Compose health checks plus HTTP responses from the API JWKS
endpoint and UI root. It exits non-zero when either endpoint does not become
ready within `--timeout` seconds (default 600). `restart` recreates one named
service from its existing image and waits for readiness; API and UI restarts
also repeat the HTTP probes. `down` preserves the stack's data. `destroy`
removes the Compose project and all of its volumes, including the external API
JWT-key volume, and succeeds when the stack is already absent:

```bash
pnpm migration-stack destroy --name migration-one
```

The destructive reset is explicit:

```bash
pnpm migration-stack reset --name migration-one --yes
```

`bootstrap` captures the current API database once into shared Git worktree
state. Pass `--refresh` to replace it, `--from FILE` to install an existing
custom-format `pg_dump`, or `--empty` to create an empty PostgreSQL 13 dump using
a temporary Docker container. `up`, `prepare`, and `reset` refuse to run until
this shared bootstrap exists.

`prepare` builds the application images. `up` builds the images from current
source and recreates containers whose images changed. Run `up` again after
editing any application source. `prepare` alone leaves running containers on
their previous images. The stack uses production images and has no source watch
process.
Keep the source checkout used for a running stack available until that stack is
shut down.

PostgreSQL's initialization script is copied into the stack's bootstrap volume
before PostgreSQL starts. This keeps its container independent of the API
checkout path after creation. Existing stacks created with the earlier direct
script mount require a one-time PostgreSQL container replacement to adopt it.
If that checkout is already gone, restore its source path or recreate the
PostgreSQL container from a valid checkout, preserving the named data volume.

Reset removes only that named stack's volumes, restores the PostgreSQL snapshot
into a private source database, builds an empty target schema from the checked-out
Flyway migrations, imports compatible application data, and restarts the stack.
Migration-history rows are never copied from the snapshot. Other stores start
empty.

Flyway reuses a PostgreSQL session across migrations. The
`beforeEachMigrate__clear_diagram_helpers.sql` callback removes the two reused
`pg_temp` Diagram guidance functions before each migration, so consecutive
guidance migrations can create their own definitions without changing applied
migration checksums. It does not remove persistent functions or application
data. To check the helper lifecycle on PostgreSQL, run
`psql -v ON_ERROR_STOP=1 -f scripts/test-diagram-migration-helpers.sql` from the
API checkout with your usual connection arguments; the test uses only
session-local functions.

The stack's JWT signing-key volume is intentionally external to destructive
resets. Tokens issued by that named stack therefore remain verifiable after a
database rebuild, while a different stack name still receives isolated keys.

The compatibility import intersects source and target columns and ignores rows
already seeded by the branch migrations. It fails fast when the snapshot lacks
a required target column unless an explicit projection is defined in
`docker/migration-stack/import-postgres-bootstrap.sh`. Value-shape migrations
that must be reapplied after import are documented in that same script. This
keeps migration renames and checksum drift out of the target history while
making real data-contract differences visible.

Runtime configuration and local-only secrets are stored under:

```text
.tmp/migration-stack/<name>/runtime.env
```

## Current implementation

The current `scripts/migration-stack.sh` builds API, Graph, Embeddings, and UI
inside the named Compose project. Repository roots default to sibling checkouts
and can be overridden explicitly:

```bash
HEY_HEY_GRAPH_ROOT=/path/to/graphs-worktree \
HEY_HEY_EMBEDDINGS_ROOT=/path/to/embeddings-worktree \
HEY_HEY_UI_ROOT=/path/to/ui-worktree \
HEY_HEY_UI_COMMON_ROOT=/path/to/ui-common-worktree \
HEY_HEY_OPENAPI_ROOT=/path/to/openapi-worktree \
pnpm migration-stack up --name migration-one
```

Migration builds reuse dependency layers while still copying and compiling the
selected sources. Embeddings uses `docker/migration-stack/embeddings.Dockerfile`:
its `dependencies` stage installs the selected checkout's requirements and
constraints before copying generated OpenAPI packages or application code.
Regenerating models therefore reinstalls only their editable packages, rather
than the entire ML dependency tree. Generated-package dependencies still resolve
against the same constraints and fail normally on incompatible requirements.
The runtime image also runs the selected checkout's `scripts/build_jina_int8.py`
to bake and verify the pinned INT8 model at `/app/models/jina-colbert-v2-int8`.
The first build downloads and converts the model; search needs no runtime model
download or host artifact mount. A failed artifact build fails the image build.

Migration-stack images set Vespa's cluster and content-engine disk limits to `1.0`
(100%). Dev volumes share the host filesystem, so a small index should not stop
accepting writes because unrelated host data exceeds a percentage threshold.
Memory limits remain as configured by the selected embeddings checkout. This
override applies only to migration-stack images; writes can still fail if the
filesystem actually runs out of space. Previously rejected documents need to be
reindexed after a feed block is lifted.

Graph's `dependencies` stage resolves Maven dependencies from `pom.xml` alone.
OpenAPI specs, resolver scripts, and Java source are copied afterward into its
`build` stage. Contract/source changes rerun generation and compilation while
preserving dependency resolution and the shared Maven repository cache.

Python, UI pnpm, and Graph Maven downloads use persistent BuildKit cache mounts
on the build host. UI retains its local ui-common package installation order.
The first build (or a dependency change) still needs downloads; subsequent builds
reuse layers or cached packages. GPU dependencies are retained from the selected
embeddings checkout. No separately published base image is needed on a persistent
build host: the dependency stage serves that purpose. Changing builders or
pruning Docker build cache loses this reuse; image cleanup below preserves it.

Image cleanup runs automatically after successful `prepare`, `up`, `reset`, and
`down` commands. It targets only application images built for the named stack.
`prepare` removes dangling older builds while keeping the newly tagged images;
`up`, `reset`, and `down` remove all of that stack's images that are no longer
referenced by any container. Running and stopped containers protect their images.
Volumes, other stacks' images, infrastructure images, and Docker build cache are
preserved. The next `up` rebuilds application images removed by `down`.

Run cleanup independently, without source checkouts or a database bootstrap:

```bash
pnpm migration-stack prune --name migration-one
```

Cleanup uses a build label introduced with this feature, so older unlabelled
images are not included. To also remove legacy images, `docker image prune -a`
provides an interactive, Docker-wide cleanup of images unused by any container.
That command also includes unrelated projects' unused images.

Each new named stack is assigned available loopback ports automatically. For
example, a generated runtime file may contain:

| Service       | URL                      |
| ------------- | ------------------------ |
| UI            | `http://localhost:49152` |
| API           | `http://localhost:49153` |
| Graph         | `http://localhost:49154` |
| Embeddings    | `http://localhost:49155` |
| Temporal UI   | `http://localhost:49156` |
| Neo4j browser | `http://localhost:49157` |
| Vespa         | `http://localhost:49159` |
| CLI bridge    | `http://localhost:49160` |

The generated runtime file preserves the chosen ports for subsequent commands.
Use the `MIGRATION_*_PORT` variables before the first command to override any
assignment. Explicit ports are validated and must be available when the runtime
file is created.

Start the matching local CLI with one command:

```bash
pnpm migration-stack cli --name migration-one
pnpm migration-stack cli --name migration-one pair
```

The runner supplies the API port, controller origin, WebAuthn relying-party ID,
isolated bridge port, and credential profile from the stack runtime file.
The UI receives the same bridge port through its runtime configuration, so
browser requests reach the matching CLI without a `server` query parameter.
Arguments after the stack options are forwarded to the CLI, so commands such as
`pair`, `status`, and `controllers` use the same configuration without copying
any ports.

## Sync a Mac checkout to a remote Docker host

To keep editing on the Mac while building and running containers on Linux, use
`scripts/migration-stack-remote.sh`. It syncs the local API, Graph, Embeddings,
UI, UI Common, and OpenAPI checkouts into an isolated staging directory under
the remote user's home, starts the stack there, then forwards the UI and API
ports to the Mac. Local uncommitted source changes are included.

The helper prints UTC timestamps (`YYYY-MM-DDTHH:MM:SSZ`) at launch and each
major phase: source preparation, repository syncs, bootstrap import, remote
build/start, startup completion, and SSH forwarding. Remote phase timestamps
come from the Linux host so they can be compared directly with container logs.

The remote helper reuses the bootstrap already created by migration-stack on
Linux. It copies that dump into the synced stack's isolated state, so the Mac
needs no PostgreSQL or Docker daemon and the Linux PostgreSQL server does not
need to be running while the copy is made. It stops with an error if no dump or
more than one candidate exists, rather than choosing a database snapshot
silently.

The remote helper validates this copy with `pg_restore --list` in a disposable
`postgres:13` container, then installs the dump and its checksum metadata with
owner-only permissions. The Linux host does not need PostgreSQL client binaries
installed. This import is owned by the remote helper and does not invoke the
selected API checkout's potentially older `bootstrap` command. Docker must be
running and able to use or pull `postgres:13`; a validation failure stops launch
before installing the dump.

Set `HEY_HEY_MIGRATION_REMOTE_TARGET` in the Mac's `~/.zshrc` to the Linux SSH
target. Then run this from the API checkout:

```bash
mstack dev
mstack migration-one --worktree migration-one
mstack migration-two --worktree migration-two
```

If the shell helper is not installed, define it in `~/.zshrc` with the absolute
path to this API checkout:

```bash
mstack() { bash /path/to/api/scripts/migration-stack-remote.sh "$@"; }
```

The stack name selects the remote directories and runtime isolation. The optional
worktree name selects sources independently in all six repositories. Without it,
the helper keeps the existing development paths (including repository-root
overrides and uncommitted files). With it, each repository uses the registered
linked worktree whose directory basename matches the requested name, regardless
of its branch name. Multiple matches, stale registrations, and missing required
files fail before any SSH or sync; they do not trigger a fallback.
The Mac helper copies its current lifecycle script separately and points it at
the selected API source, so an older API worktree does not need to implement
the new `up`, `destroy`, or `restart` options itself.

When a matching worktree is absent, the helper creates a fresh, temporary detached
checkout pinned to the locally available `origin/dev` revision, then local `dev`
if that remote-tracking ref is absent. OpenAPI instead requires `origin/master`.
It never substitutes the current arbitrary branch and does not fetch; fetch the
intended repository first to refresh a stale remote-tracking ref. Temporary
fallbacks are removed when the helper exits. Required build source files must
exist in each selected source. Before any SSH sync, the helper runs the selected
Embeddings generator against the selected OpenAPI embeddings and API specs to
create both Python packages in temporary storage. It syncs those packages over
the selected Embeddings source's ignored generated output. Existing local
packages are neither reused nor overwritten, so baseline checkouts work without
pre-generated files and packages always match the selected contracts.

Generation uses the selected script's pinned generator versions and requires
`npx` plus Java, or Docker when `npx` is unavailable, with the generator artifacts
cached or downloadable. Ambient `OPENAPI_*` overrides are cleared for this step
to prevent another checkout's spec, output path, or package settings from leaking
in. Generation failures abort before remote state is changed.

Before syncing, one JSON line per repository reports its absolute source path,
full commit revision, dirty boolean (tracked edits and untracked files), selection
reason, and baseline ref when applicable. Ignored files are not counted by Git's
dirty state. Source selection never changes credentials: environment files still
come from the original API and Embeddings development paths.

The source sync excludes Git metadata, environment files, caches, and the local
`.tmp` directory. It sends the API `.env` and `.env.local` plus the Embeddings
`.env` separately over SSH with mode `600`, since Compose uses those files at
runtime. The API and Embeddings Docker ignore files keep them out of build
images. Each stack keeps its own copy of the Linux bootstrap, runtime config,
and Docker volumes. Run the helper again after source edits to sync and rebuild.
The original `mstack <name>` form still opens an interactive UI/API tunnel;
Ctrl-C closes that tunnel and leaves the remote stack running.

### Unattended Mac lifecycle and service access

Use the explicit subcommands when a test run owns the stack. `up` syncs the
selected sources, builds and starts the remote stack, waits for API and UI
readiness, and exits. `down` tears down that stack's Compose project and
volumes, removes its remote staging directory, and is safe to repeat after a
successful teardown. These commands do not require a local Docker daemon:

```bash
mstack up nightly-20261005 --timeout 600
mstack status nightly-20261005
mstack down nightly-20261005
```

The up command can inject extra API runtime settings without changing the
normal API `.env` files. Repeat `--api-env KEY=VALUE`, or provide a private
Compose-format environment file with `--api-env-file FILE`. The supplied file
is copied with owner-only permissions. A later `up` with no overrides replaces
the prior override with an empty file. Compose's fixed stack identity,
database, and service settings still take precedence over extra file values.
For the mock LLM, the launcher accepts the requested `ANTHROPIC_API_URL` and
`OPENAI_API_URL` names and translates them to the API's existing
`ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` settings. An `--api-env-file` uses
the API's actual setting names directly:

```bash
mstack up nightly-20261005 --timeout 600 \
  --api-env MOCK_LLM_SESSION_ROUTING_ENABLED=true \
  --api-env MOCK_LLM_SERVER_URL=http://host.docker.internal:43001 \
  --api-env ANTHROPIC_API_URL=http://host.docker.internal:43001 \
  --api-env OPENAI_API_URL=http://host.docker.internal:43001/v1
```

When mock session routing is explicitly enabled, the launcher runs the API with
`NODE_ENV=development`; the API deliberately disables that route in production.

The following SSH commands stay open until interrupted. Start them in separate
terminals or let the test harness own their processes. The UI and API forward
to their assigned same-numbered Mac ports; each stack uses its own hostname:

```bash
mstack tunnel nightly-20261005
mstack db-tunnel nightly-20261005 --local-port 15432
mstack restart nightly-20261005 api --timeout 600
```

The database tunnel forwards only the selected stack's Postgres container to
Mac loopback. With the tunnel open, connect to `127.0.0.1:15432` as user
`migration`, database `migration_test`; the stack's private runtime file holds
the password. Restart uses the named stack's Compose project and returns only
after the service is ready again.

To let the containerized API call a mock server on Mac loopback, keep a reverse
tunnel open as well:

```bash
mstack reverse-tunnel nightly-20261005 --local-port 3001 --remote-port 43001
```

It binds the remote forward to the host gateway address that the stack API
container actually resolves for `host.docker.internal:43001`. On a standard
Linux Docker host this is the default bridge address, which can be reached by
other local containers. The Linux SSH server must allow client-specified remote
bind addresses (`GatewayPorts clientspecified`), and the selected gateway port
must be free. Restrict access to the host gateway and avoid a public `0.0.0.0`
bind. Each concurrent stack should use a distinct remote port.
`ExitOnForwardFailure` makes a refused bind fail immediately.

For a manual teardown on Linux, the equivalent command is:

```bash
cd ~/.cache/hey-hey/migration-stack/mac-test/sources/api
HEY_HEY_MIGRATION_STATE_ROOT="$HOME/.cache/hey-hey/migration-stack/mac-test/state" \
  pnpm migration-stack down --name mac-test
```

The Mac needs Git and Node.js, and both hosts need `ssh` and `rsync`; Linux also needs the
usual migration-stack prerequisites. The default staging path is
`~/.cache/hey-hey/migration-stack/<name>/` on Linux.

### Concurrent verification

Use distinct stack names whose normalized names differ (names are lowercased,
sanitized and truncated to 40 characters). Prepare `migration-one` and
`migration-two` linked worktrees in different subsets of the six repositories,
leaving others to exercise the baseline fallback. Run the three commands above
in separate Mac terminals, retaining their selection reports. Start them in
sequence and leave each running so all three coexist; this also avoids racing
the existing Linux free-port allocator during initial provisioning.

On Linux, for each name, inspect only the non-secret runtime identifiers:

```bash
for name in dev migration-one migration-two; do
  root="$HOME/.cache/hey-hey/migration-stack/$name"
  grep -E '^(COMPOSE_PROJECT_NAME|STACK_.*_PORT)=' \
    "$root/sources/api/.tmp/migration-stack/$name/runtime.env"
  docker ps --filter "label=com.docker.compose.project=heyhey-$name" \
    --format '{{.ID}} {{.Names}} {{.Ports}}'
  docker volume ls --filter "label=com.docker.compose.project=heyhey-$name"
done
```

Confirm disjoint published ports, container IDs, Compose project labels, and
volume names, and load each UI/API through its tunnel. Before rebuilding one
stack, save the other two stacks' container IDs/start times, volume names,
runtime-file checksums, and checksums of a representative source file in each
of their six source directories. Change a source file only in the selected
worktree, close that stack's tunnel, and rerun its command. Verify that its
remote source reflects the edit and its UI/API returns, while the other two
stacks retain their recorded sources, runtime checksums, containers/start times,
volumes, and responding UI/API endpoints. Do not print environment-file contents
or use a volume-deleting reset for this check.

## Run from a remote API checkout

The simplest remote setup is to run the migration-stack commands on the machine
that runs Docker, then access the stack from the Mac over SSH. Keep the API and
sibling repository checkouts on the Docker host; the runner reads those files
and uses them as build contexts and bind mounts. A Docker context pointed at a
remote daemon is not sufficient for this runner because bind-mount paths and
port allocation are resolved by the host running the command.

Configure SSH access from the Mac, for example with a `migration-host` alias in
`~/.ssh/config`, then connect to that host using Remote SSH in your editor or a
terminal. On the Docker host, run the normal setup and lifecycle commands from
the API checkout:

```bash
cd /path/to/heyhey/api
pnpm migration-stack bootstrap --empty
pnpm migration-stack up --name mac-test
```

The host must have the API and sibling repositories available, as well as the
usual migration-stack prerequisites. `bootstrap --empty` creates a blank source
database using a temporary Docker container, so this clean-start path does not
need a separate API database.

The stack publishes its ports on the Docker host's loopback interface. Read the
assigned port numbers on that host without printing the secret values in
`runtime.env`:

```bash
grep '^STACK_.*_PORT=' .tmp/migration-stack/mac-test/runtime.env
```

From the Mac, forward the ports you need to the same local port numbers. For
example, replace the placeholders below with the UI and API ports from the
runtime file:

```bash
ssh -N \
  -L <ui-port>:127.0.0.1:<ui-port> \
  -L <api-port>:127.0.0.1:<api-port> \
  migration-host
```

Keep that SSH session open, then use `http://localhost:<ui-port>` in the Mac's
browser. Add forwards for Temporal UI, Neo4j Browser, Vespa, or other exposed
services when needed. Use Remote SSH or otherwise sync source changes to the
Docker host before rebuilding the stack.

## Target pane-based launcher

The next iteration should add a worktree selection menu and split infrastructure
startup from application startup. The intended flow is:

1. Select a worktree name once.
2. Resolve matching worktrees and isolated `dev` fallbacks.
3. Start the named Docker infrastructure project.
4. Print the exact directory and launch command for each Tilix pane.
5. Launch each service through a stack-aware wrapper that injects its ports and
   dependency URLs.

Commands such as `migration-stack infra` and `migration-stack run` are design
targets and do not exist yet. Until they are implemented, use the current
containerized runner and explicit repository-root overrides shown above.

## CLI modes

The CLI is not a Docker infrastructure service. It has two distinct roles.

### Local CLI

When CLI changes are part of a migration, use the matching CLI worktree or an
isolated `cli/dev` fallback. Each local stack needs its own:

- platform API URL;
- controller/UI origin;
- loopback bridge port; and
- credential profile or backend namespace.

The CLI's `--local` option currently hardcodes API port `3000`, controller port
`5173`, and bridge port `3848`. Supporting a second local stack requires changing
those values into defaults that explicit stack environment variables can
override. The launcher can then provide values equivalent to:

```bash
HEYHEY_API_URL=http://localhost:3100 \
HEYHEY_CONTROLLER_ORIGIN=http://localhost:5273 \
HEYHEY_SERVER_PORT=3948 \
HEYHEY_PROFILE=migration-one \
pnpm dev -- --local
```

### Staging CLI

Keep the staging CLI independent of local stacks. The existing stable checkout
continues to run against staging:

```bash
cd ../cli-stable
pnpm dev -- --staging
```

`../cli-stable` currently implements `--staging`; the current `../cli` checkout
does not. The staging process uses `https://staging.heyhey.dev` and its own bridge
port and credential namespace, so it can remain running alongside local stacks.

## Data and contract notes

- A reset restores PostgreSQL from the shared bootstrap. Neo4j and Vespa start
  empty and are repopulated by their normal stack initialization paths.
- Database schema changes are applied only through Flyway.
- Redis and Temporal must be isolated along with PostgreSQL; database isolation
  alone is insufficient.
- The Embeddings image currently requires its ignored, generated OpenAPI Python
  packages to exist before building.
- No part of this tooling changes Temporal workflow code or command sequencing.
