const path = require('path');
const { spawnSync } = require('child_process');
const { resolveGeneratedRoot } = require('./generated-root');

const projectRoot = path.resolve(__dirname, '..');
const openapiRootResult = spawnSync(
  process.execPath,
  [path.join(__dirname, 'openapi-root.js')],
  { cwd: projectRoot, encoding: 'utf8' },
);

if (openapiRootResult.status !== 0) {
  throw new Error(
    openapiRootResult.stderr || 'Unable to resolve the OpenAPI root.',
  );
}

const openapiRoot = openapiRootResult.stdout.trim();
const result = spawnSync(
  process.execPath,
  [
    path.join(openapiRoot, 'scripts/project-mode-contract.js'),
    '--typescript-output',
    path.join(resolveGeneratedRoot(), 'project-mode-contract.schema.ts'),
  ],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    `Project MODE schema generation exited with status ${result.status ?? 1}.`,
  );
}
