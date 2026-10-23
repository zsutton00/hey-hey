# Hey Hey CLI

Hey Hey is a shared place for you and your team to shape a project and build it together. Features, designs, mockups, decisions and tasks live in one workspace and stay connected as the project changes. Coding agents work from the same context you do.

This repository is the command-line tool, `heyhey`. It runs on your machine and connects your Hey Hey project to the coding agents you already use, such as Claude Code, so they start from the project's context instead of a blank prompt. Hey Hey keeps the plans, decisions and session history in the project.

The CLI is a Node.js and TypeScript program with a terminal interface built on Ink. It reaches Hey Hey through the API and consumes selected browser-safe source modules shared with the web app.

## Development and shared source

Run `pnpm dev` from `apps/cli` to execute the CLI source with `tsx`. Run `pnpm build` to bundle it with esbuild into `dist/index.mjs`. Neither command requires UI Common's built output or declarations.

CLI-only SDK adapters, credentials and persistent agent-session runtime live in `src/agent-runtime`. CLI code and scripts import that local runtime rather than `@hey-hey/ui-common/agents`.

Code that the UI also uses remains in `packages/ui-common/src`. The CLI imports browser-safe modules there directly by relative source path: coordination schemas and parsing, identity, the capability catalog, attachment formatting, and the shared client entrypoint (`clients/shared.ts`). Client runtime registration has one owner in UI Common's `clients/runtimeRegistry.ts`; reuse it rather than creating a CLI copy. Keep CLI machine authentication in the CLI and browser authentication in UI Common.

Do not import UI Common's package barrels, built bundles or declarations into the CLI. Shared imports must not pull in React, MUI, Jotai, browser providers or browser authentication. `src/package/source-boundary.test.ts` checks the shared import graph and package manifest. The CLI manifest has no UI Common dependency and must contain no `file:`, `link:` or `workspace:` dependencies. API contracts remain generated from OpenAPI in the consumer-specific generated directories.

`tsconfig.json` is check-only (`noEmit: true`); esbuild owns the published output layout. It intentionally has no `rootDir: "src"` because the typecheck follows shared source imports outside that directory. Use `pnpm tsc --noEmit` for checking, not `tsc` to produce a distributable. The config includes `src/`, so standalone scripts also need direct execution checks.

## The rest of Hey Hey

- **UI**: the web app.
- **UI Common**: the UI's internal components, hooks and clients, plus browser-safe source modules shared with the CLI.
- **API**: project data, business rules and the events the other services consume.
- **Graph service**: relationships between the things in a project.
- **Embeddings Service**: search by meaning across project content.
- **CLI** (this repository): connects the project to the coding agents you already use.

## Using Hey Hey

Hey Hey is hosted at [heyhey.dev](https://heyhey.dev).

## License

AGPL-3.0. Issues are welcome; we aren't accepting pull requests at this time.
