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
const source = path.join(root, 'specs/schemas/conversations.yaml');
function expand(value, file) {
  if (Array.isArray(value)) return value.map((entry) => expand(entry, file));
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) {
    const [relative, pointer] = value.$ref.split('#');
    const target = relative ? path.resolve(path.dirname(file), relative) : file;
    const document = yaml.load(fs.readFileSync(target, 'utf8'));
    return expand(
      pointer
        .slice(1)
        .split('/')
        .reduce((entry, key) => entry[key], document),
      target,
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, expand(entry, file)]),
  );
}
const document = yaml.load(fs.readFileSync(source, 'utf8'));
const names = [
  'GoalPmRoutingSelectionPayload',
  'GoalPmRoutingPayload',
  'GoalPmRoutingDecisionResponseDto',
  'GoalPmRoutingEnactmentRequest',
  'GoalPmRoutingAnswer',
  'GoalPmRoutingCompletionRequest',
];
const output =
  '// Generated from OpenAPI by scripts/generate-goal-pm-decision-schema.js.\n' +
  names
    .map(
      (name) =>
        `export const ${name}Schema = ${JSON.stringify(expand(document[name], source), null, 2)} as const;\n`,
    )
    .join('\n');
fs.writeFileSync(
  path.join(resolveGeneratedRoot(), 'goal-pm-decision.schema.ts'),
  output,
);
