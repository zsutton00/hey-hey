# Canonical Plan UI

The UI consumes `PLAN` and `PLAN_STAGE` Work Items and their `STANDARD` Task
children. `useProjectPlans` supplies lists; `useCanonicalPlanAggregate` validates
the registry and composes dependency-ordered detail views. The UI does not
reconstruct legacy Plan DTOs or call legacy Plan lifecycle endpoints.

## Entry points

- Project Plan list URLs remain `/projects/:projectId/plans`.
- Plan detail and selected Stage URLs retain their existing paths.
- Generic Task URLs for PLAN and PLAN_STAGE render the shared Plan presentation.
- Historical `/stages/:stageId/steps/:stepId` URLs resolve the `PLAN_STEP` alias
  through the backend. A historical Step ID must never be assumed to be a Task ID.
- Concrete Tasks use the ordinary Task page. Open Items and coding sessions
  retain Plan/Stage ancestry as Task identities, without a duplicate Step.

Create Plans from a Feature's Plans tab. Creation uses the generic Task mutation,
a required Feature parent, authored outcome, and schema-backed
`planConfiguration`; an empty Plan starts in BACKLOG. The old standalone and
Initiative creation controls now lead to Features rather than creating orphan
legacy Plans.

Plan section editing, status changes, and archive/delete use generic Work Item
controls. Pending status proposals remain pending in the UI. Worktree editing
uses aggregate configuration. Task Monitor setup and existing monitor routes
retain the Plan shell and selected Stage.

Explorer visibility comes from each effective type definition's
`showsInExplorerSidebar` capability. There is no unconditional Plans section
or ancestry filter that hides a Plan because it has a Feature parent.

Coding sessions obtain Plan ancestry from full Task context and worktree
configuration from the canonical aggregate. They wait for context to load and
show errors before startup. The shared CodingSession prop now accepts only the
Plan ID/title/description it consumes, allowing a canonical projection without
inventing legacy owner, status, or Stage data.

## Verification

Run `pnpm type-check` and `pnpm build` against the matching live ui-common
checkout. A build checks exports across lazy routes; Vite development
transpilation alone does not check them. Do not baseline missing-export errors.

Focused tests cover Plan identity, Stage automation paths, previews, Feature
creation, pending mutations, historical alias wiring, Task/session ancestry,
and startup context loading. Broader unrelated test and TypeScript failures
must be distinguished from regressions in these consumers.
