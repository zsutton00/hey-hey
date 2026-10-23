import type { RunRegistry } from '../run/run-registry';
import type { RunStore } from '../run-store/run-store';
import type { PlatformWebSocketManager } from './platform-ws';
import type { ServerLogger } from './logger';
import type { MonitorProjectContext } from './monitors/project-context';
import type { RunLifecycleEvents } from './run-lifecycle-events';

export interface ConversationRoomSubscriptionsDependencies {
  runRegistry: RunRegistry;
  runLifecycleEvents: RunLifecycleEvents;
  runStore: RunStore;
  platformWebSocketManager: PlatformWebSocketManager;
  projectContext: MonitorProjectContext;
  logger: ServerLogger;
  retryDelayMs?: number;
  maxAttempts?: number;
}

interface PendingRegistration {
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  subscribedConversationId: string | null;
}

const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_MAX_ATTEMPTS = 50;

const clearPendingTimer = (pending: PendingRegistration): void => {
  if (!pending.timer) return;
  clearTimeout(pending.timer);
  pending.timer = null;
};

/**
 * Projects the RunRegistry's active-run set onto platform conversation rooms.
 * Local UI sockets are intentionally not part of this ownership boundary.
 */
export class ConversationRoomSubscriptions {
  private readonly pendingByRunId = new Map<string, PendingRegistration>();
  private readonly conversationRefCounts = new Map<string, number>();
  private readonly retryDelayMs: number;
  private readonly maxAttempts: number;
  private unregisterRunRegistered: (() => void) | null = null;
  private unregisterRunRemoved: (() => void) | null = null;

  public constructor(private readonly dependencies: ConversationRoomSubscriptionsDependencies) {
    this.retryDelayMs = dependencies.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.maxAttempts = dependencies.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  private readonly registerRun = (runId: string): void => {
    const existing = this.pendingByRunId.get(runId);
    if (existing) {
      this.dependencies.logger.debug('conversation-room.subscription.register.already_tracked', {
        runId,
        attempts: existing.attempts,
        subscribedConversationId: existing.subscribedConversationId,
      });
      return;
    }

    this.dependencies.logger.info('conversation-room.subscription.run_registered', { runId });
    this.pendingByRunId.set(runId, {
      attempts: 0,
      timer: null,
      subscribedConversationId: null,
    });
    void this.attachRun(runId).catch((error: unknown) => {
      this.dependencies.logger.error('conversation-room.subscription.register.failed', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  private readonly attachRun = async (runId: string): Promise<void> => {
    const { logger, platformWebSocketManager, projectContext, runStore } = this.dependencies;
    const pending = this.pendingByRunId.get(runId);
    if (!pending) {
      logger.debug('conversation-room.subscription.register.cancelled', { runId });
      return;
    }

    pending.attempts += 1;
    logger.debug('conversation-room.subscription.register.attempt', {
      runId,
      attempt: pending.attempts,
      maxAttempts: this.maxAttempts,
    });

    const run = await runStore.getRun(runId);
    if (this.pendingByRunId.get(runId) !== pending) {
      logger.debug('conversation-room.subscription.register.cancelled_after_lookup', { runId });
      return;
    }
    if (!run) {
      if (pending.attempts >= this.maxAttempts) {
        this.pendingByRunId.delete(runId);
        logger.warn('conversation-room.subscription.register.skipped', {
          runId,
          reason: 'run_not_found',
          attempts: pending.attempts,
          maxAttempts: this.maxAttempts,
        });
        return;
      }

      pending.timer = setTimeout(() => {
        pending.timer = null;
        void this.attachRun(runId).catch((error: unknown) => {
          logger.error('conversation-room.subscription.register.failed', {
            runId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }, this.retryDelayMs);

      logger.debug('conversation-room.subscription.register.retry_scheduled', {
        runId,
        attempt: pending.attempts,
        maxAttempts: this.maxAttempts,
        retryDelayMs: this.retryDelayMs,
      });
      return;
    }

    const { conversationId } = run;
    const projectId = run.contextMetadata?.projectId;
    if (!conversationId) {
      this.pendingByRunId.delete(runId);
      logger.warn('conversation-room.subscription.register.skipped', {
        runId,
        reason: 'no_conversation_id',
        attempts: pending.attempts,
      });
      return;
    }

    if (projectId) projectContext.learn(projectId);

    pending.subscribedConversationId = conversationId;
    const previousRefCount = this.conversationRefCounts.get(conversationId) ?? 0;
    this.conversationRefCounts.set(conversationId, previousRefCount + 1);
    if (previousRefCount === 0) {
      platformWebSocketManager.subscribe(conversationId);
    } else {
      logger.debug('conversation-room.subscription.register.shared_room', {
        runId,
        conversationId,
        refCount: previousRefCount + 1,
      });
    }
    logger.info('conversation-room.subscription.run_registered.subscribed', {
      runId,
      conversationId,
      attempts: pending.attempts,
      refCount: previousRefCount + 1,
    });
  };

  private readonly removeRun = (runId: string): void => {
    const pending = this.pendingByRunId.get(runId);
    if (!pending) {
      this.dependencies.logger.debug('conversation-room.subscription.remove.no_state', { runId });
      return;
    }

    this.dependencies.logger.info('conversation-room.subscription.run_removed', { runId });
    clearPendingTimer(pending);
    this.pendingByRunId.delete(runId);

    const conversationId = pending.subscribedConversationId;
    if (!conversationId) {
      this.dependencies.logger.debug('conversation-room.subscription.remove.cancelled_pending', {
        runId,
        attempts: pending.attempts,
      });
      return;
    }

    const refCount = this.conversationRefCounts.get(conversationId);
    if (refCount === undefined) {
      this.dependencies.logger.warn('conversation-room.subscription.remove.missing_ref', {
        runId,
        conversationId,
      });
      return;
    }
    if (refCount > 1) {
      this.conversationRefCounts.set(conversationId, refCount - 1);
      this.dependencies.logger.debug('conversation-room.subscription.remove.shared_room', {
        runId,
        conversationId,
        refCount: refCount - 1,
      });
      return;
    }

    this.conversationRefCounts.delete(conversationId);
    this.dependencies.platformWebSocketManager.unsubscribe(conversationId);
    this.dependencies.logger.info('conversation-room.subscription.run_removed.unsubscribed', {
      runId,
      conversationId,
    });
  };

  public start(): void {
    if (this.unregisterRunRegistered || this.unregisterRunRemoved) return;

    const { logger, runLifecycleEvents, runRegistry } = this.dependencies;
    this.unregisterRunRegistered = runLifecycleEvents.onRunRegistered(this.registerRun);
    this.unregisterRunRemoved = runLifecycleEvents.onRunRemoved(this.removeRun);

    const registeredRuns = runRegistry.list();
    logger.info('conversation-room.subscription.start.seed', {
      registeredRunCount: registeredRuns.length,
    });
    for (const run of registeredRuns) this.registerRun(run.runId);
  }

  public dispose(): void {
    this.unregisterRunRegistered?.();
    this.unregisterRunRemoved?.();
    this.unregisterRunRegistered = null;
    this.unregisterRunRemoved = null;

    for (const pending of this.pendingByRunId.values()) clearPendingTimer(pending);
    this.pendingByRunId.clear();

    for (const conversationId of this.conversationRefCounts.keys()) {
      this.dependencies.platformWebSocketManager.unsubscribe(conversationId);
    }
    this.conversationRefCounts.clear();
    this.dependencies.logger.info('conversation-room.subscription.disposed');
  }
}
