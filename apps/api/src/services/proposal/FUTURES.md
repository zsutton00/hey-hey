# Reviewed proposal futures

Author through the existing project proposal endpoint with action
`VERSIONED_UPDATE`, target type `TASK` or `DESIGN_DOC`, and a generated
`FutureRevisionMutation` as `updates`. Ordinary review policy applies.

Agents author through the `propose_future_revision` MCP tool with a
`FutureRevisionAuthoring` delta instead, so they never resend unchanged
content. `future-revision-materializer.ts` reads the selected baseline (live
content and revision token, a parent future's reviewed result, or for a
refinement the future's latest reviewed result and existing baseline), applies
the `edit_work_item` / `edit_design_doc`-shaped `changes`, copies status (and
task config and source) from the baseline, and hands the complete
`FutureRevisionMutation` to ordinary creation. Stored futures, history, review
and Apply only ever see complete content.

For a new future, reserve a UUID as `futureId`, use `operation: REVISE` and
`expectedRevision: 0`, and supply a complete `result`, a selected `baseline`
(revision token and complete content), and the complete `dependencies` array.
Use the same future ID and current reviewed revision for subsequent proposals.
Sections must include unchanged content. A FUTURE baseline selects one exact
reviewed revision of another future for the same target. LIVE baseline tokens
are retained for the application/reconciliation owner; staging does not assert
that the live baseline is still current.

Approval appends immutable history and stores the complete result without
updating live content. Concurrent refinements use an expected-revision compare
and update inside the approval transaction. Retrying the same committed proposal
does not append another revision. A cancellation is another reviewed mutation:
`operation: CANCEL`, the stable `futureId`, and `expectedRevision`. Cancellation
retains the last reviewed result, dependencies, and history.

Read a future explicitly with
`GET /api/v1/organizations/{organizationId}/projects/{projectId}/proposals/futures/{futureId}`.
The response exposes originating/updating proposal identities, reviewed history,
complete content, baseline, dependencies and terminal outcome. Existing entity
reads still return live content. The originating proposal's `updates.futureId`
is the selection handle, including in grouped proposal responses.

`outstandingRefinementProposalIds` identifies ordinary-visible DRAFT
VERSIONED_UPDATE proposals for that future and target, including pending
revisions and cancellations. Resolve their contents and review state through
the existing proposal reads. Approved/rejected proposals and hidden BUILDING
group members are excluded; proposals based on older reviewed revisions remain
discoverable. The list is separate from approved history: pending edits and
rejection do not replace the approved content, baseline, dependencies, or its
approval. Ordinary refinement approval accepts the new reviewed result without
another acceptance step. Apply confirmation and invalidation belong to the
application owner, which must reread current state rather than treating this
list as authorization. No draft edit-history UI or historical approval restore
is implied.

Completion dependencies are directed future-owned DEPENDS_ON records, persisted
separately from generic graph edges and group prerequisites. Their targets use
canonical TASK identity with a project-effective `work-item` role, plus PLAN
explicitly. A group may reference its own typed CREATE reservations only with
the corresponding materialization prerequisite. Completion is not checked at
approval. Work Items and Plans retain completion authority.

`completionEligibility` reads canonical work-item status for every explicit
dependency in the same organization and project. Only `COMPLETED` qualifies;
Plans in `VERIFYING` still await final acceptance. Missing, unresolvable,
cancelled, archived, and superseded targets produce linked blockers. An empty
dependency set is eligible. Eligibility is a read-time projection, independent
of approval, baseline currency, and application outcome; it grants no authority
to apply and does not mutate live content or future history.

`GET .../proposals/futures/{futureId}/applicability` exposes current-user
permission, approval, completion, outcome and baseline gates without writing.
`POST .../proposals/futures/{futureId}/apply` rechecks them in the application
transaction, including the expected approved revision and the exact confirmed
pending refinement versions. Approval and application share the same permission
and approval evaluator. Successful application records `appliedAt`,
`appliedRevision`, and APPLIED under the same future identity. Completion events
never apply a future.

Proposal listing accepts `completionDependencyId` to find the latest reviewed
proposal of each future with that persisted work dependency. This uses future
dependency records, not group ordering or live-target graph edges.

The shared proposal reconciliation owner is absent from this checkout.
BASELINE_CHANGED and BASELINE_UNAVAILABLE remain blockers. Integrating the
shared reviewed return path is still required to finish the review journey;
warning acknowledgement and a future-specific reconciliation engine are not
substitutes.

Schema changes use the new Flyway migration. It has not been applied in this
session: local PostgreSQL was unavailable, and worktree doctor and Flyway
validation both reported connection refused at localhost:5432. Apply only with
explicit runtime approval. Run `pnpm db:flyway:validate` and, once authorized,
`pnpm db:flyway:migrate` using the worktree database tooling.

`pnpm generate:api` generates API models and the OpenAPI-derived runtime future
mutation and authoring validators from the matching OpenAPI worktree.
