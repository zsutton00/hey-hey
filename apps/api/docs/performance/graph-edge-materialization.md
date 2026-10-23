# Graph edge materialization benchmark

The opt-in benchmark at
`src/services/proposal/__tests__/graph-edge-materialization.benchmark.test.ts`
drives both proposal publication paths through the generated Graph client and a
real loopback Graph service. PostgreSQL fixtures execute in a rollback-only
transaction; Graph relationships are removed after each sample.

Run it with local API and Graph databases and a service token:

```sh
GRAPH_EDGE_MATERIALIZATION_BENCHMARK=1 \
GRAPH_EDGE_MATERIALIZATION_BENCHMARK_TOKEN='…' \
GRAPH_SERVICE_URL=http://127.0.0.1:8081/api \
PROJECT_DATABASE_URL='postgresql://…' \
pnpm jest --runInBand graph-edge-materialization.benchmark.test.ts
```

The table reports successful and deterministic mixed-failure batches at 1, 5,
9, and 25 edges. It separates Graph request elapsed time, checkpoint persistence
elapsed time, and total materialization time, and includes Graph request,
transaction, and statement counts plus API checkpoint transactions/statements.

## Comparable baseline

Before this change, every fresh edge used three sequential Cypher statements in
one transaction: identity lock, replay lookup, then endpoint resolution/create.
The optimized path keeps one transaction but performs the lock followed by one
combined replay-or-create statement.

| Fresh edges | Before statements | After statements | Before Graph transactions | After Graph transactions | Generic API checkpoint transactions |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3 | 2 | 1 | 1 | 2 |
| 5 | 15 | 10 | 5 | 5 | 10 |
| 9 | 27 | 18 | 9 | 9 | 18 |
| 25 | 75 | 50 | 25 | 25 | 50 |

Elapsed times are environment-dependent and are emitted by the benchmark rather
than checked into this document. Compare runs on the same machine and dataset;
the statement-count reduction is the invariant attribution signal. Mixed-failure
runs intentionally reuse stable relationship identities with conflicting
semantics, so successful entries still commit and input order remains visible.
