# Development Guidelines

React + TypeScript + MUI + Vite frontend. Cross-project rules (cleanliness, commits, git safety) live in `~/CLAUDE.md` — read them first.

## Tooling

- Package manager: `pnpm`. Scripts: `pnpm run dev | build | type-check | lint | test`.
- After non-trivial TS/TSX changes, run `pnpm run type-check`.

## TypeScript

- `unknown`, not `any`. If something legitimately needs assertion, narrow it.
- Explicit return types on exported functions.
- `import type` for type-only imports.

## File structure

```
src/
├── components/     # Reusable UI
├── pages/          # Page-level
├── data/           # Hooks + collections (data layer)
├── services/       # API/business logic
├── contexts/       # React context
├── utils/          # Pure helpers
├── types/          # Type defs
├── i18n/           # Translations
└── api/            # Generated API client (don't hand-edit)
```

## Data fetching

Use the `src/data/` layer — never call the generated API client directly from components.

- Component reads: `useConversations`, `useReport`, etc. from `src/data/hooks/`.
- Mutations / cross-cutting state: collections in `src/data/collections/`.

## i18n

All user-facing strings go through `useTranslation`:

```typescript
const { t } = useTranslation();
return <Typography>{t("integrations.github.tokenHelp")}</Typography>;
```

Translation keys are hierarchical and descriptive. Never hardcode user-facing copy in components.

## URL state with `nuqs`

Filters, pagination, selected tabs, sort options, view modes → store in the URL with `nuqs`, not `useState`. This gives back/forward, deep links, and shareable URLs for free.

```typescript
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";

const [search, setSearch] = useQueryState("search", parseAsString.withDefault(""));
const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
```

Keep `useState` for: form inputs pre-submit, modal open/closed, hover, transient UI.

## Navigation

Navigable elements should be real `<a>`s with `href` so right-click / cmd-click / "copy link" work — then intercept the left-click for SPA routing:

```typescript
<Box
  component="a"
  href={pathService.report({ projectId, reportId })}
  onClick={(e) => {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      navigate(href);
    }
  }}
>
```

## MUI conventions

- Import from `@mui/material` / `@mui/icons-material`. Use theme values via `sx`; don't inline styles.
- Use `slots` / `slotProps`, not the deprecated `*Props` shortcuts.
- Grid v2: `<Grid size={{ xs: 12, md: 6 }}>` — `item` and bare `xs={12}` are deprecated.

## React conventions

- Function components only.
- Event handlers prefixed `handle*` (`handleSubmit`, `handleClick`).
- Add `data-testid` to anything tests target — components, list items, interactive elements.
- Include all dependencies in `useEffect` / `useCallback` / `useMemo`. Don't suppress the lint rule without a comment explaining why.

## Testing

Vitest + React Testing Library. Target test-ids (`data-testid`) rather than text/role when text is i18n'd or volatile. Mock the data layer (`vi.mock("../../data/hooks/...")`), not the API client.

## Accessibility

Maintain ARIA labels on interactive elements without visible text. Keyboard navigation for everything clickable. Focus management on dialogs/modals.
