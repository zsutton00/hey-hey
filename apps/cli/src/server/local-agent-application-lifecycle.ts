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
  private disposal: Promise<void> | undefined;
  private cleanupSteps: Array<() => void | Promise<void>> | undefined;

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

  public dispose(): Promise<void> {
    this.dependencies.runRuntime.runRegistry.closeAdmission();
    this.cleanupSteps ??= [
      () => this.dependencies.machineActions.dispose(),
      () => this.dependencies.platformRuntime.dispose(),
      () => this.dependencies.stateMachineRuntime.dispose(),
      () => this.dependencies.monitorRuntime.dispose(),
      () => this.dependencies.monitorEventSources.dispose(),
      () => this.dependencies.runRuntime.dispose(),
      () => this.dependencies.infrastructure.dispose(),
    ];
    this.disposal ??= this.finishDisposal().catch((error: unknown) => {
      this.disposal = undefined;
      throw error;
    });
    return this.disposal;
  }

  private async finishDisposal(): Promise<void> {
    this.dependencies.logger.debug('local.lifecycle.dispose.started');
    while (this.cleanupSteps?.length) {
      await this.cleanupSteps[0]!();
      this.cleanupSteps.shift();
    }
    this.dependencies.logger.debug('local.lifecycle.dispose.completed');
  }
}
