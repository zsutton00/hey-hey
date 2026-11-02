import { TaskMonitorInterventionSystemMessageDataAllOfAgentIdentityEnum as TaskMonitorInterventionSystemMessageDataAgentIdentityEnum } from '@hey-hey/contracts/api/models';
import {
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  TaskMonitorInterventionChoice,
  type CreateSystemMessage,
  type TaskMonitorInterventionSystemMessageData,
} from '@hey-hey/contracts/api/models';
import { toOpenApiProjectId } from '../../shared/api/identifierAdapters';

export interface TaskMonitorInterventionProjection {
  readonly interventionId: string;
  readonly providerActionId: string;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type TaskMonitorInterventionMessage = Omit<
  CreateSystemMessage,
  'conversationId' | 'parentMessageId' | 'createdAt'
>;

export const toTaskMonitorInterventionData = (
  intervention: TaskMonitorInterventionProjection,
): TaskMonitorInterventionSystemMessageData =>
  ({
    type: SystemMessageDataTypeEnum.TaskMonitorIntervention,
    response: `Approval is required for ${intervention.action}: ${intervention.target}`,
    agentIdentity: TaskMonitorInterventionSystemMessageDataAgentIdentityEnum.TaskMonitorCoordinator,
    interventionId: intervention.interventionId,
    providerActionId: intervention.providerActionId,
    runId: intervention.runId,
    agentSessionId: intervention.agentSessionId,
    action: intervention.action,
    target: intervention.target,
    fingerprint: intervention.fingerprint,
    createdAt: intervention.createdAt,
    expiresAt: intervention.expiresAt,
    choices: [TaskMonitorInterventionChoice.Approve, TaskMonitorInterventionChoice.Deny],
  }) satisfies TaskMonitorInterventionSystemMessageData;

export const toTaskMonitorInterventionMessage = (
  projectId: string,
  intervention: TaskMonitorInterventionProjection,
): TaskMonitorInterventionMessage =>
  ({
    projectId: toOpenApiProjectId(projectId),
    type: MessageType.System,
    status: MessageStatus.Open,
    data: toTaskMonitorInterventionData(intervention),
  }) satisfies TaskMonitorInterventionMessage;
