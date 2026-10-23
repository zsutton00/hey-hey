import type { MessagePoster } from '../../../run/message-poster';
import type { RunRegistry } from '../../../run/run-registry';
import type { ServerLogger } from '../../../server/logger';
import type {
  EffectExecutionIdentity,
  EffectHandler,
  EffectSettlement,
} from '../../../state-machine';
import { toTaskMonitorInterventionMessage } from '../task-monitor-intervention-message';
import type {
  ApplyTaskMonitorDecisionEffect,
  ProjectTaskMonitorInterventionEffect,
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
    /no_run_registered|No pending .* permission request|does not match pending request/u.test(
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
    const delivery = await this.runRegistry.submitPermissionDecision(effect.runId, {
      runId: effect.runId,
      sessionId: effect.providerSessionId,
      requestId: effect.providerActionId,
      agentType: run.provider,
      decision: effect.providerDecision,
      reason: effect.operation === 'REJECT_EXACT_ACTION' ? 'Denied by user.' : null,
      idempotencyToken: execution.effectId,
      userId: effect.human.userId,
      deciderUserId: effect.human.userId,
    });
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
