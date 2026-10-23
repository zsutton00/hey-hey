const fs = require('fs');
const path = require('path');
const { resolveOpenapiRoot } = require('./openapi-root');
const yaml = require('js-yaml');
const { resolveGeneratedRoot } = require('./generated-root');

const openapiRoot = resolveOpenapiRoot();

const workItemsSchemaPath = path.join(
  openapiRoot,
  'specs/schemas/work-items.yaml',
);
const schemasRoot = path.dirname(workItemsSchemaPath);
const schemaDocuments = new Map();

const loadSchemaDocument = (schemaPath) => {
  const resolvedPath = path.resolve(schemaPath);
  const relativePath = path.relative(schemasRoot, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(
      `Task Monitor schema generation only supports references within ${schemasRoot}: ${schemaPath}`,
    );
  }

  if (!schemaDocuments.has(resolvedPath)) {
    schemaDocuments.set(
      resolvedPath,
      yaml.load(fs.readFileSync(resolvedPath, 'utf8')),
    );
  }
  return schemaDocuments.get(resolvedPath);
};

const workItemsSchemas = loadSchemaDocument(workItemsSchemaPath);

const resolvePointer = (pointer, sourcePath) => {
  const [schemaReference, fragment] = pointer.split('#', 2);
  if (fragment === undefined || !fragment.startsWith('/')) {
    throw new Error(
      `Task Monitor schema generation requires a JSON pointer fragment: ${pointer}`,
    );
  }

  const targetPath = schemaReference
    ? path.resolve(path.dirname(sourcePath), schemaReference)
    : sourcePath;
  const schemaDocument = loadSchemaDocument(targetPath);

  const value = fragment
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, key) => {
      if (typeof value !== 'object' || value === null || !(key in value)) {
        throw new Error(`Unable to resolve Task Monitor schema ref ${pointer}`);
      }
      return value[key];
    }, schemaDocument);

  return {
    sourcePath: targetPath,
    referenceKey: `${targetPath}#${fragment}`,
    value,
  };
};

const dereference = (
  value,
  sourcePath = workItemsSchemaPath,
  referenceStack = [],
) => {
  if (Array.isArray(value)) {
    return value.map((entry) => dereference(entry, sourcePath, referenceStack));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (typeof value.$ref === 'string') {
    const resolved = resolvePointer(value.$ref, sourcePath);
    if (referenceStack.includes(resolved.referenceKey)) {
      throw new Error(
        `Circular Task Monitor schema reference: ${[
          ...referenceStack,
          resolved.referenceKey,
        ].join(' -> ')}`,
      );
    }
    const { $ref, ...siblings } = value;
    return dereference(
      { ...resolved.value, ...siblings },
      resolved.sourcePath,
      [...referenceStack, resolved.referenceKey],
    );
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      dereference(entry, sourcePath, referenceStack),
    ]),
  );
};

const executionDefinition = workItemsSchemas.TaskMonitorExecutionDefinition;
if (!executionDefinition) {
  throw new Error(
    'TaskMonitorExecutionDefinition is missing from work-items.yaml.',
  );
}

const outputPath = path.join(
  resolveGeneratedRoot(),
  'task-monitor-execution-definition.schema.ts',
);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  [
    '/* This file is generated from OpenAPI by scripts/generate-task-monitor-schema.js. */',
    '/* Do not edit by hand. */',
    '',
    `export const taskMonitorExecutionDefinitionJsonSchema = ${JSON.stringify(
      dereference(executionDefinition),
      null,
      2,
    )} as const;`,
    '',
  ].join('\n'),
);
