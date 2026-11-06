import { spawn } from 'node:child_process';
import { StructuredServerLogger } from '../server/logger';
import { z } from 'zod/v4';
import { LOCAL_PROJECT, SERVICE_IMAGES } from './compose';

const containerSchema = z.array(
  z.object({
    Id: z.string(),
    Config: z.object({
      Image: z.string(),
      Labels: z.record(z.string(), z.string()).nullable(),
      Env: z.array(z.string()).nullable().optional(),
    }),
    State: z.object({
      Running: z.boolean(),
      Status: z.string(),
      Health: z.object({ Status: z.string() }).optional(),
    }),
  }),
);
export type ObservedContainer = z.infer<typeof containerSchema>[number];

/** All Docker and Compose process access lives here, including discovery. */
export class DockerBoundary {
  constructor(private readonly readiness = { attempts: 120, intervalMs: 1000 }) {}

  private readonly logger = new StructuredServerLogger({}, { component: 'local-docker' });
  async command(args: string[], input?: string): Promise<string> {
    this.logger.debug('local.docker.command', { operation: args[0] });
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      // Docker diagnostics may contain environment values. Never surface raw output.
      child.stderr.resume();
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Docker timed out. Check Docker and available resources, then retry.'));
      }, 600_000);
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('Docker is unavailable. Install Docker with Compose, then retry.'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(output);
          return;
        }
        reject(
          new Error(
            'Docker operation failed. Check Docker, disk space and service diagnostics, then retry.',
          ),
        );
      });
      child.stdin.on('error', () => {
        // The process close/error handlers report this command failure.
      });
      child.stdin.end(input);
    });
  }

  async prerequisite(): Promise<'ready' | 'missing' | 'stopped' | 'compose'> {
    try {
      await this.command(['--version']);
    } catch {
      return 'missing';
    }
    try {
      await this.command(['info', '--format', '{{.ServerVersion}}']);
    } catch {
      return 'stopped';
    }
    try {
      await this.command(['compose', 'version']);
    } catch {
      return 'compose';
    }
    return 'ready';
  }

  async inspect(): Promise<ObservedContainer[]> {
    const ids = (
      await this.command([
        'ps',
        '-aq',
        '--filter',
        `label=com.docker.compose.project=${LOCAL_PROJECT}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length === 0) {
      return [];
    }
    return containerSchema.parse(JSON.parse(await this.command(['inspect', ...ids])));
  }

  async hasPersistentStorage(): Promise<boolean> {
    const volumes = await this.command([
      'volume',
      'ls',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${LOCAL_PROJECT}`,
    ]);
    return volumes.trim().length > 0;
  }

  async compose(path: string, args: string[], input?: string): Promise<void> {
    await this.command(
      ['compose', '--project-name', LOCAL_PROJECT, '--file', path, ...args],
      input,
    );
  }

  async stop(path: string): Promise<void> {
    await this.compose(path, ['stop']);
  }

  async pull(path: string): Promise<void> {
    await this.compose(path, ['pull']);
  }
  private async startService(path: string, service: string, wait: boolean): Promise<void> {
    try {
      await this.compose(path, [
        'up',
        '-d',
        ...(wait ? ['--wait', '--wait-timeout', '120'] : []),
        '--pull',
        'never',
        service,
      ]);
    } catch {
      throw new Error(
        `${service} could not start. Check its Docker service diagnostics, available resources, port conflicts and configuration, then retry. Data is preserved.`,
      );
    }
  }

  /** Recreates only the UI container so changed runtime configuration takes effect. */
  async recreateUi(path: string): Promise<void> {
    try {
      await this.compose(path, ['up', '-d', '--no-deps', '--pull', 'never', 'ui']);
    } catch {
      throw new Error(
        'ui could not restart. Check its Docker service diagnostics and configuration, then retry. Data is preserved.',
      );
    }
  }

  async startDatabase(path: string): Promise<void> {
    for (const service of ['postgres', 'redis']) {
      await this.startService(path, service, true);
    }
  }
  async provision(path: string, sql: string): Promise<void> {
    await this.compose(
      path,
      [
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      sql,
    );
  }
  /**
   * `outOfOrder` is for dev mode only: a checkout ahead of the installed release
   * can carry migrations dated before ones the release already applied.
   */
  async migrate(path: string, { outOfOrder = false } = {}): Promise<void> {
    await this.compose(path, [
      'run',
      '--rm',
      '--no-deps',
      '--pull',
      'never',
      'api',
      'flyway',
      '-locations=filesystem:/app/db/flyway',
      ...(outOfOrder ? ['-outOfOrder=true'] : []),
      'migrate',
    ]);
  }
  async startApplication(path: string): Promise<void> {
    await this.startService(path, 'api', false);
    // Graph/search fetches API signing keys during construction and cannot boot
    // until the API has completed its own database and Redis initialization.
    await this.waitForServices(['api']);
    for (const service of ['graph-search', 'ui']) {
      await this.startService(path, service, false);
    }
  }

  async health(services: string[] = Object.keys(SERVICE_IMAGES)): Promise<void> {
    await this.waitForServices(services);
  }

  /** Developer-only: graph/search alone, once an API run from source serves signing keys. */
  async startGraphSearch(path: string): Promise<void> {
    await this.startService(path, 'graph-search', false);
  }

  /** Removes containers only; named volumes, and so all data, are kept. */
  async removeContainers(path: string, services: string[]): Promise<void> {
    await this.compose(path, ['rm', '--stop', '--force', ...services]);
  }

  private async waitForServices(services: string[]): Promise<void> {
    let failure = 'api signing keys are unavailable';
    for (let attempt = 0; attempt < this.readiness.attempts; attempt++) {
      const containers = await this.inspect();
      const unready = services.flatMap((service) => {
        const container = containers.find(
          (item) => item.Config.Labels?.['com.docker.compose.service'] === service,
        );
        if (!container) {
          return [`${service}: missing container`];
        }
        if (
          container.State.Running &&
          container.State.Status === 'running' &&
          container.State.Health?.Status === 'healthy'
        ) {
          return [];
        }
        return [
          `${service}: ${container.State.Status} (${container.State.Health?.Status ?? 'health not ready'})`,
        ];
      });
      failure =
        unready.length > 0
          ? unready.join(', ')
          : 'api signing keys are unavailable at /api/v1/auth/jwks';
      if (unready.length === 0) {
        try {
          const response = await fetch('http://127.0.0.1:3000/api/v1/auth/jwks', {
            signal: AbortSignal.timeout(3000),
          });
          if (response.ok) {
            return;
          }
        } catch {
          // API startup or a restart can temporarily make its signing keys unreachable.
        }
      }
      this.logger.debug('local.docker.readiness.waiting', { failure, attempt });
      if (attempt + 1 < this.readiness.attempts) {
        await new Promise((resolve) => setTimeout(resolve, this.readiness.intervalMs));
      }
    }
    throw new Error(
      `Application readiness timed out: ${failure}. Check the listed services' Docker diagnostics, Redis/database configuration and model files, then retry. Data is preserved.`,
    );
  }
}
