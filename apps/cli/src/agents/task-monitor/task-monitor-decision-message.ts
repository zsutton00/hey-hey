import { COORDINATOR_RECOVERY_GUIDANCE } from './task-monitor-coordinator-recovery';
import type { TaskMonitorCoordinatorValidationFailure } from '../../shared/agent-bridge-contract/generated/api';
import {
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  type CreateSystemMessage,
  type TaskMonitorSupervisionSystemMessageData,
} from '../../shared/api/generated/api';
import type { LocalTaskMonitorCoordinatorDecision } from '../../shared/agent-bridge-contract/generated/api';

export type TaskMonitorSupervisionMessage = Omit<
  CreateSystemMessage,
  'conversationId' | 'parentMessageId' | 'createdAt'
>;

export type TaskMonitorReviewLifecycle =
  | {
      readonly outcome: 'REQUESTING_REVIEW';
      readonly requestId: string;
      readonly rationale: string;
    }
  | { readonly outcome: 'AWAITING_REVIEW'; readonly requestId: string; readonly rationale: string }
  | {
      readonly outcome: 'REVIEW_REQUEST_FAILED';
      readonly requestId: string;
      readonly rationale: string;
      readonly failureContext: string;
    }
  | {
      readonly outcome: 'REVIEW_REQUEST_RECONCILING';
      readonly requestId: string;
      readonly rationale: string;
      readonly recoveryContext: string;
    }
  | {
      readonly outcome: 'REVIEW_RECOVERY_JUDGMENT_REQUIRED';
      readonly requestId: string;
      readonly rationale: string;
      readonly recoveryContext: string;
    };

const toTaskMonitorSupervisionData = (
  decision: LocalTaskMonitorCoordinatorDecision,
): TaskMonitorSupervisionSystemMessageData => {
  const common = {
    type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
    response: decision.rationale,
    agentIdentity: 'task-monitor-coordinator' as const,
    rationale: decision.rationale,
  };
  switch (decision.action) {
    case 'REQUEST_REVIEW':
      throw new Error('Review decisions must be projected through their durable lifecycle.');
    case 'REQUEST_CHANGES':
      return { ...common, outcome: 'CHANGES_REQUESTED', guidance: decision.guidance };
    case 'ACCEPT_TASK':
      return { ...common, outcome: 'ACCEPTED' };
    case 'WAIT':
      return { ...common, outcome: 'WAITING' };
    case 'REQUEST_JUDGMENT':
      return { ...common, outcome: 'JUDGMENT_REQUESTED', guidance: decision.guidance };
    case 'HALT':
      return { ...common, outcome: 'HALTED', failureContext: decision.failureContext };
  }
};

export const toTaskMonitorReviewLifecycleMessage = (
  projectId: string,
  lifecycle: TaskMonitorReviewLifecycle,
): TaskMonitorSupervisionMessage => {
  const data: TaskMonitorSupervisionSystemMessageData = {
    type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
    response: lifecycle.rationale,
    agentIdentity: 'task-monitor-coordinator',
    ...lifecycle,
  };
  return {
    projectId,
    type: MessageType.System,
    status: MessageStatus.Completed,
    data,
  };
};

export const toTaskMonitorSupervisionMessage = (
  projectId: string,
  decision: LocalTaskMonitorCoordinatorDecision,
): TaskMonitorSupervisionMessage => {
  return {
    projectId,
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: toTaskMonitorSupervisionData(decision),
  };
};

/** A recovery request is authored independently of the rejected recommendation. */
export const toTaskMonitorRecoveryJudgmentMessage = (
  projectId: string,
  requestId: string,
  failure: TaskMonitorCoordinatorValidationFailure,
): TaskMonitorSupervisionMessage => {
  const rationale = `The coordinator could not return a valid decision automatically. ${failure.code}: ${failure.message}`;
  const data: TaskMonitorSupervisionSystemMessageData = {
    type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
    agentIdentity: 'task-monitor-coordinator',
    outcome: 'JUDGMENT_REQUESTED',
    requestId,
    response: rationale,
    rationale,
    guidance: COORDINATOR_RECOVERY_GUIDANCE,
  };
  return { projectId, type: MessageType.System, status: MessageStatus.Completed, data };
};
