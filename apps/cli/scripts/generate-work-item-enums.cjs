// Focused OpenAPI generation: preserve the complete canonical API surface while
// refreshing the two shared enums consumed by work-item registry validation.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveOpenapiRoot } = require('./openapi-root.cjs');
const output = path.join(process.cwd(), '.openapi-tmp', 'work-item-enums');
execFileSync(
  'pnpm',
  [
    'exec',
    'openapi-generator-cli',
    'generate',
    '-i',
    path.join(resolveOpenapiRoot(), 'specs/api/openapi.yaml'),
    '-g',
    'typescript-axios',
    '-o',
    output,
    '--additional-properties',
    'supportsES6=true,withInterfaces=true,modelPropertyNaming=camelCase,typescriptThreePlus=true,useSingleRequestParameter=true',
    '--global-property',
    'models=WorkStatus:WorkItemIconKey,supportingFiles=api.ts,apiDocs=false,modelDocs=false',
  ],
  { stdio: 'inherit' },
);
const generated = fs.readFileSync(path.join(output, 'api.ts'), 'utf8');
const target = path.join(process.cwd(), 'src/shared/api/generated/api.ts');
let canonical = fs.readFileSync(target, 'utf8');
for (const name of ['WorkStatus', 'WorkItemIconKey']) {
  const pattern = new RegExp(
    `export const ${name} = \\{[\\s\\S]*?\\} as const;\\s*export type ${name} = typeof ${name}\\[keyof typeof ${name}\\];`,
    'g',
  );
  const blocks = [...generated.matchAll(pattern)];
  if (blocks.length !== 1 || [...canonical.matchAll(pattern)].length !== 1) {
    throw new Error(`Expected exactly one generated and canonical ${name} enum block`);
  }
  canonical = canonical.replace(pattern, blocks[0][0]);
}
fs.writeFileSync(target, canonical);
