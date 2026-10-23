import { spawn } from 'node:child_process';

// SQL text never crosses the SSH boundary. Fingerprints/counters only.
const command = `timeout 20s docker exec -i hey-hey-staging-postgres-1 sh -c 'PGPASSWORD="$(cat /run/secrets/postgres_password)" exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq -v ON_ERROR_STOP=1'`;
const integerCounters = [
  'calls',
  'rows',
  'shared_blks_hit',
  'shared_blks_read',
  'shared_blks_dirtied',
  'shared_blks_written',
  'temp_blks_read',
  'temp_blks_written',
  'wal_records',
  'wal_fpi',
  'wal_bytes',
];
const timeCounters = [
  'total_exec_time',
  'blk_read_time',
  'blk_write_time',
  'shared_blk_read_time',
  'shared_blk_write_time',
  'temp_blk_read_time',
  'temp_blk_write_time',
];
export const statementCapabilitiesSql = `SELECT json_build_object(
 'version', current_setting('server_version_num'),
 'postmasterStart', pg_postmaster_start_time(),
 'preload', current_setting('shared_preload_libraries'),
 'ioTiming', current_setting('track_io_timing'),
 'track', current_setting('pg_stat_statements.track', true),
 'schema', (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_stat_statements'),
 'columns', (SELECT json_agg(a.attname) FROM pg_extension e JOIN pg_class c ON c.relnamespace=e.extnamespace AND c.relname='pg_stat_statements' JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 WHERE e.extname='pg_stat_statements'),
 'hasInfo', EXISTS(SELECT 1 FROM pg_extension e JOIN pg_class c ON c.relnamespace=e.extnamespace AND c.relname='pg_stat_statements_info' WHERE e.extname='pg_stat_statements')
)::text;`;

export function readPostgresJson(sshTarget, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshTarget, command],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('PostgreSQL snapshot timed out'));
    }, 25000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 16 * 1024 * 1024) {
        child.kill('SIGTERM');
        reject(new Error('PostgreSQL snapshot exceeded output bound'));
      }
    });
    child.stderr.on('data', () => {}); // May contain SQL or connection details.
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('PostgreSQL snapshot process failed'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(new Error(`PostgreSQL snapshot exited ${code}`));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error('PostgreSQL snapshot JSON unavailable'));
      }
    });
    child.stdin.end(
      "SET default_transaction_read_only=on; SET statement_timeout='5s';\n" +
        sql +
        '\n',
    );
  });
}

export function statementSnapshotSql(capabilities) {
  const schema = '"' + capabilities.schema.replaceAll('"', '""') + '"';
  const columns = capabilities.columns;
  const counters = [...integerCounters, ...timeCounters].filter((key) =>
    columns.includes(key),
  );
  const projection = [
    'dbid::text',
    'userid::text',
    'queryid::text',
    ...(columns.includes('toplevel') ? ['toplevel'] : []),
    ...(columns.includes('stats_since') ? ['stats_since'] : []),
    ...counters.map((key) =>
      integerCounters.includes(key) ? `${key}::text` : key,
    ),
  ];
  return `SET pg_stat_statements.track='none';
WITH entries AS MATERIALIZED (SELECT ${projection.join(', ')} FROM ${schema}.pg_stat_statements(false) WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()))
SELECT json_build_object('capturedAt',clock_timestamp(),'postmasterStart',pg_postmaster_start_time(),
 'info', ${capabilities.hasInfo ? `(SELECT json_build_object('stats_reset',stats_reset,'dealloc',dealloc::text) FROM ${schema}.pg_stat_statements_info)` : 'null'},
 'totalEntries',(SELECT count(*) FROM entries),
 'entries',(SELECT coalesce(json_agg(row_to_json(b)), '[]'::json) FROM (SELECT * FROM entries ORDER BY dbid,userid,queryid LIMIT 20000) b))::text;`;
}

export async function capturePostgresStatements(sshTarget) {
  try {
    const capabilities = await readPostgresJson(
      sshTarget,
      statementCapabilitiesSql,
    );
    if (
      !capabilities.schema ||
      !capabilities.track ||
      capabilities.track === 'none'
    )
      return {
        available: false,
        capturedAt: new Date().toISOString(),
        capabilities,
        gap: 'pg_stat_statements is not installed, preloaded, or tracking is disabled',
      };
    const snapshot = await readPostgresJson(
      sshTarget,
      statementSnapshotSql(capabilities),
    );
    return {
      available: true,
      capabilities,
      ...snapshot,
      truncated: snapshot.totalEntries > snapshot.entries.length,
    };
  } catch (error) {
    return {
      available: false,
      capturedAt: new Date().toISOString(),
      gap: error.message,
    };
  }
}

const key = (entry) =>
  `${entry.dbid}:${entry.userid}:${entry.queryid}:${entry.toplevel ?? 'legacy'}`;
export function comparePostgresStatements(before, after) {
  const gaps = [];
  const result = {
    startAt: before.capturedAt,
    endAt: after.capturedAt,
    gaps,
    coverage:
      'Database-wide completed-statement counter deltas, including concurrent traffic. Execution time is not CPU time or latency percentiles. Query text, parameters and plans are not exported. No statistics are reset.',
    ranked: [],
    unmatched: [],
    invalidated: [],
  };
  if (!before.available || !after.available) {
    gaps.push(before.gap, after.gap);
    return result;
  }
  if (before.postmasterStart !== after.postmasterStart) {
    gaps.push('PostgreSQL restarted between snapshots');
    return result;
  }
  if (before.capabilities.version !== after.capabilities.version) {
    gaps.push('PostgreSQL version changed');
    return result;
  }
  if (before.truncated || after.truncated)
    gaps.push(
      'Snapshot row bound reached; unmatched entries cannot be assumed new',
    );
  if (!before.info || !after.info)
    gaps.push(
      'Reset/eviction metadata unavailable on this PostgreSQL version; undetectable resets can invalidate apparently monotonic deltas',
    );
  else {
    if (before.info.stats_reset !== after.info.stats_reset) {
      gaps.push('Statement statistics reset between snapshots');
      return result;
    }
    if (before.info.dealloc !== after.info.dealloc)
      gaps.push(
        'Entries were evicted during the interval; deltas may undercount',
      );
  }
  const prior = new Map(before.entries.map((entry) => [key(entry), entry]));
  for (const entry of after.entries) {
    const identity = key(entry);
    const previous = prior.get(identity);
    if (!previous) {
      result.unmatched.push(identity);
      continue;
    }
    prior.delete(identity);
    if (entry.stats_since !== previous.stats_since) {
      result.invalidated.push(identity);
      continue;
    }
    const delta = {
      dbid: entry.dbid,
      userid: entry.userid,
      queryid: entry.queryid,
      toplevel: entry.toplevel,
    };
    let invalid = false;
    for (const field of integerCounters) {
      if (entry[field] === undefined || previous[field] === undefined) continue;
      const value = BigInt(entry[field]) - BigInt(previous[field]);
      if (value < 0n) invalid = true;
      delta[field] = value.toString();
    }
    for (const field of timeCounters) {
      if (entry[field] === undefined || previous[field] === undefined) continue;
      delta[field] = entry[field] - previous[field];
      if (delta[field] < 0) invalid = true;
    }
    if (invalid) {
      result.invalidated.push(identity);
      continue;
    }
    if (BigInt(delta.calls) > 0n)
      result.ranked.push({
        ...delta,
        meanExecutionMs: delta.total_exec_time / Number(delta.calls),
      });
  }
  result.disappeared = [...prior.keys()];
  if (result.invalidated.length)
    gaps.push(
      'Counters decreased or per-entry reset timestamps changed; affected entries excluded',
    );
  if (result.unmatched.length || result.disappeared.length)
    gaps.push(
      'Unmatched/disappeared fingerprints excluded rather than assuming zero baseline',
    );
  result.ranked.sort((a, b) => b.total_exec_time - a.total_exec_time);
  result.ioTiming = {
    before: before.capabilities.ioTiming,
    after: after.capabilities.ioTiming,
  };
  if (result.ioTiming.before !== 'on' || result.ioTiming.after !== 'on')
    gaps.push(
      'I/O timing disabled for at least one snapshot; zero timing is not proof of no I/O',
    );
  return result;
}
