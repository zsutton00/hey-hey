const fs = require('node:fs');
const path = require('node:path');

if (process.env.HEY_HEY_OPENAPI_STAGING !== '1') {
  throw new Error(
    'Generated output cleanup is only allowed in coordinator-owned staging.',
  );
}

const repositoryRoot = path.resolve(__dirname, '..');
const generatedPaths = [
  'src/generated/task-monitor-contract.schema.ts',
  'src/generated/project-mode-contract.schema.ts',
  'src/shared/agent-bridge-contract/generated',
  'src/shared/api/generated',
  'src/shared/local-agent-api/generated',
];

for (const generatedPath of generatedPaths) {
  fs.rmSync(path.join(repositoryRoot, generatedPath), { force: true, recursive: true });
}
