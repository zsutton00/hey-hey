import { DockerProcess, DockerProcessError } from './docker-process';
import { DockerRuntimeRecovery } from './docker-runtime-recovery';
import { z as boundaryZ } from 'zod/v4';
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
    HostConfig: z
      .object({
        PortBindings: z
          .record(z.string(), z.array(z.object({ HostPort: z.string() })).nullable())
          .nullable()
          .optional(),
      })
      .optional(),
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
  readonly process: DockerProcess;
  private endpointSelection?: Promise<void>;
  private endpointArgs: string[] = [];
  endpoint?: { context?: string; host: string };
  endpointFailure?: string;
  lastPrerequisiteError: DockerProcessError | undefined;

  constructor(
    private readonly readiness = { attempts: 120, intervalMs: 1000 },
    processBoundary = new DockerProcess(),
  ) {
    this.process = processBoundary;
  }

  private readonly logger = new StructuredServerLogger({}, { component: 'local-docker' });

  private async selectEndpoint(): Promise<void> {
    const contextOverride = this.process.env['DOCKER_CONTEXT'];
    const hostOverride = this.process.env['DOCKER_HOST'];
    try {
      if (!contextOverride && hostOverride) {
        this.endpointArgs = ['--host', hostOverride];
        this.endpoint = { host: hostOverride };
        return;
      }
      const context =
        contextOverride ||
        (
          await this.process.run(
            'docker',
            ['context', 'show'],
            'context',
            undefined,
            undefined,
            10_000,
          )
        ).trim();
      const raw = await this.process.run(
        'docker',
        ['context', 'inspect', context],
        'context',
        undefined,
        undefined,
        10_000,
      );
      const contexts = boundaryZ
        .array(
          boundaryZ.object({
            Endpoints: boundaryZ.object({ docker: boundaryZ.object({ Host: boundaryZ.string() }) }),
          }),
        )
        .min(1)
        .parse(JSON.parse(raw));
      const selected = contexts[0];
      if (selected) {
        this.endpoint = { context, host: selected.Endpoints.docker.Host };
        this.endpointArgs = ['--context', context];
        // Freeze local endpoints; retain remote contexts' TLS material.
        if (selected.Endpoints.docker.Host.startsWith('unix://')) {
          this.endpointArgs = ['--host', selected.Endpoints.docker.Host];
        }
      }
    } catch (error) {
      this.endpointFailure =
        error instanceof DockerProcessError
          ? error.message
          : 'Docker context inspection returned an invalid response';
      this.logger.warn('local.docker.inspection_failed', {
        error:
          error instanceof DockerProcessError
            ? error
            : new Error('Docker context inspection returned an invalid response'),
      });
    }
  }

  recovery(): DockerRuntimeRecovery {
    return new DockerRuntimeRecovery(this);
  }

  async command(args: string[], input?: string, service?: string): Promise<string> {
    this.endpointSelection ??= this.selectEndpoint();
    await this.endpointSelection;
    const operation = args[0] ?? 'docker';
    this.logger.debug('local.docker.command', { operation });
    try {
      return await this.process.run(
        'docker',
        [...this.endpointArgs, ...args],
        operation,
        input,
        service,
      );
    } catch (error) {
      this.logger.error('local.docker.command_failed', {
        operation,
        error,
        ...(error instanceof DockerProcessError ? { diagnostic: error.diagnostic } : {}),
      });
      throw error;
    }
  }

  async prerequisite(): Promise<'ready' | 'missing' | 'stopped' | 'compose'> {
    try {
      await this.command(['--version']);
    } catch (error) {
      this.lastPrerequisiteError = error instanceof DockerProcessError ? error : undefined;
      return 'missing';
    }
    try {
      await this.command(['info', '--format', '{{.ServerVersion}}']);
    } catch (error) {
      this.lastPrerequisiteError = error instanceof DockerProcessError ? error : undefined;
      return 'stopped';
    }
    try {
      await this.command(['compose', 'version']);
    } catch (error) {
      this.lastPrerequisiteError = error instanceof DockerProcessError ? error : undefined;
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

  async compose(path: string, args: string[], input?: string, service?: string): Promise<void> {
    await this.command(
      ['compose', '--project-name', LOCAL_PROJECT, '--file', path, ...args],
      input,
      service,
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
      await this.compose(
        path,
        [
          'up',
          '-d',
          ...(wait ? ['--wait', '--wait-timeout', '120'] : []),
          '--pull',
          'never',
          service,
        ],
        undefined,
        service,
      );
    } catch (error) {
      this.logger.error('local.docker.service_start_failed', { service, error });
      throw error;
    }
  }

  /** Recreates the api and ui containers so changed runtime configuration takes effect. Volumes are untouched. */
  async recreateWebStack(path: string): Promise<void> {
    try {
      await this.compose(path, ['up', '-d', '--no-deps', '--pull', 'never', 'api', 'ui']);
    } catch (error) {
      this.logger.error('local.docker.service_restart_failed', { service: 'api,ui', error });
      throw error;
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
      const observations = services.map((service) => {
        const container = containers.find(
          (item) => item.Config.Labels?.['com.docker.compose.service'] === service,
        );
        return {
          service,
          present: Boolean(container),
          running: container?.State.Running ?? false,
          status: container?.State.Status ?? 'absent',
          health: container?.State.Health?.Status ?? 'unknown',
        };
      });
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
          this.logger.debug('local.docker.signing_keys_unavailable', { status: response.status });
        } catch (error) {
          this.logger.debug('local.docker.signing_keys_unavailable', { error });
          // API startup or a restart can temporarily make its signing keys unreachable.
        }
      }
      this.logger.debug('local.docker.readiness.waiting', { failure, attempt, observations });
      if (attempt + 1 < this.readiness.attempts) {
        await new Promise((resolve) => setTimeout(resolve, this.readiness.intervalMs));
      }
    }
    throw Object.assign(
      new Error(
        `Application readiness timed out: ${failure}. Check the listed services' Docker diagnostics, Redis/database configuration and model files, then retry. Data is preserved.`,
      ),
      { code: 'READINESS_TIMEOUT' },
    );
  }
}
