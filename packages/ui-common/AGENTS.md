# UI Common

Shared components, hooks and the generated API client, consumed by `apps/ui` and `apps/cli`.

## Conventions

- Component props are typed to their real domain shape. The caller passes correct types; the component doesn't re-validate or narrow generic props.
- No optional props that nothing wires through. Delete them, or make them required.
- Brand opaque identifiers that cross domain boundaries (`RequestId`, `WorkflowId`).
- A missing required value renders a defined loading, error or empty state. No placeholder text, inferred values, or fallbacks. Never render an ID as a title or name.
- Don't add `enabled`/`useFeatureX` toggles for behavior that should run everywhere. Derive it from existing data.
- No conditional hooks.
- New import aliases or package entrypoints need explicit user approval.
- Lodash subpath imports use a `.js` suffix (`lodash/throttle.js`) so the CLI runtime resolves them.
- Field components stay dumb: render the input and propagate `onChange`. Seed initial values through `prepareFormInitialData`. Generation and accept flows belong to secondary actions (see `TaskGenerationField`, `AgentResponseField`).
- Never attribute a failure to a stale bundle, cache or dev-server reload. Debug the source and the data flow.

## MUI

- Import from `@mui/material` and `@mui/icons-material`. Style through `sx` and theme values, not inline styles.
- Use `slots`/`slotProps`, not deprecated `*Props` shortcuts.
- Grid v2: `<Grid size={{ xs: 12, md: 6 }}>`. `item` and bare `xs={12}` are deprecated.

## Testing

- Add stable, literal `data-testid`s to interactive controls and component boundaries so they are findable by code search. Put record-specific values in separate `data-*` attributes, not in the test ID.
- Cover the whole interaction for async behavior (action, request, pending, success, failure), and don't let mocks bypass the wiring under test.
- Assert observable state and requests, not CSS classes or incidental MUI output.

## Downstream check

After changing exported components, props, hooks, clients or generated types, run `pnpm type-check` in `apps/ui` too. Regenerate affected clients first.
