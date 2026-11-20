import type { PermissionAnswerDisposition } from '../../server/state-machine-input-adapter';
import { COORDINATOR_RECOVERY_GUIDANCE } from './task-monitor-coordinator-recovery';
import type { TaskMonitorCoordinatorValidationFailure } from '@hey-hey/contracts/agent-bridge';
import {
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  type CreateSystemMessage,
  type TaskMonitorSupervisionSystemMessageData,
} from '@hey-hey/contracts/api/models';
import type { LocalTaskMonitorCoordinatorDecision } from '@hey-hey/contracts/agent-bridge';
import { toOpenApiProjectId } from '../../shared/api/identifierAdapters';

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
    case 'APPROVE_PERMISSION':
    case 'DENY_PERMISSION':
    case 'ESCALATE_PERMISSION':
      throw new Error('Permission decisions are recorded as permission activity, not supervision.');
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
    projectId: toOpenApiProjectId(projectId),
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
    projectId: toOpenApiProjectId(projectId),
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: toTaskMonitorSupervisionData(decision),
  };
};

/** What the recovery request tells the user; the posted message and the published snapshot share it. */
export const taskMonitorRecoveryRequestText = (
  failure: TaskMonitorCoordinatorValidationFailure,
): string =>
  `The coordinator could not return a valid decision automatically. ${failure.code}: ${failure.message}`;

/** A recovery request is authored independently of the rejected recommendation. */
export const toTaskMonitorRecoveryJudgmentMessage = (
  projectId: string,
  requestId: string,
  failure: TaskMonitorCoordinatorValidationFailure,
): TaskMonitorSupervisionMessage => {
  const rationale = taskMonitorRecoveryRequestText(failure);
  const data: TaskMonitorSupervisionSystemMessageData = {
    type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
    agentIdentity: 'task-monitor-coordinator',
    outcome: 'JUDGMENT_REQUESTED',
    requestId,
    response: rationale,
    rationale,
    guidance: COORDINATOR_RECOVERY_GUIDANCE,
  };
  return {
    projectId: toOpenApiProjectId(projectId),
    type: MessageType.System,
    status: MessageStatus.Completed,
    data,
  };
};

export interface TaskMonitorPermissionDecisionRecord {
  readonly providerActionId: string;
  readonly action: string;
  readonly target: string;
  readonly decision: 'APPROVED' | 'DENIED' | 'ESCALATED';
  readonly rationale: string;
}

const permissionDecisionSummary: Record<TaskMonitorPermissionDecisionRecord['decision'], string> = {
  APPROVED: 'Approved',
  DENIED: 'Denied',
  ESCALATED: 'Handed to you',
};

/** Supervision activity for one monitor decision on a provider permission request. */
export const toTaskMonitorPermissionDecidedMessage = (
  projectId: string,
  record: TaskMonitorPermissionDecisionRecord,
): TaskMonitorSupervisionMessage => {
  const data: TaskMonitorSupervisionSystemMessageData = {
    type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
    response: `${permissionDecisionSummary[record.decision]}: ${record.action} ${record.target}. ${record.rationale}`,
    agentIdentity: 'task-monitor-coordinator',
    outcome: 'PERMISSION_DECIDED',
    providerActionId: record.providerActionId,
    action: record.action,
    target: record.target,
    decision: record.decision,
    rationale: record.rationale,
  };
  return {
    projectId: toOpenApiProjectId(projectId),
    type: MessageType.System,
    status: MessageStatus.Completed,
    data,
  };
};

export interface TaskMonitorPermissionAnswerRecord {
  readonly providerActionId: string;
  readonly answer: 'approve' | 'always_approve' | 'deny' | 'whitelist';
  readonly disposition: PermissionAnswerDisposition;
  readonly answeringUserId: string;
}

const describePermissionAnswerResult = ({
  disposition,
  answeringUserId,
}: TaskMonitorPermissionAnswerRecord): string => {
  switch (disposition.result) {
    case 'APPLIED':
      return 'Your answer was applied.';
    case 'ALREADY_DECIDED': {
      if (disposition.decidedByUserId === answeringUserId) {
        return `You already answered this request at ${disposition.decidedAt}.`;
      }
      const who = disposition.decidedBy === 'PERSON' ? 'another person' : 'the Task Monitor';

      return `This request was already decided by ${who} at ${disposition.decidedAt}, so your answer was not applied.`;
    }
    case 'REFUSED':
    case 'UNKNOWN_REQUEST':
    case 'NOT_DELIVERED':
    case 'DELIVERY_UNCERTAIN':
      return disposition.reason;
  }
};

/** Tells the person what happened to their answer, in the conversation they answered from. */
export const toTaskMonitorPermissionAnswerResultMessage = (
  projectId: string,
  record: TaskMonitorPermissionAnswerRecord,
): TaskMonitorSupervisionMessage => {
  const { disposition } = record;
  const reason = describePermissionAnswerResult(record);
  const data: TaskMonitorSupervisionSystemMessageData = {
    type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
    response: reason,
    agentIdentity: 'task-monitor-coordinator',
    outcome: 'PERMISSION_ANSWER_RESULT',
    providerActionId: record.providerActionId,
    answer: record.answer,
    result: disposition.result,
    reason,
    ...(disposition.result === 'ALREADY_DECIDED'
      ? {
          decidedBy: disposition.decidedBy,
          decidedAt: disposition.decidedAt,
          ...(disposition.decidedByUserId === null
            ? {}
            : { decidedByUserId: disposition.decidedByUserId }),
        }
      : {}),
  };

  return {
    projectId: toOpenApiProjectId(projectId),
    type: MessageType.System,
    status: MessageStatus.Completed,
    data,
  };
};
