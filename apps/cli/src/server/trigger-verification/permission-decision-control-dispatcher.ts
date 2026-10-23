import type { PermissionDecisionRoutingInput } from '../../agents/permission-response-routing';
import type { RunRegistry } from '../../run/run-registry';
import type { RunStore } from '../../run-store/run-store';
import type { ServerLogger } from '../logger';
import type { RunReadRestoreCoordinator } from '../restore-persisted-runs';
import type { TaskMonitorStateMachineInputAdapter } from '../state-machine-input-adapter';
import { PermissionDecisionAuditSink } from './permission-decision-audit-sink';

export interface PermissionDecisionControlInput {
  readonly conversationId: string;
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
      return;
    }

    void this.deliver(runId, input).catch((error: Error) => {
      this.logger.error('trigger-verification.control.permission_decision.dispatch_failed', {
        conversationId: input.conversationId,
        runId,
        requestId: input.requestId,
        nonce: input.nonce,
        error,
      });
    });
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
    const owner = await this.runRegistry.classifyPermissionDecisionOwner(
      runId,
      input.requestId,
      input.idempotencyToken,
      ownedRun.taskMonitorId,
    );
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
  }
}
