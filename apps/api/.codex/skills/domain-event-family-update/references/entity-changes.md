## Entity change checklist

Use this checklist for repeatable entity changes (field adds/removals, type changes, behavior changes) across source-of-truth layers.

1) DB and Prisma
- Update `prisma/schema.prisma` for the entity or model.
- Keep DB identifiers in lower snake_case and map Prisma names with `@map`/`@@map` (including enum type mapping when DB enum names are snake_case).
- Run `pnpm db:generate`.
- If schema change requires migration, add a new forward-only Flyway SQL migration under `db/flyway/` and run Flyway validate/migrate flow.

2) OpenAPI contract
- Update entity schema in `../openapi/specs/schemas/<entity>.yaml`.
- Update route or component references in `../openapi/specs/api/openapi.yaml` when needed.
- Regenerate API models and clients with `pnpm run generate:api`.

3) Generated models
- Verify generated files in `src/generated/model/*.ts` and `src/generated/model/models.ts` reflect the contract change.
- Do not hand-edit generated files.

4) Services
- Update mapping and logic in relevant service files (for example, `src/services/<entity>/<entity>.service.ts`) so returned payloads match generated contract types.

5) Controllers
- Update request and response typing in controller files (for example, `src/controllers/<entity>.controller.ts`) to align with generated models.

6) Tests and fixtures
- Update fixtures, mocks, and tests impacted by entity shape changes (for example, `src/utils/testUtils.ts`, service tests, controller tests).
- Add regression coverage for behavior changes.

7) Regenerate and verify
- After OpenAPI edits, rerun `pnpm run generate:api`.
- After Prisma edits, ensure Flyway migrations are authored and applied.
- Run targeted tests (`pnpm jest ...`) and final typecheck (`pnpm tsc --noEmit`).
