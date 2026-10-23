import { randomUUID } from 'node:crypto';
import type { RunWorktreeCollision } from '../agents/run-scope';
import type { ServerLogger } from './logger';

const TASK_MONITOR_LAUNCH_FAILURE_EVENT_KIND = 'task_monitor_launch_failure' as const;

export interface TaskMonitorLaunchFailureEvent {
  readonly kind: typeof TASK_MONITOR_LAUNCH_FAILURE_EVENT_KIND;
  readonly eventId: string;
  readonly taskMonitorId: string;
  readonly taskId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly failure: RunWorktreeCollision;
  readonly attempt: number;
  readonly detectedAt: string;
}

type TaskMonitorLaunchFailureListener = (
  event: TaskMonitorLaunchFailureEvent,
) => void | Promise<void>;

const publicationKey = (input: {
  readonly taskMonitorId: string;
  readonly agentSessionId: string;
  readonly fingerprint: string;
}): string => JSON.stringify([input.taskMonitorId, input.agentSessionId, input.fingerprint]);

/** Owns process-local, attempt-scoped publication of pre-Turn launch failures. */
export class TaskMonitorLaunchFailureRuntime {
  private readonly publishedByKey = new Map<string, TaskMonitorLaunchFailureEvent>();
  private readonly publicationByKey = new Map<string, Promise<TaskMonitorLaunchFailureEvent>>();
  private readonly attemptBySessionKey = new Map<string, number>();
  private readonly listeners = new Set<TaskMonitorLaunchFailureListener>();

  public constructor(private readonly logger: ServerLogger) {}

  public async publishLaunchFailure(input: {
    readonly taskMonitorId: string;
    readonly taskId: string;
    readonly runId: string;
    readonly agentSessionId: string;
    readonly conversationId: string;
    readonly failure: RunWorktreeCollision;
  }): Promise<TaskMonitorLaunchFailureEvent> {
    const key = publicationKey({
      taskMonitorId: input.taskMonitorId,
      agentSessionId: input.agentSessionId,
      fingerprint: input.failure.fingerprint,
    });
    const prior = this.publishedByKey.get(key);
    if (prior) {
      this.logger.debug('task_monitor.launch_failure.publication_replayed', {
        taskMonitorId: prior.taskMonitorId,
        taskId: prior.taskId,
        agentSessionId: prior.agentSessionId,
        fingerprint: prior.failure.fingerprint,
        eventId: prior.eventId,
      });
      return prior;
    }
    const activePublication = this.publicationByKey.get(key);
    if (activePublication) {
      this.logger.debug('task_monitor.launch_failure.publication_joined', {
        taskMonitorId: input.taskMonitorId,
        taskId: input.taskId,
        agentSessionId: input.agentSessionId,
        fingerprint: input.failure.fingerprint,
      });
      return activePublication;
    }

    // The publication cache is fingerprint-scoped, but the ingress identity
    // must be unique across fingerprints, retry attempts, and process
    // restarts for the retained session. A user can correct one collision
    // into a different collision before a retry, and a new CLI process can
    // observe the same retained session after an earlier attempt was
    // accepted. A process-local counter cannot distinguish those histories,
    // so the event gets a fresh nonce while the fingerprint remains the
    // stable failure identity used by projection reconciliation.
    const sessionKey = JSON.stringify([input.taskMonitorId, input.agentSessionId]);
    const attempt = (this.attemptBySessionKey.get(sessionKey) ?? 0) + 1;
    this.attemptBySessionKey.set(sessionKey, attempt);
    const event = Object.freeze({
      kind: TASK_MONITOR_LAUNCH_FAILURE_EVENT_KIND,
      eventId:
        `task-monitor-launch-failure:${input.taskMonitorId}:${input.agentSessionId}:` +
        `${String(attempt)}:${randomUUID()}`,
      taskMonitorId: input.taskMonitorId,
      taskId: input.taskId,
      runId: input.runId,
      agentSessionId: input.agentSessionId,
      conversationId: input.conversationId,
      failure: Object.freeze({ ...input.failure }),
      attempt,
      detectedAt: new Date().toISOString(),
    }) satisfies TaskMonitorLaunchFailureEvent;

    const publication = (async (): Promise<TaskMonitorLaunchFailureEvent> => {
      this.logger.info('task_monitor.launch_failure.publication.started', {
        taskMonitorId: event.taskMonitorId,
        taskId: event.taskId,
        runId: event.runId,
        agentSessionId: event.agentSessionId,
        conversationId: event.conversationId,
        collision: event.failure.code,
        fingerprint: event.failure.fingerprint,
        attempt: event.attempt,
      });
      try {
        await Promise.all([...this.listeners].map((listener) => listener(event)));
      } catch (error) {
        this.logger.error('task_monitor.launch_failure.publication.failed', {
          taskMonitorId: event.taskMonitorId,
          taskId: event.taskId,
          agentSessionId: event.agentSessionId,
          fingerprint: event.failure.fingerprint,
          eventId: event.eventId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      this.publishedByKey.set(key, event);
      this.logger.info('task_monitor.launch_failure.publication.completed', {
        taskMonitorId: event.taskMonitorId,
        taskId: event.taskId,
        agentSessionId: event.agentSessionId,
        fingerprint: event.failure.fingerprint,
        eventId: event.eventId,
        attempt: event.attempt,
      });
      return event;
    })();
    this.publicationByKey.set(key, publication);
    try {
      return await publication;
    } finally {
      this.publicationByKey.delete(key);
    }
  }

  /** Clears the attempt cache after workspace resolution succeeds and retry is canonical. */
  public clearLaunchFailures(input: {
    readonly taskMonitorId: string;
    readonly agentSessionId: string;
  }): void {
    const prefix = JSON.stringify([input.taskMonitorId, input.agentSessionId]).slice(0, -1);
    for (const key of this.publishedByKey.keys()) {
      if (key.startsWith(`${prefix},`)) this.publishedByKey.delete(key);
    }
    this.logger.debug('task_monitor.launch_failure.publication.cleared', { ...input });
  }

  public subscribe(listener: TaskMonitorLaunchFailureListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
