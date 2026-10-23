import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparePostgresStatements,
  statementSnapshotSql,
} from '../staging-postgres-statements.mjs';

const capabilities = {
  version: '130023',
  schema: 'public',
  ioTiming: 'on',
  hasInfo: false,
  columns: [
    'dbid',
    'userid',
    'queryid',
    'calls',
    'total_exec_time',
    'rows',
    'wal_bytes',
  ],
};
const entry = {
  dbid: '1',
  userid: '2',
  queryid: '-9007199254740999',
  calls: '2',
  total_exec_time: 10,
  rows: '4',
  wal_bytes: '9007199254740999',
};
const snapshot = (changes = {}) => ({
  available: true,
  capabilities,
  capturedAt: '2026-10-13T00:00:00Z',
  postmasterStart: 'same',
  info: null,
  entries: [entry],
  ...changes,
});

test('PG13 snapshots omit query text and unsupported columns at the database boundary', () => {
  const sql = statementSnapshotSql(capabilities);
  assert.match(sql, /pg_stat_statements\(false\)/);
  assert.doesNotMatch(sql, /\btoplevel\b|stats_reset|dealloc/);
  assert.match(sql, /queryid::text/);
  assert.match(sql, /wal_bytes::text/);
  assert.match(sql, /LIMIT 20000/);
  assert.match(sql, /SET pg_stat_statements.track='none'/);
});

test('computes counter deltas without precision loss and exposes PG13 reset uncertainty', () => {
  const result = comparePostgresStatements(
    snapshot(),
    snapshot({
      entries: [
        {
          ...entry,
          calls: '5',
          total_exec_time: 25,
          wal_bytes: '9007199254741002',
        },
      ],
    }),
  );
  assert.equal(result.ranked[0].calls, '3');
  assert.equal(result.ranked[0].wal_bytes, '3');
  assert.equal(result.ranked[0].meanExecutionMs, 5);
  assert.match(result.gaps.join(' '), /Reset\/eviction metadata unavailable/);
});

test('does not invent zero baselines for new fingerprints or negative reset deltas', () => {
  const result = comparePostgresStatements(
    snapshot(),
    snapshot({
      entries: [
        { ...entry, calls: '1' },
        { ...entry, queryid: '3' },
      ],
    }),
  );
  assert.equal(result.ranked.length, 0);
  assert.equal(result.invalidated.length, 1);
  assert.equal(result.unmatched.length, 1);
});

test('rejects intervals across restart or global statistics reset', () => {
  assert.equal(
    comparePostgresStatements(
      snapshot(),
      snapshot({ postmasterStart: 'changed' }),
    ).ranked.length,
    0,
  );
  const result = comparePostgresStatements(
    snapshot({ info: { stats_reset: 'a', dealloc: '0' } }),
    snapshot({ info: { stats_reset: 'b', dealloc: '0' } }),
  );
  assert.match(result.gaps[0], /statistics reset/);
});

test('preserves disabled collectors, bounded omissions, evictions and I/O gaps', () => {
  assert.match(
    comparePostgresStatements(
      { available: false, gap: 'extension absent' },
      snapshot(),
    ).gaps.join(' '),
    /extension absent/,
  );
  const result = comparePostgresStatements(
    snapshot({ truncated: true, info: { stats_reset: 'a', dealloc: '0' } }),
    snapshot({
      capabilities: { ...capabilities, ioTiming: 'off' },
      info: { stats_reset: 'a', dealloc: '1' },
    }),
  );
  assert.match(result.gaps.join(' '), /bound reached/);
  assert.match(result.gaps.join(' '), /evicted/);
  assert.match(result.gaps.join(' '), /I\/O timing disabled/);
});
