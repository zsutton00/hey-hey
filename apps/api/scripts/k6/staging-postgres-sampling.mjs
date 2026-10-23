import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

// One persistent read-only connection; never select query text, credentials or
// application_name (which may contain caller-provided data).
export const postgresWaitSql = `WITH activity AS (
  SELECT pid, backend_start, state, wait_event_type, wait_event,
    to_jsonb(pg_stat_activity)->>'query_id' AS query_id,
    query_start, xact_start, pg_blocking_pids(pid) AS blockers
  FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid()
), groups AS (
  SELECT state, wait_event_type, wait_event, count(*) AS sessions
  FROM activity GROUP BY state, wait_event_type, wait_event
)
SELECT json_build_object(
  'capturedAt', clock_timestamp(), 'database', current_database(),
  'queryIdAvailable', current_setting('server_version_num')::integer >= 140000,
  'activeQueryFingerprints', (SELECT coalesce(json_agg(row_to_json(q)), '[]'::json) FROM (
    SELECT query_id, wait_event_type, wait_event, count(*) AS sessions FROM activity
    WHERE state='active' GROUP BY query_id,wait_event_type,wait_event
  ) q),
  'activeSessions', (SELECT count(*) FROM activity WHERE state = 'active'),
  'activeWaitingSessions', (SELECT count(*) FROM activity WHERE state = 'active' AND wait_event IS NOT NULL),
  'sessionGroups', (SELECT coalesce(json_agg(row_to_json(groups)), '[]'::json) FROM groups),
  'blockedSessions', (SELECT coalesce(json_agg(row_to_json(b)), '[]'::json) FROM (
    SELECT pid, backend_start, state, wait_event_type, wait_event, blockers,
      extract(epoch FROM (clock_timestamp() - query_start)) * 1000 AS query_age_ms,
      extract(epoch FROM (clock_timestamp() - xact_start)) * 1000 AS transaction_age_ms
    FROM activity WHERE cardinality(blockers) > 0
  ) b)
)::text;`;
const command = `timeout 900s docker exec -i hey-hey-staging-postgres-1 sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_password)" exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq -v ON_ERROR_STOP=1'`;

export function summarizePostgres(samples) {
  const gaps = samples
    .slice(1)
    .map(
      (s, i) => Date.parse(s.capturedAt) - Date.parse(samples[i].capturedAt),
    );
  return {
    samples: samples.length,
    maxSampleGapMs: gaps.length ? Math.max(...gaps) : null,
    samplesWithBlockedSessions: samples.filter(
      (s) => s.blockedSessions.length > 0,
    ).length,
    maxActiveSessions: samples.length
      ? Math.max(...samples.map((s) => s.activeSessions))
      : null,
    maxActiveWaitingSessions: samples.length
      ? Math.max(...samples.map((s) => s.activeWaitingSessions))
      : null,
    waitObservations: samples
      .flatMap((s) => s.sessionGroups)
      .filter((g) => g.state === 'active' && g.wait_event !== null)
      .reduce((totals, g) => {
        const key = `${g.wait_event_type}:${g.wait_event}`;
        totals[key] = (totals[key] || 0) + g.sessions;
        return totals;
      }, {}),
    coverage:
      'Sampled database-wide state; fast waits can be missed. Wait observations are not distinct requests or durations. Backend identities are not mapped to request traces.',
  };
}

export async function startPostgresSampling({
  sshTarget,
  path,
  intervalMs = 250,
}) {
  const child = spawn(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshTarget, command],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const samples = [];
  const errors = [];
  let stopped = false;
  let pending = false;
  let ready;
  let rejectReady;
  const first = new Promise((resolve, reject) => {
    ready = resolve;
    rejectReady = reject;
  });
  let timer;
  const poll = () => {
    if (stopped || pending) return;
    pending = true;
    child.stdin.write(postgresWaitSql + '\n');
  };
  child.stdin.on('error', () => {
    errors.push('PostgreSQL sampler input closed');
  });
  child.stderr.on('data', () => {
    /* No stderr contents retained. */
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const sample = JSON.parse(line);
      samples.push(sample);
      appendFileSync(path, JSON.stringify(sample) + '\n');
      pending = false;
      ready();
    } catch {
      errors.push('PostgreSQL sample could not be decoded or saved');
      stopped = true;
      rejectReady(new Error('PostgreSQL sampler failed before benchmark'));
      child.stdin.end();
    }
  });
  const closed = new Promise((resolve) => {
    child.on('error', () => {
      errors.push('PostgreSQL sampler process failed');
      rejectReady(new Error('PostgreSQL sampler failed before benchmark'));
    });
    child.on('close', (code, signal) => {
      clearInterval(timer);
      if (!stopped || code !== 0)
        errors.push(`PostgreSQL sampler exited: ${code ?? signal}`);
      if (!samples.length)
        rejectReady(
          new Error('PostgreSQL sampler produced no samples; no benchmark ran'),
        );
      resolve();
    });
  });
  child.stdin.write(
    "SET default_transaction_read_only = on; SET statement_timeout = '2s';\n",
  );
  child.stdin.write(
    "SELECT 'SET pg_stat_statements.track=none' WHERE current_setting('pg_stat_statements.track',true) IS NOT NULL\n\\gexec\n",
  );
  poll();
  const startupTimeout = setTimeout(() => {
    stopped = true;
    child.kill('SIGTERM');
    rejectReady(
      new Error('PostgreSQL sampler startup timed out; no benchmark ran'),
    );
  }, 20_000);
  try {
    await first;
  } finally {
    clearTimeout(startupTimeout);
  }
  timer = setInterval(poll, intervalMs);
  timer.unref();
  return {
    async stop(startedAt, endedAt, warmupSeconds) {
      stopped = true;
      clearInterval(timer);
      child.stdin.end();
      const shutdownTimeout = setTimeout(() => child.kill('SIGTERM'), 5000);
      try {
        await closed;
      } finally {
        clearTimeout(shutdownTimeout);
      }
      const measured = samples.filter(
        (s) =>
          Date.parse(s.capturedAt) >=
            Date.parse(startedAt) + warmupSeconds * 1000 &&
          Date.parse(s.capturedAt) <= Date.parse(endedAt),
      );
      return { path, intervalMs, errors, ...summarizePostgres(measured) };
    },
  };
}
