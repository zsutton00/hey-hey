import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

describe('remote migration stack bootstrap import', () => {
  let root: string;
  let source: string;
  let destination: string;
  let command: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    const temporaryRoot = path.resolve(__dirname, '../../../.tmp');
    fs.mkdirSync(temporaryRoot, { recursive: true });
    root = fs.mkdtempSync(path.join(temporaryRoot, 'bootstrap with spaces-'));
    source = path.join(
      root,
      'checkout/.tmp/migration-stack/bootstrap/application.dump',
    );
    destination = path.join(root, 'remote/state/bootstrap');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(source, 'custom-format dump fixture');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, 'find'),
      '#!/bin/bash\n/usr/bin/find "$@"\nexit "${FIND_EXIT:-0}"\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(bin, 'docker'),
      '#!/bin/bash\nprintf "%s\\n" "$@" > "$DOCKER_ARGS"\nexit "${DOCKER_EXIT:-0}"\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(bin, 'pnpm'),
      '#!/bin/bash\necho "Unexpected selected-checkout bootstrap invocation" >&2\nexit 99\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(bin, 'sha256sum'),
      '#!/bin/bash\nexec /usr/bin/shasum -a 256 "$@"\n',
      { mode: 0o755 },
    );
    env = {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      TEST_HOME: root,
      remote_root: path.join(root, 'remote'),
      DOCKER_ARGS: path.join(root, 'docker-args'),
    };
    const launcher = fs.readFileSync(
      path.resolve(__dirname, '../../../scripts/migration-stack-remote.sh'),
      'utf8',
    );
    const start = launcher.indexOf(
      'if [[ ! -s "\\$remote_root/state/bootstrap/application.dump" ]]',
    );
    const end = launcher.indexOf(
      "\nprintf '[%s] Building and starting stack",
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // Render the actual SSH heredoc, then execute only its bootstrap block.
    command = execFileSync(
      '/bin/bash',
      ['-c', `cat <<EOF\n${launcher.slice(start, end)}\nEOF`],
      { encoding: 'utf8', env },
    ).replaceAll('$HOME', '$TEST_HOME');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('imports with Docker alone, preserving content, permissions, and metadata', () => {
    const result = spawnSync('/bin/bash', ['-ec', command], {
      env,
      encoding: 'utf8',
    });
    expect(result.stderr).toContain(
      'Copying the existing Linux migration-stack bootstrap',
    );
    expect(result.status).toBe(0);
    const dump = fs.readFileSync(path.join(destination, 'application.dump'));
    expect(dump).toEqual(fs.readFileSync(source));
    expect(
      fs.statSync(path.join(destination, 'application.dump')).mode & 0o777,
    ).toBe(0o600);
    expect(
      fs.statSync(path.join(destination, 'metadata.txt')).mode & 0o777,
    ).toBe(0o600);
    expect(
      fs.readFileSync(path.join(destination, 'metadata.txt'), 'utf8'),
    ).toContain(`sha256=${createHash('sha256').update(dump).digest('hex')}\n`);
    expect(fs.readFileSync(env.DOCKER_ARGS!, 'utf8').split('\n')).toEqual([
      'run',
      '--rm',
      '--mount',
      `type=bind,source=${source},target=/bootstrap.dump,readonly`,
      'postgres:13',
      'pg_restore',
      '--list',
      '/bootstrap.dump',
      '',
    ]);
  });

  it('imports a discovered dump when find reports an incomplete search', () => {
    const result = spawnSync('/bin/bash', ['-ec', command], {
      env: { ...env, FIND_EXIT: '1' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      'bootstrap search could not inspect every directory',
    );
    expect(fs.readFileSync(path.join(destination, 'application.dump'))).toEqual(
      fs.readFileSync(source),
    );
  });

  it('reports a missing dump even when find reports an incomplete search', () => {
    fs.unlinkSync(source);
    const result = spawnSync('/bin/bash', ['-ec', command], {
      env: { ...env, FIND_EXIT: '1' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no existing Linux migration-stack bootstrap');
    expect(fs.readdirSync(destination)).toEqual([]);
  });

  it('does not install a dump when Docker validation fails', () => {
    const result = spawnSync('/bin/bash', ['-ec', command], {
      env: { ...env, DOCKER_EXIT: '7' },
    });
    expect(result.status).toBe(7);
    expect(fs.readdirSync(destination)).toEqual([]);
  });

  it('leaves an existing stack bootstrap untouched', () => {
    fs.writeFileSync(path.join(destination, 'application.dump'), 'existing');
    expect(spawnSync('/bin/bash', ['-ec', command], { env }).status).toBe(0);
    expect(
      fs.readFileSync(path.join(destination, 'application.dump'), 'utf8'),
    ).toBe('existing');
    expect(fs.existsSync(env.DOCKER_ARGS!)).toBe(false);
  });
});
