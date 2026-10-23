const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { resolveOpenapiRoot } = require('./openapi-root');
const { resolveGeneratedRoot } = require('./generated-root');
const root = resolveOpenapiRoot();

function resolve(schema, file) {
  if (Array.isArray(schema)) return schema.map((item) => resolve(item, file));
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) {
    const [relative, fragment] = schema.$ref.split('#/');
    const target = relative ? path.resolve(path.dirname(file), relative) : file;
    const document = yaml.load(fs.readFileSync(target, 'utf8'));
    return resolve(
      fragment.split('/').reduce((value, key) => value[key], document),
      target,
    );
  }
  const result = Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== 'nullable')
      .map(([key, value]) => [key, resolve(value, file)]),
  );
  return schema.nullable ? { anyOf: [result, { type: 'null' }] } : result;
}
const source = path.join(root, 'specs/schemas/activity-correlation.yaml');
const document = yaml.load(fs.readFileSync(source, 'utf8'));
fs.writeFileSync(
  path.join(resolveGeneratedRoot(), 'activity-history-contract.ts'),
  '// Generated from OpenAPI by scripts/generate-activity-history-contract.cjs.\nexport const activityHistoryFilterSchema = ' +
    JSON.stringify(
      resolve(document.ActivityHistoryFilterDto, source),
      null,
      2,
    ) +
    ' as const;\n',
);
