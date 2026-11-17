import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WorkItemExecutionState } from '@hey-hey/contracts/api/models';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import type {
  MessageBus,
  MessageBusSubscriptionState,
} from 'src/core/events/message-bus.interface';
import { MESSAGE_BUS_TOKEN } from 'src/core/events/tokens';
import { isWorkItemExecutionStateRetainedEvent } from 'src/core/events/types/domain-events';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId } from 'src/types';
import {
  StoredExecutionState,
  toWorkItemExecutionState,
} from './work-item-execution-state.record';

/** One accepted change to a retained record, scoped for project fan-out. */
export interface WorkItemExecutionStateChange {
  organizationId: string;
  projectId: string;
  executionState: WorkItemExecutionState;
}

/** Where this instance sends what it delivers: its own sockets. */
export interface WorkItemExecutionStateDeliverySink {
  changed(change: WorkItemExecutionStateChange): void;
  /** This instance stopped or resumed receiving other instances' changes. */
  subscriptionChanged(state: MessageBusSubscriptionState): void;
  /**
   * This instance could not, or can again, read a project's announced changes:
   * its subscribers may hold out-of-date state until RESTORED.
   */
  projectDeliveryChanged(
    projectId: string,
    state: MessageBusSubscriptionState,
  ): void;
}

/** Bounds the per-instance ordering memory; evicting only allows a re-send. */
const DELIVERED_LIMIT = 10_000;

/** Delays between reads of one announced change that keep failing. */
const READ_RETRY_BASE_MS = 250;
const READ_RETRY_MAX_MS = 30_000;
/** Failed reads after which the project's subscribers are told they may be behind. */
const READ_FAILURES_BEFORE_INTERRUPTED = 4;

/** A work item whose latest announced change has not been read yet. */
interface PendingRead {
  projectId: string;
  revision: number;
  failures: number;
  timer?: NodeJS.Timeout;
}

/**
 * Cross-instance delivery of retained execution state.
 *
 * An accepted change commits its notification through the outbox in the same
 * transaction, so a change is never retained without being announced. The
 * outbox publishes it on the bus, which every instance receives (the bus does
 * not deduplicate this channel across instances). Each instance then reads the
 * retained record — always the latest, so superseded notifications coalesce —
 * and emits it to its local sockets unless it already delivered that revision
 * or a newer one. Losing the bus subscription is reported to the sink so
 * subscribers know they may have missed changes; after restoration they re-read.
 */
@Injectable()
export class WorkItemExecutionStateDelivery {
  private readonly logger = new Logger(WorkItemExecutionStateDelivery.name);
  private readonly delivered = new Map<string, number>();
  private readonly pending = new Map<string, PendingRead>();
  /** Work items whose unread change was announced as interrupting, by project. */
  private readonly interrupted = new Map<string, Set<string>>();
  private sink?: WorkItemExecutionStateDeliverySink;
  private started = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEvents: DomainEventPublisher,
    @Inject(MESSAGE_BUS_TOKEN) private readonly bus: MessageBus,
  ) {}

  /** Inside the accepting transaction: the obligation to notify every instance. */
  async notifyInTransaction(
    tx: AnyTransactionClient,
    row: Pick<
      StoredExecutionState,
      'workItemId' | 'organizationId' | 'projectId' | 'revision'
    >,
  ): Promise<void> {
    await this.domainEvents.publishInTransaction(tx, {
      type: EVENT_TYPES.WORK_ITEM_EXECUTION_STATE.RETAINED,
      aggregateId: row.workItemId,
      payload: {
        organizationId: row.organizationId as OrganizationId,
        projectId: row.projectId as ProjectId,
        workItemId: row.workItemId,
        revision: Number(row.revision),
      },
    });
  }

  async start(sink: WorkItemExecutionStateDeliverySink): Promise<void> {
    this.sink = sink;
    if (this.started) {
      return;
    }

    this.started = true;
    this.bus.onSubscriptionStateChange?.((state) => {
      this.logger.warn('[execution-state] delivery subscription changed', {
        state,
      });
      this.sink?.subscriptionChanged(state);
    });
    await this.bus.subscribe(
      EVENT_TYPES.WORK_ITEM_EXECUTION_STATE.RETAINED,
      (envelope) => {
        if (!isWorkItemExecutionStateRetainedEvent(envelope.event)) {
          return;
        }

        const { workItemId, projectId, revision } = envelope.event.payload;
        this.schedule(workItemId, projectId, revision);
      },
    );
  }

  /**
   * Reads one announced change, retrying that work item alone with growing
   * delays while the read fails. A newer announcement folds into the pending
   * retry, since every read returns the latest record.
   */
  private schedule(
    workItemId: string,
    projectId: string,
    revision: number,
  ): void {
    const existing = this.pending.get(workItemId);
    if (existing) {
      existing.revision = Math.max(existing.revision, revision);
      return;
    }

    const read: PendingRead = { projectId, revision, failures: 0 };
    this.pending.set(workItemId, read);
    void this.attempt(workItemId, read);
  }

  private async attempt(workItemId: string, read: PendingRead): Promise<void> {
    read.timer = undefined;
    try {
      // A newer announcement can fold in while a read is in flight; read
      // again until what this instance delivered covers the latest one.
      let target: number;
      do {
        target = read.revision;
        if (!(await this.deliver(workItemId, target))) {
          break;
        }
      } while (read.revision > target);
    } catch (error: unknown) {
      this.readFailed(workItemId, read, error);
      return;
    }

    this.pending.delete(workItemId);
    this.readRecovered(workItemId, read.projectId);
  }

  private readFailed(
    workItemId: string,
    read: PendingRead,
    error: unknown,
  ): void {
    read.failures += 1;
    const delayMs = Math.min(
      READ_RETRY_BASE_MS * 2 ** (read.failures - 1),
      READ_RETRY_MAX_MS,
    );
    this.logger.error('[execution-state] delivery read failed', {
      code: 'DELIVERY_READ_FAILED',
      workItemId,
      projectId: read.projectId,
      revision: read.revision,
      failures: read.failures,
      retryInMs: delayMs,
      error: error instanceof Error ? error.message : String(error),
    });

    if (read.failures === READ_FAILURES_BEFORE_INTERRUPTED) {
      const items = this.interrupted.get(read.projectId) ?? new Set<string>();
      const wasInterrupted = items.size > 0;
      items.add(workItemId);
      this.interrupted.set(read.projectId, items);
      if (!wasInterrupted) {
        this.sink?.projectDeliveryChanged(read.projectId, 'INTERRUPTED');
      }
    }

    read.timer = setTimeout(() => void this.attempt(workItemId, read), delayMs);
    read.timer.unref?.();
  }

  private readRecovered(workItemId: string, projectId: string): void {
    const items = this.interrupted.get(projectId);
    if (!items?.delete(workItemId)) {
      return;
    }

    if (items.size === 0) {
      this.interrupted.delete(projectId);
      this.sink?.projectDeliveryChanged(projectId, 'RESTORED');
    }
  }

  /**
   * Delivers the retained record if it is newer than what this instance sent.
   * False when there is nothing more to read: the item was deleted or its
   * retained state is unreadable.
   */
  private async deliver(
    workItemId: string,
    notified: number,
  ): Promise<boolean> {
    if ((this.delivered.get(workItemId) ?? 0) >= notified) {
      return true;
    }

    const row = await this.prisma.db.workItemExecutionState.findUnique({
      where: { workItemId },
    });
    if (!row) {
      // The work item, and its retained state with it, has been deleted.
      return false;
    }

    const revision = Number(row.revision);
    if ((this.delivered.get(workItemId) ?? 0) >= revision) {
      return true;
    }

    const executionState = toWorkItemExecutionState(row, this.logger);
    if (!executionState) {
      return false;
    }

    this.remember(workItemId, revision);
    this.sink?.changed({
      organizationId: row.organizationId,
      projectId: row.projectId,
      executionState,
    });

    return true;
  }

  private remember(workItemId: string, revision: number): void {
    this.delivered.delete(workItemId);
    this.delivered.set(workItemId, revision);
    if (this.delivered.size > DELIVERED_LIMIT) {
      const oldest = this.delivered.keys().next().value;
      if (oldest !== undefined) {
        this.delivered.delete(oldest);
      }
    }
  }
}
