import { createServer, type Server as HttpServer } from 'node:http';
import {
  createBrowserApiRuntime,
  registerApiRuntime,
  type ApiRuntime,
} from '../../../../packages/ui-common/src/clients/shared';
import {
  MachineControllerAuthority,
  MachineDirectoryUnavailableError,
  recoveryGuidanceForReadiness,
  createDefaultMachineEnrollmentClient,
  OAuthClient,
  type MachineReadinessSnapshot,
} from '../auth';
import { createUiCommonAuthAdapter } from '../auth/ui-common-auth-adapter';
import { ProjectBrowserManager } from '../browser/project-browser-manager';
import { ControllerRegistryStore, KeyPairStore } from '../credentials';
import { RepoMappingStore, type RepoMappingStoreOptions } from '../repo';
import { RunStore } from '../run-store';
import { ToolRuleStore } from '../session/tool-rules';
import { LogRingBuffer } from './log-ring-buffer';
import { reportLargeRead } from './memory-monitor';
import { AgentSessionReader } from './monitors/agent-session-reader';
import { MonitorProjectContext } from './monitors/project-context';
import { PlatformAuthContext } from './platform-auth-context';
import { PlatformWebSocketManager } from './platform-ws';
import { ProcessFailureReporter } from './process-failure-reporter';
import { fanOutLogSinks, StructuredServerLogger, type ServerLogger } from './logger';
import { DiagnosticFeed } from './diagnostic-feed';
import { AuthorizationReplayStore } from './controller-authorization/authorization-replay-store';
import { ControllerAssertionVerifier } from './controller-authorization/controller-assertion-verifier';
import { ExecutionGrantStore } from './controller-authorization/execution-grant-store';
import { HostActionAdmission } from './controller-authorization/host-action-admission';
import {
  classifyStartupReadiness,
  PlatformUnavailableStartupError,
  StartupReadinessError,
} from './startup-readiness';

export interface LocalAgentInfrastructureOptions {
  apiBaseUrl?: string;
  writeLogLine?: (line: string) => void;
  /** A Debug feed created before startup, so terminal capture can record startup output. */
  diagnosticFeed?: DiagnosticFeed;
  repoMappingStoreOptions?: RepoMappingStoreOptions;
}

/** Owns durable stores, authentication, transports, and process-level infrastructure. */
export class LocalAgentInfrastructure {
  public readonly httpServer: HttpServer;
  public readonly logRingBuffer: LogRingBuffer;
  /** Bounded live Debug source; terminal capture hooks write into its capture sink. */
  public readonly diagnosticFeed: DiagnosticFeed;
  public readonly logger: ServerLogger;
  public readonly runStore: RunStore;
  public readonly repoStore: RepoMappingStore;
  public readonly toolRuleStore: ToolRuleStore;
  public readonly oauthClient: OAuthClient;
  public readonly apiRuntime: ApiRuntime;
  public readonly keyPairStore: KeyPairStore;
  public readonly controllerRegistryStore: ControllerRegistryStore;
  public readonly executionGrantStore: ExecutionGrantStore;
  public readonly authorizationReplayStore: AuthorizationReplayStore;
  public readonly controllerAssertionVerifier: ControllerAssertionVerifier;
  public readonly hostActionAdmission: HostActionAdmission;
  public readonly machineControllerAuthority: MachineControllerAuthority;
  public readonly platformWebSocketManager: PlatformWebSocketManager;
  public readonly monitorProjectContext: MonitorProjectContext;
  public readonly platformAuthContext: PlatformAuthContext;
  public readonly projectBrowsers: ProjectBrowserManager;
  private readonly processFailureReporter: ProcessFailureReporter;
  public readonly agentSessionReader: AgentSessionReader;
  private readonly apiBaseUrl: string;
  public readonly normalizedApiBaseUrl: string;

  private initialization: Promise<void> | null = null;
  private _initialAccessToken: string | null = null;
  private disposed = false;

  public constructor(options: LocalAgentInfrastructureOptions = {}) {
    this.apiBaseUrl =
      options.apiBaseUrl ?? process.env['HEYHEY_API_URL']?.trim() ?? 'https://heyhey.dev';
    this.normalizedApiBaseUrl = this.apiBaseUrl.endsWith('/api/v1')
      ? this.apiBaseUrl
      : `${this.apiBaseUrl.replace(/\/$/u, '')}/api/v1`;
    this.logRingBuffer = new LogRingBuffer();
    this.diagnosticFeed = options.diagnosticFeed ?? new DiagnosticFeed();
    this.logger = new StructuredServerLogger({
      sink: fanOutLogSinks(this.logRingBuffer, this.diagnosticFeed),
      ...(options.writeLogLine ? { writeLine: options.writeLogLine } : {}),
    }).child({ component: 'local-server' });
    this.processFailureReporter = new ProcessFailureReporter(this.logger, this.diagnosticFeed);
    this.httpServer = createServer();
    this.runStore = new RunStore({
      onCompatibilityDiagnostic: (diagnostic) => {
        this.logger.debug('run_store.compatibility.failed', {
          ...diagnostic,
          affectedCapability: diagnostic.member ? 'run_member_access' : 'run_restoration',
        });
      },
      onInvalidRunMetadata: ({ runId, error }) => {
        this.logger.warn('run_store.invalid_metadata.filtered', { runId, error });
      },
      onIndexReconciled: ({ runCount }) => {
        this.logger.info('run_store.index.reconciled', {
          runCount,
          reason: 'startup_consistency_check',
        });
      },
      onInitializationProgress: (progress) => {
        this.logger.debug(`run_store.initialize.${progress.operation}.${progress.status}`, {
          ...progress,
        });
        if (progress.operation === 'source_read' && progress.status === 'completed') {
          const bytes = progress.sourceByteCount ?? 0;
          reportLargeRead(this.logger, 'run_store.large_family_read', bytes, { ...progress });
        }
      },
      onEventLogRead: (read) => {
        reportLargeRead(this.logger, 'run_store.large_event_log_read', read.byteCount, { ...read });
      },
    });
    this.repoStore = new RepoMappingStore(options.repoMappingStoreOptions);
    this.toolRuleStore = new ToolRuleStore();
    this.oauthClient = new OAuthClient();
    this.apiRuntime = createBrowserApiRuntime({
      baseUrl: this.normalizedApiBaseUrl,
      authAdapter: createUiCommonAuthAdapter(this.oauthClient),
    });
    registerApiRuntime(this.apiRuntime);
    this.keyPairStore = new KeyPairStore();
    this.controllerRegistryStore = new ControllerRegistryStore({ keyPairStore: this.keyPairStore });
    this.executionGrantStore = new ExecutionGrantStore({
      keyPairStore: this.keyPairStore,
      logger: this.logger,
    });
    this.authorizationReplayStore = new AuthorizationReplayStore({
      logger: this.logger,
      keyPairStore: this.keyPairStore,
    });
    const controllerOrigin =
      process.env['HEYHEY_CONTROLLER_ORIGIN']?.trim() ??
      this.apiBaseUrl.replace(/\/api\/v1$/u, '').replace(/\/$/u, '');
    const controllerRpId =
      process.env['HEYHEY_CONTROLLER_RP_ID']?.trim() ?? new URL(controllerOrigin).hostname;
    this.controllerAssertionVerifier = new ControllerAssertionVerifier({
      registry: this.controllerRegistryStore,
      origin: controllerOrigin,
      rpId: controllerRpId,
    });
    this.hostActionAdmission = new HostActionAdmission({
      logger: this.logger,
      assertionVerifier: this.controllerAssertionVerifier,
      grantStore: this.executionGrantStore,
      replayStore: this.authorizationReplayStore,
    });
    this.machineControllerAuthority = new MachineControllerAuthority({
      keyPairStore: this.keyPairStore,
      controllerRegistryStore: this.controllerRegistryStore,
      executionGrantStore: this.executionGrantStore,
      machineDirectory: this.apiRuntime.clients.machines,
      enrollmentConfirmationClient: createDefaultMachineEnrollmentClient(),
      log: (message) => this.logger.info('machine-controller.authority', { message }),
      logError: (message) => this.logger.error('machine-controller.authority.error', { message }),
      logDebug: (event, metadata) =>
        this.logger.debug(`machine-controller.authority.${event}`, metadata),
      logDiagnosticError: (event, metadata) =>
        this.logger.error(`machine-controller.authority.${event}`, metadata),
    });
    this.platformWebSocketManager = new PlatformWebSocketManager({
      serverUrl: this.apiBaseUrl.replace(/\/api\/v1$/u, '').replace(/\/$/u, ''),
      oauthClient: this.oauthClient,
      keyPairStore: this.keyPairStore,
      repoStore: this.repoStore,
      logger: this.logger.child({ component: 'platform-ws' }),
      controllerRegistryStore: this.controllerRegistryStore,
      machineControllerAuthority: this.machineControllerAuthority,
    });
    this.monitorProjectContext = new MonitorProjectContext({
      runStore: this.runStore,
      platformWebSocketManager: this.platformWebSocketManager,
      logger: this.logger,
    });
    this.platformAuthContext = new PlatformAuthContext(
      this.oauthClient,
      this.monitorProjectContext,
      this.logger.child({ component: 'platform-auth' }),
    );
    this.projectBrowsers = new ProjectBrowserManager({
      logger: this.logger.child({ component: 'shared-browser' }),
    });
    this.agentSessionReader = new AgentSessionReader({
      apiBaseUrl: this.normalizedApiBaseUrl,
      authProvider: this.platformAuthContext,
      logger: this.logger.child({ component: 'agent-session-reader' }),
      fetchImpl: fetch,
    });
  }

  public get initialAccessToken(): string {
    if (!this._initialAccessToken) {
      throw new Error('LocalAgentInfrastructure has not been initialized.');
    }
    return this._initialAccessToken;
  }

  public initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeOnce().catch((error) => {
        this.initialization = null;
        throw error;
      });
    }
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    this.logger.debug('local.infrastructure.initialize.started');
    this.processFailureReporter.start();
    const runStoreStartedAt = Date.now();
    this.logger.debug('local.infrastructure.run_store.initialize_started');
    await this.runStore.initialize();
    this.logger.debug('local.infrastructure.run_store.initialized', {
      elapsedMs: Date.now() - runStoreStartedAt,
    });
    let tokenResult = await this.oauthClient.getAccessToken({});
    if (!tokenResult.success) {
      this.logger.info('local.infrastructure.authentication.login_required', {
        error: tokenResult.error,
      });
      if (!process.stdin.isTTY) {
        throw new Error(
          'Authentication required. Run heyhey login in a terminal or provide a token with heyhey login --token.',
        );
      }
      const loginResult = await this.oauthClient.login();
      if (!loginResult.success) {
        throw new Error(`Authentication required but login failed: ${loginResult.error}`);
      }
      tokenResult = await this.oauthClient.getAccessToken({});
      if (!tokenResult.success) {
        throw new Error(`Authentication failed after login: ${tokenResult.error}`);
      }
    }
    this._initialAccessToken = tokenResult.data;
    this.apiRuntime.transport.setAuthToken(tokenResult.data);
    this.logger.debug('local.infrastructure.authentication.ready');

    const machineId = await this.keyPairStore.loadCurrentMachineId();
    if (machineId) {
      this.logger.debug('local.infrastructure.key_rotation.resume_started', { machineId });
      await this.keyPairStore.resumeKeyRotation(machineId);
      this.logger.debug('local.infrastructure.key_rotation.resume_completed', { machineId });
    }
    let readiness: MachineReadinessSnapshot;
    try {
      readiness = await this.machineControllerAuthority.reconcileBeforeRuntime();
    } catch (error) {
      if (error instanceof MachineDirectoryUnavailableError) {
        this.logger.error('local.infrastructure.platform_unavailable', {
          apiBaseUrl: this.normalizedApiBaseUrl,
          error: error.message,
          cause: error.cause instanceof Error ? error.cause.message : null,
        });
        throw new PlatformUnavailableStartupError(this.normalizedApiBaseUrl, error);
      }
      throw error;
    }
    this.logger.debug('local.infrastructure.controller_authority.reconciled', {
      state: readiness.state,
      machineId: readiness.machineId,
      hasMachineId: Boolean(readiness.machineId),
      localControllerCount: readiness.localControllers.length,
      localControllerCredentialIds: readiness.localControllers.map(
        (controller) => controller.controllerCredentialId,
      ),
      serverControllerCount: readiness.serverControllers.length,
      serverControllerCredentialIds: readiness.serverControllers.map(
        (controller) => controller.credentialId,
      ),
      serverExecutionReadiness: readiness.serverExecutionReadiness,
    });
    const readinessOutcome = classifyStartupReadiness(
      readiness,
      recoveryGuidanceForReadiness(readiness.state),
    );
    if (readinessOutcome.kind !== 'ready') {
      throw new StartupReadinessError(readinessOutcome);
    }
    this.logger.debug('local.infrastructure.initialize.completed', {
      hasMachineId: Boolean(machineId),
    });
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.logger.debug('local.infrastructure.dispose.started');
    this.processFailureReporter.dispose();
    this.platformWebSocketManager.disconnect();
    // Closing on exit also releases the profile lock for the next launch.
    await this.projectBrowsers.closeAll().catch((error: unknown) => {
      this.logger.warn('local.infrastructure.shared_browser_close_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.logger.debug('local.infrastructure.dispose.completed');
    this.diagnosticFeed.dispose();
  }
}
