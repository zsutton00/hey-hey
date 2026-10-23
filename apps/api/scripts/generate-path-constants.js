#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { resolveOpenapiRoot } = require('./openapi-root');
const { resolveGeneratedRoot } = require('./generated-root');

// Read the OpenAPI spec from openapi project
const specPath = path.join(resolveOpenapiRoot(), 'specs/api/openapi.yaml');

// Check if the OpenAPI spec exists
if (!fs.existsSync(specPath)) {
  console.error('❌ OpenAPI spec not found at:', specPath);
  console.error('Make sure the openapi project is in the expected location');
  process.exit(1);
}

const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));

// Extract paths and generate constants
const paths = Object.keys(spec.paths);

// Create constants for each controller based on path patterns
const controllerPaths = new Set();

paths.forEach((apiPath) => {
  // Extract controller name from path
  const pathSegments = apiPath.split('/').filter(Boolean);
  if (pathSegments.length > 0) {
    const controllerSegment = pathSegments[0];
    if (controllerSegment && !controllerSegment.startsWith('{')) {
      controllerPaths.add(controllerSegment);
    }
  }
});

// Generate controller constants
const controllerConstants = Array.from(controllerPaths)
  .map(
    (controller) =>
      `export const ${controller
        .toUpperCase()
        .replace(
          /[-\/]/g,
          '_',
        )}_CONTROLLER_PATH = \`\${API_BASE_PATH}/${controller}\`;`,
  )
  .join('\n');

// Generate individual path constants
const pathConstants = paths
  .map((apiPath) => {
    const pathName = apiPath
      .replace(/^\//, '')
      .replace(/\{([^}]+)\}/g, '$1')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase();
    return `export const ${pathName}_PATH = '${apiPath}';`;
  })
  .join('\n');

// Generate TypeScript constants
const tsContent = `/**
 * Generated API Path Constants
 * Generated from OpenAPI spec - DO NOT EDIT MANUALLY
 */

// Base paths
export const API_VERSION = 'v1';
export const API_BASE_PATH = \`/api/\${API_VERSION}\`;

// Controller base paths
${controllerConstants}

// Special controller paths for nested resources
export const CONVERSATION_CONTROLLER_PATH = 'organizations/:organizationId/projects/:projectId/conversations';
export const MESSAGE_CONTROLLER_PATH = 'organizations/:organizationId/projects/:projectId/messages';
export const PROJECT_CONTROLLER_PATH = 'organizations/:organizationId/projects';

// Individual endpoint paths
${pathConstants}
`;

// Ensure the generated directory exists
const outputDir = path.join(resolveGeneratedRoot(), 'api');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write to generated directory
const outputPath = path.join(outputDir, 'path-constants.ts');
fs.writeFileSync(outputPath, tsContent);

console.log('✅ Generated path constants at:', outputPath);
