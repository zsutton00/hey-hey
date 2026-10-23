const fs = require('fs');
const path = require('path');
const { resolveOpenapiRoot } = require('./openapi-root');
const yaml = require('js-yaml');
const { resolveGeneratedRoot } = require('./generated-root');

const openapiRoot = resolveOpenapiRoot();

const schemaPath = path.join(openapiRoot, 'specs/schemas/conversations.yaml');
const schemas = yaml.load(fs.readFileSync(schemaPath, 'utf8'));
const generatedSchemaNames = [
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
    `${exported ? 'export ' : ''}const ${name}Schema = ${expression};`,
  );
}

for (const name of generatedSchemaNames) emitSchema(name, true);

const output = [
  '/* This file is generated from OpenAPI by scripts/generate-workflow-review-schemas.js. */',
  "import { z } from 'zod';",
  '',
  ...declarations.flatMap((declaration) => [declaration, '']),
].join('\n');

fs.writeFileSync(
  path.join(resolveGeneratedRoot(), 'workflow-review.schemas.ts'),
  output,
);
