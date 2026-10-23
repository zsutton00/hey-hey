const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { resolveOpenapiRoot } = require('./openapi-root');
const { resolveGeneratedRoot } = require('./generated-root');

function resolve(node, file) {
  if (Array.isArray(node)) return node.map((item) => resolve(item, file));
  if (!node || typeof node !== 'object') return node;
  if (node.$ref) {
    const [relative, fragment] = node.$ref.split('#/');
    const target = relative ? path.resolve(path.dirname(file), relative) : file;
    const document = yaml.load(fs.readFileSync(target, 'utf8'));
    return resolve(
      fragment.split('/').reduce((value, key) => value[key], document),
      target,
    );
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, resolve(value, file)]),
  );
}

const source = path.join(
  resolveOpenapiRoot(),
  'specs/schemas/project-reports.yaml',
);
const document = yaml.load(fs.readFileSync(source, 'utf8'));
const names = [
  'AgentSessionConfigProjectReportV1',
  'CreateProjectReportRequestDto',
  'ProjectReportContextBatchRequestDto',
  'ProjectReportPreviewRequestDto',
  'RetryProjectReportRequestDto',
];
const schemas = Object.fromEntries(
  names.map((name) => [name, resolve(document[name], source)]),
);
fs.writeFileSync(
  path.join(resolveGeneratedRoot(), 'project-report.schemas.ts'),
  '// Generated from OpenAPI by scripts/generate-project-report-schemas.js. Do not edit.\n' +
    'export const projectReportSchemas = ' +
    JSON.stringify(schemas, null, 2) +
    ' as const;\n',
);
