Repeatable checklist for changing any controller, service, and related models:

- OpenAPI contract:
  Update schema files in `../openapi/specs/schemas/*.yaml` and references in `../openapi/specs/api/openapi.yaml`.
- Regenerate:
  Run `pnpm run generate:api` and confirm generated models changed as expected.
- Services:
  Update service mapping/logic so returned DTOs match generated contract types exactly.
- Controllers:
  Align controller request/response DTO usage to generated types and remove shape drift. Return raw payload DTOs; do not construct response envelopes in controllers.
- Tests and fixtures:
  Update service/controller tests and shared fixtures/mocks for the new shape.
- Apply steps:
  If DB/runtime apply commands are needed (for example Flyway `migrate`), ask the user for explicit approval before running them.
- Verify:
  Run targeted `pnpm jest ...` for touched modules, then run `pnpm tsc --noEmit`.
