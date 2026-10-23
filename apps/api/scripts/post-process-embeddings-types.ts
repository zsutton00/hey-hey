#!/usr/bin/env ts-node

/**
 * Post-processing script for generated embeddings OpenAPI types
 * This script adds TypeScript ignore pragmas for generated file warnings
 * and ensures proper exports for embeddings types
 */

import * as fs from 'fs';
import * as path from 'path';

const EMBEDDINGS_GENERATED_DIR = path.join(
  __dirname,
  '../src/generated/embeddings',
);

console.log('🔧 Post-processing embeddings types...');

function processEmbeddingsFile(filePath: string): {
  modified: boolean;
  replacements: number;
} {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;
  let replacements = 0;

  const fileName = path.basename(filePath, '.ts');

  // OpenAPI uniqueItems is a JSON array constraint, not a JavaScript Set.
  if (fileName === 'futureRevisionUpdate') {
    const updated = content.replace(/Set<([^>]+)>/g, 'Array<$1>');
    if (updated !== content) {
      content = updated;
      modified = true;
      replacements++;
    }
  }

  // Special handling for api.module.ts
  if (fileName === 'api.module') {
    // Remove unused HttpService import
    const originalImport = content.match(
      /import\s*\{\s*([^}]*)\s*\}\s*from\s*['"]@nestjs\/axios['"];?/,
    );
    if (originalImport?.[1]) {
      const importList = originalImport[1]
        .split(',')
        .map((item) => item.trim());
      const filteredImports = importList.filter(
        (item) => item !== 'HttpService',
      );

      if (filteredImports.length !== importList.length) {
        const newImportStatement = `import { ${filteredImports.join(', ')} } from '@nestjs/axios';`;
        content = content.replace(originalImport[0], newImportStatement);
        modified = true;
      }
    }

    // Remove HttpService from constructor parameter
    const constructorMatch = content.match(
      /constructor\(\s*([^)]*)\s*\)\s*\{\s*\}/,
    );
    if (constructorMatch?.[1] && constructorMatch[1].includes('HttpService')) {
      const newConstructor = 'constructor() {}';
      content = content.replace(constructorMatch[0], newConstructor);
      modified = true;
    }

    // Add pragmas at the very top if not already present
    if (
      !content.includes(
        '/* eslint-disable @typescript-eslint/no-unused-vars */',
      )
    ) {
      content =
        '/* eslint-disable @typescript-eslint/no-unused-vars */\n' + content;
      modified = true;
    }

    // Remove any duplicate pragmas that might be in the middle of the file
    content = content.replace(
      /\/\*\s*eslint-disable[^*]*\*\/\s*\n?\/\/\s*@ts-nocheck\s*\n?(?!import)/g,
      '',
    );

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
    return { modified, replacements };
  }

  // Add TypeScript ignore pragma at the top of generated files to suppress unused import warnings
  if (!content.includes('/* eslint-disable */')) {
    // Add ignore pragma after any existing comment block
    const commentBlockEnd = content.indexOf('*/');
    if (commentBlockEnd !== -1) {
      // Insert after the comment block
      const beforeComment = content.substring(0, commentBlockEnd + 2);
      const afterComment = content.substring(commentBlockEnd + 2);
      content =
        beforeComment +
        '\n/* eslint-disable @typescript-eslint/no-unused-vars */\n' +
        afterComment;
    } else {
      // No comment block found, insert at the beginning
      content =
        '/* eslint-disable @typescript-eslint/no-unused-vars */\n' + content;
    }
    modified = true;
  }

  // Specific fixes for embeddings types
  if (fileName === 'embeddingResponse') {
    // Ensure EmbeddingResponse has the expected structure
    // Add embeddingId and id properties if missing
    if (!content.includes('embeddingId') && content.includes('embedding_id')) {
      content = content.replace(
        /(\s+embedding_id:\s*string;)/,
        '$1\n    embeddingId: string;',
      );
      modified = true;
      replacements++;
    }

    if (!content.includes('    id:') && content.includes('embedding_id')) {
      content = content.replace(
        /(\s+embedding_id:\s*string;)/,
        '$1\n    id: string;',
      );
      modified = true;
      replacements++;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  return { modified, replacements };
}

function processEmbeddingsDirectory(dirPath: string): {
  filesProcessed: number;
  totalReplacements: number;
} {
  let filesProcessed = 0;
  let totalReplacements = 0;

  if (!fs.existsSync(dirPath)) {
    console.log(`Directory ${dirPath} does not exist. Skipping.`);
    return { filesProcessed, totalReplacements };
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Recursively process subdirectories
      const subResult = processEmbeddingsDirectory(fullPath);
      filesProcessed += subResult.filesProcessed;
      totalReplacements += subResult.totalReplacements;
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      // Process TypeScript files
      const result = processEmbeddingsFile(fullPath);
      if (result.modified) {
        console.log(
          `✓ Processed ${entry.name} (${result.replacements} replacements)`,
        );
      }
      filesProcessed++;
      totalReplacements += result.replacements;
    }
  }

  return { filesProcessed, totalReplacements };
}

// Main execution
if (!fs.existsSync(EMBEDDINGS_GENERATED_DIR)) {
  console.log(
    '❌ Embeddings generated directory not found. Make sure to run embeddings generation first.',
  );
  process.exit(1);
}

const result = processEmbeddingsDirectory(EMBEDDINGS_GENERATED_DIR);

console.log('✅ Post-processing completed successfully');
console.log(`📁 Processed ${result.filesProcessed} files`);
console.log(`🔄 Made ${result.totalReplacements} type replacements`);
console.log(
  '🚫 Added TypeScript ignore pragmas to suppress unused import warnings',
);
