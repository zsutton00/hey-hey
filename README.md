```text
 _   _   _____  __   __      _   _   _____  __   __
| | | | | ____| \ \ / /     | | | | | ____| \ \ / /
| |_| | |  _|    \ V /      | |_| | |  _|    \ V /
|  _  | | |___    | |       |  _  | | |___    | |
|_| |_| |_____|   |_|       |_| |_| |_____|   |_|
```

Hey Hey is a shared place for you and your team to shape a project and build it together. Features, designs, mockups, decisions and tasks live in one workspace and stay connected as the project changes. Coding agents work from the same context you do.

This repository holds the core of Hey Hey in one checkout. Each part keeps its own README with the details.

## What's here

| Path | What it is |
| --- | --- |
| [`apps/ui`](apps/ui/README.md) | The web app people work in: features, documents, proposals, conversations and live agent sessions. |
| [`apps/api`](apps/api/README.md) | The one backend. It owns project data and its rules, and coordinates the other services. |
| [`apps/cli`](apps/cli/README.md) | `heyhey`, the command-line tool that connects your project to the coding agents you already use. |
| [`packages/ui-common`](packages/ui-common/README.md) | Code the web app and CLI share: components, hooks, the API client and translations. |
| [`openapi`](openapi/README.md) | The OpenAPI specifications every consumer generates its contracts from. |

The Graph and Embeddings services live in their own repositories.

## Getting started

You need Node 24 (see `.nvmrc`) and pnpm 10.18.1 (`corepack enable` picks up the pinned version).

```sh
pnpm install --frozen-lockfile   # one install for every package
pnpm generate:contracts          # validate the specs, then generate every consumer's contracts
pnpm build                       # UI, then CLI, then API
pnpm check                       # UI type-check and tests, CLI type-check and tests
```

To work on a single part, run its scripts with a filter, for example `pnpm --filter ./apps/ui dev`. The web app compiles UI Common straight from `packages/ui-common`, so edits there reload live.

## Changing the API contract

The specifications in [`openapi`](openapi/README.md) are the single source for the API's server models, the web app's and UI Common's client, and the CLI's clients. After changing a spec, run `pnpm generate:contracts` and commit the spec together with everything it regenerated.

- It validates every spec first and generates nothing if validation fails.
- Each consumer still uses its own generator version and options, so outputs that look alike are not merged.
- If one consumer fails to generate, the others still finish and the failed one keeps its previous files.
- It records which spec content was used in `generated-contracts.json`. `pnpm build` and `pnpm check` refuse to run if the generated files don't match the current specs or a consumer's last generation failed.
- `pnpm generate:check` regenerates and fails if any committed generated file would change. CI runs it on every push.

By default every command uses the `openapi` folder of the checkout you're in, including linked worktrees. To generate from a different copy, set `HEY_HEY_OPENAPI_ROOT` to its `openapi` folder. If that path is wrong, generation stops instead of quietly using another copy.

### Graph and Embeddings

Graph and Embeddings generate their own models from these specs in their own repositories, so a spec change here doesn't reach them until they move to the new revision. They pin a revision of this repository and point their existing setting at its `openapi` folder:

| Service | How to point it at the specs |
| --- | --- |
| Graph | `HEY_HEY_OPENAPI_ROOT=<checkout>/openapi`, or Maven `-Dopenapi.root=<checkout>/openapi` |
| Embeddings | `HEY_HEY_OPENAPI_ROOT=<checkout>/openapi`, or `make OPENAPI_ROOT=<checkout>/openapi` |

To pin, check out an exact commit of this repository, not a branch. To confirm what they generated from, run this against that checkout:

```sh
HEY_HEY_OPENAPI_ROOT=<checkout>/openapi node <checkout>/scripts/openapi-source.cjs --identity
```

It prints the commit, whether the specs have uncommitted edits, and a digest of the spec content. If the specs match a commit here, the digest equals `source.closureDigest` in that commit's `generated-contracts.json`. `pnpm openapi:identity` prints the same thing for your own checkout.

## Images

The web app and the API ship as two separate images, `ui-service` and `api-service`. Both build from the repository root:

```sh
docker build -f apps/ui/Dockerfile -t hey-hey-ui:local .
docker build -f apps/api/Dockerfile -t hey-hey-api:local .
```

An image build stops before compiling if the committed generated files don't match the specs, the same check `pnpm build` runs. The root `.dockerignore` keeps dependencies, build output, local state and secrets out of both images.

On every pull request and push, CI works out what a change affects and runs only those checks and image builds:

- A change inside one app selects that app.
- A UI Common change also selects every package that depends on it: the web app, and the CLI for as long as it still uses UI Common.
- A spec change, or a change to root workspace, lockfile or build files, selects everything.
- Documentation alone selects nothing.

Run `node scripts/affected-builds.mjs -- <changed files>` to see the selection for any set of paths. Each built image's evidence (source commit, intended image name and digests of its inputs) is attached to the CI run. CI never pushes, releases or deploys. Publishing an image or changing what a deployment runs is a separately reviewed step.

## Dependencies

All packages share one `pnpm-lock.yaml` and one `pnpm-workspace.yaml`. Each package still declares its own dependencies. The workspace file holds the shared rules:

- New package versions are held back for three days before they can be installed.
- Only packages listed there may run install-time native builds.
- React is pinned to a single version so the web app, UI Common and the editor share one copy.

Change a dependency in the package that uses it, then run `pnpm install` at the root. Don't delete and regenerate the lockfile: that silently upgrades everything.
