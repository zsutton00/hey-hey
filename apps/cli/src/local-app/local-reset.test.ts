import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalReset } from './local-reset';
import { devWorkspace, installedWorkspace } from './local-workspace';

const keyring = vi.hoisted(() => ({
  services: ['heyhey-local-cli', 'heyhey-local-dev-cli'],
  deleted: [] as string[],
}));

vi.mock('@napi-rs/keyring', () => ({
  findCredentials: (service: string) =>
    keyring.services.includes(service) ? [{ account: 'machine-key' }] : [],
  Entry: class {
    constructor(
      readonly service: string,
      readonly account: string,
    ) {}
    deleteCredential() {
      keyring.deleted.push(`${this.service}/${this.account}`);
      return true;
    }
  },
}));

/** A Docker CLI reporting each workspace's labeled containers, volumes and network. */
function fakeDocker(workspaces: { project: string; directory: string }[], log: string): string {
  const rows = workspaces.flatMap(({ project, directory }) => {
    const container = (service: string) =>
      JSON.stringify({
        'com.docker.compose.project': project,
        'com.docker.compose.service': service,
        'com.docker.compose.project.working_dir': directory,
      });
    const volume = (name: string) =>
      JSON.stringify({
        'com.docker.compose.project': project,
        'com.docker.compose.volume': name,
      });
    const filter = `*'project=${project} '*`;
    return [
      `  *'container ls'${filter}) printf '${project}-postgres\\n${project}-api\\n' ;;`,
      `  *'volume ls'${filter}) printf '${project}_postgres-data\\n${project}_redis-data\\n${project}_api-keys\\n' ;;`,
      `  *'network ls'${filter}) echo ${project}-net ;;`,
      `  *'inspect'*' ${project}-postgres') echo '${container('postgres')}' ;;`,
      `  *'inspect'*' ${project}-api') echo '${container('api')}' ;;`,
      ...['postgres-data', 'redis-data', 'api-keys'].map(
        (name) => `  *'inspect'*' ${project}_${name}') echo '${volume(name)}' ;;`,
      ),
      `  *'inspect'*' ${project}-net') echo '{"com.docker.compose.project":"${project}","com.docker.compose.network":"default"}' ;;`,
    ];
  });
  return `#!/bin/sh
case "$*" in
  'context show') echo test ;;
  'context inspect test --format {{.Endpoints.docker.Host}}') echo unix:///test ;;
${rows.join('\n')}
  *' ls '*) ;;
  *' rm '*) echo "$*" >> '${log}' ;;
  *) exit 9 ;;
esac
`;
}

const INSTALLATION_FILES = [
  'installation.json',
  'secrets.json',
  'compose.json',
  'compose.dev.json',
  'dev-logs/api.log',
  'models/snowflake-arctic-embed-s/model.onnx',
  'cli/controllers/index',
  'cli/credentials/oauth',
  'unrelated.txt',
];

describe('LocalReset', () => {
  let home: string;
  let directory: string;
  let devDirectory: string;
  let log: string;
  const originalPath = process.env['PATH'] ?? '';

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'heyhey-local-reset-'));
    directory = installedWorkspace(home).directory;
    devDirectory = devWorkspace(home).directory;
    log = join(home, 'docker.log');
    for (const root of [directory, devDirectory]) {
      for (const file of INSTALLATION_FILES) {
        await mkdir(join(root, file, '..'), { recursive: true });
        await writeFile(join(root, file), 'sentinel');
      }
    }
    const docker = fakeDocker([installedWorkspace(home), devWorkspace(home)], log);
    await writeFile(join(home, 'docker'), docker, { mode: 0o700 });
    await writeFile(log, '');
    process.env['PATH'] = `${home}:${originalPath}`;
    keyring.deleted = [];
  });

  afterEach(async () => {
    process.env['PATH'] = originalPath;
    await rm(home, { recursive: true, force: true });
  });

  async function present(file: string, root = directory): Promise<boolean> {
    return stat(join(root, file)).then(
      () => true,
      () => false,
    );
  }

  it('fresh start clears account data and pairing but keeps installation identity, images and models', async () => {
    const reset = new LocalReset('fresh-start', true, installedWorkspace(home));

    await reset.apply(await reset.plan());

    const removed = (await readFile(log, 'utf8')).trim().split('\n');
    expect(removed).toEqual([
      '--context test container rm -f heyhey-local-postgres',
      '--context test container rm -f heyhey-local-api',
      '--context test volume rm heyhey-local_postgres-data',
      '--context test volume rm heyhey-local_redis-data',
    ]);
    for (const kept of [
      'installation.json',
      'secrets.json',
      'compose.dev.json',
      'models/snowflake-arctic-embed-s/model.onnx',
      'unrelated.txt',
    ]) {
      expect(await present(kept), kept).toBe(true);
    }
    expect(await present('cli/controllers')).toBe(false);
    expect(await present('cli/credentials')).toBe(false);
    expect(keyring.deleted).toEqual(['heyhey-local-cli/machine-key']);
  });

  it('full reset removes installation and dev-mode state, keeping models and credentials unless asked', async () => {
    const reset = new LocalReset('installation', false, installedWorkspace(home));

    await reset.apply(await reset.plan());

    const removed = await readFile(log, 'utf8');
    expect(removed).toContain('volume rm heyhey-local_api-keys');
    expect(removed).toContain('network rm heyhey-local-net');
    expect(removed).not.toContain('heyhey-local-dev');
    for (const gone of [
      'installation.json',
      'secrets.json',
      'compose.json',
      'compose.dev.json',
      'dev-logs',
      'cli/controllers',
    ]) {
      expect(await present(gone), gone).toBe(false);
    }
    for (const kept of [
      'models/snowflake-arctic-embed-s/model.onnx',
      'cli/credentials/oauth',
      'unrelated.txt',
    ]) {
      expect(await present(kept), kept).toBe(true);
    }
    expect(keyring.deleted).toEqual([]);
  });

  it('dev fresh start clears the paired dev workspace and leaves the populated installed one alone', async () => {
    const reset = new LocalReset('fresh-start', true, devWorkspace(home));

    await reset.apply(await reset.plan());

    expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual([
      '--context test container rm -f heyhey-local-dev-postgres',
      '--context test container rm -f heyhey-local-dev-api',
      '--context test volume rm heyhey-local-dev_postgres-data',
      '--context test volume rm heyhey-local-dev_redis-data',
    ]);
    expect(keyring.deleted).toEqual(['heyhey-local-dev-cli/machine-key']);
    expect(await present('cli/credentials', devDirectory)).toBe(false);
    for (const kept of [
      'installation.json',
      'secrets.json',
      'models/snowflake-arctic-embed-s/model.onnx',
    ]) {
      expect(await present(kept, devDirectory), kept).toBe(true);
    }
    for (const kept of INSTALLATION_FILES) {
      expect(await present(kept), kept).toBe(true);
    }
  });
});
