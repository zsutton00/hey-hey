# Proposal-group preparation

Implementation and measurements for @[task:603b77d2-9b1d-43bf-8c8c-5d8b2e4fd22b|Batch metadata preparation across proposal-group members].

`ProposalGroupAuthoringService.addMembers` allocates every CREATE reservation and normalizes the batch before resolving origins once per distinct conversation. Admission validates the complete candidate set and returns normalized candidates plus operation-scoped reference metadata. Member preparation consumes that evidence directly, including normalized tracking edges, without repeating origin reads, admission checks or metadata loads. The operation-local map also caches absent origins; subsequent operations read fresh state.

The group lock, expected revision, sequential proposal/member inserts, persisted ordering and transaction remain unchanged. Single-member creation and member updates retain their existing preparation path. BUILDING members remain inert. No database migration or public API change is required.

## Measurements

Local PostgreSQL, Node v22.17.0, sequential baseline/optimized runs on 2026-09-22 at 02:58:05 and 02:58:35 UTC. Each workload has ten warmups and thirty measured samples. The baseline group service is from Git revision `a6149b8af7641849571cdfc425c42112a1f0b7ac` (blob `0269f074881ae440daceba540ae04c91e27df601`). Both runs use the same working-tree prerequisite admission engine and reference loader.

| Members | Repeated influences per member | DB calls before → after | Median ms before → after | p95 ms before → after |
| --- | --- | --- | --- | --- |
| 1 | 1 | 21 → 18 | 14.51 → 12.24 | 16.25 → 13.86 |
| 1 | 10 | 21 → 18 | 15.11 → 12.67 | 17.74 → 21.31 |
| 5 | 1 | 57 → 38 | 42.78 → 28.80 | 49.50 → 33.82 |
| 5 | 10 | 57 → 38 | 43.02 → 30.97 | 55.68 → 38.01 |
| 20 | 1 | 192 → 113 | 140.16 → 86.23 | 181.48 → 107.54 |
| 20 | 10 | 192 → 113 | 143.33 → 97.69 | 165.27 → 126.16 |

Query counts were constant across all samples of each workload. Raw data: [before](measurements/proposal-group-before.json), [after](measurements/proposal-group-after.json). The twenty-member workload saves 79 queries (41%). Timings are local observations, not production guarantees; the one-member/ten-influence p95 increased despite a lower median.

Every member shares one conversation origin and one parent feature; its influences and one edge reference that feature. Queries are counted from real Prisma query events, including group locking, admission, inserts, revision advancement and canonical response mapping. Admission still performs per-member semantic/reference checks. The optimization removes repeated preparation reads; it does not make all database work constant in member count.

The real group service, validation engine, metadata loader, Prisma persistence and canonical snapshot mapper run against PostgreSQL. The work-item registry uses a warmed deterministic fixture. Graph RPC is not exercised. Groups are seeded outside timing. All synthetic rows live in one transaction deliberately rolled back, even on failure; service transaction callbacks share it, so timings exclude individual BEGIN/COMMIT round trips, transport, registry startup and fixture setup. The fixture also checks real admission rejection with field-addressable errors and no partial rows/revision advance, valid reserved references, stale revisions, and reservation preservation across single-add, batch-add and member-update paths outside measurement.

## Reproduce

Use a migrated local database configured by the repository environment. The fixture rejects non-loopback hosts. In a linked worktree, run `pnpm worktree:context` and `pnpm worktree:doctor` first; the wrapper below supplies its isolated database environment. Keep the prerequisite admission changes present for both runs.

```sh
git show a6149b8af7641849571cdfc425c42112a1f0b7ac:src/services/proposal/proposal-group-authoring.service.ts > src/services/proposal/proposal-group-authoring.service.benchmark-baseline.ts
PROPOSAL_GROUP_BENCHMARK=1 PROPOSAL_GROUP_BENCHMARK_BASELINE=1 PROPOSAL_GROUP_BENCHMARK_OUTPUT=scripts/benchmarks/measurements/proposal-group-before.json pnpm worktree:exec -- node --env-file=.env --env-file=.env.local node_modules/jest/bin/jest.js src/services/proposal/__tests__/proposal-group-preparation.benchmark.test.ts --runInBand
PROPOSAL_GROUP_BENCHMARK=1 PROPOSAL_GROUP_BENCHMARK_OUTPUT=scripts/benchmarks/measurements/proposal-group-after.json pnpm worktree:exec -- node --env-file=.env --env-file=.env.local node_modules/jest/bin/jest.js src/services/proposal/__tests__/proposal-group-preparation.benchmark.test.ts --runInBand
rm src/services/proposal/proposal-group-authoring.service.benchmark-baseline.ts
```

Run measurements sequentially without concurrent build/test workloads. The database fixture is skipped in ordinary Jest runs.
