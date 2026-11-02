const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(packageRoot, '../..');
const { resolveOpenapiRoot } = require('../../../scripts/openapi-source.cjs');
const generatedApiRoot = path.join(packageRoot, 'src/shared/api/generated');

if (process.env.HEY_HEY_OPENAPI_STAGING !== '1') {
  throw new Error('Custom contract generation must run through the contracts coordinator.');
}

const run = (command, args, cwd = packageRoot) => {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 1}.`);
  }
};

fs.rmSync(generatedApiRoot, { recursive: true, force: true });
fs.mkdirSync(generatedApiRoot, { recursive: true });
for (const obsoleteSchema of [
  'src/generated/task-monitor-contract.schema.ts',
  'src/generated/project-mode-contract.schema.ts',
]) {
  fs.rmSync(path.join(packageRoot, obsoleteSchema), { force: true });
}
for (const duplicateTransport of [
  'src/shared/agent-bridge-contract/generated',
  'src/shared/local-agent-api/generated',
]) {
  fs.rmSync(path.join(packageRoot, duplicateTransport), {
    recursive: true,
    force: true,
  });
}

const openapiScripts = path.join(resolveOpenapiRoot(), 'scripts');
const runOpenapiScript = (name, ...args) =>
  run(process.execPath, [path.join(openapiScripts, name), ...args]);

run(process.execPath, [
  path.join(repositoryRoot, 'apps/api/scripts/generate-workflow-review-schemas.js'),
  'src/generated/coding-plan.schemas.ts',
]);
run(process.execPath, ['scripts/generate-entity-prompt-template-language.cjs']);
run(process.execPath, ['scripts/generate-report-error-schemas.cjs']);
runOpenapiScript(
  'generate-controller-action-contract.js',
  'src/shared/api/generated/controller-action-contract.ts',
  '@hey-hey/contracts/api/models',
);
run('pnpm', ['exec', 'prettier', '--write', 'src/generated', 'src/shared/api/generated']);
