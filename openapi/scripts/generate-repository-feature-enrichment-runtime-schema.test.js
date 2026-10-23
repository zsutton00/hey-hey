const { test } = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const { rewriteSchemaReferences } = require('./generate-repository-feature-enrichment-runtime-schema');

test('converts OpenAPI exclusive bounds into executable draft-07 bounds', () => {
  const validate = new Ajv().compile(rewriteSchemaReferences({
    type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: true,
  }));
  assert.equal(validate(0), false);
  assert.equal(validate(5), true);
  assert.equal(validate(10), false);
});

test('keeps inclusive OpenAPI bounds inclusive without mutating the source', () => {
  const source = { type: 'number', minimum: 0, exclusiveMinimum: false };
  const validate = new Ajv().compile(rewriteSchemaReferences(source));
  assert.equal(validate(0), true);
  assert.equal(validate(-1), false);
  assert.equal(source.exclusiveMinimum, false);
});

test('preserves nullable reference semantics and rewrites nested component paths', () => {
  assert.deepEqual(rewriteSchemaReferences({
    nullable: true, $ref: '#/components/schemas/Example/properties/child',
  }), { anyOf: [{ type: 'null' }, { $ref: '#/definitions/Example/properties/child' }] });
});
