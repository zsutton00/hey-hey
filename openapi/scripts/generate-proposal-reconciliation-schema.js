const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const document = yaml.load(fs.readFileSync(path.join(__dirname, "..",
  'specs/schemas/proposals.yaml'), 'utf8'));
function resolve(value) {
  if (Array.isArray(value)) return value.map(resolve);
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) {
    if (!value.$ref.startsWith('#/')) throw new Error(`Unexpected external reference: ${value.$ref}`);
    const source = document[value.$ref.slice(2)];
    if (!source) throw new Error(`Missing schema ${value.$ref}`);
    const { $ref, ...siblings } = value;
    return resolve({ ...source, ...siblings });
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child)]));
}
const candidate = resolve(document.CreateProposalReconciliationCandidate);
const state = resolve(document.ProposalReconciliationState);
for (const outputPath of process.argv.slice(2)) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath,
    '// Generated from OpenAPI by scripts/generate-proposal-reconciliation-schema.js.\n'
    + `export const proposalReconciliationCandidateSchema = ${JSON.stringify(candidate, null, 2)} as const;\n`
    + `export const proposalReconciliationStateSchema = ${JSON.stringify(state, null, 2)} as const;\n`);
}
