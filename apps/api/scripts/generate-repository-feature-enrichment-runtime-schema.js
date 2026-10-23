#!/usr/bin/env node

const path = require('node:path');
const { resolveOpenapiRoot } = require('./openapi-root');

const openapiRoot = resolveOpenapiRoot();
const { generateRuntimeSchema } = require(
  path.join(
    openapiRoot,
    'scripts/generate-repository-feature-enrichment-runtime-schema.js',
  ),
);

generateRuntimeSchema([
  path.join(
    __dirname,
    '..',
    'src/contracts/repository-feature-enrichment-runtime-schema.ts',
  ),
]).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
