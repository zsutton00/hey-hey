#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { withModelGenerationLock } = require('./model-generation-lock');

const separatorIndex = process.argv.indexOf('--');
if (separatorIndex === -1 || separatorIndex === process.argv.length - 1) {
  throw new Error(
    'Usage: node scripts/with-model-generation-lock.js -- <command> [args...]',
  );
}

const command = process.argv[separatorIndex + 1];
const args = process.argv.slice(separatorIndex + 2);

const run = async () => {
  const exitCode = await withModelGenerationLock(
    ({ environment }) => {
      const result = spawnSync(command, args, {
        env: environment,
        stdio: 'inherit',
      });

      if (result.error) {
        throw result.error;
      }
      return result.status ?? 1;
    },
    { output: (message) => console.error(message) },
  );

  process.exitCode = exitCode;
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
