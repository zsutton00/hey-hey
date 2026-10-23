import { z } from 'zod';
import type { ApiRuntime } from '../../../../../../packages/ui-common/src/clients/shared';
import { MessageType } from '../../../shared/api/generated/api';
import type { MessagePoster } from '../../../run/message-poster';
import type { ServerLogger } from '../../../server/logger';
import type { TaskMonitorCoordinatorConversation } from '../../../server/task-monitor-coordinator-conversation';
import type {
  EffectExecutionIdentity,
  EffectHandler,
  EffectSettlement,
} from '../../../state-machine';
import type { ProjectTaskMonitorOutcomeJudgmentEffect } from './effects';
import type { TaskMonitorMachineEffectOutcome } from './events';
import { toTaskMonitorRecoveryJudgmentMessage } from '../task-monitor-decision-message';

const identitySchema = z
  .object({
    type: z.literal('TASK_MONITOR_SUPERVISION'),
    outcome: z.literal('JUDGMENT_REQUESTED'),
    requestId: z.string(),
  })
  .passthrough();

/** Delivers the committed recovery request, reconciling its stable identity before replay. */
export class TaskMonitorOutcomeJudgmentEffectHandler implements EffectHandler<
  ProjectTaskMonitorOutcomeJudgmentEffect,
  TaskMonitorMachineEffectOutcome
> {
  private readonly inFlight = new Map<
    string,
    Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>>
  >();
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (
      effect: ProjectTaskMonitorOutcomeJudgmentEffect,
      execution: EffectExecutionIdentity,
    ) => this.execute(effect, execution),
  };

  public constructor(
    private readonly apiRuntime: ApiRuntime,
    private readonly poster: MessagePoster,
    private readonly conversation: TaskMonitorCoordinatorConversation,
    private readonly logger: ServerLogger,
  ) {}

  public execute(
    effect: ProjectTaskMonitorOutcomeJudgmentEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const prior = this.inFlight.get(effect.requestId);
    if (prior) return prior;
    const delivery = this.project(effect, execution);
    this.inFlight.set(effect.requestId, delivery);
    void delivery.finally(() => this.inFlight.delete(effect.requestId)).catch(() => undefined);
    return delivery;
  }

  private async project(
    effect: ProjectTaskMonitorOutcomeJudgmentEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.info('task_monitor.recovery.judgment.delivery.started', {
      taskMonitorId: effect.taskMonitorId,
      requestId: effect.requestId,
      effectId: execution.effectId,
    });
    try {
      const conversationId = await this.conversation.resolve(effect);
      let messageId: string | null = null;
      for (let page = 1; messageId === null; page += 1) {
        const response = await this.apiRuntime.clients.conversationsApi.getMessages({
          organizationId: effect.organizationId,
          projectId: effect.projectId,
          conversationId,
          type: MessageType.System,
          page,
          limit: 100,
        });
        const messages = response.data.data ?? [];
        if (!Array.isArray(messages))
          throw new Error('Recovery request requires a page-based canonical message list.');
        for (const message of messages) {
          const identity = identitySchema.safeParse(message.data);
          if (
            message.conversationId === conversationId &&
            message.type === MessageType.System &&
            identity.success &&
            identity.data.requestId === effect.requestId
          ) {
            messageId = message.id;
            break;
          }
        }
        if (messages.length < 100) break;
      }
      messageId ??= await this.poster.createOutOfBand({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        conversationId,
        dto: toTaskMonitorRecoveryJudgmentMessage(
          effect.projectId,
          effect.requestId,
          effect.failure,
        ),
        stamp: null,
      });
      this.logger.info('task_monitor.recovery.judgment.delivery.completed', {
        taskMonitorId: effect.taskMonitorId,
        requestId: effect.requestId,
        messageId,
        conversationId,
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'OUTCOME_JUDGMENT_PROJECTED',
          taskMonitorId: effect.taskMonitorId,
          requestId: effect.requestId,
          messageId,
          conversationId,
        },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Recovery request delivery failed.';
      this.logger.error('task_monitor.recovery.judgment.delivery.failed', {
        taskMonitorId: effect.taskMonitorId,
        requestId: effect.requestId,
        reason,
      });
      return {
        status: 'failed',
        outcome: {
          type: 'OUTCOME_JUDGMENT_PROJECTION_FAILED',
          taskMonitorId: effect.taskMonitorId,
          requestId: effect.requestId,
          reason,
        },
      };
    }
  }
}
