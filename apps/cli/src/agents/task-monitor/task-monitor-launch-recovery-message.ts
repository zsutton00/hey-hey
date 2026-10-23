import {
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  TaskMonitorLaunchRecoveryAuthority,
  TaskMonitorLaunchRecoveryCollision,
  TaskMonitorLaunchRecoveryCorrectionMode,
  TaskMonitorLaunchRecoveryLifecycle,
  TaskMonitorLaunchRecoverySystemMessageDataAgentIdentityEnum,
  type CreateSystemMessage,
  type TaskMonitorLaunchRecoverySystemMessageData,
} from '../../shared/api/generated/api';
import type { ProjectTaskMonitorLaunchRecoveryEffect } from './state-machine/effects';

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
    taskId: effect.taskId,
    agentSessionId: effect.agentSessionId,
    conversationId: effect.conversationId,
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
    projectId,
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: toTaskMonitorLaunchRecoveryData(conversationId, effect),
  }) satisfies TaskMonitorLaunchRecoveryMessage;
