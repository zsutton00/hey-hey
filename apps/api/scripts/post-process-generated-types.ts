#!/usr/bin/env ts-node

/**
 * Post-processing script for generated OpenAPI types
 * This script replaces generic string types with branded types for better type safety
 * and adds TypeScript ignore pragmas for generated file warnings
 */

import * as fs from 'fs';
import * as path from 'path';
const { resolveGeneratedRoot } = require('./generated-root');

const GENERATED_DIR = resolveGeneratedRoot();
const GENERATED_MODEL_DIR = path.join(GENERATED_DIR, 'model');
const NON_API_GENERATED_DIRS = new Set(
  ['agents', 'api', 'embeddings', 'graphs', 'local'].map((directory) =>
    path.resolve(GENERATED_DIR, directory),
  ),
);
const WORKFLOW_SAFE_EXPORTS = [
  "export * from './model/models';",
  "export * from './variables';",
  "export * from './configuration';",
];
const GENERATION_ARTIFACTS = [path.join(GENERATED_DIR, 'api.module.ts')];

// Map of type descriptions to branded type names
const BRANDED_TYPE_MAP: Record<string, string> = {
  project: 'ProjectId',
  user: 'UserId',
  organization: 'OrganizationId',
  conversation: 'ConversationId',
  workflow: 'WorkflowId',
  message: 'MessageId',
  artifact: 'ArtifactId',
  'interaction type': 'InteractionTypeId',
  'organization member': 'OrganizationMemberId',
  request: 'RequestId',
  job: 'JobId',
  initiative: 'InitiativeId',
  task: 'TaskId',
  integration: 'IntegrationId',
  llm: 'LlmId',
  'implementation hint': 'ImplementationHintId',
  'validation session': 'ValidationSessionId',
  proposal: 'ProposalId',
};

console.log('🔧 Post-processing generated types...');

function cleanupGeneratedArtifacts() {
  for (const artifact of GENERATION_ARTIFACTS) {
    if (fs.existsSync(artifact)) {
      fs.rmSync(artifact, { recursive: true, force: true });
      console.log(
        `🧹 Removed generated artifact: ${path.relative(process.cwd(), artifact)}`,
      );
    }
  }
}

function enforceWorkflowSafeIndex() {
  const indexPath = path.join(GENERATED_DIR, 'index.ts');
  const header = '/* eslint-disable @typescript-eslint/no-unused-vars */';
  const desiredContent = `${header}\n${WORKFLOW_SAFE_EXPORTS.join('\n')}\n`;

  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, desiredContent, 'utf-8');
    console.log('✏️ Created generated/index.ts for workflow-safe exports');
    return;
  }

  const existing = fs.readFileSync(indexPath, 'utf-8');
  if (existing.trim() !== desiredContent.trim()) {
    fs.writeFileSync(indexPath, desiredContent, 'utf-8');
    console.log('✏️ Rewrote generated/index.ts to restrict exports');
  }
}

function extractBrandedType(comment: string): string | null {
  // Check if comment indicates a branded type
  if (!comment.includes('(branded type)')) {
    return null;
  }

  // Try to extract the type from the comment
  const lowerComment = comment.toLowerCase();

  // Look for patterns like "Unique identifier for a/an [type] (branded type)"
  for (const [key, brandedType] of Object.entries(BRANDED_TYPE_MAP)) {
    if (
      lowerComment.includes(`for a ${key}`) ||
      lowerComment.includes(`for an ${key}`)
    ) {
      return brandedType;
    }
  }

  // Look for patterns like "Unique [type] identifier (branded type)"
  for (const [key, brandedType] of Object.entries(BRANDED_TYPE_MAP)) {
    if (lowerComment.includes(`${key} identifier`)) {
      return brandedType;
    }
  }

  return null;
}

function processFile(filePath: string): {
  modified: boolean;
  replacements: number;
} {
  const normalizedPath = path.resolve(filePath);
  if (
    normalizedPath === path.resolve(path.join(GENERATED_DIR, 'index.ts')) ||
    normalizedPath.startsWith(path.resolve(path.join(GENERATED_DIR, 'api'))) ||
    normalizedPath.startsWith(
      path.resolve(path.join(GENERATED_DIR, 'embeddings')),
    )
  ) {
    return { modified: false, replacements: 0 };
  }

  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;
  let replacements = 0;
  const usedBrandedTypes = new Set<string>();

  // Apply branded type replacements based on specific patterns and context
  const fileName = path.basename(filePath, '.ts');

  if (
    fileName === 'futureRevisionUpdate' ||
    fileName === 'futureRevisionChange' ||
    fileName === 'futureRevisionResponse' ||
    fileName === 'machineControllerReconciliationRequestDto' ||
    fileName === 'controllerReconciliationResponseDto' ||
    fileName === 'canonicalControllerAuthorizationIntent' ||
    fileName === 'controllerDeviceGrantDescriptor' ||
    fileName === 'planReportPayload'
  ) {
    const updatedContent = content.replace(/Set<([^>]+)>/g, 'Array<$1>');
    if (updatedContent !== content) {
      content = updatedContent;
      modified = true;
    }
  }

  if (fileName === 'userMessageData') {
    const updatedContent = content.replace(
      '[key: string]: UserMessageValue | any;',
      '[key: string]: UserMessageValue | undefined;',
    );
    if (updatedContent !== content) {
      content = updatedContent;
      modified = true;
    }
  }

  // Preserve literal types for the ReportType value object so it can be used
  // as the discriminator of generated report DTO unions.
  if (fileName === 'reportType') {
    const updatedContent = content
      .replace(/ as ReportType(?=,|\n)/g, '')
      .replace(/(export const ReportType = \{[\s\S]*?\n\});/, '$1 as const;');
    if (updatedContent !== content) {
      content = updatedContent;
      modified = true;
    }
  }

  if (
    fileName === 'artifactResponseDto' ||
    fileName === 'createArtifactDto' ||
    fileName === 'searchResultDto'
  ) {
    const updatedContent = ensureArtifactSourceFieldsRequired(
      fileName,
      content,
    );
    if (updatedContent !== content) {
      content = updatedContent;
      modified = true;
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
  if (!content.includes('/* eslint-disable')) {
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

  // Process all fields with branded type comments
  // Match pattern: /**\n * [comment with (branded type)]\n */\n fieldName: string;
  const fieldPattern =
    /\/\*\*\s*\n\s*\*\s*([^\n]*\(branded type\)[^\n]*)\s*\n\s*\*\/\s*\n\s*(\w+)(\??):\s*string(;|\s)/g;

  let match;
  const fieldReplacements: Array<{
    field: string;
    type: string;
    offset: number;
    length: number;
  }> = [];

  while ((match = fieldPattern.exec(content)) !== null) {
    const comment = match[1] as string;
    const fieldName = match[2] as string;
    const optional = match[3];
    const terminator = match[4];

    const brandedType = extractBrandedType(comment);
    if (brandedType) {
      fieldReplacements.push({
        field: fieldName,
        type: brandedType,
        offset:
          match.index + match[0].indexOf(`${fieldName}${optional}: string`),
        length: `${fieldName}${optional}: string`.length,
      });
      usedBrandedTypes.add(brandedType);
    }
  }

  // Apply replacements in reverse order to maintain correct offsets
  fieldReplacements.reverse().forEach((replacement) => {
    const before = content.substring(0, replacement.offset);
    const after = content.substring(replacement.offset + replacement.length);
    content =
      before +
      `${replacement.field}${content[replacement.offset + replacement.field.length] === '?' ? '?' : ''}: ${replacement.type}` +
      after;
    replacements++;
    modified = true;
  });

  // Also check for fields that might already have branded types (from inline references)
  // This regex finds type references that look like branded types
  const brandedTypeUsagePattern =
    /:\s*(ProjectId|UserId|OrganizationId|ConversationId|WorkflowId|MessageId|ArtifactId|InteractionTypeId|OrganizationMemberId|RequestId|JobId|InitiativeId|TaskId|IntegrationId|LlmId)\b/g;

  let brandedMatch;
  while ((brandedMatch = brandedTypeUsagePattern.exec(content)) !== null) {
    if (brandedMatch?.[1]) {
      usedBrandedTypes.add(brandedMatch[1]);
    }
  }

  // Clean up unused imports but be more conservative
  content = removeUnusedImports(content);

  // Add missing imports for branded types
  if (usedBrandedTypes.size > 0) {
    content = addMissingImports(content, usedBrandedTypes, filePath);
    modified = true;
  }

  if (modified) {
    if (replacements > 0) {
      console.log(
        `➡️  Applied ${replacements} branded type replacements in ${path.relative(GENERATED_DIR, filePath)}`,
      );
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  return { modified, replacements };
}

function removeUnusedImports(content: string): string {
  // Be more conservative - only remove imports that are clearly unused
  const unusedImports = [
    // Only remove these if they're really not used anywhere in the file
    /import\s*\{\s*COLLECTION_FORMATS\s*\}\s*from\s*['"][^'"]*variables['"];\s*?\n/g,
  ];

  let cleanContent = content;

  // Only remove COLLECTION_FORMATS if it's not referenced anywhere
  if (
    (!content.includes('COLLECTION_FORMATS') ||
      (content.includes('COLLECTION_FORMATS') &&
        content.split('COLLECTION_FORMATS').length === 2)) &&
    unusedImports?.[0]
  ) {
    cleanContent = cleanContent.replace(unusedImports[0], '');
  }

  // Remove unused constructor parameters more carefully
  cleanContent = cleanContent.replace(
    /constructor\(\s*httpService:\s*HttpService\s*\)\s*\{\s*\}/g,
    'constructor() { }',
  );

  return cleanContent;
}

function addMissingImports(
  content: string,
  usedTypes: Set<string>,
  filePath: string,
): string {
  if (usedTypes.size === 0) {
    return content;
  }

  // First, remove all existing individual branded type imports to avoid duplicates
  let cleanContent = content.replace(
    /import\s*\{\s*([^}]*)\s*\}\s*from\s*['"](?:\.\.\/)+types['"];?\s*\n?/g,
    (_, importList) => {
      // Keep track of what was imported
      const existingTypes = importList
        .split(',')
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0);

      // Add existing types to our used types
      existingTypes.forEach((type: string) => usedTypes.add(type));

      // Remove this import line
      return '';
    },
  );

  // Add consolidated import at the top
  const sortedTypes = Array.from(usedTypes).sort();
  const typesModulePath = path.relative(
    path.dirname(filePath),
    path.join(GENERATED_DIR, '..', 'types'),
  );
  const normalizedTypesModulePath = typesModulePath.startsWith('.')
    ? typesModulePath
    : `./${typesModulePath}`;
  const importStatement = `import { ${sortedTypes.join(', ')} } from '${normalizedTypesModulePath.replace(/\\/g, '/')}';\n`;

  // Find the right place to insert the import (after the pragmas and comment block)
  const pragmaEnd = cleanContent.indexOf('// @ts-nocheck');
  if (pragmaEnd !== -1) {
    // Insert after the pragma
    const beforePragma = cleanContent.substring(
      0,
      pragmaEnd + '// @ts-nocheck'.length,
    );
    const afterPragma = cleanContent.substring(
      pragmaEnd + '// @ts-nocheck'.length,
    );
    return beforePragma + '\n' + importStatement + afterPragma;
  } else {
    // Find comment block end
    const commentBlockEnd = cleanContent.indexOf('*/');
    if (commentBlockEnd !== -1) {
      // Insert after the comment block
      const beforeComment = cleanContent.substring(0, commentBlockEnd + 2);
      const afterComment = cleanContent.substring(commentBlockEnd + 2);
      return beforeComment + '\n' + importStatement + afterComment;
    } else {
      // No comment block found, insert at the beginning
      return importStatement + cleanContent;
    }
  }
}

function ensureArtifactSourceFieldsRequired(
  fileName: string,
  content: string,
): string {
  if (fileName === 'artifactResponseDto' || fileName === 'createArtifactDto') {
    return content
      .replace(
        'sourceType?: ArtifactSourceType;',
        'sourceType: ArtifactSourceType;',
      )
      .replace('sourceId?: string;', 'sourceId: string;');
  }

  if (fileName === 'searchResultDto') {
    return content
      .replace(
        'sourceType?: ArtifactSourceType;',
        'sourceType: ArtifactSourceType;',
      )
      .replace('sourceId?: string;', 'sourceId: string;');
  }

  return content;
}

function processDirectory(dirPath: string): {
  filesProcessed: number;
  totalReplacements: number;
} {
  let filesProcessed = 0;
  let totalReplacements = 0;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (NON_API_GENERATED_DIRS.has(path.resolve(fullPath))) {
        continue;
      }
      const subResult = processDirectory(fullPath);
      filesProcessed += subResult.filesProcessed;
      totalReplacements += subResult.totalReplacements;
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.includes('.d.ts')
    ) {
      const result = processFile(fullPath);
      if (result.modified) {
        filesProcessed++;
        totalReplacements += result.replacements;
      }
    }
  }

  return { filesProcessed, totalReplacements };
}

try {
  cleanupGeneratedArtifacts();
  enforceWorkflowSafeIndex();
  for (const fileName of [
    'canonicalControllerAuthorizationIntent.ts',
    'controllerDeviceGrantDescriptor.ts',
  ]) {
    const filePath = path.join(GENERATED_MODEL_DIR, fileName);
    const content = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(
      filePath,
      content.replace(/Set<([^>]+)>/g, 'Array<$1>'),
      'utf-8',
    );
  }
  const result = processDirectory(GENERATED_DIR);
  console.log('✅ Post-processing completed successfully');
  console.log(`📁 Processed ${result.filesProcessed} files`);
  console.log(`🔄 Made ${result.totalReplacements} type replacements`);
  console.log(
    '🚫 Added TypeScript ignore pragmas to suppress unused import warnings',
  );
} catch (error) {
  console.error('❌ Error during post-processing:', error);
  process.exit(1);
}
