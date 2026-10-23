#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveOpenapiRoot } = require('./openapi-root');

const graphsSpecPath = path.join(
  resolveOpenapiRoot(),
  'specs/graphs/openapi.yaml',
);

if (!fs.existsSync(graphsSpecPath)) {
  console.error('ERROR: Graphs OpenAPI spec not found at:', graphsSpecPath);
  console.error('Make sure the openapi project is in the expected location');
  process.exit(1);
}

// The stock template serializes date-time query parameters with .toISOString(),
// but the generated signature types them as string.
const templateDir = path.join(
  __dirname,
  'openapi-templates/typescript-nestjs-graphs',
);

const outputDir = path.join(__dirname, '../src/generated/graphs');

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

console.log('Generating graphs types from:', graphsSpecPath);

try {
  const generateCommand = [
    'openapi-generator-cli generate',
    `-i "${graphsSpecPath}"`,
    '-g typescript-nestjs',
    `-t "${templateDir}"`,
    `-o "${outputDir}"`,
    '--additional-properties=npmName=@hey-hey/graphs,npmVersion=1.0.0,supportsES6=true,interfaceOnly=true,useObjectParameters=true',
  ].join(' ');

  console.log('Running:', generateCommand);
  execSync(generateCommand, { stdio: 'inherit' });

  console.log('Graphs types generated successfully at:', outputDir);
} catch (error) {
  console.error('ERROR: Failed to generate graphs types:', error.message);
  process.exit(1);
}
