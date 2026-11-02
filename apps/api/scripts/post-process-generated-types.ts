import * as fs from 'node:fs';
import * as path from 'node:path';
const { resolveGeneratedRoot } = require('./generated-root');

const generatedRoot = resolveGeneratedRoot();
const indexPath = path.join(generatedRoot, 'index.ts');
const content = [
  '/* eslint-disable @typescript-eslint/no-unused-vars */',
  "export * from '@hey-hey/contracts/api/models';",
  '',
].join('\n');

fs.mkdirSync(path.dirname(indexPath), { recursive: true });
const temporaryPath = `${indexPath}.${process.pid}.tmp`;
fs.writeFileSync(temporaryPath, content, 'utf8');
fs.renameSync(temporaryPath, indexPath);
