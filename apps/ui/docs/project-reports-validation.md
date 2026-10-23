# Project report route validation

Implemented the Overview launch row, independent newest-first report history,
protected creation route, and project-scoped typed detail route in the matching
UI and UI Common worktrees.

Request drafts retain their question, fixed scope, exclusions, and persisted
request identity when explicitly closed and reopened during the same application
session. Opening a completed report clears the draft so subsequent creation
starts a new report. Drafts are held in application memory; they do not survive
a browser reload. Persisted generation and retry remain owned by the request API.

## Verification

- UI Common `pnpm tsc --noEmit` passed.
- Report, request, Overview, path, viewer-dispatch, and work-item read/sketch
  regression tests passed.
- Follow-up validation on 2026-10-02: UI Common report/request/Overview,
  path, viewer, and work-item read/sketch checks passed: 192 tests in 19 files.
- UI report route, protected-route, application-route, and Overview destination
  checks passed: 30 tests in 5 files, including 5 new real-viewer integration tests.
  The new test leaves the canonical ReportViewer and payload parser unmocked;
  it verifies typed title, both covered-period endpoints and time zone, creation
  date, persisted historical route/request identity, and rejection of mismatched
  report project, report organization, payload project, and authorized project.
- Targeted lint checks passed for new report components and UI routes.

## Remaining repository checks

UI `pnpm type-check` reports 19 diagnostics outside the report changes:

- `OpenItemsSection.tsx`: missing `OpenItemActiveOnlyAction` export.
- `ConversationArchiveList.tsx`: `ConversationResponseDto.createdBy` is absent.
- Feature document/tree consumers: missing `FeatureHierarchyNode`,
  `useFeatureHierarchy`, `useFeatureDocumentContent`, and `useFeatureTreePageData`
  exports, resulting implicit parameter types, and obsolete `treeData` props.
- Help and repository-import consumers: missing `HelpActionCapability` export.
- `TaskDetailSidebar.tsx`: obsolete feature-tree `dataSource` prop.

The follow-up UI typecheck reproduced exactly these 19 diagnostics, with no
diagnostics in the new integration test. They remain confirmed baseline context;
no unrelated type fixes were made.

The follow-up complete UI Vitest run returned 12 failing files, 47 failing tests,
and 1,532 passing tests. All report-route, application-route, protected-route,
and Overview destination tests passed in that full run as well as independently.
The earlier 13-file/49-test failure count is historical, not the current result.

Reproduced failures and their observed boundaries:

- Open Items suite collection: `SyntaxError: Duplicate parameter name not allowed
  in this context`. This collection error is distinct from the absent
  `OpenItemActiveOnlyAction` export in the confirmed typecheck baseline.
- Explorer: four tests have an incomplete `useConversation` data mock.
- Task Agent Sessions: eleven tests have an incomplete `MINI_DEMO_TARGETS` mock.
- Workflow graph: two tests read `status` from undefined workflow-step data.
- Project page/routing/navigation: five tests expect legacy PLAN navigation,
  while the implementation selects TASK/registry-work-item destinations.
- Onboarding: six failures alongside unhandled conversation MSW requests.
- Help/import: twelve failures concerning import buttons and setup state.
- Prompt-template override/publication: six failures concerning disabled
  proposal controls or missing proposal callbacks.
- Work-item type admin form: one timeout in the full run; an isolated rerun
  passed all 73 tests. Load sensitivity is plausible but its cause is unverified.

These failures exercise boundaries outside the project-report request/detail
flow. Inspection and passing report integration tests found no attributable
report-flow defect to fix. This is boundary-based attribution, not proof from a
pristine-checkout comparison: no clean baseline suite was run. In particular,
onboarding, Help/import, prompt-template, and workflow failure root causes remain
unverified; they must not be described as established pre-existing defects.

Commands used the matching linked UI Common source. Sandbox temporary-directory
errors were resolved with `TMPDIR` inside each worktree. UI Common's pnpm launcher
could not fetch its pinned package manager, so the installed TypeScript/Vitest
executables were used directly: `tsc --noEmit` passed and the checks above passed.
UI `pnpm type-check` completed with the same 19 diagnostics; a direct TypeScript
rerun confirmed them. The full UI Common suite was not completed; its focused
integration coverage does not establish full-suite acceptance.

The UI script's separate runtime-model-catalog Node checks were run explicitly
because Vitest failure short-circuits the script. Both failed: the Vite server
check was blocked by sandbox `listen EPERM`, and the production fixture build
failed in the existing `trace-chunks` plugin while writing
`dist/chunk-manifest.txt` (`ENOENT`). Neither validates report flow; passing
results outside the sandbox have not been established. Lint passed for the new
route integration test.

The complete UI suite and downstream typecheck are therefore not green. No
claim is made that the full acceptance gate has passed.
