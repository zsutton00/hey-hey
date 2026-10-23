#!/usr/bin/env node

/**
 * Post-processes generated local-runtime OpenAPI types.
 *
 * The local model surface is generated from
 * openapi/specs/agent-bridge/openapi.yaml so the API can import the same
 * LocalPromptType (and future shared runtime types) the paired CLI consumes,
 * keeping the Agent Bridge boundary in lockstep without changing established
 * API import paths.
 *
 * Mirrors post-process-agents-types.js: creates the barrel index files
 * and stubs the HttpFile type the typescript generator imports at runtime.
 */

const fs = require('fs');
const path = require('path');

const LOCAL_BASE_DIR = path.join(__dirname, '../src/generated/local');
const MODELS_DIR = path.join(LOCAL_BASE_DIR, 'models');
const HTTP_DIR = path.join(LOCAL_BASE_DIR, 'http');

if (!fs.existsSync(MODELS_DIR)) {
  console.warn('⚠️  Local models directory does not exist. Skipping post-processing.');
  process.exit(0);
}

console.log('ℹ️  Post-processing Agent Bridge OpenAPI types...');

const modelFiles = fs
  .readdirSync(MODELS_DIR)
  .filter((file) => file.endsWith('.ts') && file !== 'index.ts')
  .sort();

if (modelFiles.length > 0) {
  const barrelContents = modelFiles
    .map((file) => {
      const baseName = path.basename(file, '.ts');
      return `export * from './${baseName}';`;
    })
    .join('\n');

  const banner = `/* tslint:disable */\n/* eslint-disable */\n// Auto-generated barrel file for local models\n`;
  fs.writeFileSync(
    path.join(MODELS_DIR, 'index.ts'),
    `${banner}\n${barrelContents}\n`,
    'utf-8',
  );

  fs.writeFileSync(
    path.join(LOCAL_BASE_DIR, 'index.ts'),
    `${banner}\nexport * from './models';\n`,
    'utf-8',
  );
}

if (!fs.existsSync(HTTP_DIR)) {
  fs.mkdirSync(HTTP_DIR, { recursive: true });
}

const httpStubPath = path.join(HTTP_DIR, 'http.ts');
if (!fs.existsSync(httpStubPath)) {
  const httpStubContents = `/* tslint:disable */\n/* eslint-disable */\n// Auto-generated stub for OpenAPI HttpFile type\nexport type HttpFile = {\n  data: unknown;\n  name?: string;\n  mimeType?: string;\n};\n`;
  fs.writeFileSync(httpStubPath, httpStubContents, 'utf-8');
}

console.log('✅ Agent Bridge types post-processing complete.');
