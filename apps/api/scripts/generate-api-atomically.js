#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fingerprintDirectory } = require('./openapi-generation-cache');
const { resolveOpenapiRoot } = require('./openapi-root');

const projectRoot = path.resolve(__dirname, '..');
const liveGeneratedRoot = path.join(projectRoot, 'src', 'generated');
const temporaryRoot = path.join(
  projectRoot,
  '.tmp',
  `api-generation-${process.pid}`,
);
const stagedGeneratedRoot = path.join(temporaryRoot, 'generated');
const prettierIgnorePath = path.join(temporaryRoot, '.prettierignore');
const backupGeneratedRoot = path.join(
  projectRoot,
  '.tmp',
  `api-generation-backup-${process.pid}`,
);
const environment = {
  ...process.env,
  HEY_HEY_GENERATED_ROOT: stagedGeneratedRoot,
};
const executable = (name) =>
  path.join(projectRoot, 'node_modules', '.bin', name);

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with status ${result.status ?? 1}.`,
    );
  }
};

const cleanup = () => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
};

try {
  fs.mkdirSync(temporaryRoot, { recursive: true });
  fs.writeFileSync(prettierIgnorePath, '');
  if (fs.existsSync(liveGeneratedRoot)) {
    fs.cpSync(liveGeneratedRoot, stagedGeneratedRoot, { recursive: true });
  } else {
    fs.mkdirSync(stagedGeneratedRoot, { recursive: true });
  }

  run(process.execPath, [
    'scripts/generate-openapi-models.js',
    'api-models',
    'api',
    '--cache',
  ]);
  run(process.execPath, ['scripts/generate-task-monitor-schema.js']);
  run(process.execPath, ['scripts/generate-activity-history-contract.js']);
  run(process.execPath, ['scripts/generate-project-report-schemas.js']);
  run(process.execPath, ['scripts/generate-goal-pm-decision-schema.js']);
  run(process.execPath, ['scripts/generate-project-mode-schema.js']);
  run(process.execPath, ['scripts/generate-feature-requirements-schema.js']);
  run(process.execPath, ['scripts/generate-future-revision-schema.js']);
  run(process.execPath, ['scripts/generate-private-beta-access-schema.js']);
  run(process.execPath, ['scripts/generate-demo-sandbox-schema.js']);
  run(process.execPath, ['scripts/generate-open-items-schemas.js']);
  run(process.execPath, ['scripts/generate-proposal-reconciliation-schema.js']);
  run(process.execPath, ['scripts/generate-workflow-review-schemas.js']);
  run(process.execPath, ['scripts/generate-diagram-schemas.js']);
  run(process.execPath, [
    'scripts/generate-entity-prompt-template-language.js',
  ]);
  run(process.execPath, [
    path.join(
      resolveOpenapiRoot(),
      'scripts/generate-controller-action-contract.js',
    ),
    path.join(stagedGeneratedRoot, 'controller-action-contract.ts'),
    './model/models',
  ]);
  run(executable('prettier'), [
    '--write',
    '--ignore-path',
    prettierIgnorePath,
    path.join(stagedGeneratedRoot, 'workflow-review.schemas.ts'),
    path.join(stagedGeneratedRoot, 'diagram.schemas.ts'),
    path.join(stagedGeneratedRoot, 'entity-prompt-template-language.ts'),
    path.join(stagedGeneratedRoot, 'controller-action-contract.ts'),
  ]);
  run(process.execPath, ['scripts/post-process-message-events.js']);
  run(process.execPath, ['scripts/generate-models-barrel.js']);
  run(executable('ts-node'), ['scripts/post-process-generated-types.ts']);
  run(process.execPath, [
    path.join(
      resolveOpenapiRoot(),
      'scripts/postprocess-project-report-models.js',
    ),
    path.join(stagedGeneratedRoot, 'model'),
  ]);
  run(process.execPath, ['scripts/generate-path-constants.js']);
  run(process.execPath, [
    'scripts/finalize-openapi-generation-cache.js',
    'api-models',
    'api',
  ]);

  if (
    fingerprintDirectory(liveGeneratedRoot) ===
    fingerprintDirectory(stagedGeneratedRoot)
  ) {
    console.log('Generated API output is unchanged; skipping promotion.');
    cleanup();
    process.exit(0);
  }

  fs.rmSync(backupGeneratedRoot, { recursive: true, force: true });
  if (fs.existsSync(liveGeneratedRoot)) {
    fs.renameSync(liveGeneratedRoot, backupGeneratedRoot);
  }
  try {
    fs.renameSync(stagedGeneratedRoot, liveGeneratedRoot);
  } catch (error) {
    if (fs.existsSync(backupGeneratedRoot)) {
      fs.renameSync(backupGeneratedRoot, liveGeneratedRoot);
    }
    throw error;
  }
  fs.rmSync(backupGeneratedRoot, { recursive: true, force: true });
  cleanup();
  console.log('Promoted generated API output.');
} catch (error) {
  cleanup();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
