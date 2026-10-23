const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { resolveGeneratedRoot } = require('./generated-root');

const root = execFileSync(
  process.execPath,
  [path.join(__dirname, 'openapi-root.js')],
  { encoding: 'utf8' },
).trim();
const documents = new Map();
function document(file) {
  if (!documents.has(file))
    documents.set(file, yaml.load(fs.readFileSync(file, 'utf8')));
  return documents.get(file);
}
function expression(schema, file) {
  let value;
  if (schema.$ref) {
    const [relative, pointer] = schema.$ref.split('#/');
    const target = relative ? path.resolve(path.dirname(file), relative) : file;
    value = expression(document(target)[pointer], target);
  } else if (schema.oneOf) {
    value = `z.union([${schema.oneOf
      .map((item) => expression(item, file))
      .join(',')}])`;
  } else if (schema.allOf) {
    value = schema.allOf
      .map((item) => expression(item, file))
      .reduce((a, b) => `z.intersection(${a}, ${b})`);
  } else if (schema.enum) {
    value =
      schema.enum.length === 1
        ? `z.literal(${JSON.stringify(schema.enum[0])})`
        : `z.enum(${JSON.stringify(schema.enum)})`;
  } else if (schema.type === 'string') {
    value = 'z.string()';
    if (schema.format === 'uuid') value += '.uuid()';
    if (schema.minLength !== undefined) value += `.min(${schema.minLength})`;
    if (schema.maxLength !== undefined) value += `.max(${schema.maxLength})`;
    if (schema.pattern)
      value += `.regex(new RegExp(${JSON.stringify(schema.pattern)}))`;
  } else if (schema.type === 'array') {
    value = `z.array(${expression(schema.items, file)})`;
    if (schema.minItems !== undefined) value += `.min(${schema.minItems})`;
  } else if (schema.type === 'object') {
    const required = new Set(schema.required ?? []);
    value = `z.object({${Object.entries(schema.properties ?? {})
      .map(
        ([key, child]) =>
          `${JSON.stringify(key)}: ${expression(child, file)}${required.has(key) ? '' : '.optional()'}`,
      )
      .join(',')}})`;
    value +=
      schema.additionalProperties === false ? '.strict()' : '.passthrough()';
  } else
    throw new Error(`Unsupported Diagram schema: ${JSON.stringify(schema)}`);
  if (schema.not)
    value += `.refine(value => !(${expression(schema.not, file)}).safeParse(value).success, 'Diagram kind and level combination is not allowed.')`;
  if (schema.nullable) value += '.nullable()';
  return value;
}
const values = [
  ['DiagramMetadata', 'work-items.yaml'],
  ['DiagramElementMetadata', 'work-items.yaml'],
  ['DiagramElementPolicy', 'work-item-type-definition.yaml'],
  ['DiagramGroupsValue', 'work-items.yaml'],
];
const output = [
  '/* Generated from OpenAPI by scripts/generate-diagram-schemas.js. */',
  "import { z } from 'zod';",
  ...values.map(([name, filename]) => {
    const file = path.join(root, 'specs/schemas', filename);
    return `export const ${name}Schema = ${expression(document(file)[name], file)};`;
  }),
].join('\n');
fs.writeFileSync(
  path.join(resolveGeneratedRoot(), 'diagram.schemas.ts'),
  output + '\n',
);
