const fs = require('node:fs');
const path = require('node:path');
const { resolveOpenapiRoot } = require('./openapi-root.cjs');
const root = resolveOpenapiRoot();
const yaml = require(require.resolve('js-yaml', { paths: [root] }));
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
  // An untyped OpenAPI schema already accepts null; Ajv requires a type for nullable.
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== 'nullable' || node.type !== undefined)
      .map(([key, value]) => [key, resolve(value, file)]),
  );
}
const common = path.join(root, 'specs/schemas/common.yaml');
const reports = path.join(root, 'specs/schemas/reports.yaml');
const entityContext = path.join(root, 'specs/schemas/entity-context.yaml');
const local = path.join(root, 'specs/local/openapi.yaml');
const schemas = {
  LocalRunToolCallsLatestTurnRequest: resolve(
    yaml.load(fs.readFileSync(local, 'utf8')).components.schemas.LocalRunToolCallsLatestTurnRequest,
    local,
  ),
  LocalRunToolCallsLatestTurnRunId: resolve(
    yaml.load(fs.readFileSync(local, 'utf8')).paths['/runs/{runId}/tool-calls/latest-turn'].post
      .parameters[0].schema,
    local,
  ),
  LocalWalkthroughSourceRequest: resolve(
    yaml.load(fs.readFileSync(local, 'utf8')).components.schemas.LocalWalkthroughSourceRequest,
    local,
  ),
  ChangeWalkthroughReportPayload: resolve(
    yaml.load(fs.readFileSync(reports, 'utf8')).ChangeWalkthroughReportPayload,
    reports,
  ),
  ActiveGoalDto: resolve(
    yaml.load(fs.readFileSync(entityContext, 'utf8')).ActiveGoalDto,
    entityContext,
  ),
  ApiErrorResponse: resolve(yaml.load(fs.readFileSync(common, 'utf8')).ApiErrorResponse, common),
  CreateReportCompletedAttemptError: resolve(
    yaml.load(fs.readFileSync(reports, 'utf8')).CreateReportCompletedAttemptError,
    reports,
  ),
};
fs.writeFileSync(
  path.join(__dirname, '../src/shared/api/generated/report-error-schemas.ts'),
  '// Generated from OpenAPI by scripts/generate-report-error-schemas.cjs. Do not edit.\nexport const reportErrorSchemas = ' +
    JSON.stringify(schemas, null, 2) +
    ' as const;\n',
);
