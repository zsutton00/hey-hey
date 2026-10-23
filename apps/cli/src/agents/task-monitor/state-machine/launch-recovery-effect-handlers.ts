import { z } from 'zod';
import type { ApiRuntime } from '../../../../../../packages/ui-common/src/clients/shared';
import { MessageType, SystemMessageDataTypeEnum } from '../../../shared/api/generated/api';
import type { MessagePoster } from '../../../run/message-poster';
import type {
  EffectExecutionIdentity,
  EffectHandler,
  EffectSettlement,
} from '../../../state-machine';
import type { ServerLogger } from '../../../server/logger';
import type { TaskMonitorCoordinatorConversation } from '../../../server/task-monitor-coordinator-conversation';
import { toTaskMonitorLaunchRecoveryMessage } from '../task-monitor-launch-recovery-message';
import type { ProjectTaskMonitorLaunchRecoveryEffect } from './effects';
import type { TaskMonitorMachineEffectOutcome } from './events';

const reasonFrom = (error: unknown): string =>
  error instanceof Error ? error.message : 'Task Monitor launch recovery projection failed.';

const projectionKey = (effect: ProjectTaskMonitorLaunchRecoveryEffect): string =>
  JSON.stringify([effect.taskMonitorId, effect.agentSessionId, effect.failure.fingerprint]);

const launchRecoveryIdentitySchema = z
  .object({
    type: z.literal(SystemMessageDataTypeEnum.TaskMonitorLaunchRecovery),
    taskMonitorId: z.string(),
    agentSessionId: z.string(),
    conversationId: z.string(),
    fingerprint: z.string(),
  })
  .passthrough();

/** Projects one typed launch-attention message for the canonical failure identity. */
export class TaskMonitorLaunchRecoveryEffectHandler implements EffectHandler<
  ProjectTaskMonitorLaunchRecoveryEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (
      effect: ProjectTaskMonitorLaunchRecoveryEffect,
      execution: EffectExecutionIdentity,
    ) => this.execute(effect, execution),
  };

  private readonly projectedByKey = new Map<string, string>();
  private readonly projectionInFlightByKey = new Map<
    string,
    Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>>
  >();

  public constructor(
    private readonly apiRuntime: ApiRuntime,
    private readonly poster: MessagePoster,
    private readonly coordinatorConversation: TaskMonitorCoordinatorConversation,
    private readonly logger: ServerLogger,
  ) {}

  public async execute(
    effect: ProjectTaskMonitorLaunchRecoveryEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const key = projectionKey(effect);
    const priorMessageId = this.projectedByKey.get(key);
    if (priorMessageId) {
      this.logger.info('task_monitor.launch_recovery.projection.replayed', {
        taskMonitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        agentSessionId: effect.agentSessionId,
        fingerprint: effect.failure.fingerprint,
        effectId: execution.effectId,
        messageId: priorMessageId,
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'LAUNCH_RECOVERY_PROJECTED',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          agentSessionId: effect.agentSessionId,
          fingerprint: effect.failure.fingerprint,
          messageId: priorMessageId,
        },
      };
    }

    const activeProjection = this.projectionInFlightByKey.get(key);
    if (activeProjection) {
      this.logger.debug('task_monitor.launch_recovery.projection.joined', {
        taskMonitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        agentSessionId: effect.agentSessionId,
        fingerprint: effect.failure.fingerprint,
        effectId: execution.effectId,
      });
      return activeProjection;
    }

    const projection = this.project(effect, execution, key);
    this.projectionInFlightByKey.set(key, projection);
    void projection
      .finally(() => {
        if (this.projectionInFlightByKey.get(key) === projection) {
          this.projectionInFlightByKey.delete(key);
        }
      })
      .catch(() => undefined);
    return projection;
  }

  private async project(
    effect: ProjectTaskMonitorLaunchRecoveryEffect,
    execution: EffectExecutionIdentity,
    key: string,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.logger.info('task_monitor.launch_recovery.projection.started', {
      taskMonitorId: effect.taskMonitorId,
      taskId: effect.taskId,
      agentSessionId: effect.agentSessionId,
      fingerprint: effect.failure.fingerprint,
      serviceId: effect.failure.serviceId,
      repositoryPath: effect.failure.repositoryPath,
      branch: effect.failure.branch,
      effectId: execution.effectId,
    });
    try {
      const conversationId = await this.coordinatorConversation.resolve({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        taskMonitorId: effect.taskMonitorId,
      });
      const existingMessageId = await this.findExistingProjection(effect, conversationId);
      if (existingMessageId) {
        this.projectedByKey.set(key, existingMessageId);
        this.logger.info('task_monitor.launch_recovery.projection.reconciled', {
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          agentSessionId: effect.agentSessionId,
          fingerprint: effect.failure.fingerprint,
          effectId: execution.effectId,
          messageId: existingMessageId,
        });
        return {
          status: 'succeeded',
          outcome: {
            type: 'LAUNCH_RECOVERY_PROJECTED',
            taskMonitorId: effect.taskMonitorId,
            taskId: effect.taskId,
            agentSessionId: effect.agentSessionId,
            fingerprint: effect.failure.fingerprint,
            messageId: existingMessageId,
          },
        };
      }
      const messageId = await this.poster.createOutOfBand({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        conversationId,
        dto: toTaskMonitorLaunchRecoveryMessage(effect.projectId, conversationId, effect),
        stamp: null,
      });
      this.projectedByKey.set(key, messageId);
      this.logger.info('task_monitor.launch_recovery.projection.completed', {
        taskMonitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        agentSessionId: effect.agentSessionId,
        fingerprint: effect.failure.fingerprint,
        effectId: execution.effectId,
        messageId,
      });
      return {
        status: 'succeeded',
        outcome: {
          type: 'LAUNCH_RECOVERY_PROJECTED',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          agentSessionId: effect.agentSessionId,
          fingerprint: effect.failure.fingerprint,
          messageId,
        },
      };
    } catch (error) {
      const reason = reasonFrom(error);
      this.logger.error('task_monitor.launch_recovery.projection.failed', {
        taskMonitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        agentSessionId: effect.agentSessionId,
        fingerprint: effect.failure.fingerprint,
        effectId: execution.effectId,
        reason,
      });
      return {
        status: 'failed',
        outcome: {
          type: 'LAUNCH_RECOVERY_PROJECTION_FAILED',
          taskMonitorId: effect.taskMonitorId,
          taskId: effect.taskId,
          agentSessionId: effect.agentSessionId,
          fingerprint: effect.failure.fingerprint,
          reason,
        },
      };
    }
  }

  private async findExistingProjection(
    effect: ProjectTaskMonitorLaunchRecoveryEffect,
    coordinatorConversationId: string,
  ): Promise<string | null> {
    const pageSize = 100;
    for (let page = 1; ; page += 1) {
      const response = await this.apiRuntime.clients.conversationsApi.getMessages({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        conversationId: coordinatorConversationId,
        type: MessageType.System,
        page,
        limit: pageSize,
      });
      const messages = response.data.data ?? [];
      if (!Array.isArray(messages)) {
        throw new Error('Launch recovery requires the requested page-based message list.');
      }
      for (const message of messages) {
        if (
          message.type !== MessageType.System ||
          message.conversationId !== coordinatorConversationId
        ) {
          continue;
        }
        const identity = launchRecoveryIdentitySchema.safeParse(message.data);
        if (
          identity.success &&
          identity.data.taskMonitorId === effect.taskMonitorId &&
          identity.data.agentSessionId === effect.agentSessionId &&
          identity.data.conversationId === effect.conversationId &&
          identity.data.fingerprint === effect.failure.fingerprint
        ) {
          return message.id;
        }
      }
      if (messages.length < pageSize) return null;
    }
  }
}
