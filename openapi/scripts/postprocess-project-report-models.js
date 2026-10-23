#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// OpenAPI uniqueItems describes JSON arrays. Axios neither serializes nor hydrates Sets.
// Keep this correction scoped to the new project-report interfaces; uniqueness stays in OpenAPI.
const target = process.argv[2];
if (!target) throw new Error('Usage: postprocess-project-report-models.js <generated file or model directory>');
const files = fs.statSync(target).isDirectory()
  ? fs.readdirSync(target).filter(name => name.endsWith('.ts')).map(name => path.join(target, name))
  : [target];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const output = source.replace(
    /export interface ((?:Create|Retry)?ProjectReport\w*)\s*\{[\s\S]*?\n\}/g,
    (declaration) => declaration.replace(/\bSet</g, 'Array<'),
  );
  if (output !== source) fs.writeFileSync(file, output);
}
