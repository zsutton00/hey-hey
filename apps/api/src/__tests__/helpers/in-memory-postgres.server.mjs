// Runs outside the Jest module sandbox, which cannot load PGlite's WASM.
// Applies the shipped Flyway migrations to an in-process PostgreSQL engine,
// serves it on a free loopback port, and prints "READY <port>" when usable.
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const flywayDirectory = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  '..',
  'db',
  'flyway',
);
const beforeEachMigrate = 'beforeEachMigrate__clear_diagram_helpers.sql';

// Flyway orders by numeric version parts, not by file name.
const versionParts = (file) =>
  file.replace(/^[BV]/, '').split('__')[0].split('.').map(Number);

const compareVersions = (a, b) => {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
};

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const database = new PGlite({ extensions: { pg_trgm } });
await database.waitReady;

const callback = readFileSync(join(flywayDirectory, beforeEachMigrate), 'utf8');
const migrations = readdirSync(flywayDirectory)
  .filter((file) => /^[BV].*\.sql$/.test(file))
  .sort(compareVersions);
// Flyway records each applied migration; some migrations read that history.
await database.exec(`
  CREATE TABLE flyway_schema_history (
    version VARCHAR(50),
    description VARCHAR(200) NOT NULL,
    installed_on TIMESTAMP NOT NULL DEFAULT now(),
    success BOOLEAN NOT NULL
  )
`);
for (const migration of migrations) {
  await database.exec(callback);
  await database.exec(readFileSync(join(flywayDirectory, migration), 'utf8'));
  const [version, description] = migration.replace(/^[BV]/, '').split('__');
  await database.query(
    'INSERT INTO flyway_schema_history (version, description, success) VALUES ($1, $2, true)',
    [version, description.replace(/\.sql$/, '')],
  );
}

const port = await freePort();
const server = new PGLiteSocketServer({
  db: database,
  host: '127.0.0.1',
  port,
});
await server.start();
console.log(`READY ${port}`);

const shutdown = async () => {
  await server.stop();
  await database.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('disconnect', shutdown);
