# Releasing the Hey Hey CLI

This is the **manual release runbook** for the CLI. Followed start to finish, it
takes a clean checkout to a published `@hey-hey/cli` release on the npm registry.

The process is deliberately manual. Automating it in CI off a version tag is a
known follow-up — see [CI automation](#ci-automation-out-of-scope) below — but
that work is **out of scope** here. Run these steps by hand for every release.

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
`dist/index.mjs` (ESM, because Ink requires it). The tarball ships only `dist/` (see the `files` field in
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

## CI automation (out of scope)

Automating this runbook — having CI build and `npm publish` the release when a
version tag is pushed — is a deliberate follow-up and is **not** part of this
procedure. Until that automation exists, every release is cut by hand using the
steps above.
