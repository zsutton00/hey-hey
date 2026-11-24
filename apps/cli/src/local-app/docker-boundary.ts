import { DockerProcess, DockerProcessError } from './docker-process';
import { DockerRuntimeRecovery } from './docker-runtime-recovery';
import { StructuredServerLogger } from '../server/logger';
import { z } from 'zod/v4';
import { LOCAL_PROJECT, SERVICE_IMAGES } from './compose';
import {
  PullProgressAggregator,
  type DownloadDetail,
  type PullProgressMode,
} from './pull-progress';

const contextEndpointSchema = z
  .array(z.object({ Endpoints: z.object({ docker: z.object({ Host: z.string() }) }) }))
  .min(1);

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
  private endpointSelection: Promise<void> | undefined;
  private endpointArgs: string[] = [];
  endpoint?: { context?: string; host: string };
  endpointFailure?: string;
  lastPrerequisiteError: DockerProcessError | undefined;

  constructor(
    private readonly readiness = { attempts: 120, intervalMs: 1000 },
    processBoundary = new DockerProcess(),
    /** The Compose project this boundary sees and drives; see `LocalWorkspace`. */
    readonly project = LOCAL_PROJECT,
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
      const contexts = contextEndpointSchema.parse(JSON.parse(raw));
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

  async command(
    args: string[],
    input?: string,
    service?: string,
    onLine?: (line: string) => boolean,
    /** A refusal is an expected answer (a capability probe), not a failure to report. */
    expectFailure = false,
  ): Promise<string> {
    this.endpointSelection ??= this.selectEndpoint();
    await this.endpointSelection;
    const operation = args[0] ?? 'docker';
    const composeOperation =
      operation === 'compose'
        ? args.find((argument) =>
            ['up', 'pull', 'stop', 'exec', 'run', 'rm', 'logs', 'ps'].includes(argument),
          )
        : undefined;
    const processOperation = composeOperation ? `compose.${composeOperation}` : operation;
    this.logger.debug('local.docker.command', { operation });
    try {
      if (this.endpoint?.context && !this.endpoint.host.startsWith('unix://')) {
        const raw = await this.process.run(
          'docker',
          ['context', 'inspect', this.endpoint.context],
          'context',
          undefined,
          undefined,
          10_000,
        );
        const current = contextEndpointSchema.parse(JSON.parse(raw))[0];
        if (current?.Endpoints.docker.Host !== this.endpoint.host) {
          throw this.process.inspectionError(
            new Error(
              'The selected Docker context endpoint changed. Restore the original endpoint before retrying this startup.',
            ),
          );
        }
      }
      return await this.process.run(
        'docker',
        [...this.endpointArgs, ...args],
        processOperation,
        input,
        service,
        undefined,
        onLine,
      );
    } catch (error) {
      const failure =
        error instanceof DockerProcessError
          ? error
          : this.process.inspectionError(
              new Error('Docker endpoint inspection returned invalid data'),
            );
      if (expectFailure) {
        this.logger.debug('local.docker.probe_refused', {
          operation,
          diagnostic: failure.diagnostic,
        });
        throw failure;
      }
      this.logger.error('local.docker.command_failed', {
        operation,
        error: failure,
        diagnostic: failure.diagnostic,
      });
      throw failure;
    }
  }

  async prerequisite(): Promise<'ready' | 'missing' | 'stopped' | 'compose'> {
    if (!this.endpoint) {
      this.endpointSelection = undefined;
    }
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
        `label=com.docker.compose.project=${this.project}`,
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
      `label=com.docker.compose.project=${this.project}`,
    ]);
    return volumes.trim().length > 0;
  }

  async compose(
    path: string,
    args: string[],
    input?: string,
    service?: string,
    onLine?: (line: string) => boolean,
  ): Promise<void> {
    await this.command(
      ['compose', '--project-name', this.project, '--file', path, ...args],
      input,
      service,
      onLine,
    );
  }

  async stop(path: string): Promise<void> {
    await this.compose(path, ['stop']);
  }

  /**
   * Services whose pinned image reference is not on this Docker host. Images are content-addressed
   * references from the release, so presence by reference is presence of the exact pinned image.
   */
  private async missingServiceImages(images: Record<string, string>): Promise<string[]> {
    const missing: string[] = [];
    for (const [service, reference] of Object.entries(images)) {
      try {
        await this.command(
          ['image', 'inspect', '--format', '{{.Id}}', reference],
          undefined,
          undefined,
          undefined,
          true,
        );
      } catch {
        // The refusal and its cause are logged by command(); an absent image is the expected answer.
        missing.push(service);
      }
    }
    this.logger.info('local.docker.image_presence', { missing });
    return missing;
  }

  /**
   * Pulls only the services whose pinned image is absent, so a download interrupted on an earlier
   * run resumes instead of leaving startup blocked on `--pull never`. Returns what it fetched.
   */
  async pullMissing(
    path: string,
    images: Record<string, string>,
    onStart: (services: string[]) => void,
    onProgress?: (detail: DownloadDetail) => void,
  ): Promise<string[]> {
    const missing = await this.missingServiceImages(images);
    if (missing.length > 0) {
      onStart(missing);
      await this.pull(path, onProgress, missing);
    }
    return missing;
  }

  /**
   * Pulls the given services' images (every image when none are named), reporting combined
   * progress across all of them while it runs.
   */
  async pull(
    path: string,
    onProgress?: (detail: DownloadDetail) => void,
    services: string[] = [],
  ): Promise<void> {
    const mode = await this.progressMode(path);
    const aggregator = new PullProgressAggregator(mode);
    const started = Date.now();
    let outcome: 'finished' | 'failed' = 'failed';
    try {
      await this.compose(
        path,
        [...(mode === 'json' ? ['--progress', 'json'] : []), 'pull', ...services],
        undefined,
        undefined,
        (line) => {
          const consumed = aggregator.feed(line);
          if (consumed) {
            onProgress?.(aggregator.detail());
          }
          return consumed;
        },
      );
      outcome = 'finished';
    } finally {
      const detail = aggregator.detail();
      // One bounded summary per pull; individual progress lines are never persisted.
      this.logger.info('local.docker.pull_summary', {
        outcome,
        mode,
        layersDone: detail.layersDone ?? 0,
        layersTotal: detail.layersTotal ?? 0,
        bytesDone: detail.bytesDone,
        bytesTotal: detail.bytesTotal,
        unrecognizedLines: aggregator.unrecognizedLines,
        elapsedMs: Date.now() - started,
      });
    }
  }

  /**
   * Compose releases differ in which `--progress` writers they accept, and some reject
   * `json` before running anything. Ask the installed Compose directly instead of guessing
   * from its version; any refusal selects the plain text reader.
   */
  private async progressMode(path: string): Promise<PullProgressMode> {
    try {
      await this.command(
        [
          'compose',
          '--project-name',
          this.project,
          '--file',
          path,
          '--progress',
          'json',
          'version',
          '--short',
        ],
        undefined,
        undefined,
        undefined,
        true,
      );
      return 'json';
    } catch {
      // The probe's refusal is already logged by command(); the text reader is the fallback.
      return 'text';
    }
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
   * Local installations, installed and dev, migrate out of order: one local
   * database can be migrated by several releases and checkouts, so a migration
   * may be dated before one already applied. Callers choose; the default is strict.
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
