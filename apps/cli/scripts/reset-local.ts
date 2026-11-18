import { execFileSync } from 'node:child_process';
import { lstat, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Entry, findCredentials } from '@napi-rs/keyring';
import { LOCAL_PROJECT, SERVICE_IMAGES } from '../src/local-app/compose';
import { InstallationStore } from '../src/local-app/installation-store';
import { LocalLifecycleOwners } from '../src/local-app/lifecycle-owners';
import { LocalKeyPairStore } from '../src/local-app/local-key-pair-store';

const directory = join(homedir(), '.heyhey', 'local-application');
const service = LocalKeyPairStore.service;
const terminal = createInterface({ input: process.stdin, output: process.stdout });
function docker(...args: string[]) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}
async function names(path: string) {
  try {
    return await readdir(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
function inventory(context: string) {
  const targets: { kind: string; id: string }[] = [];
  for (const kind of ['container', 'volume', 'network']) {
    const format = kind === 'volume' ? '{{.Name}}' : '{{.ID}}';
    const rows = docker(
      '--context',
      context,
      kind,
      'ls',
      ...(kind === 'container' ? ['-a', '--no-trunc'] : []),
      '--filter',
      'label=com.docker.compose.project=' + LOCAL_PROJECT,
      '--format',
      format,
    );
    for (const id of rows.split('\n').filter(Boolean)) {
      const labelsPath = kind === 'container' ? '.Config.Labels' : '.Labels';
      const labels = JSON.parse(
        docker(
          '--context',
          context,
          kind,
          'inspect',
          '--format',
          '{{json ' + labelsPath + '}}',
          id,
        ),
      );
      const label = (name: string) => labels['com.docker.compose.' + name];
      const owned =
        kind === 'container'
          ? Object.hasOwn(SERVICE_IMAGES, label('service')) &&
            label('project.working_dir') === directory
          : kind === 'volume'
            ? ['postgres-data', 'redis-data', 'api-keys'].includes(label('volume')) &&
              id === LOCAL_PROJECT + '_' + label('volume')
            : label('network') === 'default';
      if (!owned || label('project') !== LOCAL_PROJECT) {
        throw new Error(
          'Ambiguous Docker ownership for ' +
            kind +
            ' ' +
            id +
            '. Resolve the project collision before retrying.',
        );
      }
      targets.push({ kind, id });
    }
  }
  return targets;
}
async function reset() {
  const answer = (await terminal.question('Clear dedicated local CLI credentials too? [y/N] '))
    .trim()
    .toLowerCase();
  if (!['', 'n', 'no', 'y', 'yes'].includes(answer)) {
    throw new Error('Unrecognized credential choice.');
  }
  const clear = ['y', 'yes'].includes(answer);
  if (process.env.DOCKER_HOST) {
    throw new Error('Select the local Docker context and unset DOCKER_HOST before retrying.');
  }
  const context = docker('context', 'show');
  const endpoint = docker('context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}');
  if (!endpoint.startsWith('unix://')) {
    throw new Error('Reset requires a local Unix socket Docker context.');
  }
  const parent = join(homedir(), '.heyhey');
  for (const path of [parent, directory, join(directory, 'cli'), join(directory, 'bridges')]) {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    });
    if (stat && !stat.isDirectory()) {
      throw new Error('Expected an installation directory, found a link or file at ' + path);
    }
  }
  const resources = inventory(context);
  const fixed = [
    'compose.json',
    'compose.dev.json',
    'installation.json',
    'update-consent.json',
    'secrets.json',
    'dev-logs',
    'bridges',
  ];
  const files = (await names(directory))
    .filter(
      (name) =>
        fixed.includes(name) || /^(installation|update-consent)\.json\.\d+\.tmp$/.test(name),
    )
    .map((name) => join(directory, name));
  for (const name of await names(join(directory, 'cli'))) {
    if (clear || name !== 'credentials') {
      files.push(join(directory, 'cli', name));
    }
  }
  const accounts = clear ? findCredentials(service).map((entry) => entry.account) : [];
  console.log('Installation', directory, 'Docker', context, endpoint, 'project', LOCAL_PROJECT);
  console.log(
    'Deleting workspace data, setup, server sessions and account passkey registrations with the database.',
  );
  for (const { kind, id } of resources) console.log('Remove Docker', kind, id);
  for (const file of files) console.log('Remove', file);
  for (const account of accounts)
    console.log('Remove OS credential', service, JSON.stringify(account));
  console.log('Retaining images, model downloads, hosted and legacy stores.');
  if (!clear) {
    console.log('Retaining', service, 'and cli/credentials.');
  }
  console.log(
    'Browser cookies and authenticator passkeys require manual cleanup. See apps/cli/docs/reset-local.md.',
  );
  if (
    (await terminal.question('Type RESET heyhey-local to erase the listed targets: ')) !==
    'RESET heyhey-local'
  ) {
    console.log('Cancelled.');
    return;
  }
  const owners = new LocalLifecycleOwners(new InstallationStore(directory));
  const remaining = new Set([
    ...resources.map(({ kind, id }) => kind + ' ' + id),
    ...files,
    ...accounts.map((account) => service + ' ' + JSON.stringify(account)),
  ]);
  try {
    await owners.exclusive(async () => {
      if ((await owners.inspect()).length) {
        throw new Error('A local CLI bridge is active. Exit local CLI terminals and retry.');
      }
      if (JSON.stringify(inventory(context)) !== JSON.stringify(resources)) {
        throw new Error('Docker inventory changed. Retry to review current targets.');
      }
      for (const { kind, id } of resources) {
        docker('--context', context, kind, 'rm', ...(kind === 'container' ? ['-f'] : []), id);
        remaining.delete(kind + ' ' + id);
        console.log('Removed Docker', kind, id);
      }
      for (const file of files) {
        await rm(file, { recursive: true, force: true });
        remaining.delete(file);
        console.log('Removed', file);
      }
      for (const account of accounts) {
        const entry = new Entry(service, account);
        if (!entry.deleteCredential()) {
          throw new Error('Deletion unconfirmed for ' + service + ' ' + JSON.stringify(account));
        }
        remaining.delete(service + ' ' + JSON.stringify(account));
        console.log('Removed OS credential', service, JSON.stringify(account));
      }
    });
  } catch (error) {
    for (const target of remaining) {
      console.error('Remaining or unconfirmed:', target);
    }
    throw error;
  }
}
reset()
  .catch((error) => {
    console.error('Reset stopped.', error.message, 'Rerun to list remaining targets and retry.');
    process.exitCode = 1;
  })
  .finally(() => terminal.close());
