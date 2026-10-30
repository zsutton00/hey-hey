# OpenAPI

- After any spec change, run `npx @apidevtools/swagger-cli validate specs/api/openapi.yaml`.
- Every operation needs one generator-safe tag and a unique explicit `operationId`. Run `npm run check-operation-metadata` after changing operation metadata.
- Focused generation: `--global-property=apis=TagA,TagB` (operation tags) for clients, `--global-property=models=ModelA,ModelB` for models, including every transitive model the consumer needs. Never replace a complete generated client or model set with a filtered one unless all its consumers are covered.
