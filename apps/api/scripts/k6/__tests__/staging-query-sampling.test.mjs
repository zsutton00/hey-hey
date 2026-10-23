import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQueries, queryTemplate } from '../staging-query-sampling.mjs';

test('retains query structure without literal values or comments', () => {
  assert.equal(
    queryTemplate(
      "MATCH (n) WHERE n.secret = 'private\\\'value' /* secret */ RETURN n LIMIT 20",
    ),
    'MATCH (n) WHERE n.secret = ? ? RETURN n LIMIT ?',
  );
  const row = (secret) =>
    'sample\n' +
    JSON.stringify([
      `MATCH (n) WHERE n.id = '${secret}' RETURN n`,
      'PT1S',
      null,
      'PT0S',
      32,
      10,
      0,
    ]);
  const first = parseQueries(row('private-value'))[0];
  const second = parseQueries(row('different-value'))[0];
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.cpu, null);
  assert.equal(first.pageHits, 10);
  assert.ok(!JSON.stringify(first).includes('private-value'));
});

test('does not convert a malformed monitoring response to an empty observation', () => {
  assert.throws(() => parseQueries('[broken'));
});
