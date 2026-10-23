import type { AgenticSession } from '../../session/types';
import type { RunStore } from '../../run-store/run-store';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../../shared/logging/daily-session';
import type { ServerLogger } from '../logger';
import type { PlatformWebSocketManager } from '../platform-ws';

export type PersistedMonitorProjectResolution =
  | { status: 'found'; projectId: string; runId: string }
  | { status: 'no_daily_session_run' }
  | { status: 'missing_project'; runId: string };

/**
 * Resolve the project whose activity the daily-session monitor must subscribe
 * to after a process restart. RunRegistry only observes Runs created in this
 * process, so persisted daily-session Runs must seed the project-room binding
 * separately during bootstrap.
 */
export const resolvePersistedMonitorProject = (
  runs: readonly AgenticSession[],
): PersistedMonitorProjectResolution => {
  const latest = [...runs].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )[0];
  if (!latest) return { status: 'no_daily_session_run' };

  const projectId = latest.contextMetadata.projectId.trim();
  if (!projectId) {
    return { status: 'missing_project', runId: latest.agentic_session_id };
  }

  return { status: 'found', projectId, runId: latest.agentic_session_id };
};

export interface MonitorProjectContextDependencies {
  runStore: RunStore;
  platformWebSocketManager: PlatformWebSocketManager;
  logger: ServerLogger;
}

export class MonitorProjectContext {
  private projectId: string | null = null;

  public constructor(private readonly dependencies: MonitorProjectContextDependencies) {}

  public get currentProjectId(): string | null {
    return this.projectId;
  }

  public learn(projectId: string): void {
    if (!this.projectId) this.projectId = projectId;
  }

  public learnAndSubscribe(projectId: string): void {
    this.learn(projectId);
    this.dependencies.platformWebSocketManager.subscribeProject(projectId);
  }

  /** Restore both the project identity latch and its upstream room subscription. */
  public async restore(): Promise<string | null> {
    const resolution = resolvePersistedMonitorProject(
      await this.dependencies.runStore.findRunsByPromptType('daily_session'),
    );
    if (resolution.status === 'found') {
      this.dependencies.logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'bootstrap_context_restored',
        projectId: resolution.projectId,
        runId: resolution.runId,
      });
      this.learnAndSubscribe(resolution.projectId);
      this.dependencies.logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'bootstrap_subscription_requested',
        projectId: resolution.projectId,
        source: 'persisted_daily_session',
      });
      return resolution.projectId;
    }

    if (resolution.status === 'missing_project') {
      this.dependencies.logger.error(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'bootstrap_context_missing',
        runId: resolution.runId,
      });
      return null;
    }

    this.dependencies.logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
      stage: 'bootstrap_context_unavailable',
      reason: resolution.status,
    });
    return null;
  }
}
