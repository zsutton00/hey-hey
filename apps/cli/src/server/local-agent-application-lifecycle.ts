import type { RunApplicationRuntime } from './run-application-runtime';
import type { MonitorApplicationRuntime } from './monitor-application-runtime';
import type { MonitorEventSourceRuntime } from './monitor-event-source-runtime';
import type { PlatformApplicationRuntime } from './platform-application-runtime';
import type { LocalAgentInfrastructure } from './local-agent-infrastructure';
import type { ServerLogger } from './logger';
import type { StateMachineApplicationRuntime } from './state-machine-application-runtime';
import type { RunRetentionMaintenance } from '../run-store/run-retention-maintenance';
import type { MachineActions } from '../commands/machine-actions';
import type { DiagnosticFeed } from './diagnostic-feed';
import type { LocalSessionMetadataSource } from './local-session-metadata-source';
import type { LocalSessionReadSource } from './local-session-read-source';
import type { SessionActivitySource } from './session-activity-source';

/** The read and action owners a local presentation consumes; it never owns them. */
export interface LocalPresentationSources {
  readonly sessions: LocalSessionReadSource;
  readonly sessionMetadata: LocalSessionMetadataSource;
  readonly sessionActivity: SessionActivitySource;
  readonly diagnostics: DiagnosticFeed;
  readonly machineActions: MachineActions;
  /** A project's display name, or null when it cannot be known locally. */
  readonly readProjectName: (projectId: string) => Promise<string | null>;
  readonly logger: ServerLogger;
}

export interface LocalAgentApplicationLifecycleDependencies {
  platformRuntime: PlatformApplicationRuntime;
  stateMachineRuntime: StateMachineApplicationRuntime;
  monitorRuntime: MonitorApplicationRuntime;
  monitorEventSources: MonitorEventSourceRuntime;
  runRuntime: RunApplicationRuntime;
  infrastructure: LocalAgentInfrastructure;
  logger: ServerLogger;
  runRetentionMaintenance: RunRetentionMaintenance;
  machineActions: MachineActions;
}

/** Owns ordered disposal of the top-level local-agent application runtimes. */
export class LocalAgentApplicationLifecycle {
  private disposed = false;

  public constructor(private readonly dependencies: LocalAgentApplicationLifecycleDependencies) {}

  public startAfterReadiness(): void {
    this.dependencies.runRuntime.startAfterReadiness();
    this.dependencies.runRetentionMaintenance.startAfterReadiness();
  }

  public get presentationSources(): LocalPresentationSources {
    const { runRuntime, infrastructure, machineActions, logger } = this.dependencies;
    return {
      sessions: runRuntime.localSessionReadSource,
      sessionMetadata: runRuntime.localSessionMetadataSource,
      sessionActivity: runRuntime.sessionActivitySource,
      diagnostics: infrastructure.diagnosticFeed,
      machineActions,
      readProjectName: runRuntime.readProjectName,
      logger,
    };
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.dependencies.logger.debug('local.lifecycle.dispose.started');
    this.dependencies.machineActions.dispose();
    this.dependencies.platformRuntime.dispose();
    this.dependencies.stateMachineRuntime.dispose();
    this.dependencies.monitorRuntime.dispose();
    this.dependencies.monitorEventSources.dispose();
    try {
      await this.dependencies.runRuntime.dispose();
    } catch (error) {
      this.dependencies.logger.warn('local.lifecycle.run_runtime_dispose_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await this.dependencies.infrastructure.dispose();
    this.dependencies.logger.debug('local.lifecycle.dispose.completed');
  }
}
