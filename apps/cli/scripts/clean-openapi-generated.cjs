const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const generatedPaths = [
  '.openapi-tmp',
  'src/generated/task-monitor-contract.schema.ts',
  'src/generated/project-mode-contract.schema.ts',
  'src/shared/agent-bridge-contract/generated',
  'src/shared/api/generated',
  'src/shared/local-agent-api/generated',
];

for (const generatedPath of generatedPaths) {
  fs.rmSync(path.join(repositoryRoot, generatedPath), { force: true, recursive: true });
}
