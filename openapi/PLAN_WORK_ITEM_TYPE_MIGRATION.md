# Plans as Work Items: Migration Plan

## Purpose

Migrate the Plan aggregate from the dedicated `plans`, `plan_stages`, and
`plan_steps` persistence and API stack into the generic Work Items boundary.
The final hierarchy is:

```text
FEATURE
└── PLAN
    └── PLAN_STAGE
        └── STANDARD
```

A concrete implementation leaf is the `STANDARD` Task itself. Stage order and
Task scheduling use ordinary `DEPENDS_ON` Graph edges; the Plan model does not
introduce a parallel ordering or execution-guidance representation. This
migration also does not introduce a validation-specific Work Item type.

This document is an implementation plan, not an implementation. It supersedes
the two historical drafts found in Git commit
`756578d33af09e8f63572c6f71026531ccd5f369`; those drafts assumed a
canonical executable `PLAN_STEP`, while the chosen model here follows the
current product direction toward canonical `STANDARD` Tasks and accounts for
the newer registry, proposal-group, Task Monitor, legacy execution-guidance, and
project-owned type-definition contracts.

## Governing product requirements and contracts

This section intentionally reproduces the relevant graph-owned requirements.
The implementation session is expected to have the repository but no access
to the product graph, so nothing below depends on an external entity mention.

### Plan product model

- A Plan is a dependency-ordered collection of durable Stages.
- A Stage carries execution state from `NOT_STARTED`, `REFINING`,
  `IN_PROGRESS`, `BLOCKED`, and `COMPLETE`. Status remains lifecycle state;
  it does not select a second content representation.
- A Stage contains concrete implementation Tasks. One concrete Plan leaf is
  one `STANDARD` Task executed against the Plan's one up-front Design Doc;
  Plan generation does not author a new Design Doc per Task.
- Generation proceeds through conversational intake, one up-front Design Doc,
  feature sync, Stage proposal, concrete Task proposal, and review. Feature
  sync is a gate: it reconciles the Design Doc with the parent and
  cross-cutting product features and surfaces drift as reviewable proposals
  before Stage proposal begins.
- The producing agent creates the Stage dependency chain and the Task
  dependency DAG as part of the same reviewed materialization. A later Task is
  scheduled by adding the correct `DEPENDS_ON` edges to existing Tasks, not by
  regenerating a cached execution plan.
- Validation means the agent re-reads and revises its proposed Tasks before
  submission. It does not create a persisted validation row, checkpoint, or
  executable Task.
- User Journey phases are ephemeral visualization data. They never become a
  persisted Plan, Stage, Step, or Task and never create additional Stages.
- A coordinating executor derives runnable work from standard dependency
  edges and otherwise uses the ordinary Work Item execution system.
- Plans retain a dedicated product UI for reading, reviewing, refining, and
  executing the composed hierarchy even though their storage and lifecycle
  move behind generic Work Item interfaces.

### Work Item boundary

- Every graph-capable type uses the generic Work Item create, read, edit,
  section, hierarchy, status, proposal, and event boundaries. A type does not
  receive a permanent dedicated read endpoint, DTO family, service, or
  persistence path.
- The project-effective Work Item type registry is the single authority for
  built-in and project-defined types. API publishes one generated,
  project-scoped snapshot; UI, CLI, search, and agent consumers must not merge
  local definitions into it or widen generated DTOs.
- A type definition owns stable type key, lifecycle, allowed statuses,
  section schemas, writing standards, required scalars, allowed edge targets,
  tracking, and UI capabilities. Parentage is child-owned: each active child
  declares its allowed parent types and parent entity types, while parent
  surfaces derive eligible children by reverse indexing those declarations.
- Custom project types cannot acquire protected system hierarchy or lifecycle
  behavior through editable configuration. Types whose creation triggers
  system behavior must be protected canonical built-ins.
- Generic UI renders from the resolved registry definition and its derived
  projections. It withholds type-specific behavior when registry state is
  unavailable rather than inventing local fallbacks.
- Standard Tasks are the canonical implementation unit and may have ordinary
  Standard subtasks. Plan membership must reuse that identity instead of
  creating a second executable record.
- Cross-hierarchy relationships belong in typed Graph edges. Structural
  parentage remains the Task hierarchy; provenance fields and Plan-specific
  relationship tables are not substitutes for Graph identity.
- The existing workflow/workflow-step implementation is precedent: structured
  container and leaf types use ordinary Task identity, registry behavior,
  generic reads, Task parentage, and typed Graph relationships.
- Task Monitor is the canonical automation execution identity and lifecycle.
  Plan-specific behavior is UI composition: Plan UI selects the Stage's Tasks,
  prepares generic monitor sections, and opens the monitor by its own Work
  Item identity. Plan and Stage identifiers are provenance, not a second
  execution lifecycle.

### Release-gate guarantees

The following existing cross-boundary guarantees are copied here as release
criteria:

1. **Graph-capable Work Item reads.** Generic reads compose ordinary Work Item
   identity and scalars, runtime sections, children, and selected incident
   edges. No Plan subtype may require a dedicated read model to be complete.
2. **Registry-defined rendering.** Shared UI consumers treat the resolved
   registry definition and reverse-indexed child projection as rendering
   authority and fail closed while that state is unavailable.
3. **Registry snapshot authority.** API publishes one generated project-scoped
   effective snapshot, and every generated consumer uses it without locally
   merging sources or widening the contract.
4. **Plan automation discovery.** A direct `RELATED_TO` Graph edge between a
   Task Monitor and its Plan is the sole durable discovery signal. Work Item
   lists filter by connected entity and edge label; provenance sections do not
   establish the relationship.
5. **Synchronous completion projection.** In the legacy model, a backing Task
   status mutation updates its PlanStep and the Stage/Plan rollups before the
   successful mutation response returns, after which the shared data layer
   refreshes the Plan projection.

The fifth guarantee is replaced, not merely deleted: canonical Task status
changes must still synchronously update Stage and Plan rollups before the
successful mutation response returns.

### Current dual-record behavior that must be unwound

- Concrete legacy creation produces a backing `STANDARD` Task in `BACKLOG`
  and a separate PlanStep in `NOT_STARTED`.
- Step proposal approval writes through to both PlanStep and backing Task in
  one transaction. Stage proposal approval similarly writes through to both
  PlanStage and a backing Initiative.
- Materialized backing Tasks currently remain parented to the Plan's Feature,
  while a legacy Stage-to-Initiative association supplies another structural
  signal.
- Generic context reads currently compensate with Plan-specific pivots so
  Plans, Stages, Steps, Design Docs, tracked Tasks, and sibling entities remain
  discoverable.
- Every concrete Step is now implementation work against the up-front Design
  Doc; Design Docs are no longer a Plan Step type.
- Legacy execution-guidance rows and payloads are compatibility data, not a
  canonical source of ordering or blocker truth. Canonical scheduling is the
  `DEPENDS_ON` graph.

## Chosen model

### Decisions

1. `PLAN` and `PLAN_STAGE` are protected canonical built-in work-item type
   keys backed by rows in `tasks`.
2. A concrete Plan implementation leaf is one `STANDARD` Task. No new
   `PLAN_STEP` work-item type is introduced.
3. `STANDARD.allowedParentTypes` gains `PLAN_STAGE`.
4. Each Stage after the first has a `DEPENDS_ON` edge to its immediate
   predecessor. The resulting chain is the canonical Stage order.
5. Direct `STANDARD` children form a dependency DAG. Those edges are the
   canonical schedule and may express parallel work without inventing a
   total-order scalar.
6. `PLAN_STAGE` has neither a coarse-content section nor an
   `executionGuidance` section. No guidance request sidecar is part of the
   target model.
7. Journey phases remain transient CLI/flow context. They never become
   `PLAN`, `PLAN_STAGE`, or `STANDARD` rows.
8. Plan-specific pages and visual composition remain, but they read and mutate
   through generic work-item, section, child, edge, proposal, session, and
   report boundaries.
9. Existing Plan, Stage, and backing Task identities are preserved wherever a
   canonical identity already exists. Old implementation PlanStep identities
   become compatibility aliases, not a second source of truth.
10. Validation is a proposal-quality pass, not a persisted Plan child.
    Existing non-implementation PlanStep rows remain migration exceptions and
    are not converted into Tasks.

### Product semantics that must be reconciled before code cutover

The selected model makes two current statements more precise:

- The current Plans body says a concrete Step “refers to one or more Tasks.”
  The selected model defines one concrete Plan leaf as one `STANDARD` Task.
  Cross-feature work and reusable prerequisites remain external Tasks linked
  with `DEPENDS_ON`; they are not copied into the Plan or represented as a
  multi-Task step.
- A Task can have only one structural parent. A Task structurally placed under
  `PLAN_STAGE` belongs to one Plan. Reusing the same Task as a structural leaf
  in multiple Plans is intentionally unsupported. If multi-Plan
  membership is required, this design must stop and reintroduce a durable
  membership node such as `PLAN_STEP`; an edge without ordered membership
  metadata is insufficient.
- Stage order and Task readiness are graph facts. Agents must create complete,
  acyclic `DEPENDS_ON` edges with their Stage and Task proposals and must add
  the necessary edges whenever they introduce work later.

Project-graph authoring and Contract proposals are deliberately outside this
repository execution document.

## Why concrete leaves collapse to `STANDARD`

The current code gives a concrete PlanStep and its backing Task two identities.
That is not a durable contract:

- Title prefixes and parent status are presentation heuristics, not type data.
- A second persisted Step is redundant once one Plan leaf is one executable
  `STANDARD` Task.
- A Plan-specific position or cached schedule would duplicate the standard
  dependency graph and become stale when Tasks are added later.
- Non-implementation legacy rows must not be converted into executable Tasks
  merely to fit the new hierarchy.

`STANDARD` captures executable work, and ordinary `DEPENDS_ON` edges capture
scheduling. Validation remains an agent-side proposal review pass. This
migration must not invent another entity or section for either concern.

## Target type definitions

### `PLAN`

- Display name: `Plan`.
- Parent: required `TASK` parent of subtype `FEATURE`.
- Children: derived from child definitions; `PLAN_STAGE` accepts `PLAN`.
- Initial status: `BACKLOG` for an empty generic create; the design-doc-backed
  launcher must keep the Plan in `BACKLOG` after intake; `READY` means stage/task
  generation is complete and the Plan is ready for execution.
- Allowed statuses: `BACKLOG`, `REFINING`, `READY`, `ACTIVE`, `ON_HOLD`,
  `BLOCKED`, `COMPLETED`, `ARCHIVED`.
- Sections:
  - `outcome` — authored Markdown, required by the Plan creation tool.
  - `description` — authored Markdown.
  - `planConfiguration` — authored schema-backed JSON using
    `PlanConfigurationV1`; it carries `planType` and nullable
    `worktreeBranch` without duplicating identity, status, project, owner, or
    parent fields.
- Scalar mapping: `Task.name` is title, `Task.assigneeId` is owner,
  `Task.projectId` is originating project, and `Task.parentTaskId` is the
  parent Feature.
- UI: `showsInExplorerSidebar: true`, plus the dedicated Plan route and
  renderer. All other generic list and visibility behavior remains unchanged.
- Graph: may derive from its authoritative Design Doc and receive the direct
  Task Monitor `RELATED_TO` edge required for automation discovery.

### `PLAN_STAGE`

- Display name: `Plan stage`.
- Parent: required `TASK` parent of subtype `PLAN`.
- Initial status: `BACKLOG`.
- Allowed statuses: `BACKLOG`, `REFINING`, `ACTIVE`, `BLOCKED`, `COMPLETED`,
  `ARCHIVED`.
- Sections:
  - `description` — authored Markdown.
- Direct children: `STANDARD`.
- UI: rendered only through Plan composition and direct generic work-item
  reads; not listed as a standalone product item.
- Graph: may target another `PLAN_STAGE` with `DEPENDS_ON`; every Stage after
  the first depends on its immediate predecessor.

### `STANDARD` under `PLAN_STAGE`

- It remains the ordinary implementation Task type and keeps the same section
  schema, service relationships, sessions, reports, proposals, events, and
  lifecycle.
- `STANDARD.allowedParentTypes` adds `PLAN_STAGE` in both the canonical
  template and every effective project definition.
- A direct `STANDARD` child of `PLAN_STAGE` requires a service relation, a
  description, and acceptance criteria. These are parent-conditioned Plan
  invariants; do not make every Standard Task require a service.
- Scheduling uses ordinary `DEPENDS_ON` edges. An agent creating or adding
  Plan Tasks must create the complete, acyclic dependency set in the same
  reviewed change set.
- It is executable through Task Monitor and coding sessions.
- It may own ordinary Standard subtasks. Stage execution and rollup operate on
  direct Stage children; a parent Task remains responsible for its own
  subtask completion semantics.

### Validation boundary

- Do not add a validation-specific type, icon, status set, section schema,
  mention type, event family, route, or registry capability in this migration.
- Inventory legacy non-implementation PlanSteps separately from implementation
  Steps. Do not classify them only from title prefixes.
- Preserve their legacy compatibility path until they are explicitly retired;
  the current validation pass requires no durable replacement.
- A remaining non-implementation row blocks destructive removal of its legacy
  storage unless an explicit retirement rule covers it.

## Shared status vocabulary

The shared `WorkStatus` enum currently lacks both `REFINING` and `BLOCKED`.
Add both to OpenAPI, Prisma, local prompt schemas, generated clients, event
snapshots, search filters, UI status presentation, and registry validation.

Because PostgreSQL enum additions cannot safely be used in a new default in
the same Flyway migration, sequence them as follows:

1. Append-only migration A: add `REFINING` and `BLOCKED` to `WorkStatus` only.
2. Deploy code that understands the values.
3. Append-only migration B: seed type definitions or defaults that use them.

Compatibility mappings are centralized and exhaustive:

| Legacy Plan status | Canonical WorkStatus |
| --- | --- |
| `INTAKE` | `BACKLOG` |
| `BRAINSTORMING` | `REFINING` |
| `DRAFT` | `BACKLOG` |
| `ACTIVE` | `ACTIVE` |
| `ON_HOLD` | `ON_HOLD` |
| `BLOCKED` | `BLOCKED` |
| `COMPLETE` | `COMPLETED` |
| `ARCHIVED` | `ARCHIVED` |

| Legacy Stage status | Canonical WorkStatus |
| --- | --- |
| `NOT_STARTED` | `BACKLOG` |
| `REFINING` | `REFINING` |
| `IN_PROGRESS` | `ACTIVE` |
| `BLOCKED` | `BLOCKED` |
| `COMPLETE` | `COMPLETED` |

The backing Task status is authoritative for implementation leaves. During
backfill, a legacy PlanStep status must agree with the existing Task-to-Step
projection. A disagreement is a migration exception; do not choose one with a
fallback.

## Dependency-ordered hierarchy

Do not add a generic `position` field or a Plan-owned ordered-child array.
Ordering and readiness use the standard `DEPENDS_ON` graph.

Rules:

- Stage order is a linear dependency chain. If the intended display order is
  A, B, C, then B `DEPENDS_ON` A and C `DEPENDS_ON` B. The first Stage has no
  Stage predecessor; every later Stage has exactly one immediate predecessor
  within the same Plan.
- Direct `STANDARD` children form a dependency DAG. Independent roots are
  intentionally parallel; a Task becomes eligible according to the ordinary
  dependency scheduler when its prerequisites are terminal.
- Stage and Task dependency edges must remain within the allowed registry edge
  targets and must pass the standard cycle and endpoint validation.
- Agents create the full dependency set with the reviewed Stage or Task
  proposal. Adding a later Task means attaching its `DEPENDS_ON` edges to the
  appropriate existing Tasks in the same change set.
- Plan reads render a topological order. `createdAt` and ID may break ties for
  stable presentation, but tie-breaking carries no scheduling meaning.
- Reparenting across Plans or Stages must revalidate every incident dependency;
  it may not leave a cross-boundary scheduling edge accidentally.

Extend the generic change-set projector and materializer so one proposal can
atomically create Stages or `STANDARD` children, attach services and semantic
relationships, and persist all required dependency edges.

## Lifecycle and rollup

Replace `PlanStepStatusSyncService` with a transaction-aware hierarchy rollup
owned by the generic Task mutation boundary.

### Stage rollup

- A Stage in `REFINING` remains there until its Task-shaping change set
  commits; child updates cannot silently clear the transition state.
- A Stage with no children is an empty planned Stage and remains `BACKLOG`.
- `COMPLETED` and `CANCELLED` direct children are terminal.
- All direct children terminal means Stage `COMPLETED`.
- Any explicitly blocked direct child means Stage `BLOCKED`.
- Any `ACTIVE`, refinement/generation, or partially terminal direct child set
  means Stage `ACTIVE`.
- Reopening or adding non-terminal work to a completed Stage returns it to
  `ACTIVE`.

### Plan rollup

- All Stages completed means Plan `COMPLETED`.
- Any blocked Stage means Plan `BLOCKED` unless a separately documented manual
  override applies.
- Any active or refining Stage means Plan `ACTIVE`.
- Reopening or adding non-terminal work to a completed Plan returns it to
  `ACTIVE`.
- A ready, generated Plan with no active Stage remains `READY` until execution
  begins.

### Transaction and event guarantee

The child mutation, Stage update, Plan update, and all outbox events commit in
one transaction. The successful child mutation response is not returned before
rollup is complete. Generic Task status events are the primary event family;
temporary Plan-domain compatibility events are derived from the same committed
transition, not from a second write path.

Do not activate a Stage while any Stage it `DEPENDS_ON` remains non-terminal.
Once those dependencies are satisfied, ordinary Task execution may activate
the Stage when one of its direct children starts.

## Dependency scheduling cutover

The target model has no `executionGuidance` section, guidance request row, or
Plan-specific cached schedule. The standard dependency graph is authoritative:

1. Stage-generating agents create the linear Stage dependency chain.
2. Task-generating agents create the complete Task dependency DAG, including
   dependencies on existing Tasks when work is added later.
3. Plan UI and executors derive blocked, runnable, and next work through the
   standard Graph and scheduling system.
4. Dependency mutation uses ordinary edge proposals, validation, events, and
   invalidation. It does not trigger guidance regeneration.
5. Legacy guidance payloads remain readable only during compatibility. They
   are not migrated into a section and do not override canonical edges.
6. Explicit legacy blocker relationships may become `DEPENDS_ON` edges only
   when both endpoints map unambiguously. Narrative recommendations and
   ambiguous ordering become migration exceptions rather than inferred facts.

Retiring the legacy guidance sidecar and any Temporal workflow that produces
it requires the compatibility and Temporal safety gates later in this plan.

## Graph and topology target

### Structural hierarchy

The `Task.parentTaskId` chain is the only structural source of truth:

- Feature → Plan
- Plan → Stage
- Stage → implementation Task
- implementation Task → optional Standard subtasks

Remove Plan-specific `HAS_PLAN_STAGE`, `HAS_PLAN_STEP`, `PLAN_TRACKS`,
`PLAN_STAGE_TRACKS`, and `PLAN_STEP_TRACKS` compensation after parity is
proven. Graph and embeddings consumers should see Task nodes with registry
subtypes, as they already do for workflow work items.

### Semantic edges

Map legacy relationships deliberately:

- Plan created from its seed Design Doc → `PLAN DERIVES_FROM DESIGN_DOC`.
- Plan automation → `TASK_MONITOR RELATED_TO PLAN`; this direct edge remains
  the sole durable discovery signal.
- Stage order → each later `PLAN_STAGE DEPENDS_ON PLAN_STAGE` predecessor.
- Task schedule → `STANDARD DEPENDS_ON STANDARD`; independent roots remain
  parallel and the ordinary scheduler determines eligibility.
- Cross-feature or reusable prerequisite Tasks → plan Task `DEPENDS_ON`
  prerequisite Task; do not reparent an externally owned Task merely to make
  it appear in the Plan.
- Service ownership stays on `ServiceTask`; duplicate PlanRelationship service
  rows disappear.
- Design-doc motivation stays as the existing Design Doc influence on the
  canonical implementation Task.
- Explicit implementation blockers become canonical Task dependencies only
  when both endpoints map unambiguously to implementation Tasks. Legacy
  narrative recommendations are not promoted to Graph facts.
- Created per-Stage Initiatives are retired if they have no non-Plan owners.
  A genuinely shared or linked Initiative remains canonical and receives an
  explicit semantic edge rather than being treated as Stage identity.

Update allowed edge targets in the effective registry snapshots, including
Stage-to-Stage and Task-to-Task `DEPENDS_ON` plus the Task Monitor ability to
target `PLAN`. Do not use provenance JSON as relationship identity.

## Generic API target

### Reads

- `GET /work-items/{id}` and generic hierarchy reads resolve `PLAN`,
  `PLAN_STAGE`, and `STANDARD` through the effective registry.
- Plan UI composes a Plan from the root Work Item, dependency-ordered Stage
  children, the Task dependency DAG, selected incident edges, and associated
  sessions/reports.
- Add a batch child read by parent IDs if needed to avoid N+1 reads. It remains
  a generic work-item endpoint, not a Plan DTO family.
- Existing Plan routes temporarily adapt the generic model into legacy
  `PlanResponseDto`, `PlanStageDto`, and `PlanStepDto` shapes. They become
  read-only after producer cutover and are removed after all consumers drain.
- `get_context` uses generic parent hierarchy and subtype-aware labels. Remove
  PlanStep backing-content unification and special Plan pivots only after
  parity tests prove the same ancestry, siblings, links, and Plan context.

### Lists and visibility

Set `PLAN.showsInExplorerSidebar` to `true` in the canonical definition and
every effective project snapshot. No ancestry-aware exclusion or other
Plan-specific list behavior is introduced. `PLAN_STAGE` and `STANDARD` retain
their existing type-owned visibility, search, and direct-read behavior.

### Writes

- Generic work-item creation owns all Task rows.
- Generic section operations own Plan and Stage authored content.
- Generic change sets own bulk Stage and Task creation, services, and semantic
  edges, including complete dependency chains and DAGs.
- Generic status mutation owns lifecycle validation, events, and rollup.
- Generic reparenting owns structural moves and revalidates incident
  dependencies.
- Type-specific Plan tools remain orchestration conveniences only. They build
  valid generic proposals and never write Plan tables directly.

## Proposal and generation cutover

### `create_plan`

Keep the design-doc-first user flow, but make approval materialize:

1. the Design Doc;
2. a `PLAN` Work Item under the selected Feature, using the reserved Plan UUID;
3. the `DERIVES_FROM` edge to the Design Doc;
4. the Plan-generation Agent Session and Conversation, associated with the
   Plan Work Item through generic session/work-item association;
5. the launch signal after the transaction commits.

If the Plan and Design Doc are separate proposals, use an explicit proposal
group because the Plan edge references the future Design Doc identity. If one
compound proposal can validly materialize both, keep it one proposal. Do not
use proposal adjacency as an implicit dependency.

### Stage and Task proposal

`create_stage` creates a `PLAN_STAGE` child and, for every Stage after the
first, its `DEPENDS_ON` edge to the immediate predecessor in one reviewable
change set. A Stage may exist empty in `BACKLOG` until concrete Tasks are
approved; it has no alternate content section or guidance sidecar.

One graph change set per Stage materializes concrete work:

- verifies the Stage and Plan identities;
- creates direct `STANDARD` children;
- attaches service relationships to implementation Tasks;
- records Design Doc influences and the complete Task dependency DAG;
- validates that all dependency endpoints exist and the graph is acyclic;
- transitions the Stage out of `REFINING` when Task shaping completes.

The whole change set is retry-safe and idempotent under the existing
`PREPARED` materialization/publication protocol. A bulk proposal’s resulting
identity must not be overloaded as “the first step”; every created Work Item
has its own reserved identity and materialization checkpoint.

### User Journey branch

Journey phases remain ephemeral through the single user review gate. After
approval, create one Plan-rooted change set, or a finalized prerequisite group,
that materializes the approved concrete Tasks and dependency edges under the
already-created Stages. It must never create a new Stage.

### Pending proposals at cutover

- Stop accepting new legacy `PLAN_STAGE`/`PLAN_STEP` proposals before the
  final legacy-to-generic backfill.
- Drain or explicitly reject every DRAFT, approved-but-unmaterialized, grouped,
  and leased legacy proposal.
- Translate reserved Stage identities directly to `PLAN_STAGE` Task IDs.
- Translate reserved implementation-step identities to their canonical Task
  identities only when the mapping is one-to-one and persisted.
- Preserve approved proposal records and influence history. Use identity
  aliases for old targets; do not rewrite immutable history opportunistically.
- Resume creation only after the generic projector, materializer, group
  finalizer, retry path, and publication fence all pass parity tests.

## Event, search, mention, and identity compatibility

### Events

Primary post-cutover events are generic Task/work-item events plus ordinary
Graph edge events. Task snapshots contain `taskType`; scheduling identity lives
in `DEPENDS_ON` edges.

- Add the new type keys and statuses to OpenAPI events, core discriminated
  unions, ID extraction, websocket mapping, Graph, embeddings, and generated
  clients.
- During compatibility, derive existing `plan.*`, `plan_stage.*`, and
  `plan_step.*` notifications from committed generic events.
- Consumers must deduplicate compatibility and generic invalidation by event
  identity.
- Stop publishing Plan relationship events after Graph edges become canonical.
- Retain old event schemas for replay until historical outbox and downstream
  retention windows expire.

### Identity aliases

Add a generic, indexed identity-alias table with source entity type/ID,
canonical entity type/ID, migration name, and timestamps.

- Legacy Plan ID → `TASK` of subtype `PLAN`, same UUID.
- Legacy Stage ID → `TASK` of subtype `PLAN_STAGE`, same UUID.
- Implementation PlanStep ID → backing `STANDARD` Task UUID.
- Non-implementation or untyped PlanStep IDs → no automatic canonical
  target; retain them in the exception manifest until explicitly retired.

All old Plan and Stage URLs redirect to the new Plan route. Old implementation
Step URLs resolve through the alias and open the canonical Task inside its Plan
context. New links never emit legacy PlanStep IDs.

Mention normalization must keep logical `plan` and `plan_stage` mentions
clickable while resolving their storage through Task subtype. Do not add a new
logical mention type for non-implementation legacy rows in this migration.

### Search and summaries

- Reindex Plan and Stage Task rows with subtype-aware titles, sections,
  ancestry, and route metadata.
- Reindex Plan-contained Standard Tasks without duplicating old PlanStep
  documents.
- Rewrite `PlanLineageBoostService` to follow Task ancestry and dependency
  edges, then remove the legacy Plan table lookup.
- Tombstone old PLAN/PLAN_STAGE/PLAN_STEP registry and embedding documents only
  after canonical documents are queryable.
- Rebuild EntityRegistry, entity-summary, topology state, and graph embedding
  mappings from the canonical Task identities.

## Sessions, conversations, reports, and evidence

- Backfill Plan-generation and Stage-refinement sessions into
  `agent_session_work_item_associations` using `PLAN` or `PLAN_STAGE` subtype
  plus canonical Task ID.
- Coding sessions remain attached to the canonical `STANDARD` Task.
- Conversations use the generic workflow-about/work-item association and
  derive Plan context from ancestry or direct Graph edges.
- Reports attached to legacy `PLAN` or `PLAN_STEP` identities are re-keyed to
  canonical `TASK` identities through the alias map while preserving relation
  and evidence ownership.
- File-touch and production-history feature resolution walks generic Task
  ancestry instead of querying `Plan.parentTaskId`.
- Attention/open-item navigation lineage is rebuilt from Plan → Stage → Task
  ancestry.
- Task Monitor selected work contains executable direct `STANDARD` children
  only.
- Task Monitor retains the direct `RELATED_TO` edge to the Plan even though
  Plan IDs are now Task-backed.

## Existing-data migration

Implement an idempotent, resumable migration runner with `--dry-run`,
`--apply`, per-record checkpoints, a machine-readable manifest, and a final
parity report. Run it through the repository’s worktree-aware database wrapper
when applicable.

### Preflight inventory

Count and classify, without mutating:

- Plans with no parent Feature, a missing parent, or a non-Feature parent.
- Plan and Stage UUID collisions with existing Task UUIDs.
- Stages whose legacy sequence cannot form one unambiguous linear chain.
- PlanSteps with missing backing entities or types other than `TASK`.
- One backing Task referenced by multiple PlanSteps, Stages, or Plans.
- Linked Tasks whose current structural Feature differs from the Plan’s parent
  Feature.
- Task/PlanStep title, description, assignee, service, and status mismatches.
- Non-implementation or untyped PlanSteps, using proposal provenance and flow
  metadata first and title prefixes only as a one-time migration heuristic
  requiring review.
- Non-default effort or timing values that have no target product contract.
- PlanStep blocker relations that cannot map to canonical Task dependencies.
- Legacy guidance rows, payload references, and Temporal executions that must
  remain readable during compatibility but have no canonical target section.
- DRAFT/grouped/leased proposals and approved materializations still targeting
  legacy entity types.
- In-flight Plan generation, Stage refinement, Plan execution, and guidance
  workflows/sessions.
- Reports, conversations, notifications, attention records, summaries,
  embeddings, Graph nodes/edges, and entity-registry rows keyed to legacy
  types.
- Plan versions and signoffs, including whether any live UI or API client still
  consumes them.
- Created Stage Initiatives with non-Plan dependents.

Any ambiguous record is an exception with the exact source IDs and reason. Do
not invent parents, statuses, services, validation kinds, or fallback text.

### Backfill mapping

#### Plan

- Insert a Task using the Plan UUID and subtype `PLAN`.
- Copy organization, project, title, owner→assignee, parent Feature, timestamps,
  and mapped status.
- Write `outcome`, `description`, and `planConfiguration` sections.
- Add the Design Doc edge and other reviewed semantic edges.

#### Stage

- Insert a Task using the Stage UUID and subtype `PLAN_STAGE`.
- Parent it to the Plan Task.
- Copy title, description, timestamps, and mapped status.
- After every Stage exists, translate the reviewed legacy Stage sequence into
  the linear `DEPENDS_ON` chain. Ambiguous or cyclic input blocks that Plan.
- Keep legacy guidance data behind the compatibility reader; do not copy it to
  a Work Item section or use it to override dependency edges.

#### Implementation step

- Keep the backing `STANDARD` Task UUID as canonical.
- Verify it belongs exclusively to this structural Plan placement.
- Reparent it to the Stage.
- Preserve sections, services, Task dependencies, sessions, reports,
  proposals, events, and Design Doc influence on that Task.
- Materialize reviewed legacy blocker/order semantics as standard
  `DEPENDS_ON` edges. If the intended schedule is ambiguous, stop that Stage
  for review rather than manufacturing a dependency.
- Add the old PlanStep → Task identity alias.
- If PlanStep duplicates differ from the Task, stop that record for review.

#### Legacy non-implementation step

- Do not create a Task or another Work Item type for it in this migration.
- Keep it in the exception manifest and preserve legacy compatibility until it
  is explicitly retired. The current validation pass does not require a
  durable replacement.
- Do not archive a synthetic backing Task until proving it has no independent
  sessions, reports, proposals, dependencies, or non-Plan references.

#### Unsupported legacy row

Untyped, `DESIGN_DOC`, `SERVICE`, `OTHER`, unbacked, shared, or cross-feature
rows do not fit the chosen leaf contract automatically. Emit them in the
exception report and require an explicit mapping decision.

### Legacy fields

- `PlanVersion` currently records version numbers, author, and summary but not
  an independent full snapshot. Preserve it read-only during compatibility;
  new history comes from generic section history and proposals. Archive the
  rows after consumers drain.
- `PlanSignOff` has no current governing product requirement. Freeze new
  writes, retain it for audit during compatibility, and either model a real
  generic approval contract or remove the endpoint after usage proves zero.
- PlanStep effort and timing are dropped only when preflight proves values are
  defaults or unused. Non-default data blocks that record until the product
  chooses a canonical home.
- `planType` and `worktreeBranch` move into `PlanConfigurationV1`.
- Created Stage Initiatives are archived only after dependency audit. Linked
  Initiatives remain and receive explicit topology.

### Parity checks

For every Plan, compare legacy and canonical projections:

- identity, organization, project, parent Feature, owner, status, and config;
- Stage count, title, status, and dependency chain;
- implementation Task count and dependency DAG, plus all unresolved
  non-implementation rows;
- services, dependencies, Design Doc provenance, and Task Monitor edge;
- compatibility coverage for legacy guidance rows and references;
- proposals, sessions, conversations, reports, notifications, and search
  documents;
- lifecycle rollup result.

Store counts and checksums in the migration manifest. Producer cutover requires
zero unexplained parity failures.

## Repository implementation phases

### Phase 0 — repository preflight

1. Verify that generic Work Item change sets can create `DEPENDS_ON` edges in
   the same reviewed mutation as their source and target Work Items.
2. Verify generic cycle detection, endpoint validation, incident-edge reads,
   and dependency-driven eligibility for `PLAN_STAGE` and `STANDARD`.
3. Inventory untyped and non-implementation PlanSteps; fail the migration if
   any lack an explicit retirement or compatibility decision.
4. Inventory every reader and producer of legacy execution-guidance rows,
   payloads, events, and Temporal executions.
5. Decide whether Plan versions and signoffs remain repository behavior.

Project-graph proposals and topology maintenance are outside this repository
plan and must be handled on their owning surface.

### Phase 1 — OpenAPI-first additive contract

In `../openapi`:

1. Add `REFINING` and `BLOCKED` to `WorkStatus` across API, local, Graph, and
   embeddings specs where the shared enum is mirrored.
2. Add `PLAN` and `PLAN_STAGE` examples and any closed generated unions.
3. Add `PlanConfigurationV1` and the required icon tokens.
4. Add identity-alias and redirect response shapes.
5. Ensure generated Graph contracts allow Stage-to-Stage and Task-to-Task
   `DEPENDS_ON` relationships through ordinary Work Item change sets.
6. Mark legacy Plan endpoints and event families deprecated without removing
   them.
7. Update entity-context, reports, conversations, agent sessions, triggers,
   Graph traversal, and mention schemas for Task-backed logical Plan types.
8. Validate all specs and regenerate consumers; never widen generated DTOs in
   handwritten code.

### Phase 2 — API schema and registry prerequisites

1. Add append-only Flyway migration A for `WorkStatus` values.
2. Update Prisma and regenerate after the migration contract is present.
3. Add append-only Flyway migration B for the identity-alias table.
4. Add append-only Flyway migration C for canonical type templates and every
   project-effective definition:
   - seed `PLAN` and `PLAN_STAGE`;
   - add `PLAN_STAGE` to `STANDARD.allowed_parent_types`;
   - preserve child-owned parentage and literal allowed entity types;
   - add edge targets, status sets, sections, writing standards, and
     capabilities, including `PLAN.showsInExplorerSidebar: true`.
5. Update `WORK_ITEM_TYPE_KEYS`, registry parity tests, definition validators,
   icon handling, schema-validator registry, and project snapshot generation.
6. Fail startup if a project snapshot lacks required protected Plan types or
   parentage; do not merge a local fallback.
7. Run Flyway validate. Ask explicitly before applying migrations and report
   whether they were applied.

### Phase 3 — generic Work Item infrastructure

1. Extend generic Work Item change sets, projection, materialization, and
   publication to create `DEPENDS_ON` edges atomically with Work Items.
2. Enforce parent-conditioned Plan service and section rules.
3. Reuse standard dependency cycle detection, endpoint validation, incident
   edge reads, events, and execution eligibility for Plan Stages and Tasks.
4. Add batch child and incident-edge reads if required to avoid N+1 queries.
5. Add Task-backed logical entity and alias resolution for routes, mentions,
   reports, conversations, proposals, context, and Graph.
6. Implement the transaction-aware Plan hierarchy rollup and replace duplicate
   computations in `PlanService` and `PlanStepStatusSyncService`.
7. Add no Plan-specific ordering, guidance, or scheduling store.

### Phase 4 — canonical producer implementation behind a disabled flag

1. Rewrite `PlanFromDesignDocLauncherService` and `create_plan` approval around
   generic `PLAN` creation, sections, Design Doc edge, and work-item session
   association.
2. Rewrite Plan-shaping MCP tools as generic proposal/change-set composers.
3. Replace Stage proposal approval and per-Stage Initiative creation with
   `PLAN_STAGE` Task materialization.
4. Replace `create_step`/`create_steps` backing-Task plus PlanStep creation with
   direct `STANDARD` creation for implementation work.
5. Remove title-prefix content discrimination. Preserve legacy
   non-implementation rows behind compatibility until explicitly retired.
6. Rewrite Stage, Task, and User Journey materialization around atomic change
   sets that include complete dependency edges.
7. Keep feature-sync before Stage proposal and keep the User Journey review
   gate single and pre-materialization.
8. Publish the generic authoring guidance that every producing agent will use
   to create Stage and Task dependencies; do not introduce a Plan-specific
   scheduler.
9. Keep the canonical producer path disabled until compatibility consumers,
   backfill parity, and the CLI producer phases below have passed their gates.

### Phase 5 — compatibility projection and data backfill

1. Add a generic Plan assembler used only by legacy adapters; it reads Work
   Items and emits legacy DTOs without maintaining duplicate fields.
2. Introduce temporary same-transaction shadow projection while legacy
   producers remain active, with metrics for every mismatch.
3. Run dry-run inventory and resolve all exception classes.
4. Backfill Plan/Stage Tasks, sections, aliases, dependency edges, and
   dependent records; report non-implementation rows as unresolved and keep
   legacy guidance data behind compatibility.
5. Re-run until idempotent, then prove projection parity.
6. Implement and rehearse the legacy-proposal freeze and drain procedure
   without invoking it while legacy CLI producers remain authoritative.
7. Prove the reversible producer flag in a non-production cutover rehearsal;
   activation occurs in the cross-repository rollout after consumer gates.

### Phase 6A — UI Common generated contract intake

1. Regenerate the API client and models only after the additive OpenAPI
   contract exposes `PLAN`, `PLAN_STAGE`, their sections, generic hierarchy,
   incident `DEPENDS_ON` edges, aliases, and Work Item events.
2. Replace Plan-domain model imports with generated Work Item, section, edge,
   and registry types. Do not locally widen generated DTOs or recreate their
   fields in handwritten validators.
3. Inventory the public exports consumed by UI and CLI before changing them.
   Keep a compatibility export only when an existing consumer cannot migrate
   in the same release, and give every compatibility export a deletion gate.
4. Add contract fixtures for a complete Plan aggregate: Plan Work Item,
   Stage children, Standard Task grandchildren, Design Doc relationship, and
   both serial and parallel dependency edges.

Exit gate: generated code is clean, the effective registry snapshot is the
only type-definition authority, and the fixture can be represented without a
Plan-specific DTO extension.

### Phase 6B — UI Common canonical read model and cache

1. Replace `data/collections/plans.ts`, `planSteps.ts`,
   `planRelationships.ts`, and `planActiveStageExecutionGuidance.ts` with one
   Plan composition boundary over generic Work Item reads, child queries,
   sections, and selected incident edges.
2. Update `data/collections/workItems.ts` so its generated response and client
   boundary use `GET /work-items/{id}` and generic Work Item list/hierarchy
   contracts rather than deriving the supposedly generic model from
   `TaskResponseDto`.
3. Update `usePlan`, `usePlanSteps`, and `usePlanRelationships` consumers to
   read canonical identities. Remove the active-guidance hook rather than
   mapping guidance into another client-side field.
4. Make the Plan list a generic Work Item query filtered by type `PLAN` and
   ordinary status. Explorer visibility comes only from
   `PLAN.showsInExplorerSidebar: true` in the effective registry snapshot.
5. Build one normalized cache identity per Work Item. A temporary legacy Plan
   adapter may project from that cache, but it must not maintain a second
   independently mutable Plan/Stage/Step cache.
6. Fetch enough hierarchy and edge data in batches to avoid a Plan viewer
   waterfall. Fail with an explicit loading, empty, or error state when the
   hierarchy or registry snapshot is incomplete.
7. During the compatibility window, parity-test the generic composition
   against legacy Plan reads without letting UI code select between two live
   sources of truth.

Exit gate: Plan list and detail reads resolve from canonical Work Items, and
cache invalidation has no duplicate Plan identity.

### Phase 6C — UI Common mutations and proposal review

1. Replace `usePlanUpdate`, `usePlanDelete`, `usePlanStageUpdate`,
   `usePlanStepUpdate`, and skipped-step mutations with generic Work Item
   mutations and ordinary Standard Task status changes.
2. Replace Stage reorder and Step move semantics with reviewed `DEPENDS_ON`
   edge mutations. Do not translate drag order into a hidden position field.
3. Rewrite `PlanCreateRenderer`, `PlanStepsProposalRenderer`,
   `PlanStepUpdateRenderer`, their dispatcher branches, and Plan-specific
   proposal stepper configuration to render generic Work Item change sets,
   reserved identities, hierarchy, sections, and relationship operations.
   Keep isolated legacy renderers during the compatibility release so pending
   proposals created before producer cutover remain reviewable.
4. Show dependency additions and removals as first-class reviewable changes,
   including whether an operation produces a serial chain or parallel work.
5. Invalidate the Plan ancestor, affected Stage, affected Tasks, Work Item
   lists, and incident-edge queries from the committed generic mutation. Do
   not optimistically synthesize a legacy PlanStep result.
6. Keep legacy non-implementation rows read-only behind the compatibility
   adapter until their explicit disposition; do not expose an action that
   turns them into Standard Tasks by title inference.

Exit gate: canonical edits target Work Items or edges, while retained legacy
proposal review is read-only, isolated, and tied to the measured drain.

### Phase 6D — UI Common Plan presentation

1. Rework `PlanViewer`, `PlanStageStepperCard`, and
   `PlanStageStepsList` around Plan → Stage → Standard Task ancestry.
2. Derive Stage order from the Stage `DEPENDS_ON` chain and Task eligibility
   from the Task dependency DAG. Represent parallel branches without forcing
   a display-only total order.
3. Replace the guidance-backed execution graph view model with one built from
   canonical Task edges and Work Item lifecycle state.
4. Remove the obsolete coarse-fidelity list, execution-guidance widgets,
   guidance selection utilities, and Step-recommendation behavior whose
   authority was the retired guidance payload.
5. Rework progress, status labels, service links, archive/delete affordances,
   and the worktree editor against generated Work Item fields and sections.
6. Keep plan-contained Standard Tasks navigable in Plan context while using
   the Task's one canonical identity and ordinary Task page behavior.
7. Keep validation as an agent-side review of proposed Tasks; add no persisted
   validation child, status action, or dedicated component.

Exit gate: the Plan surface renders and edits a dependency-backed Work Item
aggregate with no coarse-fidelity, guidance, or PlanStep runtime dependency.

### Phase 6E — UI Common Task Monitor composition

1. Change `planStageTaskMonitorSetup.ts` and its hooks from
   `PlanResponseDto`/`PlanStageDto`/`PlanStepDto`/guidance inputs to the
   canonical Plan, Stage, direct Standard children, and their `DEPENDS_ON`
   edges.
2. Remove the Step-to-Task identity map and guidance-priority merge. Each
   execution node is already the canonical Task ID, and its blockers are the
   Task's direct dependency targets within the selected Stage.
3. Validate that every selected Task is a direct Standard child of the Stage,
   belongs to the same organization/project, is executable, and participates
   in an acyclic dependency graph.
4. Produce the Task Monitor execution definition with deterministic
   topological ordering while preserving parallel eligibility in
   `dependsOnTaskIds`.
5. Preserve Plan and Stage provenance for presentation, but keep the direct
   `RELATED_TO` edge between Task Monitor and Plan as the sole durable
   automation-discovery relationship.
6. Update setup review, launch, reopen, visualization, and eligibility tests
   for later-added Tasks and changed dependency edges.

Exit gate: Task Monitor setup needs no PlanStep identity or execution-guidance
payload and produces the same runnable set as the standard dependency graph.

### Phase 6F — UI Common realtime, routing, and integration surfaces

1. Update websocket handling to invalidate canonical Work Item, hierarchy,
   section, and edge query keys from generic events. Keep legacy Plan-event
   handlers only while a deployed producer can still emit them.
2. Update entity adapters, mentions, breadcrumbs, activity items, related-item
   grouping, session launch, conversation hooks, report links, and
   `webPathService` to use canonical Plan/Stage/Task identity and ancestry.
3. Preserve legacy Plan and Step URLs through API-provided aliases and one
   redirect path. Do not build a second client-side identity resolver.
4. Verify that a Task reached from search, activity, a report, or a direct URL
   resolves to the same cache entry and can recover its Plan context from
   ancestry.
5. Remove local registry fallbacks. Withhold type-specific behavior while the
   effective snapshot is unavailable.

Exit gate: all cross-cutting UI Common surfaces agree on canonical identity,
and legacy routes are compatibility entry points rather than data sources.

### Phase 6G — UI Common legacy deletion and publish gate

1. After UI and CLI consumers have migrated, remove the dedicated Plan
   collections, hooks, guidance modules, PlanStep proposal renderers, legacy
   event handlers, and stale exports.
2. Remove `plansClient` usage from UI Common once legacy read and mutation
   endpoints are no longer supported.
3. Run focused collection, hook, Plan viewer, proposal, Task Monitor,
   websocket, entity-adapter, and path-service tests.
4. Run `pnpm generate:check`, `pnpm tsc --noEmit`, `pnpm check`, and
   `pnpm build`; inspect the package export diff before publishing.
5. Publish the UI Common version only after UI and CLI compatibility builds
   have consumed the exact candidate package.

Exit gate: no shipped UI Common module imports a legacy Plan DTO or calls a
dedicated Plan endpoint.

### Phase 7 — UI

1. Preserve Plan list/detail URLs and redirect legacy Step URLs through aliases.
2. Render Plan, Stage, and Task identities without duplicate caches.
3. Set `PLAN.showsInExplorerSidebar` to `true`; make no other Plan-specific
   changes to generic list visibility.
4. Preserve the parent Feature Plan tab and breadcrumb.
5. Keep Plan-contained Tasks nested under the Plan in Open Items.
6. Do not introduce a new validation Work Item surface; the current validation
   pass is agent-side review rather than a persisted entity.
7. Route search, mentions, activity, sessions, conversations, and reports to
   Plan context based on canonical ancestry.
8. Remove PlanStep-specific entity adapters after redirects and retention pass.

### Phase 8A — CLI generated contracts and trigger boundary

1. Regenerate the platform API client, local-agent API client, and generated
   validators after their source OpenAPI contracts are additive and deployed.
2. Update prompt payloads and trigger verification to remove retired fidelity
   variants and legacy guidance regeneration. Retain only the
   generated fields required by concrete Task authoring and the agent-side
   validation review.
3. Replace handwritten Plan/Stage/Step response schemas at HTTP boundaries
   with generated contract-aligned validators. Do not use permissive local
   schemas to hide a cross-service shape mismatch.
4. Update prompt-type registry fixtures, signed-trigger fixtures, and payload
   rejection tests before changing handlers so old and new trigger versions
   have an explicit compatibility boundary.
5. Keep legacy trigger parsing only for already-issued compatible sessions;
   new sessions must receive the canonical payload shape.

Exit gate: the CLI accepts the new generated contracts, rejects malformed
canonical payloads, and can still drain explicitly supported old sessions.

### Phase 8B — CLI canonical Plan reads and session grounding

1. Rewrite `load-plan-design-doc.ts` to resolve the Plan's Design Doc through
   the canonical relationship instead of a dedicated Plan association.
2. Rewrite `task-monitor-plan-context.ts` to read the selected Task through
   `GET /work-items/{id}`, recover Stage and Plan through generic ancestry,
   and read their generated sections and incident edges.
3. Remove the dedicated Plan GET and the PlanStep lookup. The selected
   Standard Task is the execution leaf and supplies its own title,
   description, status, services, and identity.
4. Update `agent-session-starter.ts`, startup prompt input, run context, and
   conversation dispatch so canonical Plan/Stage/Task IDs are carried once
   and validated at ingress.
5. Ground prompts with the effective Work Item type registry and graph data;
   do not embed a local Plan ontology or recover ordering from array order.

Exit gate: a CLI session can orient from any Plan-resident Task using generic
reads, ancestry, sections, and edges only.

### Phase 8C — CLI Stage authoring producer cutover

1. Replace the Plan-only authoring surface in
   `proposed-stages.handler.ts` with generic Work Item and edge proposal tools.
2. Update `agents/mcp-server-config.ts` and the plan-shaping allowed-tool sets
   so `create_work_item`, `edit_work_item`, and edge tools are available to
   the authoring turns before the Plan-only tools are removed.
3. Update the proposed-stage prompt to create `PLAN_STAGE` children under the
   existing `PLAN`, then create the linear Stage dependency chain in the same
   reviewed proposal group: Stage B depends on Stage A, Stage C on Stage B.
4. Replace `create_stage`, `update_stage`, `delete_stage`, and
   `reorder_stages` instructions with type-specific guidance for generic Work
   Item creation/editing and ordinary edge creation/deletion.
5. Remove all placeholder-row authoring and title-prefix conventions. Proposed
   Stages contain concrete description/sections and no placeholder children.
6. On revision, read the live Stage children and incident edges, then propose
   the minimum Work Item or dependency change; never reconstruct the chain
   from conversation history.
7. Test temporary/reserved identities, grouped approval, rejection, retry,
   deletion, and dependency-cycle failures.

Exit gate: newly proposed Stages are canonical Work Items with a complete,
reviewable `DEPENDS_ON` chain and no legacy Stage proposal.

### Phase 8D — CLI concrete Task authoring and later additions

1. Replace PlanStep tools in `proposed-steps.handler.ts` with generic
   `STANDARD` Work Item creation/editing plus relationship operations.
2. Require each initial Task proposal set to include the complete intended
   dependency DAG, including explicit parallel roots where appropriate.
3. When a user adds or changes work later, read the current Stage children and
   incident edges, then add or revise only the affected Task dependencies.
   Do not regenerate a cached schedule.
4. Remove `create_step`, `create_steps`, `update_step`, `delete_step`, and
   `move_step` guidance, PlanStep IDs, title discrimination, skipped-step
   semantics, and sequence-based ordering from new-session prompts.
5. Keep the validation mode as a review pass over the proposed Task set and
   dependency graph. It must not create a validation Task or other persisted
   child.
6. Retire the deferred-fidelity expansion in `refine-stage.handler.ts`. If a
   later-work entry point remains, redefine it as ordinary Task and edge
   authoring against the live Stage; otherwise remove the handler after old
   sessions drain.

Exit gate: all new and later-added implementation work is a canonical Task
whose execution eligibility is fully described by standard edges.

### Phase 8E — CLI User Journey materialization

1. Keep Journey phases ephemeral and preserve the single user approval gate;
   never create Work Items for phases.
2. Change `journey-map.schemas.ts`, `submission-tools.ts`, phase-breakdown
   prompts, and step-review prompts from `sequenceOrder` to explicit Task
   dependency references that can point to Tasks in the current or prior
   approved phase.
3. Preserve agent-minted Task IDs through phase breakdown and step review so
   later phases can name real dependency endpoints before materialization.
4. Validate endpoint membership, duplicate IDs, missing references, and DAG
   cycles at submission. Step review must return the full tightened Task set
   with dependency intent preserved.
5. Materialize all accumulated Standard Tasks and their `DEPENDS_ON` edges
   atomically under already-existing Stages immediately before finalize; the
   Journey branch must not create or reorder Stages.
6. Preserve design-doc grounding and report-chain evidence for every phase.

Exit gate: the autonomous post-approval branch produces the same canonical
Task DAG as conversational authoring without persisting phases or order
numbers.

### Phase 8F — CLI execution and Task Monitor consumption

1. Update Plan execution payloads, prompts, session context, and completion
   summaries to use canonical Task IDs rather than Step IDs.
2. Build runnable/blocked/complete state from Task lifecycle plus direct
   `DEPENDS_ON` edges; use a deterministic topological traversal only as a
   presentation/execution cursor, not as a second schedule authority.
3. Update Task Monitor startup and Plan context to pass direct Stage child
   Tasks and their dependencies. Preserve Plan/Stage provenance only for
   prompt grounding and display.
4. Ensure Tasks added after monitor preparation are handled according to the
   Task Monitor's explicit refresh policy; never consult or regenerate legacy
   execution guidance.
5. Preserve direct `RELATED_TO` Plan discovery for Task Monitors and reject a
   provenance-only match.
6. Add execution tests for serial work, parallel roots, blocked work,
   cancellation, later additions, dependency edits, and cycle rejection.

Exit gate: CLI execution and Task Monitor agree with the standard dependency
graph and contain no Step-to-Task projection.

### Phase 8G — CLI compatibility drain and deletion

1. Keep old prompt handlers and trigger payloads only for pinned in-flight
   sessions, behind the Temporal compatibility plan and explicit approval
   required by the Temporal safety gate below.
2. Remove retired Plan tools from MCP allowlists, fidelity prompt text,
   guidance-regeneration dispatch, `sequenceOrder`, PlanStep response shapes,
   and dedicated Plan client calls after the drain proves zero use.
3. Delete obsolete prompt snapshots and fixtures only when their runtime path
   is gone; replace them with canonical Work Item and dependency-DAG
   snapshots.
4. Run focused plan-shaping, trigger-verification, design-doc loading,
   Task Monitor context/start, plan-execution, and runner tests.
5. Run `pnpm generate:check`, `pnpm tsc --noEmit`, `pnpm test`, `pnpm lint`,
   and `pnpm build`.

Exit gate: the CLI contains no active legacy Plan producer or consumer path,
and any retained compatibility code is tied only to an identified in-flight
session population and removal date.

### Phase 9 — Graph and embeddings

1. Update Graph ingestion to model Plan-family Work Items as Task nodes with
   subtype and generic `HAS_TASK` hierarchy.
2. Migrate semantic edges and remove Plan-specific traversal types only after
   old consumers drain.
3. Update neighborhood/context queries and suppress only structural pivots
   derived from generic hierarchy.
4. Reindex canonical Plan/Stage/Task documents and lineage boosts.
5. Tombstone legacy documents and prove no duplicate search results.

### Phase 10 — contract legacy behavior

1. Make all legacy Plan endpoints read-only, measure usage, then remove them.
2. Remove `Plan`, `PlanStage`, `PlanStep`, `PlanRelationship`,
   `PlanStepRelation`, legacy enum storage, and duplicate status-sync code with
   new append-only Flyway migrations.
3. Remove the legacy guidance sidecar after compatibility readers, producers,
   events, and Temporal executions have drained; do not migrate it into a
   generic section.
4. Archive or remove created Stage Initiatives after reference audit.
5. Remove compatibility Plan events, DTO adapters, Graph node types, route
   aliases past retention, and stale generated clients.
6. Keep identity aliases required by durable mentions, proposals, reports, or
   historical URLs.

## Temporal safety gate

The repository currently includes Temporal workflow code for Plan shaping and
execution guidance. No implementation phase may change Temporal workflow
command sequencing, activity scheduling, signals, retries, cancellation, or
registered workflow behavior without explicit user approval at that time.

Before any approved Temporal change:

- identify every affected registered workflow and activity;
- choose Worker Versioning/Build IDs or a `patched()` branch;
- replay representative persisted histories, including the legacy guidance
  fixture;
- deploy compatible workers before routing new executions;
- drain or pin in-flight executions to compatible builds;
- remove old branches/workers only after the retention window.

Merely changing Plan persistence inside an existing activity should keep the
same activity boundary and command sequence. Deleting the Temporal guidance
workflow or rewiring Plan-shaping nodes is a separate explicitly approved
rollout.

## Cross-repository rollout

1. Additive OpenAPI and enum contract.
2. Additive API schema, registry, aliases, and dependency-edge support.
3. Regenerate API and publish the additive server contract without exposing
   registry types whose storage or generic services are not yet usable.
4. Deploy API compatibility readers, same-transaction shadow projection,
   aliases, and parity metrics while legacy producers remain authoritative.
5. Regenerate UI Common, land its canonical read/cache boundary, and publish a
   compatibility release that can consume both the additive server contract
   and retained legacy routes.
6. Migrate UI to that UI Common release and prove canonical Plan list/detail,
   routing, proposal review, and Task Monitor setup before changing producers.
7. Regenerate CLI contracts and deploy canonical read/session-grounding code
   while its legacy authoring path remains active.
8. Dry-run and apply the data backfill after explicit migration approval;
   prove identity, hierarchy, edge, section, and projection parity.
9. Cut CLI Stage authoring to generic Work Item proposals and Stage dependency
   edges, then cut concrete Task authoring and later-addition behavior.
10. Cut the CLI User Journey materializer to atomic Standard Tasks plus
    dependency edges, retaining ephemeral phases and the single review gate.
11. Flip API producers to generic writes only after UI Common, UI, and CLI
    consumers have passed their canonical-path gates.
12. Cut UI Common and CLI Task Monitor/execution consumers from guidance and
    PlanStep identity to the canonical Task DAG.
13. Reindex Graph/search and verify one canonical identity per Plan, Stage,
    and Task.
14. Drain legacy clients, proposals, events, routes, sessions, and Temporal
    executions with per-path usage metrics.
15. Publish deletion releases of UI Common and CLI, then migrate UI to the
    deletion release.
16. Contract legacy writes, then legacy reads, event schemas, generated
    clients, adapters, and tables.

Do not expose a registry definition to clients before its database schema,
validators, generic services, generated contracts, and renderer support are
deployed.

## Rollback

- Enum additions, new type definitions, and aliases are additive and remain
  after rollback.
- Before producer cutover, disable shadow projection and continue legacy
  writes.
- During the rollback window after producer cutover, keep legacy tables and a
  verified reverse compatibility projection. Flip reads and producers back
  together; do not let both sides accept independent writes.
- Keep a database backup and the migration manifest before applying the
  backfill.
- Do not delete legacy tables, event schemas, route aliases, or old Temporal
  workers until rollback metrics, proposal drains, event retention, and
  history replay all pass.
- After destructive legacy-table removal, rollback requires database restore
  plus compatible application versions; call that out as the irreversible
  release boundary.

## Verification matrix

### Contract and generation

- `../openapi`: `npm run validate:all` and `npm run check-duplicates`.
- `api`: `pnpm generate:all`; generated diff contains the new statuses,
  schemas, type keys, events, and edge targets without handwritten widening.
- `ui-common`: `pnpm generate:check`.
- `cli`: `pnpm generate:check`.

### API focused tests

- Registry template/project parity and protected type behavior.
- Parentage for Feature → Plan → Stage → Standard.
- Parent-conditioned service rules.
- Atomic Stage/Task creation, reparenting, and dependency-edge creation.
- Stage-chain and Task-DAG cycle/endpoint validation.
- Generic change-set projection/materialization and retry checkpoints.
- Grouped proposal reserved identities and publication fencing.
- Standard → Stage → Plan rollup and event ordering.
- Cancelled Task terminality and reopen behavior.
- Dependency-driven runnable/blocked/next-work derivation, including Tasks
  added after initial materialization.
- Generic context, Graph edges, aliases, mentions, reports, sessions,
  conversations, and search.
- Legacy adapter parity and route redirects.
- Backfill dry-run, idempotency, exception handling, and checksums.
- Event union, websocket mapping, Graph ingestion, and embeddings replay.

### End-to-end scenarios

1. Plan with a linear Stage dependency chain and a mixed serial/parallel Task
   dependency DAG.
2. Later Task addition with correct dependencies on existing Tasks and no
   schedule regeneration.
3. User Journey review followed by autonomous concrete materialization into
   existing Stages.
4. Same-feature existing Task adoption with explicit reparenting and reviewed
   dependency edges.
5. Cross-feature prerequisite retained externally with a dependency edge.
6. Rejection of a Task already structurally parented under another Plan.
7. Task cancellation advances Stage and Plan rollup.
8. Legacy non-implementation rows remain resolvable without being converted to
   a new Work Item type.
9. Task Monitor discovery works only through direct `RELATED_TO` Plan edge.
10. Legacy Plan/Stage/Step links resolve through aliases.
11. Pending and grouped proposal cutover/retry remains deterministic.
12. Search, context, activity, reports, and Open Items show one canonical
    identity with Plan-aware routing.

### UI Common focused verification

- Canonical Plan list/detail composition batches hierarchy, sections, and
  selected edges and produces one cache identity per Work Item.
- Generic Work Item events invalidate Plan, Stage, Task, list, hierarchy, and
  edge queries without relying on duplicate Plan events.
- Stage-chain rendering supports the linear dependency chain; Task rendering
  supports serial and parallel DAG branches.
- Plan updates, Stage updates, Task status changes, and dependency edits use
  generic mutations and render reviewable generic change sets.
- Coarse-fidelity, guidance, Step recommendation, and PlanStep mutation
  components are absent from the canonical path.
- Task Monitor setup uses direct Standard children and Task edges, produces a
  deterministic topological view, and preserves parallel blockers.
- Legacy URLs resolve through aliases to the same cached canonical identity.
- Registry-unavailable, partial-hierarchy, empty-plan, and API-error states
  fail closed with explicit UI states.
- Package export inspection proves UI and CLI do not consume a removed symbol
  before the UI Common deletion release.

### CLI focused verification

- Generated trigger parsing accepts canonical payloads, rejects malformed
  payloads, and identifies the explicitly supported legacy-session cohort.
- Stage proposals create `PLAN_STAGE` Work Items plus the complete linear
  dependency chain in one review group.
- Initial and later Task proposals create Standard Tasks with complete
  dependency edges and reject missing endpoints or cycles.
- Agent-side validation reviews the proposed Task DAG and persists no
  validation child.
- User Journey phase breakdown and step review preserve Task identities and
  dependencies across phases, then materialize once without `sequenceOrder`.
- Generic Plan reads recover the Design Doc, Stage, and Task through canonical
  relationships and ancestry without dedicated Plan endpoints.
- Plan execution and Task Monitor derive runnable work from Task state and
  standard edges, including parallel roots, cancellation, later additions,
  and dependency edits.
- New-session prompts and tool allowlists contain no retired fidelity, guidance,
  PlanStep, reorder, move, or title-prefix authoring behavior.
- In-flight Temporal histories replay before any approved handler/node
  deletion or routing change.

### Repository checks

- API: focused Jest suites, `pnpm db:flyway:validate`, `pnpm tsc --noEmit`,
  `pnpm lint`, and `pnpm build`.
- Apply Flyway migrations only after explicit approval with
  `pnpm db:flyway:migrate`; report whether application occurred.
- UI Common: focused Vitest suites, `pnpm generate:check`,
  `pnpm tsc --noEmit`, `pnpm check`, and `pnpm build`.
- UI: focused Vitest suites, `pnpm type-check`, `pnpm lint`, and `pnpm build`.
- CLI: focused Vitest suites, `pnpm generate:check`, `pnpm tsc --noEmit`,
  `pnpm test`, `pnpm lint`, and `pnpm build`.
- Graph: focused Maven tests followed by `mvn test`.
- Embeddings: generated models, focused tests, then `pytest tests/ -v` in the
  repository virtual environment.
- Temporal: replay tests against captured histories before any approved
  workflow deployment.

## Completion criteria

The migration is complete only when:

1. `PLAN` and `PLAN_STAGE` are canonical protected registry types in every
   project-effective snapshot; no validation-specific type is introduced.
2. Concrete Plan work is represented by one canonical `STANDARD` Task per
   dependency-scheduled leaf with no PlanStep duplicate.
3. Non-implementation legacy rows are never inferred from titles during
   backfill.
4. A linear Stage dependency chain and acyclic Task dependency graph drive all
   ordering and execution eligibility; no Plan-specific position or cached
   schedule remains.
5. Adding later work requires ordinary `DEPENDS_ON` edges and is immediately
   visible to the standard scheduler without regeneration.
6. The validation pass remains an agent-side review of proposed Tasks and
   creates no persisted Plan child; legacy non-implementation rows are retired
   through the measured compatibility path rather than silently remapped.
7. Stage and Plan rollup is synchronous with child mutation and replaces the
   old dual-record projection guarantee.
8. `PLAN_STAGE` has no `executionGuidance` section or canonical guidance
   request row; legacy guidance data is retired after compatibility drain.
9. Generic APIs, registry snapshots, Graph edges, proposals, sessions,
   conversations, reports, events, search, and context own the canonical data.
10. Plan UI and Task Monitor retain their product behavior without a
    Plan-specific backend lifecycle.
11. Legacy identities, mentions, URLs, proposals, reports, and event history
    remain resolvable through reviewed compatibility paths.
12. Every ambiguous migration record is resolved explicitly; no fallback text,
    parent, type, service, or status is invented.
13. All cross-repository generation, validation, focused tests, type checks,
    builds, data parity checks, and any required Temporal replay checks pass.
14. Legacy Plan tables and event/API families are removed only after the
    measured rollback and retention gates close.
