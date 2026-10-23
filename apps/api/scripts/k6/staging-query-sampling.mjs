import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

// Query text stays in memory; only literal-free templates are retained.
export function queryTemplate(text) {
  return text
    .replace(
      /'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      '?',
    )
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseQueries(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('['))
    .map((line) => {
      const [text, elapsed, cpu, wait, allocatedBytes, pageHits, pageFaults] =
        JSON.parse(line);
      const template = queryTemplate(text);
      return {
        fingerprint: createHash('sha256').update(template).digest('hex'),
        template,
        elapsed,
        cpu,
        wait,
        allocatedBytes,
        pageHits,
        pageFaults,
      };
    });
}

export function startQuerySampling(sshTarget) {
  const source = readFileSync(
    new URL('./staging-query-worker.py', import.meta.url),
    'utf8',
  );
  const port = Number(process.env.STAGING_NEO4J_HTTP_PORT || 17474);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid Neo4j HTTP port');
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const child = spawn(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      sshTarget,
      `python3 -u -c ${quote(source)} ${port}`,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let pending;
  let closed = false;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const fail = () => {
    closed = true;
    const error = new Error('Persistent Neo4j collector unavailable');
    readyReject(error);
    pending?.reject(error);
    pending = undefined;
  };
  child.on('error', fail);
  child.on('exit', fail);
  child.stdin.on('error', fail);
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const row = JSON.parse(line);
      if (row.ready) readyResolve(row);
      else if (pending) {
        pending.resolve(row);
        pending = undefined;
      } else if (row.queryError) fail();
    } catch {
      fail();
      child.kill();
    }
  });
  const timeout = (promise) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          child.kill();
          reject(new Error('Neo4j collector timed out'));
        }, 10000);
      }),
    ]).finally(() => clearTimeout(timer));
  };
  const initialized = timeout(ready);
  initialized.catch(() => {});
  return {
    async sample() {
      await initialized;
      if (closed) throw new Error('Neo4j collector closed');
      if (pending) throw new Error('Neo4j query poll already pending');
      return timeout(
        new Promise((resolve, reject) => {
          pending = { resolve, reject };
          child.stdin.write('sample\n');
        }),
      );
    },
    async close() {
      child.stdin.end();
      child.kill();
    },
  };
}
