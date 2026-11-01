# Proposal admission reuse

Implementation and measurements for @[task:adbdbe35-981c-4313-9ed1-5200e7c1606b|Share proposal admission validation and reference metadata].

Admission validates each submitted envelope once, normalizes tracking, and loads deduplicated reference metadata for the operation. Its typed result owns an isolated candidate; accessing the public candidate returns a detached copy. Modified copies require admission again. Ordinary create and draft update pass this evidence to specialized validation before title/subtype snapshotting. Plain candidates still receive full validation. Graph projection, plan-stage checks and approval-time validation retain their existing paths.

Targets, edges and influence snapshots share the existing metadata loader. A supplied title never substitutes for endpoint existence/type/scope evidence. Draft updates enrich only newly appended influences; historical snapshots remain unchanged. No schema migration or API contract change is required.

## Measured results

Sequential runs on 2026-09-22 at 01:59:06 UTC (before) and 01:59:42 UTC (after), Node v22.17.0, local PostgreSQL, using the same installed dependencies, database and fixture. Baseline service and validation engine: Git revision `5f2d6198d89cd4308a0a18e1645c8af9dc6ec6e8`. Each workload warmed up for 10 operations, then recorded 30 operations. Concurrent repository work changed LOOP schemas/mappings; these ordinary proposal workloads do not exercise LOOP operations.

| Workload                   | Database calls before → after | Median ms before → after | p95 ms before → after |
| -------------------------- | ----------------------------- | ------------------------ | --------------------- |
| Create                     | 16 → 12                       | 12.97 → 10.32            | 16.67 → 12.20         |
| Draft update               | 18 → 13                       | 14.27 → 10.91            | 17.09 → 14.44         |
| Batch create, 20 proposals | 149 → 107                     | 150.24 → 111.65          | 282.77 → 132.89       |

Database-call counts were constant across every measured sample. Raw results: [before](measurements/proposal-admission-before.json), [after](measurements/proposal-admission-after.json).

The fixture executes the real ProposalService, validation engine, plan-stage projector, reference loader, response policy and Prisma queries. Each create has five repeated influences and an edge referencing its parent feature. The batch repeats that same reference across all 20 proposals. The draft update targets that same feature and appends five influences while retaining its edge. Each update's stored influences and updates are reset outside the measured interval.

The registry uses a warmed, deterministic test snapshot. Approval and graph RPC collaborators are inert because these agent-authored proposals remain drafts and never enact. Database queries and persistence are real. Synthetic organization/project/user/task/proposal rows live inside one transaction that is deliberately rolled back, including on failure. Service transaction callbacks share that transaction, so measurements exclude individual BEGIN/COMMIT round trips. They include admission, persistence and response mapping, but exclude HTTP/MCP transport, registry startup, fixture seeding and cleanup. Local timing varies with machine load; these results establish the measured workload improvement, not a production latency guarantee.

## Reproduce

The current benchmark runs create and draft update only. Batch-create measurements above are historical; proposal batch creation was retired with the batch editing tool.

Use a migrated local PostgreSQL database configured through the repository environment. The benchmark refuses non-loopback database hosts. In a linked worktree, first run `pnpm worktree:context` and `pnpm worktree:doctor`; the wrapper below supplies its isolated database environment.

Extract the two baseline modules without replacing the working implementation:

```sh
git show 5f2d6198d89cd4308a0a18e1645c8af9dc6ec6e8:src/services/proposal/proposal.service.ts > src/services/proposal/proposal.service.benchmark-baseline.ts
git show 5f2d6198d89cd4308a0a18e1645c8af9dc6ec6e8:src/services/proposal/proposal-validation.engine.ts > src/services/proposal/proposal-validation.engine.benchmark-baseline.ts
```

Run these sequentially, without other test/build workloads:

```sh
PROPOSAL_ADMISSION_BENCHMARK=1 PROPOSAL_ADMISSION_BENCHMARK_BASELINE=1 PROPOSAL_ADMISSION_BENCHMARK_OUTPUT=proposal-admission-before.json pnpm worktree:exec -- node --env-file=.env --env-file=.env.local node_modules/jest/bin/jest.js src/services/proposal/__tests__/proposal-admission.benchmark.test.ts --runInBand
PROPOSAL_ADMISSION_BENCHMARK=1 PROPOSAL_ADMISSION_BENCHMARK_OUTPUT=proposal-admission-after.json pnpm worktree:exec -- node --env-file=.env --env-file=.env.local node_modules/jest/bin/jest.js src/services/proposal/__tests__/proposal-admission.benchmark.test.ts --runInBand
rm src/services/proposal/proposal.service.benchmark-baseline.ts src/services/proposal/proposal-validation.engine.benchmark-baseline.ts
```

The database workload is skipped during ordinary Jest runs. No migration, deployment, restart or persistent fixture cleanup is needed.
