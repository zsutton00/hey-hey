import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Run outside Jest's VM so PGlite can load its WASM engine normally.
it('recovers legacy claims without reviving terminal failures and fences competing claims', () => {
  const script = `
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
  const db = new PGlite();
  try {
    const migrations = process.argv[1];
    const baseline = readFileSync(
      resolve(migrations, 'B2026.02.18.0__baseline_schema.sql'),
      'utf8',
    );
    const enumSql = baseline.match(/CREATE TYPE "OutboxEventStatus"[^;]+;/)[0];
    const tableSql = baseline.match(
      /CREATE TABLE "outbox_events"[\\s\\S]+?\\n\\);/,
    )[0];
    await db.exec(enumSql + tableSql);
    await db.exec(\`INSERT INTO outbox_events
      (id, correlation_id, event_type, aggregate_type, aggregate_id, payload,
       status, partition_key, source_service, source_method, retry_count)
      VALUES ('crashed', 'corr', 'message.created', 'message', 'message-1',
       '{"message":"stored payload", "routing":{"type":"user"}}',
       'PROCESSING', 'partition', 'api', 'create', 0),
       ('terminal', 'corr', 'message.created', 'message', 'message-2', '{}',
       'FAILED', 'partition', 'api', 'create', 3)\`);
    await db.exec(
      readFileSync(
        resolve(migrations, 'V2026.11.11.004056__outbox_claim_lease.sql'),
        'utf8',
      ),
    );
    const claim = (token) =>
      db.query(
        \`UPDATE outbox_events
      SET claim_token = $1, claim_expires_at = CURRENT_TIMESTAMP + INTERVAL '60 seconds'
      WHERE id = 'crashed' AND status = 'PROCESSING'
        AND claim_expires_at <= CURRENT_TIMESTAMP RETURNING id\`,
        [token],
      );
    const claims = await Promise.all([claim('first'), claim('second')]);
    assert.deepEqual(claims.map((result) => result.rows.length).sort(), [0, 1]);
    const winner = claims[0].rows.length ? 'first' : 'second';
    const stale = await db.query(\`UPDATE outbox_events SET status = 'FAILED'
      WHERE id = 'crashed' AND claim_token = 'obsolete' RETURNING id\`);
    assert.equal(stale.rows.length, 0);
    const completed = await db.query(
      \`UPDATE outbox_events
      SET status = 'PUBLISHED', claim_token = NULL, claim_expires_at = NULL
      WHERE id = 'crashed' AND claim_token = $1 RETURNING payload\`,
      [winner],
    );
    assert.deepEqual(completed.rows, [
      { payload: { message: 'stored payload', routing: { type: 'user' } } },
    ]);
    const terminal =
      await db.query(\`SELECT status, next_retry_at, claim_expires_at, retry_count
      FROM outbox_events WHERE id = 'terminal'\`);
    assert.deepEqual(terminal.rows, [
      {
        status: 'FAILED',
        next_retry_at: null,
        claim_expires_at: null,
        retry_count: 3,
      },
    ]);
  } finally {
    await db.close();
  }

`;
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      script,
      resolve(__dirname, '../../../../db/flyway'),
    ],
    { cwd: resolve(__dirname, '../../../..'), stdio: 'pipe', timeout: 30000 },
  );
}, 35000);
