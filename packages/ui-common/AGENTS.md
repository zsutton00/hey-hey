# UI-Common Agent Rules

Task note: when working from a linked Git worktree, OpenAPI-derived generation must prefer the matching `../openapi/.worktrees/<worktree>` checkout and fall back to the main `../openapi` checkout; use `HEY_HEY_OPENAPI_ROOT` or the repository/tool-specific override only to pin a source.

## Type Safety and Refactoring

### Always Prefer:

- **Type-first refactoring**: When fixing issues, first consider whether a type change would prevent the problem entirely.
- **Branded types**: Use branded types for opaque identifiers that cross domain or service boundaries (for example, `RequestId` and `WorkflowId`).
- **Required vs optional**: Make fields required when they should always exist, use unions for conditional presence
- **Exhaustive handling**: Use discriminated unions and ensure all cases are handled.
- **Interface segregation**: Create specific interfaces (like LLMJobContext) instead of using generic ones with optional fields
- **No zombie optionals**: Avoid optional props/fields that are never wired through; they create false confidence and hide missing behavior. Delete unused optionals or make them required and prove they flow end-to-end.
- **Required data through optional fields**: Verify that optional API data is reliably populated before making it a feature dependency. Otherwise add an explicit fetch or use an alternative data path.
- **No uncertain casts**: Do not cast to types unless their runtime shape is established.
- **Strong props**: Component props must be strongly typed to their real domain shape. Do not accept generic or loosely-typed props and then validate or narrow inside the component. The caller is responsible for passing correct types; internal runtime checks hide type bugs and weaken guarantees.

## Agent behavior

- **Never blame stale bundles**: Do not attribute a UI or runtime failure to a stale bundle, build artifact, cache, or dev-server reload. Debug the source behavior, runtime data flow, and rendered output instead.
- Decompose large functions recursively, not just once: if an extracted helper is still long or doing multiple jobs, split it again into smaller named functions.
- Prefer pure functions when possible so behavior is deterministic and easy to unit test; isolate side effects in thin orchestration layers.
- Treat decomposition as a testing opportunity: add or update focused tests around extracted logic, especially for branching behavior and invariants.

- When adding validation, encode constraints in types first.
- Prefer `type` for unions and `interface` for objects that can be extended.
- Use `const` assertions and `as const` for literal types.
- **No shortcuts under refactor**: When replacing a broken pattern, do not add shims or wrappers that keep the old behavior alive. Do the hard switch or confirm a compatibility requirement.

### Material-UI (MUI) Standards

- **Import pattern**: Import components from `@mui/material` and icons from `@mui/icons-material`
- **Theme consistency**: Use theme values for spacing, colors, and typography
- **sx prop**: Prefer `sx` prop over inline styles for MUI components
- **Slots**: Use `slots` or `slotProps` when supported by the component; migrate deprecated props according to that component's API.
- **Responsive design**: Use MUI's breakpoint system and responsive utilities
- **Grid**: Grid `item`, `xs`, `md`, `lg`, and `xl` are deprecated. For sizes use `size={{ xs: 12, ... }}` instead

## Coding Guidelines

- **Approval required for new package aliases/entrypoints**: Never add a new import alias or package-style entrypoint (for example `@ui-common-activity`) without explicit user approval in this thread.
- Never use any for types. Where possible use openapi derived types.
- Use strongly typed constants for finite string values shared between services, such as event types and channels.
- **No conditional hooks**: React hooks must be called unconditionally and in the same order on every render. Do not call hooks after early returns or inside conditionals, loops, or nested functions.
- **OpenAPI alignment**: Do not manually add/update OpenAPI models here. Update the OpenAPI spec in `../openapi` and regenerate. When adding schemas, bind them to the generated OpenAPI types.
- **OpenAPI generation filters**: Operations in `../openapi/specs/api/openapi.yaml` have one stable generator tag and an explicit `operationId`. When generating a focused client, pass `--global-property=apis=TagA,TagB` with the required tag names; when generating a focused model set, pass `--global-property=models=ModelA,ModelB` and include transitive dependencies. Keep `src/api` complete unless every consumer of the generated client is covered by the selected operations.
- **Missing required values**: Render a defined loading, error, or empty state; do not substitute fallback text, IDs, inferred values, or placeholders. Confirm the data contract when it is unclear.
- **Never render IDs as titles/names**: IDs are identifiers only and must never be shown as user-facing labels.
- Add searchable `data-testid`s to test-critical interactive controls and component boundaries. Use stable literal test IDs that can be found directly with code search, and put record-specific values in separate `data-*` attributes instead of interpolating them into the test ID.
- **Lodash import suffix**: Use explicit `.js` suffixes for lodash subpath imports (for example `lodash/throttle.js`, `lodash/isEqual.js`) so the CLI runtime resolves them correctly.

## Feature Flag and Configuration Rules

- **No opt-in toggles for required behavior**: When a capability (e.g., collaboration, lexical editing) should run everywhere, do not add `enabled`, `useFeatureX`, or similar booleans. Derive behavior from existing data (like the presence of a collab client) and fall back gracefully when the data is missing.
- **Avoid bespoke switches**: If behavior truly needs configuration, expose it through existing template metadata or backend-controlled flags rather than adding ad-hoc props.
- **Prefer explicit fallbacks**: Handle unavailable resources with UI states or safe defaults—not new feature flags.

## UI Field Implementation Notes

- Field components should stay dumb: render text inputs/areas and propagate user edits via `onChange`. Domain-specific actions belong in secondary actions, not in the field.
- Seed initial values from the system message the same way across fields (through `prepareFormInitialData`); avoid bespoke initialization inside field components.
- Mirror simple patterns like `TaskGenerationField` and `AgentResponseField`: no auto-submission, no mount-time `onChange`, no special casing for generated content. Let secondary actions perform generation/accept flows.

## Testing Standards

- **Test behavior and contracts first**: Prioritize tests that prove user-visible behavior, domain invariants, data flow, integration wiring, and failure handling. Do not spend primary coverage effort on incidental styling or implementation details unless they are themselves an explicit product requirement.
- **Every bug fix needs a regression test**: Reproduce the reported failure at the narrowest boundary that would have caught it before the fix. The test must fail against the broken implementation and pass because of the fix.
- **Protect wiring seams**: When behavior crosses components, hooks, clients, or services, prove that required inputs and callbacks reach the behavior owner. Do not let mocks silently bypass the production wiring under test.
- **Test complete interaction outcomes**: For interactive or async behavior, cover the initiating action, dispatched operation, pending state, success state, and defined failure state as applicable. A render-only or callback-presence assertion is not sufficient when the defect concerns what happens after interaction.
- **Layer tests deliberately**: It is acceptable to use a focused wiring test at the caller and a focused behavioral test at the owner when together they prove the complete path. Keep the boundary explicit so each test fails for one actionable reason.
- **Prefer durable assertions**: Assert observable state, emitted requests, domain results, and stable accessibility or test identifiers. Avoid assertions coupled only to component structure, CSS class names, or incidental MUI output.

## Checks

- **Typecheck on completion**: When you finish work, run `pnpm tsc --noEmit`. If it reports errors, fix them and rerun until it passes.
- **Validate the downstream UI consumer**: After changing UI Common's exported components, props, hooks, clients, or generated API types, run `pnpm type-check` in the matching UI checkout/worktree against the linked UI Common source. Resolve downstream diagnostics introduced by the change or explicitly record them as remaining work. For OpenAPI-derived changes, regenerate every affected client before running this check; the downstream typecheck does not validate an OpenAPI contract that has not been regenerated.

## Formatting

After editing files, run `pnpm exec prettier --write <changed files>` before finishing. Claude Code does this automatically via a `PostToolUse` hook in `.claude/settings.json`; Codex has no equivalent configured here, so do it by hand.
