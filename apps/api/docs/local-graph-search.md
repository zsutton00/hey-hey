# Run Hey Hey with PostgreSQL graph and search (no Neo4j or Vespa)

This is for developers who run Hey Hey themselves. The combined graph and search
service (`apps/graph-search`) answers the same graph and search requests the API
already makes, from a PostgreSQL database instead of Neo4j and Vespa. The API has
no storage-specific code: the two existing settings decide where its graph and
search calls go. Leave them as they are and nothing about the existing deployment
changes. Starting this through the CLI or an app is not covered here.

## What you run

| Part                     | Source                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| Graph and search service | built from `apps/graph-search` by `docker-compose.graph-search.yml`    |
| Its own database         | `pgvector/pgvector:0.8.7-pg17-trixie` (PostgreSQL 17, pgvector 0.8.7)  |
| Application PostgreSQL   | `docker-compose.yml` (`postgres:13`, unchanged)                        |
| Redis                    | `docker-compose.yml` (the service reads the events the API publishes)  |
| Temporal                 | `docker-compose.yml`, as for any local run                             |
| Embedding model files    | fetched once with `apps/graph-search/scripts/fetch-model.sh`           |
| The API itself           | `pnpm dev`, as usual; it must be running so the service can fetch keys |

The service has its own logical database (`heyhey_graph_search`) and a
non-superuser role (`graph_search`). It never touches the application database.
The model files, ONNX runtime and tokenizer are installation dependencies, not
bundled in the image. The model (Snowflake arctic-embed-s, INT8) is Apache-2.0.

## Start

From `apps/api`:

```sh
# 1. Model files (about 34 MB, checksums verified)
bash ../graph-search/scripts/fetch-model.sh

# 2. Passwords for the new database (letters and digits, they go into a URL)
export GRAPH_SEARCH_POSTGRES_ADMIN_PASSWORD=...
export GRAPH_SEARCH_DB_PASSWORD=...

# 3. Application dependencies plus the combined service
docker compose -f docker-compose.yml -f docker-compose.graph-search.yml up --build -d
```

Then point the API at it in `apps/api/.env` and start the API:

```sh
GRAPH_SERVICE_URL="http://localhost:8090/api"
EMBEDDINGS_SERVICE_URL="http://localhost:8090"
```

Both URLs name the one process; the graph routes are under `/api`, the search
routes at the root. Check it with `curl http://127.0.0.1:8090/healthz`.

The service verifies the API's tokens against the API's key endpoint
(`GRAPH_SEARCH_JWKS_URL`, default `http://host.docker.internal:3000/api/v1/auth/jwks`).
It refuses to start until that endpoint answers, so start the API first (or restart
the service afterwards with `docker compose ... restart graph-search`). If your API
runs elsewhere, set `GRAPH_SEARCH_JWKS_URL`. All other service settings are listed in
`apps/graph-search/README.md`.

The first start creates the database, role and extensions
(`docker/graph-search/init-graph-search-db.sh`, once, when the volume is created) and
the service applies its own migrations. To reset it, remove the
`graph-search-postgres-data` volume.

## When something is wrong

- Missing database password: Compose stops and names the variable to set.
- Missing model files: the service stops and names the files, their source and the
  folder it looked in (run `fetch-model.sh`).
- Unreachable database, key endpoint or Redis, or a wrong database name: the
  service stops at startup and says which setting to fix.
- The API's own defaults (`localhost:5005` for search, `localhost:8081/api` for
  graph) apply when the URLs are unset, as before; that is the existing behaviour
  and was left unchanged.

## Memory

Measured for the encoder (512-token texts, whole process, Apple Silicon): about
115 MB after loading the model, 193 MB peak at batch size 1 (the required
setting), 361 MB at 4. The compose file caps the service at 512 MB and one CPU.
The PostgreSQL 17 container and the application's PostgreSQL, Redis and Temporal
add their own usage. Not yet measured: the service under a realistic project
load on Linux.

## What search does differently from the deployed (Vespa) search

This list is owned by the search service and awaits user review; it is not a claim
of parity. See "What callers lose compared with the deployed search" in
`apps/graph-search/README.md` for the full text. In short:

- Scores, ordering and which results pass a threshold differ.
- No token-level match positions (`matchSpans`); no per-token max-sim ranking.
- Meaning-based matching of a long document uses its first 512 tokens.
- Fuzzy matching is trigram-based.
- No Vespa ranking profiles or phrase-proximity boosts.
- Stats report fewer figures; stats and health count only the caller's organization.
- The debug lookup (`/debug`, `/debug/entity`) is not available and answers 501,
  so the API's debug-entity call does not work against this option.

## Limits to know

- Redis Pub/Sub has no replay, the same as the deployed setup: events published
  while the service is down are missed.
- The shared-server story (one PostgreSQL 17 server for the API and this service)
  waits on the separate PostgreSQL 13 to 17 upgrade; this setup runs its own
  PostgreSQL 17 instead.
- This guide's setup has been checked as a valid Compose configuration only; a
  full start-to-finish run with the API belongs to the verification task.
