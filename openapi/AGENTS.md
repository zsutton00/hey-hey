Task note: downstream repositories use linked Git worktrees; their OpenAPI generation must prefer the matching `openapi/.worktrees/<worktree>` checkout and fall back to this main checkout, with an explicit root override used only when intentionally pinning a source.

## Workflow Rules

- After every change to this repo, run `npx @apidevtools/swagger-cli validate specs/api/openapi.yaml` and ensure it passes. Do not skip this validation step.***

## OpenAPI Generation Metadata

- Every operation in `specs/api/openapi.yaml` must have one declared, generator-safe tag and a unique explicit `operationId`. Run `npm run check-operation-metadata` after changing operation metadata.
- Use OpenAPI Generator filters for focused work. Filter API clients with `--global-property=apis=TagA,TagB` and filter model-only generation with `--global-property=models=ModelA,ModelB`. The API filter values are the operation tags; model filters must include every referenced/transitive model needed by the consumer.
- Keep filters scoped to the generated artifact being worked on. Do not replace a canonical full client or model set with a filtered set unless all of its imports and consumers are covered.
- In a linked worktree, generation must resolve the matching `openapi/.worktrees/<worktree>` checkout first and fall back to this main checkout. Use `HEY_HEY_OPENAPI_ROOT` only when intentionally pinning a source.
