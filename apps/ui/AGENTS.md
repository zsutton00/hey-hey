# Repository Guidelines

## Revert Semantics
- “Revert” means revert only the files changed during the current session. Preserve all pre-existing and unrelated user changes, including untracked files and assets. Before deleting or overwriting anything, identify the current session’s touched files and ask if the scope is unclear.

## Project Structure & Module Organization
- `src/` holds all runtime code. Feature areas live under `components/`, `pages/`, `hooks/`, `contexts/`, `utils/`, and `services/`; share types in `types/`. Keep mock data and example flows under `examples/` and `data/`.
- Tests sit next to the code (`*.test.tsx`) or in `src/__tests__/` for cross-cutting scenarios. UI assets land in `src/assets/`.
- API types and clients are provided by the linked `@hey-hey/ui-common` package; import them from `@hey-hey/ui-common/api` and `@hey-hey/ui-common/clients`.
- `public/` contains static files and the MSW worker. `docs/` aggregates deep-dive notes referenced by agents. Build artifacts land in `dist/` and should stay untracked. Workflow helpers live in `scripts/`.

## Build, Test, and Development Commands
Use `pnpm` (lockfile is authoritative).
- `pnpm install` – install dependencies.
- `pnpm dev` – start Vite with HMR at `localhost:5173`.
- `pnpm build` – run the TypeScript project references check then emit the production bundle.
- `pnpm preview` – serve the built bundle locally.
- `pnpm lint` / `pnpm lint:fix` – run ESLint with the repo configuration.
- `pnpm type-check` – invoke `tsc -b` for project references.
- `pnpm test`, `pnpm test:run`, `pnpm test:ui` – run Vitest in watch, CI, or interactive UI mode.
- `pnpm generate:i18n-keys` – refresh generated i18n sources; review diff before committing.

## Coding Style & Naming Conventions
- TypeScript + React 19 with functional components only. Favor named exports for reusable pieces.
- Follow ESLint defaults: double quotes, semicolons, 2-space indentation, and underscores for intentionally unused identifiers.
- Keep exactly one React component per `.tsx` file.
- Prefer extracting complicated component logic into custom hooks; when a hook becomes sufficiently complex, place it in its own file.
- Component files are PascalCase (`ProjectDebugView.tsx`); hooks start with `use`, context providers end in `Provider`. Keep route components under `pages/` and shared UI under `components/`.

## Testing Guidelines
- Vitest with `@testing-library/react` drives unit and interaction tests; use `@testing-library/user-event` for realistic flows.
- Mirror the module name: `Component.test.tsx` beside the component or in `src/__tests__` for broader scenarios.
- Mock APIs through MSW handlers when tests touch network logic; avoid coupling to real services.
- Run `pnpm test:run` before opening a PR; add high-value assertions around authentication, routing guards, and query caching.

## TypeScript Error Policy
- After every code change, run `pnpm type-check` before handing off work.
- This repo currently has existing TypeScript errors; treat them as baseline and do not introduce new errors.
- Compare the latest `pnpm type-check` output against the baseline and ensure any added/changed files do not create additional TypeScript diagnostics.

## UI Common Dependency Resolution

- **Treat local UI Common changes as live.** The UI receives updates from the local `@hey-hey/ui-common` dependency immediately. Never infer that UI Common is stale, out of date, or unavailable by inspecting pnpm's internal `node_modules/.pnpm` package copy, package hash, cached artifact contents, or the absence of a newly added symbol there. Do not recommend reinstalling or refreshing the dependency on that basis. Verify the UI's actual module resolution, build behavior, or running behavior instead.

## Commit & Pull Request Guidelines
- Prefer imperative, scoped subjects: `feat: add initiative timeline` or `fix: reset auth tokens`. Avoid placeholders like `wip` and squash trivial noise before pushing.
- Each PR should describe the change, outline validation steps, and call out docs or feature flags touched. Link Linear/Jira issues when applicable and attach UI screenshots or short Looms for visual updates.
- Ensure lint, type-check, and `pnpm test:run` pass before requesting review. Include new docs in `docs/` when workflows change.

## Formatting

After editing files, run `pnpm exec prettier --write <changed files>` before finishing. Claude Code does this automatically via a `PostToolUse` hook in `.claude/settings.json`; Codex has no equivalent configured here, so do it by hand.
