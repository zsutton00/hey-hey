const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const yaml = require('js-yaml');
const Parser = require('@apidevtools/json-schema-ref-parser').$RefParser;
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

async function main() {
  for (const [file, name] of [
    ['external-agent-completion.yaml', 'RepositoryGroundingExternalCompletionPayload'],
    ['reports.yaml', 'FeatureSyncDecisionReportPayload'],
  ]) {
    const source = yaml.load(fs.readFileSync(path.resolve(__dirname, '../specs/schemas', file), 'utf8'))[name];
    assert.deepEqual(source['x-schema-candidates'], source.oneOf.map(({ $ref }) => {
      const [relativeFile, model] = $ref.split('#/');
      return { model, schema: `openapi:/event-schemas/${relativeFile.replace('./', '') || file}#/${model}` };
    }));
  }
  const schemas = await new Parser().dereference(
    path.resolve(__dirname, '../specs/schemas/external-agent-completion.yaml'),
  );
  const union = schemas.RepositoryGroundingExternalCompletionPayload;
  const validate = addFormats(new Ajv({ strict: false })).compile(union);
  for (const code of ['provider_timeout', 'graph_unavailable', 'machine_unavailable']) {
    assert.equal(validate({ outcome: 'retryable_failure', code, message: 'Unavailable' }), true);
  }
  assert.equal(validate({ outcome: 'terminal_failure', code: 'invalid_request', message: 'Invalid' }), true);
  assert.equal(validate({ findings: [] }), true);
  assert.equal(validate({
    outcome: 'success', summary: 'Proposed first work',
    taskProposalIds: ['11111111-1111-4111-8111-111111111111'], featureProposalIds: [],
  }), true);
  assert.equal(validate({ outcome: 'retryable_failure', code: 'invented', message: 'Invalid' }), false);
  assert.equal(validate({ outcome: 'retryable_failure', code: 'provider_timeout', message: '' }), false);
  assert.equal(union['x-schema-candidates'].length, union.oneOf.length);
  console.log('Event completion union compatibility validated.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
