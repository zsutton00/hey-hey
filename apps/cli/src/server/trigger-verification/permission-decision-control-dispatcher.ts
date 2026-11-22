import type { MessagePoster } from '../../run/message-poster';
import { toTaskMonitorPermissionAnswerResultMessage } from '../../agents/task-monitor/task-monitor-decision-message';
import type { PermissionAnswerDisposition } from '../state-machine-input-adapter';
import type { PermissionDecisionRoutingInput } from '../../agents/permission-response-routing';
import type {
  PermissionDecisionDeliveryOutcome,
  PermissionDecisionOwner,
  RunRegistry,
} from '../../run/run-registry';
import type { RunStore } from '../../run-store/run-store';
import type { ServerLogger } from '../logger';
import type { RunReadRestoreCoordinator } from '../restore-persisted-runs';
import type { TaskMonitorStateMachineInputAdapter } from '../state-machine-input-adapter';
import { PermissionDecisionAuditSink } from './permission-decision-audit-sink';

export interface PermissionDecisionControlInput {
  readonly conversationId: string;
  readonly replyConversationId?: string | undefined;
  /** Needed to tell the person the result; without it the result is only logged. */
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly requestId: string;
  readonly sessionId: string;
  readonly agentType: PermissionDecisionRoutingInput['agentType'];
  readonly decision: PermissionDecisionRoutingInput['decision'];
  readonly reason: string | null;
  readonly idempotencyToken: string;
  readonly userId: string;
  readonly routingUserId?: string | undefined;
  readonly decidedAt: string;
  readonly nonce: string;
}

/** Routes generic permission controls only for Runs that retain generic permission ownership. */
export class PermissionDecisionControlDispatcher {
  private readonly auditSink: PermissionDecisionAuditSink;

  public constructor(
    private readonly runStore: RunStore,
    private readonly runRegistry: RunRegistry,
    private readonly runReadRestoreCoordinator: RunReadRestoreCoordinator,
    private readonly taskMonitorStateMachineInputAdapter: TaskMonitorStateMachineInputAdapter,
    private readonly poster: MessagePoster,
    auditFilePath: string,
    private readonly logger: ServerLogger,
  ) {
    this.auditSink = new PermissionDecisionAuditSink(auditFilePath);
  }

  public dispatch(input: PermissionDecisionControlInput): void {
    const runId = this.runStore.lookupByConversationId(input.conversationId);
    if (!runId) {
      this.logger.warn('trigger-verification.control.no_active_run', {
        kind: 'permission_decision',
        conversationId: input.conversationId,
        requestId: input.requestId,
        nonce: input.nonce,
      });
      if (input.replyConversationId) {
        void this.reportResult(input, {
          result: 'UNKNOWN_REQUEST',
          reason: 'The coding run for this permission request could not be found.',
        });
      }
      return;
    }

    void this.deliver(runId, input).catch(async (error: Error) => {
      this.logger.error('trigger-verification.control.permission_decision.dispatch_failed', {
        conversationId: input.conversationId,
        runId,
        requestId: input.requestId,
        nonce: input.nonce,
        error,
      });
      if (input.replyConversationId) {
        await this.reportResult(input, {
          result: 'DELIVERY_UNCERTAIN',
          reason: 'The CLI could not confirm delivery of your answer to the coding run.',
        });
      }
    });
  }

  /**
   * Tells the person what happened to their answer in the Conversation it came from, which can be
   * the Task Monitor workspace or the coding session, even when the other surface settled the
   * request first. A failure to tell them is logged with its cause and never changes the outcome.
   */
  private async reportResult(
    input: PermissionDecisionControlInput,
    disposition: PermissionAnswerDisposition,
    interventionId?: string,
    replyConversationId = input.replyConversationId ?? input.conversationId,
  ): Promise<void> {
    const logContext = {
      conversationId: replyConversationId,
      requestId: input.requestId,
      result: disposition.result,
      nonce: input.nonce,
    };
    if (input.projectId === null) {
      this.logger.warn('trigger-verification.control.permission_decision.result_not_reported', {
        ...logContext,
        cause: 'frame_has_no_project_id',
      });
      return;
    }

    try {
      await this.poster.createOutOfBand({
        organizationId: input.organizationId,
        projectId: input.projectId,
        conversationId: replyConversationId,
        dto: toTaskMonitorPermissionAnswerResultMessage(input.projectId, {
          providerActionId: input.requestId,
          interventionId,
          answer: input.decision,
          answeringUserId: input.userId,
          disposition,
        }),
        stamp: null,
      });
      this.logger.info(
        'trigger-verification.control.permission_decision.result_reported',
        logContext,
      );
    } catch (error) {
      this.logger.error('trigger-verification.control.permission_decision.result_report_failed', {
        ...logContext,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * A monitored Run's request is answered through the Task Monitor machine whenever the machine
   * records it, running or stopped, so the first answer settles it once. A request the machine has
   * no record of, such as one raised while the monitor was already stopped, belongs to the person
   * on the provider path.
   */
  private async routeByRecordedOwner(
    owner: PermissionDecisionOwner,
    input: PermissionDecisionControlInput,
    runId: string,
    taskMonitorId: string | null,
  ): Promise<PermissionDecisionOwner> {
    if (
      !taskMonitorId ||
      (owner.kind !== 'task_monitor_intervention' && owner.kind !== 'provider_permission')
    ) {
      return owner;
    }
    const recorded = await this.taskMonitorStateMachineInputAdapter.holdsPermissionRequest(
      taskMonitorId,
      { runId, providerActionId: input.requestId, providerSessionId: input.sessionId },
    );
    if (recorded) {
      return { kind: 'task_monitor_intervention', taskMonitorId };
    }
    if (owner.kind !== 'task_monitor_intervention') {
      return owner;
    }

    this.logger.warn('trigger-verification.control.permission_decision.no_monitor_record', {
      conversationId: input.conversationId,
      runId,
      requestId: input.requestId,
      taskMonitorId: owner.taskMonitorId,
      owner: 'HUMAN',
      cause: 'task_monitor_has_no_record_of_request',
      nonce: input.nonce,
    });

    return { kind: 'provider_permission' };
  }

  private async deliver(runId: string, input: PermissionDecisionControlInput): Promise<void> {
    const activeRun = this.runRegistry.get(runId);
    const ownedRun = activeRun ?? (await this.runReadRestoreCoordinator.restore(runId));
    if (!activeRun) {
      this.logger.info('trigger-verification.control.permission_decision.run_restored', {
        conversationId: input.conversationId,
        runId,
        requestId: input.requestId,
        nonce: input.nonce,
      });
    }
    const routingInput: PermissionDecisionRoutingInput = {
      runId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      agentType: input.agentType,
      decision: input.decision,
      reason: input.reason,
      idempotencyToken: input.idempotencyToken,
      deciderUserId: input.userId,
      ...(input.routingUserId ? { userId: input.routingUserId } : {}),
    };
    const classified = await this.runRegistry.classifyPermissionDecisionOwner(
      runId,
      input.requestId,
      input.idempotencyToken,
      ownedRun.taskMonitorId,
    );
    const taskMonitorId =
      classified.kind === 'task_monitor_intervention'
        ? classified.taskMonitorId
        : ownedRun.taskMonitorId;
    const owner = await this.routeByRecordedOwner(classified, input, runId, taskMonitorId);
    if (owner.kind === 'settled_specialized_request') {
      this.logger.warn(
        'trigger-verification.control.permission_decision.specialized_request_settled',
        {
          conversationId: input.conversationId,
          runId,
          requestId: input.requestId,
          nonce: input.nonce,
        },
      );
      return;
    }
    if (owner.kind === 'task_monitor_intervention') {
      this.logger.info('trigger-verification.control.permission_decision.task_monitor_admission', {
        conversationId: input.conversationId,
        runId,
        requestId: input.requestId,
        taskMonitorId: owner.taskMonitorId,
        nonce: input.nonce,
      });
      const result = await this.taskMonitorStateMachineInputAdapter.admitPermissionDecision({
        taskMonitorId: owner.taskMonitorId,
        runId,
        providerActionId: input.requestId,
        providerSessionId: input.sessionId,
        decision: input.decision,
        decidedAt: input.decidedAt,
        userId: input.userId,
        authenticatedAt: input.decidedAt,
        ingressId: `permission-decision:${input.idempotencyToken}`,
      });
      if (result.status === 'rejected') {
        this.logger.warn(
          'trigger-verification.control.permission_decision.task_monitor_admission_rejected',
          {
            conversationId: input.conversationId,
            runId,
            requestId: input.requestId,
            taskMonitorId: owner.taskMonitorId,
            nonce: input.nonce,
            code: result.code,
            reason: result.reason,
          },
        );
      }
      await this.reportResult(input, result.disposition, result.interventionId);
      if (
        result.disposition.result === 'APPLIED' &&
        result.interventionId &&
        input.replyConversationId &&
        input.replyConversationId !== input.conversationId
      ) {
        await this.reportResult(
          input,
          result.disposition,
          result.interventionId,
          input.conversationId,
        );
      }
      return;
    }
    this.logger.info('trigger-verification.control.permission_decision.dispatch', {
      conversationId: input.conversationId,
      runId,
      requestId: input.requestId,
      decision: input.decision,
      agentType: input.agentType,
      owner: owner.kind,
      nonce: input.nonce,
    });
    const result = await this.runRegistry.submitPermissionDecision(runId, routingInput);
    await this.auditSink
      .append({
        requestId: input.requestId,
        runId,
        decision: input.decision,
        outcome: result.outcome,
      })
      .catch((error: Error) => {
        this.logger.error('trigger-verification.control.permission_decision.audit_failed', {
          conversationId: input.conversationId,
          runId,
          requestId: input.requestId,
          outcome: result.outcome,
          nonce: input.nonce,
          error,
        });
      });
    if (result.outcome !== 'delivered') {
      this.logger.warn('trigger-verification.control.permission_decision.not_delivered', {
        conversationId: input.conversationId,
        runId,
        requestId: input.requestId,
        decision: input.decision,
        outcome: result.outcome,
        reason: result.reason,
        nonce: input.nonce,
      });
    }
    if (taskMonitorId && owner.kind === 'provider_permission') {
      await this.reportResult(input, providerPathDisposition(result, classified));
    }
  }
}

const providerPathDisposition = (
  delivery: PermissionDecisionDeliveryOutcome,
  classified: PermissionDecisionOwner,
): PermissionAnswerDisposition => {
  if (delivery.outcome === 'delivered') {
    return { result: 'APPLIED' };
  }
  if (
    classified.kind === 'task_monitor_intervention' &&
    delivery.outcome === 'dropped' &&
    ['no_run_registered', 'stale_permission_already_settled'].includes(delivery.reason)
  ) {
    return {
      result: 'UNKNOWN_REQUEST',
      reason:
        'The Task Monitor and coding agent have no pending record of this permission request.',
    };
  }
  if (/timeout|transport|connection|socket|closed/i.test(delivery.reason)) {
    return {
      result: 'DELIVERY_UNCERTAIN',
      reason: 'We could not confirm whether the coding agent received your answer.',
    };
  }
  return {
    result: 'NOT_DELIVERED',
    reason: 'Your answer could not be delivered to the coding agent.',
  };
};
