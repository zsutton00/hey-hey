# Releasing the Hey Hey CLI

This is the **manual release runbook** for the CLI. Followed start to finish, it
takes a clean checkout to a published `@hey-hey/cli` release on the npm registry.

Releases are cut by the automated **Release CLI** workflow described at the end, which
publishes the pinned image set and generates `release-manifest.json`. The procedure
below documents the npm steps that workflow performs. It is not an independent path:
`prepack` runs `scripts/verify-release-manifest.ts`, so `npm publish` fails unless a
valid `release-manifest.json` for the exact package version is present.

The CLI publishes to npm as the scoped package **`@hey-hey/cli`**. The registry
plus the published `version` is the stable identifier — `npm install @hey-hey/cli`
always resolves the latest release, and any specific release is addressable as
`@hey-hey/cli@X.Y.Z`. There is no separate canonical artifact URL to maintain.

## Prerequisites

- **An authenticated npm account** with publish rights to the `@hey-hey` scope —
  `npm whoami` should report your account, and the `@hey-hey` scope must already
  be registered to it. Scope registration is a one-time setup performed outside
  this runbook.
- **A clean checkout of `main`** at the commit you intend to release, with no
  uncommitted changes.
- **The matching OpenAPI repository checkout** available at `../openapi`, or
  `HEY_HEY_OPENAPI_ROOT` set to its location. Publishing verifies that the
  committed clients and runtime schema match that checkout.

## Procedure

### 1. Bump the version

Edit `package.json` and set `version` to the new release version (semver, no
`v` prefix). Commit the bump on `main`:

```bash
git commit -am "chore: release vX.Y.Z"
```

### 2. Build the bundle

```bash
pnpm build
```

This runs the esbuild bundler (`scripts/build.mjs`), which first builds the
`ui-common` workspace package and then emits the single-file bundle to
`dist/index.mjs` (ESM, because Ink requires it). The tarball ships `dist/` and `release-manifest.json` (see the `files` field in
`package.json`), so this build must run before publishing.

### 3. Publish to npm

```bash
npm publish
```

The `prepublishOnly` lifecycle runs `pnpm generate:check` before npm creates or
uploads the package. Publishing stops if regenerating from OpenAPI changes any
committed API client or runtime schema file.

This packs `dist/` plus `package.json` and uploads it to the npm registry as
`@hey-hey/cli@X.Y.Z`. The package is scoped, so it would publish privately by
default; `publishConfig.access` is set to `public` in `package.json`, which
makes `npm publish` publish it publicly without needing `--access public` on the
command line.

The runtime dependencies (such as `@napi-rs/keyring`) are declared in
`package.json` and install alongside the package when a consumer runs
`npm install @hey-hey/cli`, so the published artifact is self-sufficient.

### 4. Verify the publish

```bash
npm view @hey-hey/cli
```

Confirm the listed `version` matches the one you just published and that
`dist-tags.latest` points at it. To verify the package contents resolve and
install cleanly, install it into a scratch directory:

```bash
npm install @hey-hey/cli
```

## Automated release (images and package together)

Releases are cut by the **Release CLI** workflow (`.github/workflows/release-cli.yml`),
run manually from a `release/**` branch after the version in `package.json` is bumped.
It is gated by the protected `release` environment and needs an `NPM_TOKEN` secret.

1. Builds API, UI and graph/search images natively for `linux/amd64` and
   `linux/arm64`, and merges each into a multi-arch list tagged with the CLI version
   under `ghcr.io/zsutton00`.
2. Pins PostgreSQL (pgvector) and Redis upstream images by digest.
3. Writes `apps/cli/release-manifest.json` (generated, never committed): the CLI version
   and the digest-pinned reference for each of the five images. Install, matching
   checks and update offers read this file; nothing resolves image tags on its own.
4. Publishes `@hey-hey/cli` to npm.
5. Verifies: every manifest image pulls anonymously on both architectures, and the
   published package installs, runs `heyhey --version` and ships the same manifest.

Each GHCR package must be set to **public** once, after its first publish, or the
anonymous pull check fails. Agents is not part of the release set.
