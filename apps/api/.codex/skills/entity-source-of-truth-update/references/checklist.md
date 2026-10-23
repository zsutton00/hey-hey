Repeatable checklist for changing any entity (fields, types, or behavior), from source-of-truth layers outward:

- DB and Prisma:
  Update `prisma/schema.prisma` for the entity/model. Keep DB identifiers in lower snake_case and map Prisma names with `@map`/`@@map` (including enum type mapping). Run `pnpm db:generate`. When schema changes require a migration, add a new forward-only Flyway SQL migration in `db/flyway/`.
- OpenAPI contract:
  Update `../openapi/specs/schemas/<entity>.yaml` and any references in `../openapi/specs/api/openapi.yaml`.
- Regenerate API types/models:
  Run `pnpm run generate:api`.
- Generated models:
  Verify `src/generated/model/*.ts` and `src/generated/model/models.ts` include the expected field/type changes. Do not hand-edit generated files.
- Services:
  Update service mapping and behavior so returned payloads match generated contract types.
- Controllers:
  Update request/response typing and mapping in controllers to align with generated models.
- Tests and fixtures:
  Update fixtures/mocks and service/controller tests for the new shape/behavior, and add regression tests for behavior changes.
- Verify:
  Run focused `pnpm jest ...` suites for touched modules, then run `pnpm tsc --noEmit`.
