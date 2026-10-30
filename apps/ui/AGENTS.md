# UI

React 19 + MUI + Vite SPA. API types and clients come from `@hey-hey/ui-common`. MUI, hook and `data-testid` conventions live in `packages/ui-common/AGENTS.md`.

- One component per `.tsx` file. Move complex logic into hooks, in their own file once they grow. Event handlers are named `handle*`.
- **Data layer:** components never call the generated API client directly. Read through hooks in `src/data/hooks/`; mutations and cross-cutting state go through collections in `src/data/collections/`.
- **i18n:** all user-facing strings go through `useTranslation()` with hierarchical keys. Run `pnpm generate:i18n-keys` after changing translations and review the diff.
- **URL state:** filters, pagination, selected tab, sort and view mode live in the URL via `nuqs`, not `useState`. Keep `useState` for pre-submit form input, modal state and transient UI.
- **Navigation:** navigable elements are real `<a href>`s so cmd-click and copy-link work. Intercept plain left-clicks for SPA routing (see `pathService` for hrefs).
- **Tests:** mock the data layer (`vi.mock("../../data/hooks/...")`) and use MSW for network, never the API client. Prefer `data-testid` over text when copy is i18n'd or volatile.
- Local `@hey-hey/ui-common` changes are live. Never conclude it is stale from pnpm's internal `node_modules/.pnpm` copy; verify actual module resolution or behavior instead.
