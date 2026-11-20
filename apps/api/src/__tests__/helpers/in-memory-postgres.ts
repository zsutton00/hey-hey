import { ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';

export interface InMemoryPostgres {
  /** Prisma-compatible connection URL for the in-process database. */
  url: string;
  close(): Promise<void>;
}

const SERVER_SCRIPT = join(__dirname, 'in-memory-postgres.server.mjs');
const STARTUP_TIMEOUT_MS = 120_000;

/**
 * A real PostgreSQL engine (PGlite) with the shipped Flyway migrations
 * applied. No server, container or installed PostgreSQL is needed, so
 * database tests run wherever the unit tests do. It runs in a child process
 * because Jest's module sandbox cannot load PGlite.
 */
export async function startInMemoryPostgres(): Promise<InMemoryPostgres> {
  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  const port = await waitForReady(child);

  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&sslmode=disable`,
    close: () =>
      new Promise((resolve) => {
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}

function waitForReady(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`In-memory PostgreSQL did not start: ${output}`));
    }, STARTUP_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const ready = /READY (\d+)/.exec(output);
      if (ready) {
        clearTimeout(timer);
        resolve(Number(ready[1]));
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`In-memory PostgreSQL exited with ${code}: ${output}`));
    });
  });
}
