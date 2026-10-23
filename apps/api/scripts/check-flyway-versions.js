#!/usr/bin/env node

const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');

function findDuplicateVersions(filenames) {
  const byVersion = new Map();
  for (const filename of filenames) {
    const match = /^([VB])(\d+(?:[._]\d+)*)__.+\.sql$/.exec(filename);
    if (!match) continue;
    const parts = match[2].split(/[._]/).map((part) => BigInt(part).toString());
    while (parts.length > 1 && parts.at(-1) === '0') parts.pop();
    // Baseline and versioned migrations may legitimately share a version.
    const key = `${match[1]}${parts.join('.')}`;
    const files = byVersion.get(key) ?? [];
    files.push(filename);
    byVersion.set(key, files);
  }
  return [...byVersion.values()].filter((files) => files.length > 1);
}

if (require.main === module) {
  const directory = process.argv[2] ?? resolve(__dirname, '../db/flyway');
  const duplicates = findDuplicateVersions(readdirSync(directory));
  if (duplicates.length) {
    console.error(
      'Duplicate Flyway migration versions:\n' +
        duplicates.map((files) => files.join('\n')).join('\n\n'),
    );
    process.exitCode = 1;
  }
}

module.exports = { findDuplicateVersions };
