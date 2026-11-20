import { execFileSync } from 'node:child_process';
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Entry, findCredentials } from '@napi-rs/keyring';
import { z } from 'zod/v4';
import { SERVICE_IMAGES } from './compose';
import { InstallationStore } from './installation-store';
import { LocalLifecycleOwners } from './lifecycle-owners';
import { installedWorkspace, type LocalWorkspace } from './local-workspace';

/**
 * `installation` erases everything the local installation owns, so the next run is a first install.
 * `fresh-start` erases only the account, projects, setup, sessions and this computer's pairing;
 * installation identity, secrets, images and model files are kept so the next run is a fast first use.
 */
export type LocalResetScope = 'installation' | 'fresh-start';

export const LOCAL_RESET_CONFIRMATION = 'RESET heyhey-local';

const OWNED_VOLUMES = ['postgres-data', 'redis-data', 'api-keys'];
const VOLUMES_BY_SCOPE: Record<LocalResetScope, string[]> = {
  installation: OWNED_VOLUMES,
  'fresh-start': ['postgres-data', 'redis-data'],
};
const INSTALLATION_FILES = [
  'compose.json',
  'compose.dev.json',
  'installation.json',
  'update-consent.json',
  'secrets.json',
  'dev-logs',
  'bridges',
];
const labelsSchema = z.record(z.string(), z.string());
const TEMPORARY_FILE = /^(installation|update-consent)\.json\.\d+\.tmp$/;

interface DockerTarget {
  kind: 'container' | 'volume' | 'network';
  id: string;
}

export interface LocalResetPlan {
  context: string;
  endpoint: string;
  resources: DockerTarget[];
  files: string[];
  accounts: string[];
}

async function names(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * The one list of what Hey Hey's local installation owns and may delete. Docker resources are
 * positively identified by compose labels and the installation directory; keyring entries only
 * from the dedicated local service. Never prunes Docker or deletes a whole keyring.
 */
export class LocalReset {
  readonly service: string;
  readonly directory: string;
  private readonly project: string;

  constructor(
    readonly scope: LocalResetScope,
    /** Also erase this computer's local CLI credentials and pairing keys. Always true for fresh start. */
    readonly clearCredentials: boolean,
    readonly workspace: LocalWorkspace = installedWorkspace(),
  ) {
    this.service = workspace.credentialService;
    this.directory = workspace.directory;
    this.project = workspace.project;
  }

  async plan(): Promise<LocalResetPlan> {
    if (process.env['DOCKER_HOST']) {
      throw new Error('Select the local Docker context and unset DOCKER_HOST before retrying.');
    }
    const context = this.docker('context', 'show');
    const endpoint = this.docker(
      'context',
      'inspect',
      context,
      '--format',
      '{{.Endpoints.docker.Host}}',
    );
    if (!endpoint.startsWith('unix://')) {
      throw new Error('Reset requires a local Unix socket Docker context.');
    }
    await this.assertDirectories();

    const resources = this.inventory(context);
    const files = await this.files();
    const accounts = this.clearCredentials
      ? findCredentials(this.service).map((entry) => entry.account)
      : [];
    return { context, endpoint, resources, files, accounts };
  }

  /** What `apply` will remove and keep, one line each, for review before confirmation. */
  describe(plan: LocalResetPlan): string[] {
    const lines = [
      `${this.workspace.label === 'dev' ? 'Dev workspace' : 'Installation'} ${this.directory} Docker ${plan.context} ${plan.endpoint} project ${this.project}`,
      'Deleting workspace data, setup, server sessions and account passkey registrations with the database.',
      ...plan.resources.map(({ kind, id }) => `Remove Docker ${kind} ${id}`),
      ...plan.files.map((file) => `Remove ${file}`),
      ...plan.accounts.map(
        (account) => `Remove OS credential ${this.service} ${JSON.stringify(account)}`,
      ),
    ];
    if (this.scope === 'fresh-start') {
      lines.push(
        'Retaining installation identity, secrets, images, model downloads, hosted and legacy stores.',
      );
    } else {
      lines.push('Retaining images, model downloads, hosted and legacy stores.');
    }
    if (!this.clearCredentials) {
      lines.push(`Retaining ${this.service} and cli/credentials.`);
    }
    lines.push(
      'Browser cookies and authenticator passkeys require manual cleanup. See apps/cli/docs/reset-local.md.',
    );
    return lines;
  }

  /** Removes the reviewed targets; refuses if a bridge is active or Docker changed since `plan`. */
  async apply(plan: LocalResetPlan): Promise<void> {
    const owners = new LocalLifecycleOwners(new InstallationStore(this.directory));
    const credentialKey = (account: string) => `${this.service} ${JSON.stringify(account)}`;
    const remaining = new Set([
      ...plan.resources.map(({ kind, id }) => `${kind} ${id}`),
      ...plan.files,
      ...plan.accounts.map(credentialKey),
    ]);
    try {
      await owners.exclusive(async () => {
        if ((await owners.inspect()).length) {
          throw new Error('A local CLI bridge is active. Exit local CLI terminals and retry.');
        }
        if (JSON.stringify(this.inventory(plan.context)) !== JSON.stringify(plan.resources)) {
          throw new Error('Docker inventory changed. Retry to review current targets.');
        }

        for (const { kind, id } of plan.resources) {
          const force = kind === 'container' ? ['-f'] : [];
          this.docker('--context', plan.context, kind, 'rm', ...force, id);
          remaining.delete(`${kind} ${id}`);
          console.log('Removed Docker', kind, id);
        }

        for (const file of plan.files) {
          await rm(file, { recursive: true, force: true });
          remaining.delete(file);
          console.log('Removed', file);
        }

        for (const account of plan.accounts) {
          if (!new Entry(this.service, account).deleteCredential()) {
            throw new Error(`Deletion unconfirmed for ${credentialKey(account)}`);
          }
          remaining.delete(credentialKey(account));
          console.log('Removed OS credential', credentialKey(account));
        }
      });
    } catch (error) {
      for (const target of remaining) {
        console.error('Remaining or unconfirmed:', target);
      }
      throw error;
    }
  }

  private docker(...args: string[]): string {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim();
  }

  private async assertDirectories(): Promise<void> {
    const expected = [
      join(this.directory, '..'),
      this.directory,
      join(this.directory, 'cli'),
      join(this.directory, 'bridges'),
    ];
    for (const path of expected) {
      const stat = await lstat(path).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return undefined;
        }
        throw error;
      });
      if (stat && !stat.isDirectory()) {
        throw new Error(`Expected an installation directory, found a link or file at ${path}`);
      }
    }
  }

  /**
   * Every labeled resource must be positively owned by this installation, or the reset refuses.
   * Fresh start then targets only containers and the data volumes.
   */
  private inventory(context: string): DockerTarget[] {
    const targets: DockerTarget[] = [];
    for (const kind of ['container', 'volume', 'network'] as const) {
      const format = kind === 'volume' ? '{{.Name}}' : '{{.ID}}';
      const listAll = kind === 'container' ? ['-a', '--no-trunc'] : [];
      const rows = this.docker(
        '--context',
        context,
        kind,
        'ls',
        ...listAll,
        '--filter',
        `label=com.docker.compose.project=${this.project}`,
        '--format',
        format,
      );
      for (const id of rows.split('\n').filter(Boolean)) {
        const labels = this.labels(context, kind, id);
        const label = (name: string) => labels[`com.docker.compose.${name}`];
        if (!this.owned(kind, id, label) || label('project') !== this.project) {
          throw new Error(
            `Ambiguous Docker ownership for ${kind} ${id}. Resolve the project collision before retrying.`,
          );
        }
        if (this.targeted(kind, label)) {
          targets.push({ kind, id });
        }
      }
    }
    return targets;
  }

  private labels(context: string, kind: DockerTarget['kind'], id: string): Record<string, string> {
    const path = kind === 'container' ? '.Config.Labels' : '.Labels';
    const json = this.docker(
      '--context',
      context,
      kind,
      'inspect',
      '--format',
      `{{json ${path}}}`,
      id,
    );
    return labelsSchema.parse(JSON.parse(json) ?? {});
  }

  private owned(
    kind: DockerTarget['kind'],
    id: string,
    label: (name: string) => string | undefined,
  ): boolean {
    if (kind === 'container') {
      return (
        Object.hasOwn(SERVICE_IMAGES, label('service') ?? '') &&
        label('project.working_dir') === this.directory
      );
    }
    if (kind === 'volume') {
      const volume = label('volume') ?? '';
      return OWNED_VOLUMES.includes(volume) && id === `${this.project}_${volume}`;
    }
    return label('network') === 'default';
  }

  private targeted(
    kind: DockerTarget['kind'],
    label: (name: string) => string | undefined,
  ): boolean {
    if (kind === 'volume') {
      return VOLUMES_BY_SCOPE[this.scope].includes(label('volume') ?? '');
    }
    return kind === 'container' || this.scope === 'installation';
  }

  private async files(): Promise<string[]> {
    const files =
      this.scope === 'installation'
        ? (await names(this.directory))
            .filter((name) => INSTALLATION_FILES.includes(name) || TEMPORARY_FILE.test(name))
            .map((name) => join(this.directory, name))
        : [];
    const cli = join(this.directory, 'cli');
    for (const name of await names(cli)) {
      if (this.clearCredentials || name !== 'credentials') {
        files.push(join(cli, name));
      }
    }
    return files;
  }
}
