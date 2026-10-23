// Typed bridge to the combined checkout's single OpenAPI source resolver.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const openapiSource = require('../../../../scripts/openapi-source.cjs') as {
  resolveOpenapiRoot: () => string;
};

export const resolveOpenapiRoot = (): string =>
  openapiSource.resolveOpenapiRoot();
