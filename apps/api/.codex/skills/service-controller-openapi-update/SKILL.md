---
name: service-controller-openapi-update
description: Update API contract changes across OpenAPI specs, generated models, NestJS controllers, services, and tests in this repository. Use when endpoint request/response fields, params, DTO shapes, or mapping logic change and every layer must remain aligned with generated types.
---

# Service Controller OpenAPI Update

## Invariant

Keep one contract source of truth: OpenAPI spec -> generated models -> controller/service/test usage. Do not patch drift with local DTO extensions or fallback fields.
Controller methods must return raw payload DTOs only; the global `TransformInterceptor` adds the response envelope.

## Workflow

1. State root cause before edits:
   Invariant that must hold, what breaks it, and which caller provides required fields.
2. Audit call sites before code changes:
   Locate all request builders, service mappers, and controller response paths that touch the changed fields.
3. Update OpenAPI first:
   Edit schema files in `../openapi/specs/schemas/*.yaml` and route references in `../openapi/specs/api/openapi.yaml`.
4. Regenerate generated API types:
   Run `pnpm run generate:api`.
5. Update implementation:
   Adjust controller/service logic to use generated types only. Keep payloads exact and use `satisfies` when constructing typed objects. Controllers should return raw payloads, not envelope objects (`success`, `message`, `timestamp`, `statusCode`, `path`).
6. Update tests and fixtures:
   Fix controller/service tests and any shared mocks/fixtures that rely on the changed shape.
7. Ask before applying runtime changes:
   If the update also needs DB/runtime apply actions (for example Flyway `migrate`, backfills, or deploy-time scripts), pause and ask the user for explicit approval before running apply commands.
8. Verify end-to-end:
   Run focused Jest tests for touched modules, then always run `pnpm tsc --noEmit`.

## Hard Rules

- Never add stricter validation constraints than generated schemas unless OpenAPI is updated first.
- Never widen generated DTOs with intersections/casts to add keys.
- Treat cross-service shape mismatches as integration failures.
- Fail fast on missing required fields; do not invent placeholder defaults.
- Never build API envelopes inside controllers; return raw payloads and rely on the global transform interceptor.
- Always ask the user before running apply commands that mutate runtime state (for example Flyway `migrate`, data backfills, or deploy/apply scripts).

## Quick Commands

- Find impacted controller/service files:
  `rg -n "Controller|Service|<fieldName>|<endpointName>" src`
- Regenerate types:
  `pnpm run generate:api`
- Run targeted tests:
  `pnpm jest src/services/<domain> src/controllers/<domain>`
- Final typecheck:
  `pnpm tsc --noEmit`

## Reference

For the compact checklist version, see `references/checklist.md`.
