# Open Items Goal promotion and row state

The OpenAPI source is the matching OpenAPI worktree's
`specs/schemas/open-items.yaml` and `specs/api/openapi.yaml`.
API, UI Common and CLI consumers were regenerated from that source.

## Consumer operations

All operations are scoped to the authenticated user and authorized project.
The stable generator tag is `OpenItems`.

| operationId | POST path beneath `/organizations/{organizationId}/projects/{projectId}/open-items` | Request |
| --- | --- | --- |
| `promoteGroupToGoal` | `/promotions` | `{ groupId, goalName, targetDate?, idempotencyKey }` |
| `setOpenItemGoalFilter` | `/items/{entityType}/{entityId}/goal-filter` | `{ filter, idempotencyKey }` |
| `setOpenItemGoalDisclosure` | `/items/{entityType}/{entityId}/goal-disclosure` | `{ collapsed, idempotencyKey }` |

Promotion returns `{ collection, goal, untrackedMembers, replayed }`.
`goal` and each untracked member use `{ entityType, entityId }`; Goal is a
`TASK` identity with stored presentation `workItemTypeKey: GOAL`.
The controller returns this raw payload; the global interceptor provides
the usual response envelope. The generated axios client exposes it as
`response.data.data`.

There is no expected-revision input. The generated closed request schema
rejects that field. A new request checks for the group before creating a
Goal. Creation uses `TaskService.createInTransaction`, which owns Goal
validation and task creation events. Goal creation and its retry identity
commit together without modifying the collection.

Eligible members are determined from active project target-owned tracking
rules by `GoalTracksService.eligibleGoalMembers`; attachment uses the normal
`attachToGoal` path outside a Prisma transaction. TRACKS creates use the
graph service's existing caller-supplied relationship identity contract.
This makes overlapping creates for the same source/target identity replay
the same graph relationship.

The final transaction locks the current collection, removes tracked members
still in that group, ungroups remaining current members, deletes the group,
adds/pins the Goal, advances the revision once and stores the successful
result. Explicit moves made while tracking runs retain their current
placement. Members added during tracking remain open and ungrouped and are
included in `untrackedMembers`. Groups never become graph entities.

Earlier Goal/TRACKS writes remain visible after a later failure. The
collection remains unchanged until its publication transaction commits.
Same-intent retries within the existing idempotency retention window reuse
the created Goal and existing TRACKS relationships, or return the recorded
successful result with `replayed: true`. Conflicting key reuse is rejected.
No cleanup or rollback of earlier Goal/TRACKS writes is performed.

Only a committed collection change publishes `open_items.changed` outside
the transaction, to the authorized user/project room, containing project
identity and revision. Replay publishes no additional revision.

## Goal row consumption

Canonical Open Items include required `goalTrackedWorkFilter` and
`goalCollapsed` fields. Their defaults are `ACTIVE_AND_BACKLOG` and `true`.
Filters are `ACTIVE_AND_BACKLOG`, `ACTIVE`, `ALL` and `NONE`. Setting
either field uses the normal revisioned, idempotent mutation path.
Canonical activation refreshes preserve the row's preferences.

UI Common exposes `adapter.promoteGroupToGoal(request)`, which returns the
promotion result and replaces the canonical collection without allowing an
older replay to overwrite a newer revision. Its regular `adapter.mutate`
dispatches both preference operations. Canonical row mapping carries the
preferences into the sidebar record; the hook also exposes the complete
canonical collection. Promotion failures mark the collection stale so the
consumer can refresh and show the failure.

The sidebar implementation owns lazy tracked-work loading and filtering:
collapsed rows load no tracked work; expanded rows use the existing Goal
tracked-work read. ACTIVE means ACTIVE work or a canonical non-IDLE running
Agent Session. No attention/readiness heuristics or session state are stored
in the collection.

## Storage and verification

Forward-only migration:
`db/flyway/V2026.10.13.074407__persist_open_item_goal_row_state.sql`.
It adds two non-null columns with defaults and a CHECK constraint matching
the four filter values. Apply only through the worktree-aware Flyway wrapper.

Focused API tests cover the real HTTP boundary, target-owned eligibility,
stable TRACKS identity, ordered failures, replay, one collection publication,
preferences and activation preservation. Database tests use real Postgres
collection/idempotency/Goal rows and the real GoalTracksService with an
injected graph transport; they do not
claim a live Neo4j integration test or a full TaskService event integration.

Run database tests in the isolated worktree environment:

```sh
pnpm worktree:exec env NODE_ENV=test RUN_OPEN_ITEMS_PROMOTION_DB_TESTS=1 pnpm jest src/services/open-items/__tests__/open-items-goal-promotion.database.test.ts --runInBand
```

UI Common adapter and visibility/realtime hook tests prove canonical cache
replacement, persisted row preference consumption and scoped revalidation.

## Local verification completed on 2026-10-13

The user explicitly approved applying the pending migrations. The worktree
wrapper applied all three pending migrations successfully: undated Goals,
Open Items triage sessions and Goal row state. Flyway validation passed for
313 migrations; the worktree doctor reported the isolated database initialized.
Direct schema reads confirmed both non-null column defaults, the four-value
filter CHECK constraint and successful Flyway history for all three migrations.

All five promotion database tests passed:

- Four concurrent same-intent requests create one Goal and one canonical
  TRACKS relationship, with one collection revision. Ineligible members stay
  open and ungrouped. All four filters and disclosure persist, replay correctly
  and survive activation refreshes.
- A missing group changes neither Goal count nor the collection and emits
  no collection notification.
- Goal creation failure rolls back both that Goal and its retry identity.
- Failure after collection row writes rolls back those writes; earlier Goal
  and TRACKS writes remain. Retrying completes with the same Goal and relationship.
- Failure on the second graph write retains the Goal and first TRACKS write,
  leaving the collection unchanged; retry produces exactly two target
  relationships on that same Goal.

The focused unit/HTTP/GoalTracks checks also passed (54 tests), and the
database test file passes ESLint. The required API typecheck still reports
the three unrelated baseline starterPrompt diagnostics in the project service
and its test; no promotion diagnostics remain.

## Reconciliation disposition for downstream consumers

Final proposal reads confirmed all three reconciliation updates APPROVED:

- @[task:6191161c-acdb-4299-bb01-c209bceba7b5|Add group promotion and persisted Goal row state]
- @[task:7cdb7310-cb36-403d-8e49-05348fbeccab|Attention-driven Open Items cleanup with Goals]
- @[feature:9a87d775-0968-4c61-bef3-c5be977d80d0|Open Items]

Migration authorization was separate; approval was confirmed from the
proposal records after their disposition changed during verification.
No promotion-semantics wording remains pending in these three proposals.
The implemented ordered steps follow
@[design_doc:a68116d0-4efb-4136-95a9-130673f23081|Open Items triage: attention-driven cleanup with Goals].
The consuming work,
@[task:fea0470f-1e1b-4b67-a610-ffb3c7e05895|Build promotion confirmation and lazy Goal rows in the sidebar],
must use the generated no-expected-revision contract and preserve the
documented retained-write failure semantics. The task's implementation
notes still contain the earlier statement that local migration application
was pending approval; the completed local results above supersede that
operational note. This does not change the approved product semantics.
