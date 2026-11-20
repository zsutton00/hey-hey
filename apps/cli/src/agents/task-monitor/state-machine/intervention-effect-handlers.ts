import type { MessagePoster } from '../../../run/message-poster';
import type { Run } from '../../../run/run';
import type { PermissionDecisionDeliveryOutcome, RunRegistry } from '../../../run/run-registry';
import type { ServerLogger } from '../../../server/logger';
import type {
  EffectExecutionIdentity,
  EffectHandler,
  EffectSettlement,
} from '../../../state-machine';
import type { TaskMonitorCoordinatorRunner } from '../../../server/monitors/runner';
import {
  toTaskMonitorPermissionDecidedMessage,
  type TaskMonitorPermissionDecisionRecord,
} from '../task-monitor-decision-message';
import type { TaskMonitorDecisionStore } from '../task-monitor-decision-store';
import { toTaskMonitorInterventionMessage } from '../task-monitor-intervention-message';
import {
  isTaskMonitorPermissionDecision,
  type TaskMonitorPermissionDecision,
} from '../task-monitor-permission-decision';
import type {
  ApplyTaskMonitorDecisionEffect,
  DecideTaskMonitorPermissionEffect,
  ProjectTaskMonitorInterventionEffect,
  RecordTaskMonitorPermissionDecisionEffect,
} from './effects';
import type { TaskMonitorMachineEffectOutcome } from './events';

const reasonFrom = (error: unknown): string =>
  error instanceof Error ? error.message : 'Task Monitor intervention delivery failed.';

/** Projects the pending intervention without making the Message authoritative. */
export class TaskMonitorInterventionProjectionEffectHandler implements EffectHandler<
  ProjectTaskMonitorInterventionEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: ProjectTaskMonitorInterventionEffect) =>
      Promise.resolve({
        status: 'uncertain' as const,
        outcome: {
          type: 'INTERVENTION_PROJECTION_FAILED' as const,
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
          reason: 'Intervention projection delivery is uncertain after process recovery.',
        },
      }),
  };

  public constructor(
    private readonly poster: MessagePoster,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: ProjectTaskMonitorInterventionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.info('task_monitor.intervention.projection.started', {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      effectId: execution.effectId,
    });
    try {
      const messageId = await this.poster.createOutOfBand({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        conversationId: effect.conversationId,
        dto: toTaskMonitorInterventionMessage(effect.projectId, effect),
        stamp: null,
      });
      this.logger.info('task_monitor.intervention.projection.completed', {
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        effectId: execution.effectId,
        messageId,
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'INTERVENTION_PROJECTED',
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
          messageId,
        },
      };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.intervention.projection.failed', {
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        effectId: execution.effectId,
        reason,
      });
      return {
        status: 'failed',
        outcome: {
          type: 'INTERVENTION_PROJECTION_FAILED',
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
          reason,
        },
      };
    }
  }
}

const deliveryClassification = (reason: string): 'stale' | 'failed' | 'cancelled' | 'uncertain' => {
  if (
    /no_run_registered|No pending .* permission request|does not match pending request|service_scope_request_not_found/u.test(
      reason,
    )
  ) {
    return 'stale';
  }
  if (/abort|cancel/u.test(reason.toLowerCase())) return 'cancelled';
  if (/no_runner_bound|timeout|transport|connection|socket|closed/u.test(reason.toLowerCase())) {
    return 'uncertain';
  }
  return 'failed';
};

/** Delivers one committed human decision through the provider-owning Run. */
export class TaskMonitorDecisionApplicationEffectHandler implements EffectHandler<
  ApplyTaskMonitorDecisionEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: ApplyTaskMonitorDecisionEffect) =>
      Promise.resolve({
        status: 'uncertain' as const,
        outcome: {
          type: 'DECISION_APPLICATION_UNCERTAIN' as const,
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
          reason: 'Provider decision delivery is uncertain after process recovery.',
        },
      }),
  };
  private readonly deliveries = new Map<
    string,
    Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>>
  >();

  public constructor(
    private readonly runRegistry: RunRegistry,
    private readonly logger: ServerLogger,
  ) {}

  public execute(
    effect: ApplyTaskMonitorDecisionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const replay = this.deliveries.get(execution.effectId);
    if (replay) {
      this.logger.info('task_monitor.intervention.decision.replayed', {
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        effectId: execution.effectId,
      });
      return replay;
    }
    const delivery = this.deliver(effect, execution).finally(() => {
      this.deliveries.delete(execution.effectId);
      this.logger.debug('task_monitor.intervention.decision.delivery_released', {
        taskMonitorId: effect.taskMonitorId,
        interventionId: effect.interventionId,
        providerActionId: effect.providerActionId,
        effectId: execution.effectId,
      });
    });
    this.deliveries.set(execution.effectId, delivery);
    return delivery;
  }

  private async deliver(
    effect: ApplyTaskMonitorDecisionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const logContext = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      runId: effect.runId,
      agentSessionId: effect.agentSessionId,
      operation: effect.operation,
      effectId: execution.effectId,
    };
    this.logger.info('task_monitor.intervention.decision.started', logContext);
    const run = this.runRegistry.get(effect.runId);
    this.logger.debug('task_monitor.intervention.decision.owner_lookup.completed', {
      ...logContext,
      ownerFound: run !== null,
    });
    if (!run || run.agentSessionId !== effect.agentSessionId) {
      return this.classified(effect, execution, 'stale', 'provider-action-owner-stale');
    }

    this.logger.debug('task_monitor.intervention.decision.owner_call.started', {
      ...logContext,
      provider: run.provider,
    });
    const delivery = await this.submit(effect, run, execution);
    this.logger.debug('task_monitor.intervention.decision.owner_call.completed', {
      ...logContext,
      provider: run.provider,
      deliveryOutcome: delivery.outcome,
    });
    if (delivery.outcome === 'delivered') {
      this.logger.info('task_monitor.intervention.decision.delivered', {
        ...logContext,
        callbackType: delivery.callbackType,
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'DECISION_APPLIED',
          taskMonitorId: effect.taskMonitorId,
          interventionId: effect.interventionId,
          providerActionId: effect.providerActionId,
        },
      };
    }
    return this.classified(
      effect,
      execution,
      deliveryClassification(delivery.reason),
      delivery.reason,
    );
  }

  /** Each request kind is answered by its own owner; neither is ever decided through the other. */
  private async submit(
    effect: ApplyTaskMonitorDecisionEffect,
    run: Run,
    execution: EffectExecutionIdentity,
  ): Promise<PermissionDecisionDeliveryOutcome> {
    const reason = this.denialReason(effect);
    if (effect.requestKind === 'SERVICE_SCOPE') {
      try {
        return await run.serviceScopeCoordinator.decideByMonitor({
          requestId: effect.providerActionId,
          decision: effect.providerDecision === 'approve' ? 'approve' : 'deny',
          reason,
        });
      } catch (error) {
        return { outcome: 'failed', reason: reasonFrom(error) };
      }
    }

    return this.runRegistry.submitPermissionDecision(effect.runId, {
      runId: effect.runId,
      sessionId: effect.providerSessionId,
      requestId: effect.providerActionId,
      agentType: run.provider,
      decision: effect.providerDecision,
      reason,
      idempotencyToken: execution.effectId,
      ...(effect.human ? { userId: effect.human.userId, deciderUserId: effect.human.userId } : {}),
    });
  }

  private denialReason(effect: ApplyTaskMonitorDecisionEffect): string | null {
    if (effect.operation !== 'REJECT_EXACT_ACTION') {
      return null;
    }

    return effect.human ? 'Denied by user.' : `Denied by Task Monitor: ${effect.monitorRationale}`;
  }

  private classified(
    effect: ApplyTaskMonitorDecisionEffect,
    execution: EffectExecutionIdentity,
    classification: 'stale' | 'failed' | 'cancelled' | 'uncertain',
    reason: string,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    const common = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      reason,
    } as const;
    this.logger[classification === 'failed' ? 'error' : 'warn'](
      `task_monitor.intervention.decision.${classification}`,
      { ...common, runId: effect.runId, effectId: execution.effectId },
    );
    switch (classification) {
      case 'stale':
        return { status: 'failed', outcome: { type: 'DECISION_APPLICATION_STALE', ...common } };
      case 'failed':
        return { status: 'failed', outcome: { type: 'DECISION_APPLICATION_FAILED', ...common } };
      case 'cancelled':
        return {
          status: 'cancelled',
          outcome: { type: 'DECISION_APPLICATION_CANCELLED', ...common },
        };
      case 'uncertain':
        return {
          status: 'uncertain',
          outcome: { type: 'DECISION_APPLICATION_UNCERTAIN', ...common },
        };
    }
  }
}

const MONITOR_DECISION_FAILED_PREFIX = 'The Task Monitor could not decide this request';

/**
 * Asks the Task Monitor agent to decide one pending provider permission request.
 * Anything the monitor cannot judge becomes an escalation carrying the reason,
 * never a silent failure. The supervision record is a separate effect the machine
 * emits only once it has accepted the outcome.
 */
export class TaskMonitorPermissionDecisionEffectHandler implements EffectHandler<
  DecideTaskMonitorPermissionEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: DecideTaskMonitorPermissionEffect) =>
      Promise.resolve({
        status: 'uncertain' as const,
        outcome: this.escalation(
          effect,
          `${MONITOR_DECISION_FAILED_PREFIX}: the decision was interrupted before it finished.`,
        ),
      }),
  };

  public constructor(
    private readonly coordinatorRunner: TaskMonitorCoordinatorRunner,
    private readonly decisionStore: TaskMonitorDecisionStore,
    private readonly runRegistry: RunRegistry,
    private readonly logger: ServerLogger,
    private readonly now: () => number = Date.now,
  ) {}

  public async execute(
    effect: DecideTaskMonitorPermissionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const logContext = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      runId: effect.runId,
      effectId: execution.effectId,
    };
    this.logger.info('task_monitor.permission_decision.started', logContext);

    const outcome = await this.decide(effect, execution, logContext);
    if (outcome.type === 'MONITOR_PERMISSION_ESCALATED' && effect.requestKind === 'SERVICE_SCOPE') {
      this.handServiceScopeToHuman(effect, outcome.reason, logContext);
    }

    return { status: 'succeeded', outcome };
  }

  /**
   * The Run owns a Service scope request and already shows it to the person; an escalation moves
   * the Run's wait from the monitor to them. When the Run is gone, restoring it from its persisted
   * request waits on the person, so there is nothing further to hand over.
   */
  private handServiceScopeToHuman(
    effect: DecideTaskMonitorPermissionEffect,
    reason: string,
    logContext: Record<string, string>,
  ): void {
    const run = this.runRegistry.get(effect.runId);
    if (!run || run.agentSessionId !== effect.agentSessionId) {
      this.logger.warn('task_monitor.service_scope.handoff_owner_missing', {
        ...logContext,
        reason,
      });
      return;
    }
    run.serviceScopeCoordinator.handToHuman(effect.providerActionId, reason);
  }

  private async decide(
    effect: DecideTaskMonitorPermissionEffect,
    execution: EffectExecutionIdentity,
    logContext: Record<string, string>,
  ): Promise<TaskMonitorMachineEffectOutcome> {
    try {
      const identity = await this.coordinatorRunner.runTaskMonitor(
        {
          monitorId: effect.taskMonitorId,
          cause: 'PERMISSION_REQUEST',
          correlationId: effect.interventionId,
          coordinatorAttemptId: execution.effectId,
          monitoredPermissionRequest: {
            interventionId: effect.interventionId,
            providerActionId: effect.providerActionId,
            runId: effect.runId,
            agentSessionId: effect.agentSessionId,
            action: effect.action,
            target: effect.target,
            fingerprint: effect.fingerprint,
            createdAt: effect.createdAt,
            expiresAt: effect.expiresAt,
          },
        },
        { organizationId: effect.organizationId, projectId: effect.projectId },
      );
      if (!identity) {
        return this.failed(effect, 'the monitor agent could not be started', logContext);
      }

      const result = await this.decisionStore.wait(identity.runId);
      if (result.status === 'INVALID') {
        return this.failed(
          effect,
          `the monitor's answer was invalid (${result.reason})`,
          logContext,
        );
      }
      if (result.status === 'TURN_SETTLED') {
        return this.failed(
          effect,
          `the monitor's turn ended without a decision (${result.terminalOutcome})`,
          logContext,
        );
      }
      if (!isTaskMonitorPermissionDecision(result.decision)) {
        return this.failed(
          effect,
          `the monitor answered with ${result.decision.action}, which does not decide a permission request`,
          logContext,
        );
      }

      return this.outcomeFor(effect, result.decision);
    } catch (error) {
      return this.failed(
        effect,
        error instanceof Error ? error.message : String(error),
        logContext,
      );
    }
  }

  private outcomeFor(
    effect: DecideTaskMonitorPermissionEffect,
    decision: TaskMonitorPermissionDecision,
  ): TaskMonitorMachineEffectOutcome {
    if (decision.action === 'ESCALATE_PERMISSION') {
      return this.escalation(effect, decision.rationale);
    }

    const decidedAt = this.now();
    const approved = decision.action === 'APPROVE_PERMISSION';
    return {
      type: 'MONITOR_PERMISSION_DECIDED',
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      fingerprint: effect.fingerprint,
      resolution: approved ? 'APPROVE' : 'DENY',
      providerDecision: approved ? 'approve' : 'deny',
      rationale: decision.rationale,
      decidedAt: new Date(decidedAt).toISOString(),
    };
  }

  private failed(
    effect: DecideTaskMonitorPermissionEffect,
    cause: string,
    logContext: Record<string, string>,
  ): TaskMonitorMachineEffectOutcome {
    this.logger.error('task_monitor.permission_decision.failed', { ...logContext, cause });

    return this.escalation(effect, `${MONITOR_DECISION_FAILED_PREFIX}: ${cause}.`);
  }

  private escalation(
    effect: DecideTaskMonitorPermissionEffect,
    reason: string,
  ): TaskMonitorMachineEffectOutcome {
    return {
      type: 'MONITOR_PERMISSION_ESCALATED',
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      reason,
    };
  }
}

/**
 * Projects one committed monitor permission outcome as supervision activity.
 * The machine emits it only after accepting the outcome, so the conversation never
 * shows a decision the machine rejected. A failed projection is reported back to the
 * machine with its cause and retried if the process dies before it settles.
 */
export class TaskMonitorPermissionRecordEffectHandler implements EffectHandler<
  RecordTaskMonitorPermissionDecisionEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = { strategy: 'retry' as const };

  public constructor(
    private readonly poster: MessagePoster,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: RecordTaskMonitorPermissionDecisionEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const logContext = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
      effectId: execution.effectId,
      decision: effect.decision,
    };
    const common = {
      taskMonitorId: effect.taskMonitorId,
      interventionId: effect.interventionId,
      providerActionId: effect.providerActionId,
    };

    if (effect.conversationId === null) {
      const reason = 'the Task Monitor has no conversation to record the decision in';
      this.logger.warn('task_monitor.permission_decision.record_skipped', {
        ...logContext,
        reason,
      });

      return {
        status: 'failed',
        outcome: { type: 'PERMISSION_DECISION_RECORD_FAILED', ...common, reason },
      };
    }

    const record: TaskMonitorPermissionDecisionRecord = {
      providerActionId: effect.providerActionId,
      action: effect.action,
      target: effect.target,
      decision: effect.decision,
      rationale: effect.rationale,
    };
    try {
      await this.poster.createOutOfBand({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        conversationId: effect.conversationId,
        dto: toTaskMonitorPermissionDecidedMessage(effect.projectId, record),
        stamp: null,
      });
      this.logger.info('task_monitor.permission_decision.recorded', logContext);

      return { status: 'succeeded', outcome: { type: 'PERMISSION_DECISION_RECORDED', ...common } };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.permission_decision.record_failed', {
        ...logContext,
        reason,
      });

      return {
        status: 'failed',
        outcome: { type: 'PERMISSION_DECISION_RECORD_FAILED', ...common, reason },
      };
    }
  }
}
