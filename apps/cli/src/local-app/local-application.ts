import { LocalLifecycleOwners, type DisclosedOwner } from './lifecycle-owners';
import { ReleasePackage } from './release-package';
import type { StartupDiagnostics } from './startup-diagnostics';
import { EventEmitter } from 'node:events';
import { StructuredServerLogger } from '../server/logger';
import { ReleaseSource, sameRelease } from './release-source';
import { InstallationStore } from './installation-store';
import { ModelDownloader } from './model-downloader';
import { DockerProcessError } from './docker-process';
import type { ColimaMountRepair } from './docker-runtime-recovery';
import { DockerBoundary, type ObservedContainer } from './docker-boundary';
import {
  composeConfiguration,
  LOCAL_AGENT_PORT_VARIABLE,
  localWebOrigin,
  localWebSocketUrl,
  provisioningSql,
  SERVICE_IMAGES,
} from './compose';
import {
  LOCAL_WEB_CONTAINER_PORT,
  resolveLocalBridgePort,
  resolveLocalWebPort,
} from './local-port';
import type { ReleaseManifest } from '../release/release-manifest';

/**
 * A running install is current only when the UI is published on the local web
 * port with the matching bridge port and live-update address, and the API
 * trusts the same passkey origin. Anything else is recreated in place.
 */
export function webStackIsCurrent(
  observed: ObservedContainer[],
  bridgePort: number,
  webPort: number,
): boolean {
  const service = (name: string) =>
    observed.find((c) => c.Config.Labels?.['com.docker.compose.service'] === name);
  const ui = service('ui');
  const api = service('api');
  const publishedPorts = ui?.HostConfig?.PortBindings?.[`${LOCAL_WEB_CONTAINER_PORT}/tcp`]?.map(
    (binding) => binding.HostPort,
  );

  return (
    publishedPorts?.includes(String(webPort)) === true &&
    ui?.Config.Env?.includes(`${LOCAL_AGENT_PORT_VARIABLE}=${bridgePort}`) === true &&
    ui.Config.Env.includes(`VITE_WS_URL=${localWebSocketUrl(webPort)}`) &&
    api?.Config.Env?.includes(`ACCOUNT_PASSKEY_ORIGIN=${localWebOrigin(webPort)}`) === true
  );
}

export interface LocalApplicationNavigation {
  url: string;
  reconnectCommand: string;
  stopCommand: string;
}

export type LocalState =
  | { kind: 'update'; release: ReleaseManifest; required: boolean; activeCount: number | null }
  | { kind: 'update-restart'; version: string }
  | { kind: 'installation' }
  | { kind: 'prerequisite'; message: string }
  | { kind: 'progress'; steps: string[]; current: string }
  | { kind: 'recovery'; message: string }
  | { kind: 'docker-repair'; message: string; profile: string }
  | ({
      kind: 'ready';
      bridgeConnected: false;
      executionAuthorized: false;
    } & LocalApplicationNavigation)
  | { kind: 'stop'; activeCount: number; restartCommand: string }
  | { kind: 'stopped'; restartCommand: string }
  | ({ kind: 'exited' } & LocalApplicationNavigation)
  | { kind: 'cancelled' };

export function assertObservedRelease(
  containers: ObservedContainer[],
  release: ReleaseManifest,
): void {
  assertObservedReleases(containers, [release]);
}

function assertObservedReleases(
  containers: ObservedContainer[],
  releases: [ReleaseManifest, ...ReleaseManifest[]],
): void {
  const [release] = releases;
  const seen = new Set<string>();
  for (const container of containers) {
    const service = container.Config.Labels?.['com.docker.compose.service'];
    const imageName = Object.entries(SERVICE_IMAGES).find(([name]) => name === service)?.[1];
    if (
      !service ||
      !imageName ||
      seen.has(service) ||
      !releases.some(
        (candidate) =>
          container.Config.Image === candidate.images[imageName].reference &&
          container.Config.Labels?.['dev.heyhey.cli-version'] === candidate.cliVersion,
      )
    ) {
      throw new Error(
        `Observed application release differs from CLI ${release.cliVersion}. This installation requires CLI ${release.cliVersion} and its complete pinned image set. Restore that matching release before starting or connecting. Data is preserved.`,
      );
    }
    seen.add(service);
  }
}

export class LocalApplication extends EventEmitter {
  state: LocalState = { kind: 'progress', steps: [], current: 'Checking local installation' };
  private readonly logger = new StructuredServerLogger({}, { component: 'local-application' });
  private busy = false;
  private consent = false;
  private offered: ReleaseManifest | undefined;
  private offeredFrom: ReleaseManifest | undefined;
  private disclosed: DisclosedOwner[] = [];
  private declined = false;
  private mountRepair: { repair: ColimaMountRepair; message: string } | undefined;

  constructor(
    readonly releases: ReleaseSource,
    readonly storage: InstallationStore,
    readonly docker: DockerBoundary,
    private readonly models: ModelDownloader,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly packages?: ReleasePackage,
    /** Resolved once; the bridge listens here and the UI container is told the same value. */
    readonly bridgePort: number = resolveLocalBridgePort(),
    readonly webPort: number = resolveLocalWebPort(),
    private readonly diagnostics?: StartupDiagnostics,
  ) {
    super();
  }

  private show(state: LocalState): void {
    this.logger.debug('local.application.state', {
      state: state.kind,
      ...(state.kind === 'progress' ? { action: state.current } : {}),
    });
    if (
      state.kind === 'recovery' ||
      state.kind === 'prerequisite' ||
      state.kind === 'docker-repair'
    ) {
      this.diagnostics?.failure();
    }
    this.state = state;
    this.emit('change', state);
  }

  cancel(): void {
    if (!this.busy) {
      this.show({ kind: 'cancelled' });
    }
  }
  async install(): Promise<void> {
    this.consent = true;
    await this.run();
  }
  async retry(): Promise<void> {
    this.diagnostics?.retry();
    await this.run();
  }

  declineDockerRepair(): void {
    if (this.state.kind === 'docker-repair' && this.mountRepair) {
      this.show({ kind: 'recovery', message: this.mountRepair.message });
      this.mountRepair = undefined;
    }
  }

  async confirmDockerRepair(): Promise<void> {
    if (this.state.kind !== 'docker-repair' || !this.mountRepair || this.busy) {
      return;
    }
    const offered = this.mountRepair;
    this.mountRepair = undefined;
    this.busy = true;
    try {
      await new LocalLifecycleOwners(this.storage).exclusive(() => offered.repair.apply());
    } catch (error) {
      const cause =
        error instanceof DockerProcessError
          ? error
          : new Error(
              this.docker.process.safe(
                error instanceof Error ? error.message : 'Runtime repair failed',
              ),
            );
      this.logger.error('local.docker.repair_failed', { error: cause });
      this.show({
        kind: 'recovery',
        message: `${offered.message} Repair failed: ${cause.message}. The original Docker refusal is retained above. Configuration backups are kept beside colima.yaml; application data is preserved.`,
      });
      return;
    } finally {
      this.busy = false;
    }
    await this.retry();
  }

  async requestStop(): Promise<void> {
    try {
      if (!(await this.storage.read())) {
        throw new Error('No local installation found.');
      }
      this.disclosed = await new LocalLifecycleOwners(this.storage).inspect();
      this.show({
        kind: 'stop',
        activeCount: this.disclosed.reduce((sum, item) => sum + item.work.runIds.length, 0),
        restartCommand: 'heyhey local',
      });
    } catch (error) {
      this.logger.error('local.application.failure', { operation: 'startup', error });
      this.show({
        kind: 'recovery',
        message:
          error instanceof Error
            ? error.message
            : 'Could not inspect active work. Keep running and retry.',
      });
    }
  }

  async confirmStop(): Promise<void> {
    if (this.state.kind !== 'stop' || this.busy) {
      return;
    }
    this.busy = true;
    try {
      const owners = new LocalLifecycleOwners(this.storage);
      await owners.exclusive(async () => {
        if (!(await owners.stop(this.disclosed))) {
          await this.requestStop();
          return;
        }
        await this.docker.stop(this.storage.composePath);
        this.show({ kind: 'stopped', restartCommand: 'heyhey local' });
      });
    } catch (error) {
      this.logger.error('local.application.failure', { operation: 'startup', error });
      this.show({
        kind: 'recovery',
        message:
          error instanceof Error ? error.message : 'Shutdown failed. Retry; data is preserved.',
      });
    } finally {
      this.busy = false;
    }
  }

  async declineUpdate(): Promise<void> {
    if (this.state.kind !== 'update') {
      return;
    }
    if (this.state.required) {
      this.cancel();
      return;
    }
    this.declined = true;
    await this.run();
  }

  private async offer(release: ReleaseManifest, required: boolean): Promise<void> {
    this.offered = release;
    this.offeredFrom = (await this.storage.read())?.release;
    let activeCount: number | null = null;
    try {
      this.disclosed = await new LocalLifecycleOwners(this.storage).inspect();
      activeCount = this.disclosed.reduce((sum, item) => sum + item.work.runIds.length, 0);
    } catch (error) {
      if (required) {
        throw error;
      }
      this.disclosed = [];
      this.logger.warn('local.release.update_work_unavailable', { error });
    }
    this.show({ kind: 'update', release, required, activeCount });
  }

  async acceptUpdate(): Promise<void> {
    if (this.state.kind !== 'update' || !this.offered || this.busy) {
      return;
    }
    const target = this.offered;
    const required = this.state.required;
    this.busy = true;
    this.show({
      kind: 'progress',
      steps: [],
      current: `Updating matching CLI ${target.cliVersion} and application images`,
    });
    const owners = new LocalLifecycleOwners(this.storage);
    try {
      await owners.exclusive(async () => {
        const installation = await this.storage.read();
        if (
          !installation ||
          !this.offeredFrom ||
          !sameRelease(installation.release, this.offeredFrom)
        ) {
          throw new Error(
            'Installation changed while the update was offered. Retry to review its matching release.',
          );
        }
        if (!(await owners.stop(this.disclosed))) {
          await this.offer(target, required);
          return;
        }
        // Consent is durable before package or Docker mutation, including interrupted updates.
        await this.storage.recordUpdate(installation.release, target);
        const current = await this.releases.read();
        if (!sameRelease(current, target)) {
          if (!this.packages) {
            throw new Error('Release package is unavailable. Retry the update offer.');
          }
          await this.packages.install(target);
          this.show({ kind: 'update-restart', version: target.cliVersion });
          return;
        }
        this.busy = false;
        await this.runLocked();
      });
    } catch (error) {
      this.logger.error('local.application.failure', { operation: 'startup', error });
      this.show({
        kind: 'recovery',
        message:
          error instanceof Error ? error.message : 'Update failed. Retry; data is preserved.',
      });
    } finally {
      this.busy = false;
    }
  }

  async run(): Promise<void> {
    try {
      const installation = await this.storage.read();
      if (installation || this.consent) {
        await new LocalLifecycleOwners(this.storage).exclusive(() => this.runLocked());
      } else {
        await this.runLocked();
      }
    } catch (error) {
      this.logger.error('local.application.failure', { operation: 'startup', error });
      this.show({
        kind: 'recovery',
        message:
          error instanceof Error ? error.message : 'Local lifecycle operation failed. Retry.',
      });
    }
  }

  private async runLocked(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    let action = 'Checking local installation';
    const steps: string[] = [];
    const progress = (next: string) => {
      action = next;
      this.show({ kind: 'progress', steps: [...steps], current: next });
    };
    try {
      const prerequisite = await this.docker.prerequisite();
      if (prerequisite !== 'ready') {
        this.logger.error('local.docker.prerequisite', { reasonCode: prerequisite });
        const install =
          this.platform === 'darwin'
            ? 'Install and open Docker Desktop for Mac.'
            : this.platform === 'win32'
              ? 'Install and open Docker Desktop with WSL 2.'
              : 'Install Docker Engine and the Docker Compose plugin; start the Docker service.';
        const message =
          prerequisite === 'missing'
            ? install
            : prerequisite === 'compose'
              ? 'Install the Docker Compose v2 plugin, then retry.'
              : 'Start Docker, then retry.';
        this.show({
          kind: 'prerequisite',
          message: this.docker.lastPrerequisiteError
            ? `${this.docker.lastPrerequisiteError.message}. ${message}`
            : message,
        });
        return;
      }
      steps.push('Docker is ready');
      const release = await this.releases.read();
      let installation = await this.storage.read();
      const observed = await this.docker.inspect();
      const updateConsent = installation ? await this.storage.updateConsent() : undefined;
      const updating = Boolean(
        installation &&
        !sameRelease(installation.release, release) &&
        updateConsent &&
        sameRelease(updateConsent.from, installation.release) &&
        sameRelease(updateConsent.target, release),
      );
      if (installation && !sameRelease(installation.release, release) && !updating) {
        await this.offer(release, true);
        return;
      }
      if (updating && (await new LocalLifecycleOwners(this.storage).inspect()).length > 0) {
        // Work or a bridge created after the original consent gets a fresh disclosure.
        await this.offer(release, true);
        return;
      }
      if (updating && installation) {
        assertObservedReleases(observed, [release, installation.release]);
        installation = { ...installation, release };
      } else {
        assertObservedRelease(observed, release);
      }
      if (installation && !updating && !this.declined && this.packages) {
        const newer = await this.packages.newerThan(release.cliVersion).catch((error: unknown) => {
          this.logger.warn('local.release.optional_check_unavailable', { error });
          return undefined;
        });
        if (newer) {
          await this.offer(newer, false);
          return;
        }
      }
      if (!installation && (observed.length > 0 || (await this.docker.hasPersistentStorage()))) {
        throw new Error(
          'Local containers or persistent volumes exist without installation identity. Restore installation.json from backup before retrying. Data is preserved.',
        );
      }
      if (!installation && !this.consent) {
        this.show({ kind: 'installation' });
        return;
      }
      progress('Checking graph/search model files');
      await this.models.ensure(
        installation?.modelDirectory ?? this.storage.modelDirectory,
        progress,
      );
      installation ??= await this.storage.prepare(release);
      // Recheck the persisted winner if another terminal prepared installation concurrently.
      if (!sameRelease(installation.release, release)) {
        throw new Error('Installation release changed. Use the matching CLI release, then retry.');
      }
      if (
        !updating &&
        observed.length === Object.keys(SERVICE_IMAGES).length &&
        observed.every((c) => c.State.Running)
      ) {
        if (!webStackIsCurrent(observed, this.bridgePort, this.webPort)) {
          progress('Updating the web app address and bridge port');
          const secrets = await this.storage.secrets();
          this.docker.process.protect(Object.values(secrets));
          await this.storage.writeCompose(
            composeConfiguration(installation, secrets, this.bridgePort, this.webPort),
          );
          this.logger.info('local.stack.web_configuration_stale', {
            webOrigin: localWebOrigin(this.webPort),
          });
          await this.docker.recreateWebStack(this.storage.composePath);
        }
        progress('Checking application readiness');
        await this.docker.health();
      } else {
        progress('Preparing protected local storage');
        const secrets = await this.storage.secrets();
        this.docker.process.protect(Object.values(secrets));
        const config = composeConfiguration(installation, secrets, this.bridgePort, this.webPort);
        await this.storage.writeCompose(config);
        steps.push('Local storage created');
        if (updating) {
          progress('Stopping application for the matching release update');
          await this.docker.stop(this.storage.composePath);
        }
        if (updating || observed.length < Object.keys(SERVICE_IMAGES).length) {
          progress('Downloading matching application images');
          await this.docker.pull(this.storage.composePath);
          steps.push('Application images downloaded');
        }
        progress('Starting PostgreSQL and Redis');
        await this.docker.startDatabase(this.storage.composePath);
        steps.push('Database started');
        progress('Provisioning separate application databases');
        await this.docker.provision(
          this.storage.composePath,
          provisioningSql(secrets.api, secrets.graph),
        );
        progress('Migrating the application database');
        await this.docker.migrate(this.storage.composePath);
        progress('Starting application services');
        await this.docker.startApplication(this.storage.composePath);
        steps.push('Application services started');
        progress('Checking application readiness');
        await this.docker.health();
      }
      assertObservedRelease(await this.docker.inspect(), release);
      if (updating) {
        await this.storage.adoptRelease(installation, release);
      }
      this.show({
        kind: 'ready',
        url: new URL('/local', localWebOrigin(this.webPort)).toString(),
        reconnectCommand: 'heyhey local',
        stopCommand: 'heyhey local stop',
        bridgeConnected: false,
        executionAuthorized: false,
      });
    } catch (error) {
      this.logger.error('local.application.failure', { operation: 'startup', action, error });
      const message =
        error instanceof Error
          ? error.message
          : 'Check local Docker and installation configuration, then retry.';
      let recoveryMessage = `${action}: ${message}`;
      if (error instanceof DockerProcessError) {
        const installation = await this.storage.read().catch((cause: unknown) => {
          this.logger.warn('local.docker.inspection_failed', { error: cause });
          return undefined;
        });
        const diagnosis = await this.docker
          .recovery()
          .diagnose(error, installation?.modelDirectory ?? this.storage.modelDirectory);
        recoveryMessage += diagnosis.message ? `\n${diagnosis.message}` : '';
        if (diagnosis.repair) {
          this.mountRepair = { repair: diagnosis.repair, message: recoveryMessage };
          this.show({
            kind: 'docker-repair',
            message: recoveryMessage,
            profile: diagnosis.repair.profile,
          });
          return;
        }
      }
      this.show({ kind: 'recovery', message: recoveryMessage });
    } finally {
      this.busy = false;
    }
  }
}
