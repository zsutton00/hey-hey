#!/usr/bin/env node

/**
 * Post-processes generated agents OpenAPI types.
 * Creates barrel exports and stub runtime files expected by the generator.
 */

const fs = require('fs');
const path = require('path');

const AGENTS_BASE_DIR = path.join(__dirname, '../src/generated/agents');
const MODELS_DIR = path.join(AGENTS_BASE_DIR, 'models');
const HTTP_DIR = path.join(AGENTS_BASE_DIR, 'http');

if (!fs.existsSync(MODELS_DIR)) {
  console.warn('⚠️  Agents models directory does not exist. Skipping post-processing.');
  process.exit(0);
}

console.log('ℹ️  Post-processing agents OpenAPI types...');

// Generate models barrel file for easier imports
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

  const banner = `/* tslint:disable */\n/* eslint-disable */\n// Auto-generated barrel file for agents models\n`;
  fs.writeFileSync(
    path.join(MODELS_DIR, 'index.ts'),
    `${banner}\n${barrelContents}\n`,
    'utf-8',
  );

  // Also create a root index that re-exports the models barrel
  fs.writeFileSync(
    path.join(AGENTS_BASE_DIR, 'index.ts'),
    `${banner}\nexport * from './models';\n`,
    'utf-8',
  );
}

// Create stub for HttpFile import expected by generator
if (!fs.existsSync(HTTP_DIR)) {
  fs.mkdirSync(HTTP_DIR, { recursive: true });
}

const httpStubPath = path.join(HTTP_DIR, 'http.ts');
if (!fs.existsSync(httpStubPath)) {
  const httpStubContents = `/* tslint:disable */\n/* eslint-disable */\n// Auto-generated stub for OpenAPI HttpFile type\nexport type HttpFile = {\n  data: unknown;\n  name?: string;\n  mimeType?: string;\n};\n`;
  fs.writeFileSync(httpStubPath, httpStubContents, 'utf-8');
}

console.log('✅ Agents types post-processing complete.');
