import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('preview can cancel, then reset populated files while retaining credentials and caches', async () => {
  const home = await mkdtemp(join(tmpdir(), 'heyhey-reset-test-'));
  const directory = join(home, '.heyhey/local-application');
  try {
    for (const file of [
      'installation.json',
      'secrets.json',
      'cli/controllers/index',
      'cli/credentials/oauth',
      'models/model',
      'independent',
    ]) {
      const path = join(directory, file);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, 'sentinel');
    }
    await writeFile(
      join(home, 'docker'),
      `#!/bin/sh
case "$*" in
  'context show') echo test ;;
  'context inspect test --format {{.Endpoints.docker.Host}}') echo unix:///test ;;
  *' ls '*) exit 0 ;;
  *) exit 9 ;;
esac
`,
      { mode: 0o700 },
    );
    async function run(confirm) {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/reset-local.ts'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, HOME: home, DOCKER_HOST: '', PATH: home + ':' + process.env.PATH },
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (chunk.toString().includes('[y/N]')) child.stdin.write('n\n');
        if (chunk.toString().includes('Type RESET')) child.stdin.end(confirm + '\n');
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      const code = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      assert.equal(code, 0, output);
    }
    await run('cancel');
    assert.equal(await readFile(join(directory, 'secrets.json'), 'utf8'), 'sentinel');
    await run('RESET heyhey-local');
    for (const file of ['installation.json', 'secrets.json', 'cli/controllers']) {
      await assert.rejects(stat(join(directory, file)), { code: 'ENOENT' });
    }
    for (const file of ['cli/credentials/oauth', 'models/model', 'independent']) {
      assert.equal(await readFile(join(directory, file), 'utf8'), 'sentinel');
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
