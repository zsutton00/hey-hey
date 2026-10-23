# Storybook conventions

Storybook is the component-preview and visual-validation environment for `ui-common`. It is a **dev-time tool only** — Storybook is not bundled into `dist`, not referenced from any production entry point, and not deployed. No Storybook artifact ships to users.

Run it locally with `pnpm storybook`.

## Where stories live

Stories colocate with the component they preview:

```
src/components/Foo/
  Foo.tsx
  Foo.stories.tsx
```

`.storybook/main.ts` globs `src/**/*.stories.@(ts|tsx|mdx)`, so any file matching that pattern is picked up automatically. There is no central stories registry to update.

## Where fixtures live

Component-specific mock data lives **inline** in the `.stories.tsx` file. Only when the same fixture is needed by more than one story file should it be extracted.

Shared fixtures live in a `__fixtures__/` folder next to the consumers, mirroring the existing `__tests__/` colocation pattern:

```
src/components/Foo/
  Foo.tsx
  Foo.stories.tsx
  __fixtures__/
    conversation.ts
```

Fixtures export typed factories that return DTOs from `src/api` (the generated OpenAPI types). Do not hand-roll fixture types — generated DTOs are the source of truth, and a fixture that drifts from the contract defeats the purpose of the preview.

Stories must not reach into live API clients or platform data fetchers; fixtures are the only data source.

## Shared decorator stack

`.storybook/preview.ts` is the **single seam** for global wrapping. Its only decorator renders every story inside `StoryProviders` (`.storybook/StoryProviders.tsx`), a composed component that wires the platform context every story gets for free:

- `HeyThemeProvider` (light mode default; MUI theme, toast container)
- `ProjectContext.Provider` seeded with the fixture in `.storybook/fixtures/projectContext.ts` — a stable `organizationId`/`projectId` and a no-op `navigate`
- `DataHooksProvider` with a fresh `QueryClient` per story configured to **fail fast**: `retry: false`, `staleTime: Infinity`, refetches disabled, and a default `queryFn` that throws a clear error directing authors to seed fixture data instead of hitting live APIs

Individual story files do not wrap themselves with `HeyThemeProvider` or other top-level providers. **Adding a new piece of platform context is a single edit to `StoryProviders` — never per-story.**

### Seeding fixture data into the query cache

For components backed by data-layer hooks, supply fixture data via the `queryData` story parameter — `StoryProviders` reads it from story context and calls `queryClient.setQueryData` for each entry before the story renders:

```tsx
export const Populated: StoryObj<typeof Foo> = {
  parameters: {
    queryData: [
      { queryKey: ["foo", "list"], data: fooListFixture() },
    ],
  },
};
```

This is the **only** mechanism stories use to supply fixture data to components that consume data-layer hooks. If a story renders a component whose hook is not seeded, the default `queryFn` guard fires and the story surfaces the error — that signal is intentional, not a bug to work around.

## Expectation for new UI work

**Any task that adds or changes a presentational component in `ui-common` adds or updates that component's story as part of the same change.** A story covering the meaningful states (empty, loading, error, populated, and any state-driven branches) is part of the deliverable, not a follow-up.

Coverage is opportunistic, not exhaustive: existing components without stories are not blocked from being touched, but they get a story the next time they are touched. The goal is steady accretion of preview coverage on the surfaces we iterate on.

This convention sets the expectation going forward; it does not retroactively rewrite acceptance criteria on already-scoped tasks.
