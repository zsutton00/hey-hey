import { TaskMonitorLaunchRecoverySystemMessageDataAllOfAgentIdentityEnum as TaskMonitorLaunchRecoverySystemMessageDataAgentIdentityEnum } from '@hey-hey/contracts/api/models';
import {
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  TaskMonitorLaunchRecoveryAuthority,
  TaskMonitorLaunchRecoveryCollision,
  TaskMonitorLaunchRecoveryCorrectionMode,
  TaskMonitorLaunchRecoveryLifecycle,
  type CreateSystemMessage,
  type TaskMonitorLaunchRecoverySystemMessageData,
} from '@hey-hey/contracts/api/models';
import type { ProjectTaskMonitorLaunchRecoveryEffect } from './state-machine/effects';
import {
  toOpenApiConversationId,
  toOpenApiProjectId,
  toOpenApiTaskId,
} from '../../shared/api/identifierAdapters';

export type TaskMonitorLaunchRecoveryMessage = Omit<
  CreateSystemMessage,
  'conversationId' | 'parentMessageId' | 'createdAt'
>;

export const toTaskMonitorLaunchRecoveryData = (
  conversationId: string,
  effect: ProjectTaskMonitorLaunchRecoveryEffect,
): TaskMonitorLaunchRecoverySystemMessageData =>
  ({
    type: SystemMessageDataTypeEnum.TaskMonitorLaunchRecovery,
    response:
      `Task Monitor paused before work started. ${effect.failure.message} The affected service is ${effect.failure.serviceId}. ` +
      effect.failure.correctiveAction,
    agentIdentity:
      TaskMonitorLaunchRecoverySystemMessageDataAgentIdentityEnum.TaskMonitorCoordinator,
    taskMonitorId: effect.taskMonitorId,
    taskId: toOpenApiTaskId(effect.taskId),
    agentSessionId: effect.agentSessionId,
    conversationId: toOpenApiConversationId(effect.conversationId),
    serviceId: effect.failure.serviceId,
    repositoryPath: effect.failure.repositoryPath,
    branch: effect.failure.branch,
    collision: TaskMonitorLaunchRecoveryCollision.BranchCheckedOutInHostRepository,
    authority:
      effect.failure.authority === 'PLAN'
        ? TaskMonitorLaunchRecoveryAuthority.Plan
        : TaskMonitorLaunchRecoveryAuthority.TaskMonitor,
    correctionMode:
      effect.failure.correctionMode === 'PLAN_LOCKED'
        ? TaskMonitorLaunchRecoveryCorrectionMode.PlanLocked
        : TaskMonitorLaunchRecoveryCorrectionMode.UserEditable,
    correctiveAction: effect.failure.correctiveAction,
    lifecycle: TaskMonitorLaunchRecoveryLifecycle.RetryableLaunch,
    fingerprint: effect.failure.fingerprint,
  }) satisfies TaskMonitorLaunchRecoverySystemMessageData;

export const toTaskMonitorLaunchRecoveryMessage = (
  projectId: string,
  conversationId: string,
  effect: ProjectTaskMonitorLaunchRecoveryEffect,
): TaskMonitorLaunchRecoveryMessage =>
  ({
    projectId: toOpenApiProjectId(projectId),
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: toTaskMonitorLaunchRecoveryData(conversationId, effect),
  }) satisfies TaskMonitorLaunchRecoveryMessage;
