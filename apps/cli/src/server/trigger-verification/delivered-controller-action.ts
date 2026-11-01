import type {
  AgentTrigger,
  MonitorCommandBody1,
} from '../../shared/agent-bridge-contract/generated/api';
import type {
  ExecutableEnvelopeAuthorization,
  HostActionAdmissionRequest,
} from '../controller-authorization/types';
import type { V2ConversationControlBody } from './protocol-v2';
import { hashControllerAction } from '../../shared/api/generated/controller-action-contract';
import type {
  ControllerStartInputs,
  ControllerMessageInputs,
  HostActionPreparation,
} from '../../shared/api/generated/api';

type AuthorityIncreasingControlKind = V2ConversationControlBody['kind'];

/** Maps each authorized control kind to its controller-authorized action. */
export const controlAction = (
  kind: AuthorityIncreasingControlKind,
): Pick<HostActionAdmissionRequest, 'actionCategory' | 'actionType'> => {
  switch (kind) {
    case 'compact_run':
      return {
        actionCategory: 'AUTHORITY_INCREASING_CONTROL',
        actionType: 'CONVERSATION_CONTROL_COMPACT_RUN',
      };
    case 'permission_decision':
      return {
        actionCategory: 'AUTHORITY_INCREASING_CONTROL',
        actionType: 'CONVERSATION_CONTROL_PERMISSION_DECISION',
      };
    // An answer is the user replying in the conversation.
    case 'question_answer':
      return { actionCategory: 'CONVERSATION', actionType: 'CONVERSATION_TRIGGER' };
  }
};

/** Hash the very payload consumed by dispatch. No assertion-supplied hash or
 * independently maintained execution-field inventory enters this derivation. */
export function conversationActionHash(
  body: AgentTrigger,
  targetId: string,
  requestId: string,
  authorization: ExecutableEnvelopeAuthorization,
): string {
  if (body.promptType !== 'start_run' && body.promptType !== 'user_message') {
    return authorization.kind === 'controller_assertion'
      ? authorization.intent.actionPayloadHash
      : '';
  }
  return hashControllerAction({
    requestId,
    actionCategory: 'CONVERSATION',
    actionType: 'CONVERSATION_TRIGGER',
    targetKind: 'AGENT_SESSION',
    targetId,
    ...(body.promptType === 'start_run'
      ? {
          inputs: {
            kind: 'START_RUN',
            payload: body.payload,
            ...(body.admittedServiceScope
              ? { admittedServiceScope: body.admittedServiceScope }
              : {}),
          } satisfies ControllerStartInputs,
        }
      : body.promptType === 'user_message'
        ? {
            inputs: {
              kind: 'USER_MESSAGE',
              payload: body.payload,
              ...(body.admittedServiceScope
                ? { admittedServiceScope: body.admittedServiceScope }
                : {}),
            } satisfies ControllerMessageInputs,
          }
        : {}),
  } satisfies HostActionPreparation);
}

export function controlActionHash(body: V2ConversationControlBody, requestId: string): string {
  return hashControllerAction({
    requestId,
    ...controlAction(body.kind),
    targetKind: 'AGENT_SESSION',
    targetId: body.agentSessionId,
    inputs: { kind: 'CONTROL', body },
  } satisfies HostActionPreparation);
}

export function monitorActionHash(
  body: Pick<MonitorCommandBody1, 'target' | 'command'>,
  requestId: string,
): string {
  return hashControllerAction({
    requestId,
    actionCategory: 'TASK_MONITOR',
    actionType:
      body.command.cause === 'START'
        ? 'TASK_MONITOR_START'
        : body.command.cause === 'RESUME'
          ? 'TASK_MONITOR_RESUME'
          : body.command.cause === 'JUDGMENT_RESOLVED'
            ? 'TASK_MONITOR_JUDGMENT_RESOLVED'
            : body.command.cause === 'CONTINUE'
              ? 'TASK_MONITOR_CONTINUE'
              : 'TASK_MONITOR_COMPLETE',
    targetKind: 'TASK_MONITOR',
    targetId: body.target.workItemId,
    inputs: { kind: 'TASK_MONITOR', command: body.command },
  } satisfies HostActionPreparation);
}
