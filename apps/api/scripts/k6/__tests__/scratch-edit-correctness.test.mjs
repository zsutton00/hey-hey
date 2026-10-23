import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

test('scratch latency success requires applied state and the newly written description', () => {
  const source = readFileSync(
    new URL('../activity-api-diagnostic.js', import.meta.url),
    'utf8',
  );
  const body = source.slice(
    source.indexOf('  write_scratch_edit() {'),
    source.indexOf('  write_scratch_add() {'),
  );
  let request;
  let assertion;
  const id = '123e4567-e89b-42d3-a456-426614174201';
  const actions = vm.runInNewContext(`({${body}})`, {
    distributed: true,
    fixtureManifest: { assignments: [{ scratchTaskId: id }] },
    __VU: 1,
    __ITER: 2,
    config: { runId: 'comparison' },
    projectPath: (path) => path,
    isRecord: (value) =>
      value !== null && typeof value === 'object' && !Array.isArray(value),
    send: (_action, _method, _path, payload) => {
      request = payload;
      return {};
    },
    record: (_action, _response, _status, check) => {
      assertion = check;
    },
  });
  actions.write_scratch_edit();
  const current = {
    id,
    sections: [
      { key: 'description', materializedMarkdown: request.sections[0].content },
    ],
  };
  assert.equal(assertion({ status: 'APPLIED', task: current }), true);
  assert.equal(assertion({ status: 'PENDING', task: current }), false);
  assert.equal(
    assertion({
      status: 'APPLIED',
      task: {
        id,
        sections: [
          { key: 'description', materializedMarkdown: 'Previous description' },
        ],
      },
    }),
    false,
  );
  assert.equal(assertion({ status: 'APPLIED', task: { id } }), false);
});
