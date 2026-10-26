const fs = require('fs');
const path = require('path');
const { resolveOpenapiRoot } = require('./openapi-root');
const yaml = require('js-yaml');
const { resolveGeneratedRoot } = require('./generated-root');

const openapiRoot = resolveOpenapiRoot();

const schemaPath = path.join(openapiRoot, 'specs/schemas/conversations.yaml');
const schemas = yaml.load(fs.readFileSync(schemaPath, 'utf8'));
const generatedSchemaNames = [
  'ImplementPromptPayload',
  'CodingPlanDiscrepancy',
  'CodingPlanContext',
  'CodingPlanVersion',
  'CodingPlanVersionApproval',
  'CodingPlanEmissionInput',
  'CodingPlanQuestion',
  'CodingPlanConversationalApproval',
  'CodingPlanApprovalPayload',
  'CodingPlanWorkflowAnswer',
  'CodingPlanReviewAnswerPayload',
  'QuestionsFeedbackPayload',
  'QuestionsApprovedPayload',
  'PlanShapingFeatureSyncReviewDismissedAnswerPayload',
  'PlanShapingFeatureSyncReviewRefineAnswerPayload',
  'OnboardingFeatureListReviewUserSubmission',
  'OnboardingPlanStageProposalReviewUserSubmission',
];

const referencedNames = new Set();

function schemaExpression(schema) {
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\//, '');
    if (name.includes('/')) {
      const target = name
        .split('/')
        .reduce((value, key) => value[key], schemas);
      return schemaExpression(target);
    }
    referencedNames.add(name);
    return `${name}Schema`;
  }

  if (schema.allOf) {
    return schema.allOf
      .map(schemaExpression)
      .reduce((left, right) => `z.intersection(${left}, ${right})`);
  }

  if (schema.oneOf) {
    return `z.union([${schema.oneOf.map(schemaExpression).join(', ')}])`;
  }

  if (schema.enum) {
    if (schema.enum.length === 1) {
      return `z.literal(${JSON.stringify(schema.enum[0])})`;
    }
    return `z.enum(${JSON.stringify(schema.enum)})`;
  }

  if (schema.type === 'string') {
    let result = 'z.string()';
    if (schema.minLength !== undefined) result += `.min(${schema.minLength})`;
    if (schema.maxLength !== undefined) result += `.max(${schema.maxLength})`;
    if (schema.format === 'uuid') result += '.uuid()';
    return result;
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    let result = schema.type === 'integer' ? 'z.number().int()' : 'z.number()';
    if (schema.minimum !== undefined) result += `.min(${schema.minimum})`;
    if (schema.maximum !== undefined) result += `.max(${schema.maximum})`;
    return result;
  }

  if (schema.type === 'boolean') return 'z.boolean()';

  if (schema.type === 'array') {
    let result = `z.array(${schemaExpression(schema.items ?? {})})`;
    if (schema.minItems !== undefined) result += `.min(${schema.minItems})`;
    if (schema.maxItems !== undefined) result += `.max(${schema.maxItems})`;
    if (schema.uniqueItems) {
      result +=
        ".refine((items) => new Set(items.map((item) => JSON.stringify(item))).size === items.length, 'Array items must be unique')";
    }
    return result;
  }

  if (schema.type === 'object' || schema.properties) {
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {}).map(
      ([name, propertySchema]) => {
        const expression = schemaExpression(propertySchema);
        return `  ${JSON.stringify(name)}: ${required.has(name) ? expression : `${expression}.optional()`},`;
      },
    );
    let result = `z.object({\n${properties.join('\n')}\n})`;
    if (schema.additionalProperties === false) result += '.strict()';
    else if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === 'object'
    ) {
      result += `.catchall(${schemaExpression(schema.additionalProperties)})`;
    } else result += '.passthrough()';
    return result;
  }

  return 'z.unknown()';
}

const checkedSchemas = ['CodingPlanVersion', 'CodingPlanEmissionInput'];
const emitted = new Set();
const declarations = [];

function emitSchema(name, exported) {
  if (emitted.has(name)) return;
  const schema = schemas[name];
  if (!schema) throw new Error(`Unknown OpenAPI schema ${name}.`);

  referencedNames.clear();
  const expression = schemaExpression(schema);
  const dependencies = [...referencedNames];
  for (const dependency of dependencies) emitSchema(dependency, false);

  emitted.add(name);
  declarations.push(
    `${generatedSchemaNames.includes(name) ? 'export ' : ''}const ${name}Schema = ${expression}${checkedSchemas.includes(name) ? ` satisfies z.ZodType<${name}>` : ''};`,
  );
}

for (const name of generatedSchemaNames) emitSchema(name, true);

const output = [
  '/* This file is generated from OpenAPI by scripts/generate-workflow-review-schemas.js. */',
  "import { z } from 'zod';",
  `import type { ${checkedSchemas.join(', ')} } from '${process.argv[2] ? '../shared/api/generated/api' : './model/models'}';`,
  '',
  ...declarations.flatMap((declaration) => [declaration, '']),
].join('\n');

fs.writeFileSync(
  process.argv[2] ??
    path.join(resolveGeneratedRoot(), 'workflow-review.schemas.ts'),
  output,
);

// Handler tool declarations use the original JSON Schema, including uniqueness.
if (process.argv[2]) {
  const expand = (schema) => {
    if (Array.isArray(schema)) return schema.map(expand);
    if (!schema || typeof schema !== 'object') return schema;
    if (schema.$ref)
      return expand(
        schema.$ref
          .replace(/^#\//, '')
          .split('/')
          .reduce((value, key) => value[key], schemas),
      );
    return Object.fromEntries(
      Object.entries(schema).map(([key, value]) => [key, expand(value)]),
    );
  };
  // MCP clients reject a tools/list entry whose inputSchema lacks a top-level
  // `type: 'object'` (dropping every tool on that server), and the Anthropic
  // API refuses top-level allOf. Flatten object compositions into one object.
  const toToolInputSchema = (schema) => {
    if (!Array.isArray(schema.allOf)) return schema;
    const { allOf, description, ...rest } = schema;
    const parts = allOf.map(toToolInputSchema);
    if (parts.some((part) => part.type !== 'object')) {
      throw new Error('Tool input allOf must compose object schemas only.');
    }
    const required = [...new Set(parts.flatMap((part) => part.required ?? []))];
    const closed = parts.some((part) => part.additionalProperties === false);
    return {
      ...rest,
      type: 'object',
      ...(description ? { description } : {}),
      ...(closed ? { additionalProperties: false } : {}),
      required,
      properties: Object.assign({}, ...parts.map((part) => part.properties ?? {})),
    };
  };
  fs.writeFileSync(
    process.argv[2].replace('.schemas.ts', '.tool-schemas.ts'),
    '/* Generated from OpenAPI; do not edit. */\n' +
      ['CodingPlanEmissionInput', 'CodingPlanDiscrepancy', 'CodingPlanQuestion']
        .map(
          (name) =>
            `export const ${name}ToolSchema = ${JSON.stringify(toToolInputSchema(expand(schemas[name])), null, 2)};\n`,
        )
        .join('\n'),
  );
}
