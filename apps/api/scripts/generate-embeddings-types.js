#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { resolveOpenapiRoot } = require('./openapi-root');

// Path to the embeddings OpenAPI spec
const embeddingsSpecPath = path.join(
  resolveOpenapiRoot(),
  'specs/embeddings/openapi.yaml',
);

// Check if the embeddings OpenAPI spec exists
if (!fs.existsSync(embeddingsSpecPath)) {
  console.error('❌ Embeddings OpenAPI spec not found at:', embeddingsSpecPath);
  console.error('Make sure the openapi project is in the expected location');
  process.exit(1);
}

// Output directory for embeddings types
const outputDir = path.join(__dirname, '../src/generated/embeddings');

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

console.log('🔧 Generating embeddings types from:', embeddingsSpecPath);

try {
  // Generate TypeScript types for embeddings API
  const generateCommand = [
    'openapi-generator-cli generate',
    `-i "${embeddingsSpecPath}"`,
    '-g typescript-nestjs',
    `-o "${outputDir}"`,
    '--additional-properties=npmName=@hey-hey/embeddings,npmVersion=1.0.0,supportsES6=true,interfaceOnly=true,useObjectParameters=true',
  ].join(' ');

  console.log('Running:', generateCommand);
  execSync(generateCommand, { stdio: 'inherit' });

  // Post-process the generated types if needed
    // Check if post-processing script exists
    const postProcessScript = path.join(
      __dirname,
      'post-process-embeddings-types.ts',
    );
    if (fs.existsSync(postProcessScript)) {
      console.log('🔧 Post-processing embeddings types...');
      execFileSync(
        process.execPath,
        ['-r', 'ts-node/register/transpile-only', postProcessScript],
        { stdio: 'inherit' },
      );
    }

  console.log('✅ Embeddings types generated successfully at:', outputDir);
} catch (error) {
  console.error('❌ Failed to generate embeddings types:', error.message);
  process.exit(1);
}
