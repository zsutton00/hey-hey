const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveOpenapiRoot } = require('./openapi-root');
const { resolveGeneratedRoot } = require('./generated-root');
execFileSync(process.execPath, [path.join(resolveOpenapiRoot(), 'scripts/generate-proposal-reconciliation-schema.js'),
  path.join(resolveGeneratedRoot(), 'proposal-reconciliation.schema.ts')], { stdio: 'inherit' });
