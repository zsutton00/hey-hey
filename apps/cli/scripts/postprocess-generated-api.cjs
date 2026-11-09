#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { resolveOpenapiRoot } = require('../../../scripts/openapi-source.cjs');

const directory = path.resolve(process.argv[2] ?? 'src/shared/agent-bridge-contract/generated');
const files = [];

const visit = (current) => {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const file = path.join(current, entry.name);
    if (entry.isDirectory()) {
      visit(file);
    } else if (entry.isFile() && file.endsWith('.ts')) {
      files.push(file);
    }
  }
};

visit(directory);
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  let content = original;
  if (!content.includes('@ts-nocheck')) {
    content = `// @ts-nocheck\n${content}`;
  }
  content = content.replace(
    /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g,
    (_match, prefix, modulePath, suffix) =>
      `${prefix}${modulePath.endsWith('.js') ? modulePath : `${modulePath}.js`}${suffix}`,
  );
  content = content.replace(/\bSet</g, 'Array<');
  content = content.replace(
    /'knownControllerCredentialIds': Set<string>;/g,
    "'knownControllerCredentialIds': Array<string>;",
  );
  content = content.replace(
    /'revokedControllerCredentialIds': Set<string>;/g,
    "'revokedControllerCredentialIds': Array<string>;",
  );
  content = `${content
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '')}\n`;
  if (content !== original) fs.writeFileSync(file, content);
}

const modelsDirectory = path.join(directory, 'models');
const reportTarget = fs.existsSync(modelsDirectory)
  ? modelsDirectory
  : path.join(directory, 'api.ts');
execFileSync(
  process.execPath,
  [
    path.join(resolveOpenapiRoot(), 'scripts/postprocess-project-report-models.js'),
    reportTarget,
  ],
  { stdio: 'inherit' },
);
