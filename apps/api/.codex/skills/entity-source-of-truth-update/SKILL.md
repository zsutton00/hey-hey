---
name: entity-source-of-truth-update
description: Change an entity end-to-end across Prisma, OpenAPI, generated models, NestJS services/controllers, and tests in this repository. Use when adding/removing entity fields, changing entity types, or updating entity behavior and you must keep DB schema, API contract, generated types, and runtime mappings aligned.
---

# Entity Source Of Truth Update

## Invariant

Keep one entity contract flow: Prisma schema and DB shape -> OpenAPI schema -> generated models -> service/controller mappings -> tests and fixtures. Fail fast on missing required fields and fix upstream callers instead of adding fallback defaults.

## Workflow

1. State root cause before edits:
   Name the invariant that must hold, what breaks it, and which caller owns each required field.
2. Audit call sites before code changes:
   Find service mappers, controller responses, request builders, fixtures, and tests that touch the changed entity fields.
3. Update DB and Prisma first when persistence shape changes:
   Edit `prisma/schema.prisma`, keep DB naming in lower snake_case, and map Prisma names with `@map`/`@@map` (including enums when DB enum type names are snake_case). Run `pnpm db:generate`. When a migration is required, add a new Flyway SQL migration in `db/flyway/`.
4. Update OpenAPI contract:
   Edit `../openapi/specs/schemas/<entity>.yaml` and related references in `../openapi/specs/api/openapi.yaml`.
5. Regenerate API models:
   Run `pnpm run generate:api`.
6. Verify generated output:
   Confirm `src/generated/model/*.ts` and `src/generated/model/models.ts` reflect the contract change and do not hand-edit generated files.
7. Update implementation:
   Adjust service logic and controller request/response usage so payloads match generated types exactly.
8. Update tests and fixtures:
   Update mocks/fixtures and add regression coverage for changed behavior.
9. Verify end-to-end:
   Run targeted Jest suites for touched modules and always run `pnpm tsc --noEmit`.

## Hard Rules

- Keep generated/OpenAPI/Prisma shapes aligned; treat drift as an integration failure.
- Database identifiers are lower snake_case. Prisma camel/Pascal names must map explicitly via `@map`/`@@map`.
- Do not widen generated DTOs or add stricter local constraints unless OpenAPI changes first.
- Do not invent placeholder defaults for required fields.
- Do not hand-edit `src/generated`.

## Quick Commands

- Find impacted files:
  `rg -n "<EntityName>|<fieldName>|Controller|Service" src prisma ../openapi/specs`
- Prisma client generation:
  `pnpm db:generate`
- Migration authoring (when needed):
  `db/flyway/V<timestamp>__<description>.sql`
- Migration validation:
  `pnpm db:flyway:validate`
- API model generation:
  `pnpm run generate:api`
- Targeted tests:
  `pnpm jest src/services/<entity> src/controllers/<entity>`
- Final typecheck:
  `pnpm tsc --noEmit`

## Reference

Use `references/checklist.md` for the compact repeatable checklist.
