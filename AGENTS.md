# Hey Hey

pnpm monorepo: `apps/api`, `apps/cli`, `apps/ui`, `packages/ui-common`, and the `openapi` source of truth. Cross-project rules (cleanliness, commits, git safety) live in `~/CLAUDE.md`. Package-specific rules live in each package's `AGENTS.md`.

This file is pruned periodically. Add a rule only when its absence has demonstrably cost us.

## Commands

- `pnpm bootstrap` installs; `pnpm generate:contracts` regenerates from OpenAPI; `pnpm check` is the repo-wide gate.
- Run a package's own `type-check`/`test` scripts while iterating; run `pnpm check` before calling a change done.
- Checks are evidence, not a work queue. A failure outside your change is reported, not fixed.
- If asked only to commit, commit without running checks.
- In a linked worktree, OpenAPI generation resolves the matching `openapi/.worktrees/<worktree>` first, then the main checkout. Set `HEY_HEY_OPENAPI_ROOT` only to pin a source deliberately.
- After editing, run `pnpm exec prettier --write <changed files>`. Claude Code does this via a hook; other agents do it by hand. Pass file paths, never a directory: formatting a directory rewrites unrelated files.

## Command cost

Some commands are slow enough to dominate a task. Budget for them.

- `pnpm generate:contracts` takes about five minutes. Finish every OpenAPI edit first, then run it once. `pnpm check` and `pnpm type-check` also take the generation lock and rebuild contracts.
- Run `pnpm check` once, at the end. While iterating, run only the focused tests for the files you changed, one package at a time. The full UI and CLI suites together can be killed for memory (exit 137).
- Run `ui`, `ui-common` and `cli` Vitest with `NODE_ENV=test`. The shell default of `production` fails every React test with "jsxDEV is not a function" and wastes a full run.
- Run any command expected to exceed two minutes in the background and watch its log. Do not start a second copy while one runs.

## Contracts come from OpenAPI

- Edit `openapi/specs`, then regenerate. Never hand-write request/response types, clients, schemas, or anything under `generated/`.
- Don't re-declare a shape the spec already defines. Import the generated type.
- Use `satisfies` to check literals against generated types. Do not use `as` to silence a type error. If the type is wrong, fix the spec or the type.

## Generation benchmarks

- Compare isolated baseline and candidate checkouts whose complete generation inputs match the intended revisions. Record the OpenAPI closure and generator-input identities (specs, scripts, manifests, and tool versions); a matching OpenAPI digest alone does not make cached outputs comparable.
- Start each scenario from the same recorded source and cache state. Do not carry edits or generated outputs from one scenario into another unless that carry-over is the scenario being measured.
- Run all generation requests through the host-wide coordinator. Measure lock wait separately from useful generation time, and count expensive invocations at the generator boundary; don't trust an invocation counter unless its instrumentation is present in that checkout.
- Mark a before/after result noncomparable when inputs, tool versions, cache state, or completion differ, and identify the mismatch instead of inferring a speedup.

## Production, other users, other projects

Hey Hey is a shipped product. Other users, organizations and projects run it in production, staging and local stacks. This repo's own project and data are one sample, never the population.

- Do not design, fix or verify against this project's data alone. Anything that reads stored or API data must hold for every project's data: empty, partial, older revisions, custom types, fields we never set ourselves.
- A failure on someone else's data is a production outage we cannot see or reproduce. We find out only from their logs, so every failure must be diagnosable from the log line alone.
- Every rejection, failed start and caught error logs its specific cause (error code and safe detail) where it is handled. A bare `catch` that drops the cause is a defect. Redaction hides content, never the reason.
- Tests for anything that renders, parses, migrates or loads stored data run the real shipped artifact (published canonical templates, real migrations, captured payloads) against realistic populated data. A hand-written one-field fixture or an empty collection proves nothing.
- Before releasing a change to a shared renderer, schema or contract, exercise every shipped canonical artifact it consumes against it. A release that breaks Runs for other users is not "an edge case".

## Types

- Trust the types. Don't re-check at runtime what the compiler already guarantees: no `typeof x === "object"` ladders or property-by-property probing of typed values.
- Validate only at a real trust boundary (network, disk, user input, model output), once, at the edge, then pass typed values inward.
- If you find yourself guarding against a type, the type is wrong. Fix it at the source.
- When narrowing is genuinely needed, write one named type guard (`function isFoo(x: unknown): x is Foo`) or use a discriminated union, and reuse it. Don't inline `typeof` checks at each call site.

## Readability

- Code should show its core logic at a glance. Use braces on every `if`/`else`, blank lines between logical steps, and early returns over nesting.
- Before writing a helper, search for an existing one (shared utils, language and library features) and use it. Add a new helper only when none fits, and put it where others will find it.
- Name intermediate values instead of chaining dense expressions. Prefer a few short functions to one long one.
- Defensive plumbing (guards, fallbacks, normalization) must not bury the main path. If it dominates a function, move it to the boundary or delete it.

## Tests

- Test behavior and requirements, not the implementation. Prefer a few tests at the integration or feature level over many per-function tests.
- A test written to confirm your first draft works is a scratch check, not an asset. Keep it only if it protects a requirement worth guarding for the life of the repo.
- A small change should not touch many test files. Three is a smell, four is very suspicious, five is almost certainly wrong. Touching that many tests means they're coupled to wording or structure: fix the coupling rather than patching each one. If a change truly ripples (a utility change that breaks its controller and service tests), say why in your summary.
- When behavior genuinely changes, update the tests to assert the new requirement, don't just adjust strings until they pass.
- Don't assert on copy, log text, or incidental structure unless that text is the requirement.
- Mock at the system boundary (network, clock, filesystem), not between your own modules.
- Add a negative-path test only for untrusted input or a defined invalid case.
