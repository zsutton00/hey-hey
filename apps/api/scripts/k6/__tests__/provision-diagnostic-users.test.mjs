import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../provision-diagnostic-users.mjs', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function loadState()'), source.indexOf('async function verify('));

function helper(users, targetCount = 100) {
  return runInNewContext(`${functions}\n({ loadState, applySql });`, {
    usersFile: 'users', manifestPath: 'manifest', targetCount,
    SUPPORTED_TARGETS: new Set([50, 100]),
    readFileSync: (path) => JSON.stringify(path === 'users' ? users : {
      organizationId: 'organization', projectId: 'project',
    }),
  });
}

const user = (number) => ({
  email: `diagnostic+pj${number}@example.com`, password: 'test-password',
  organizationId: 'organization',
});

test('missing numbered identities are found by number, including gaps', () => {
  const state = helper([user(1), user(3)], 50).loadState();
  assert.equal(state.missing.length, 48);
  assert.equal(state.missing[0].email, user(2).email);
  assert.equal(state.missing.some((entry) => entry.email === user(3).email), false);
});

test('expanding fifty identities to one hundred creates only numbers 51-100', () => {
  const existing = Array.from({ length: 50 }, (_, i) => user(i + 1));
  const state = helper(existing).loadState();
  assert.equal(state.missing.length, 50);
  assert.equal(state.missing[0].email, user(51).email);
  assert.equal(state.missing.at(-1).email, user(100).email);
  assert.equal(state.password, 'test-password');
});

test('unsupported targets and identities beyond the target are refused', () => {
  assert.throws(() => helper([user(1)], 75).loadState(), /fifty or one hundred/);
  assert.throws(() => helper([user(1), user(60)], 50).loadState(), /target range/);
});

test('duplicate or foreign numbered identities are refused before SQL', () => {
  assert.throws(() => helper([user(1), user(1)]).loadState(), /unique numbered/);
  assert.throws(() => helper([user(1), { ...user(2), email: 'other+pj2@example.com' }]).loadState(), /unique numbered/);
});

test('transaction refuses elevated reference roles and conflicting accounts', () => {
  const api = helper([user(1)]);
  const state = api.loadState();
  const sql = api.applySql(state, state.missing.map(() => 'hash'), user(2).email);
  assert.match(sql, /om.role = 'MEMBER' AND pm.role = 'MEMBER'/);
  assert.match(sql, /refusing to overwrite/);
  assert.match(sql, /NOT u.dev_admin_mode AND NOT u.must_change_password/);
  assert.match(sql, /ON COMMIT DROP/);
});
