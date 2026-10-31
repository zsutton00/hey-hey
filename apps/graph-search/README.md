# Graph and search service

The Rust foundation for a PostgreSQL graph/search backend. One process owns
separate `graph` and `search` modules and a dedicated logical database on the
existing PostgreSQL server. The search module includes the text encoder; graph
traversal, search queries, authentication and event ingestion are follow-on work.
This shell is not ready to replace the existing backends.

## Build from a clean checkout

Install Rust 1.97.0 (including rustfmt and Clippy), Node 24+, pnpm 10.18.1, and
Docker with Compose v2. A rustup installation uses `rust-toolchain.toml`
automatically. Cargo downloads dependencies on the first build; `Cargo.lock`
is committed. No Node dependencies or API build are needed to build this app.

From the repository root:

```sh
pnpm bootstrap
pnpm --filter @hey-hey/graph-search check
pnpm --filter @hey-hey/graph-search build
```

Or without Node/pnpm:

```sh
cd apps/graph-search
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked --release
```

`pnpm check` includes this app's formatting, Clippy, compilation and tests.
Normal builds use committed SQLx query metadata in `.sqlx/`, so they need no
running database. SQL uses SQLx's checked macros; migrations are embedded in
the binary. After changing SQL, run against the dedicated database:

```sh
cd apps/graph-search
cargo install sqlx-cli --version 0.8.6 --locked --no-default-features --features rustls,postgres
export DATABASE_URL="$GRAPH_SEARCH_DATABASE_URL"
SQLX_OFFLINE=false cargo sqlx prepare -- --all-targets
```

Commit the regenerated `.sqlx/` files. `DATABASE_URL` is used only by SQLx's
build tooling, never as a runtime fallback. CI also compiles SQL against a real
PostgreSQL 17 instance and runs the database and container tests.

## Run against the existing PostgreSQL server

Hey Hey uses **one PostgreSQL server**, with separate logical databases and
credentials for the API and graph/search. Complete the existing server's
PostgreSQL 17 upgrade before running this service against it. That upgrade must
also make pgvector 0.8.7 available; the selected server image is
`pgvector/pgvector:0.8.7-pg17-trixie`. The upgrade and its data migration remain
separate work. This app's normal Compose file starts only the Rust service and
requires an explicit database URL; it creates no PostgreSQL container or volume.

Once PostgreSQL 17 and pgvector are available, an administrator provisions the
logical database on that same server. In an administrator `psql` session:

```sql
CREATE ROLE graph_search LOGIN;
\password graph_search
CREATE DATABASE heyhey_graph_search OWNER graph_search;
\connect heyhey_graph_search
CREATE EXTENSION vector VERSION '0.8.7';
CREATE EXTENSION pg_trgm;
```

The password command prompts interactively. Use this dedicated, non-superuser
role in the service URL. Extensions are installed by the administrator in the
graph/search database; the app applies its own SQLx migrations there on startup.
Core full-text search needs no extension. The API keeps its own credentials,
logical database and Flyway migrations. The fixed graph/search database name is
`heyhey_graph_search`; startup rejects other names before connecting, and
verifies PostgreSQL 17 and the absence of Flyway history before migrating.

For the container, use an address reachable **from the container**. With the
existing server published on the host's port 5432, run from the repository root:

```sh
export GRAPH_SEARCH_DATABASE_URL='postgres://graph_search:YOUR_URL_ENCODED_PASSWORD@host.docker.internal:5432/heyhey_graph_search'
docker compose -f apps/graph-search/compose.yaml up --build -d --wait
curl --fail http://127.0.0.1:8090/healthz
docker compose -f apps/graph-search/compose.yaml down
```

Compose includes the host gateway mapping for Linux; Docker Desktop provides
that hostname too. For a remote server, use its configured host and TLS settings.
Stopping this Compose project stops only graph/search, leaving the shared server
and both databases in place.

For native development, copy `.env.example` to `.env` and set the graph/search
password and the existing server's host/port. The example uses loopback port 5432.
Then export the settings and run:

```sh
cd apps/graph-search
set -a
. ./.env
set +a
cargo run --locked
```

The application reads environment variables; it does not load `.env` files.

| Variable                       | Default                     | Meaning                                                   |
| ------------------------------ | --------------------------- | --------------------------------------------------------- |
| `GRAPH_SEARCH_DATABASE_URL`    | Required                    | PostgreSQL URL naming `heyhey_graph_search`               |
| `GRAPH_SEARCH_BIND`            | `127.0.0.1:8090`            | Numeric bind IP and port; image default is `0.0.0.0:8090` |
| `GRAPH_SEARCH_MAX_CONNECTIONS` | `5`                         | Pool limit, 1–100; five-second acquisition timeout        |
| `GRAPH_ENABLED`                | `true`                      | Enable the graph route group; `true` or `false`           |
| `SEARCH_ENABLED`               | `true`                      | Enable the search route group; `true` or `false`          |
| `SEARCH_EMBEDDING_MODEL`       | `snowflake-arctic-embed-s`  | Model name recorded with the stored vectors               |
| `SEARCH_EMBEDDING_DIMENSION`   | `384`                       | Vector size; must match the model and the database record |
| `SEARCH_EMBEDDING_MAX_BATCH`   | `1`                         | Texts per encoding run, 1–8; see the encoder section      |
| `SEARCH_EMBEDDING_MODEL_DIR`   | `models/<model>`            | Folder with the model files; image default `/models/...`  |
| `GRAPH_SEARCH_MODEL_DIR`       | `./models/<model>`          | Compose host folder mounted read-only as the model folder |
| `RUST_LOG`                     | `info`                      | Tracing filter; logs are JSON on stdout                   |
| `GRAPH_SEARCH_DB_PORT`         | `55437`                     | Disposable test fixture port only                         |
| `GRAPH_SEARCH_PORT`            | `8090`                      | Compose host HTTP port                                    |
| `GRAPH_SEARCH_IMAGE`           | `heyhey-graph-search:local` | Compose service image                                     |

The graph route group is under `/api`, matching the graph specification's server
prefix; the search group is rooted at `/`, matching the embeddings specification.
Both currently return **501 Not Implemented**; disabled surfaces return 404.
`GET /healthz` is a separate process readiness endpoint: 200 after migrations
and while PostgreSQL is reachable, 503 when it is unavailable. It is not the
embeddings specification's `/health` response. Wire authority remains
`openapi/specs/graphs/openapi.yaml` and `openapi/specs/embeddings/openapi.yaml`;
this foundation introduces no domain DTOs or successful domain operations.

The runtime uses two Tokio workers and at most five database connections by
default. Compose caps the service at one CPU/512 MiB. The disposable test
server has a one CPU/512 MiB limit; the existing server retains its own resource
configuration. The 512 MiB Compose limit leaves room for the encoder measured below. SIGINT/SIGTERM drain HTTP
requests and close the pool. The image runs as an unprivileged numeric user.

## Text encoder

The search module turns document and query text into vectors in-process, so a
local install needs no embedding service. It runs Snowflake's
[arctic-embed-s](https://huggingface.co/Snowflake/snowflake-arctic-embed-s)
(384 dimensions, INT8 ONNX) on the CPU through ONNX Runtime 1.31.0 and the
Hugging Face tokenizer. Encoding runs on one dedicated thread with a short
queue, so requests stay responsive and only one batch is in memory at a time.

**Model files are an installation dependency.** The service never downloads
them. Fetch the pinned revision (checksums verified) once:

```sh
cd apps/graph-search
bash scripts/fetch-model.sh            # into models/snowflake-arctic-embed-s
```

It installs `model_quantized.onnx` and `tokenizer.json` from revision
`e596f507467533e48a2e17c007f0e1dacc837b33`. **License: Apache-2.0** (the
model card's license). If files are missing, startup names them, the source and
the folder to use. Set `SEARCH_ENABLED=false` to run without search and without
the model. The ONNX Runtime library is linked into the binary at build time.

**Vectors are tied to the model.** On first start the service records the model
name and vector size in `search.embedding_model`. If a later start is configured
for a different model or size, it refuses to start and says the stored vectors
must be re-encoded; changing the model is never a silent mismatch.

**Keep the batch cap at 1.** The INT8 model quantizes each batch as a whole, so
with a cap above 1 the same text gets a slightly different vector depending on
its neighbours (cosine 0.996 at cap 2), and stored vectors stop matching
query-time vectors. Larger batches also cost memory without adding throughput.

Measured memory, next to the benchmark that chose the model (512-token texts,
peak resident memory of the whole process including about 115 MB after loading;
Apple Silicon, macOS 14.4, Rust encoder in this crate):

| Batch | This encoder | Benchmark | Encoding rate (this encoder) |
| ----- | ------------ | --------- | ---------------------------- |
| 1     | 193 MB       | 0.43 GB   | 17 docs/s                    |
| 2     | 232 MB       | 0.69 GB   | 18 docs/s                    |
| 4     | 361 MB       | 1.14 GB   | 19 docs/s                    |
| 8     | 575 MB       | 1.7 GB    | not measured                 |

The benchmark figures come from the model-selection benchmark (ONNX Runtime
1.31.1; 33 to 29 docs/s, Rust idle about 140 MB). Its measurement setup differs,
so compare the trend rather than the absolute values. Cold start is about 0.1 s.

Model tests use the real files and are skipped by default:

```sh
bash scripts/fetch-model.sh
GRAPH_SEARCH_TEST_MODEL_DIR=models/snowflake-arctic-embed-s pnpm test:model
```

On macOS, building needs the macOS 15 SDK (Xcode 16 or current Command Line
Tools): the ONNX Runtime build for Apple Silicon references CoreML classes
missing from older SDKs, although the encoder only uses the CPU.

## Integration verification

Unit/HTTP tests run without PostgreSQL. The database test needs an explicitly
disposable database: it exercises startup migrations, extensions, full-text
search, readiness, restart idempotence and rejection of Flyway history. It
temporarily creates a Flyway sentinel table in that test database.

```sh
docker compose -p graph-search-test -f apps/graph-search/compose.test.yaml up -d database --wait
cd apps/graph-search
GRAPH_SEARCH_TEST_DATABASE_URL=postgres://graph_search:local_graph_search@127.0.0.1:55437/heyhey_graph_search \
  pnpm test:database
cd ../..
docker compose -p graph-search-test -f apps/graph-search/compose.test.yaml down --volumes
```

Choose a free `GRAPH_SEARCH_DB_PORT` and match the test URL if the fixture's
default port is occupied. Only `compose.test.yaml` provisions a temporary server.
It hosts an API-like `project` database with a Flyway sentinel and a separate
`heyhey_graph_search` database owned by a non-superuser role. The container test
verifies graph/search startup and restart leave the API-like database unchanged.
These fixtures do not read the real API's environment or access its server. To build the runtime and verify a fresh container install/restart:

```sh
docker build -f apps/graph-search/Dockerfile -t heyhey-graph-search:local .
pnpm --filter @hey-hey/graph-search test:container
```

The container test uses a unique Compose project and ephemeral host ports, and
removes only its own containers and volume when finished.

## Release path

The existing `publish-images.yml` workflow selects graph/search when its inputs
change on a `release/**` branch. It runs the Cargo checks, builds the image once,
smoke-tests fresh database startup and restart, records build evidence, then
publishes `ghcr.io/zsutton00/graph-search-service:candidate-<full-git-sha>` and
a release/version tag. Manual release-branch retries can select **Graph Search**
or **All**; **Both** retains its existing UI/API meaning. The build accepts
`APP_VERSION` and `SOURCE_REVISION` OCI labels like the API image.

Review the published digest and evidence before any deployment. A local run can
use `GRAPH_SEARCH_IMAGE=ghcr.io/zsutton00/graph-search-service@sha256:<digest>`
with `docker compose ... up --no-build`. This task adds build/publication support;
it does not deploy, change API backend selection, or upgrade deployed PostgreSQL.

References: [pgvector's supported images](https://github.com/pgvector/pgvector#docker)
and [SQLx offline query checking](https://docs.rs/sqlx/0.8.6/sqlx/macro.query.html#offline-mode).

## Authentication

Set `GRAPH_SEARCH_JWKS_URL` to the API's reachable JWKS endpoint, and set
`GRAPH_SEARCH_GRAPH_AUDIENCE=graph-service` and
`GRAPH_SEARCH_SEARCH_AUDIENCE=embeddings-service` to match API-issued system tokens.
Startup fetches and validates the verification keys before loading the model or connecting
to PostgreSQL. Missing, unavailable or malformed signing trust prevents startup.
RS256 and a known `kid` are required; there is no static-secret fallback.
JWKS refreshes after five minutes and on an unknown key (limited to once per five seconds).
Publish new keys before signing with them, retaining overlapping keys through token expiry.

Current API user tokens omit issuer and audience. Leave `GRAPH_SEARCH_JWT_ISSUER`
and `GRAPH_SEARCH_USER_AUDIENCE` unset to accept that existing profile. These optional
settings enforce issuer and ordinary-operation audience when the issuer supplies them.
Deletion always requires exactly the configured provider audience and the sole
`organization:projection:delete` scope, with organization and marker matching the command.
Template export and copy require the separate `project:template:copy` system credential.

Each method in both route groups declares its policy through `AuthenticatedRouter`.
Verified `Principal` context is placed in request extensions. Future store-backed handlers
must use this identity and `authorize_tenant` when resolving resource IDs to tenancy;
a token cannot by itself establish the owner of an opaque node or relationship ID.
The data handlers still return 501 after authorization; this change does not implement stores.
`/healthz` remains public process readiness.

Embedding writes authorize `metadata.organizationId` and `metadata.projectId` at the
`POST /embeddings` boundary. Tenant IDs supplied in the path, query, top-level body,
and embedding metadata must agree. Write permission is checked for that organization.
Other operations' arbitrary metadata is not interpreted as authentication context.

Graph authentication rejections use the Graph response format: ordinary errors contain
`timestamp`, `status`, `error`, and `path`; projection-deletion errors also contain the
published `message`. Search rejections retain the Python-style `detail` body. Error paths
exclude query parameters, and Graph paths preserve the `/api` prefix.
