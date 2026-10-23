export type PermissionDecision = 'approve' | 'always_approve' | 'deny' | 'whitelist';
type PermissionAgentType = 'claude' | 'codex' | 'opencode';

export type PermissionCallbackType =
  | 'claude_control_response'
  | 'codex_exec_approval_response'
  | 'opencode_permission_response'
  | 'service_scope_decision';

export interface PermissionDecisionRoutingInput {
  runId: string;
  sessionId: string;
  requestId: string;
  agentType: PermissionAgentType;
  decision: PermissionDecision;
  reason: string | null;
  idempotencyToken: string | null;
  userId?: string;
  /** Signed decider; owns any Run follow-up the decision causes. */
  deciderUserId: string;
}

interface PermissionDecisionRoutingMetadata {
  runId: string;
  sessionId: string;
  requestId: string;
  idempotencyToken: string | null;
  userId?: string;
}

interface ClaudePermissionDecisionDispatch {
  agentType: 'claude';
  decision: PermissionDecision;
  callbackType: 'claude_control_response';
  callbackPayload: {
    type: 'control_response';
    response: {
      subtype: 'success';
      request_id: string;
      response:
        | {
            behavior: 'allow';
            updatedInput: Record<string, never>;
          }
        | {
            behavior: 'deny';
            message: string;
          };
    };
  };
  routing: PermissionDecisionRoutingMetadata;
}

interface CodexPermissionDecisionDispatch {
  agentType: 'codex';
  decision: PermissionDecision;
  callbackType: 'codex_exec_approval_response';
  callbackPayload: {
    type: 'exec_approval_response';
    call_id: string;
    session_id: string;
    approved: boolean;
    decision: PermissionDecision;
    reason: string | null;
  };
  routing: PermissionDecisionRoutingMetadata;
}

interface OpencodePermissionDecisionDispatch {
  agentType: 'opencode';
  decision: PermissionDecision;
  callbackType: 'opencode_permission_response';
  callbackPayload: {
    type: 'permission_response';
    request_id: string;
    reply: 'once' | 'always' | 'reject';
    reason: string | null;
  };
  routing: PermissionDecisionRoutingMetadata;
}

export type AgentPermissionDecisionDispatch =
  | ClaudePermissionDecisionDispatch
  | CodexPermissionDecisionDispatch
  | OpencodePermissionDecisionDispatch;

const toDenyReason = (reason: string | null): string =>
  reason && reason.trim().length > 0 ? reason : 'Denied by user.';

export const translatePermissionDecisionToDispatch = (
  input: PermissionDecisionRoutingInput,
): AgentPermissionDecisionDispatch => {
  const routing: PermissionDecisionRoutingMetadata = {
    runId: input.runId,
    sessionId: input.sessionId,
    requestId: input.requestId,
    idempotencyToken: input.idempotencyToken,
    ...(input.userId ? { userId: input.userId } : {}),
  };

  if (input.agentType === 'claude') {
    const response =
      input.decision === 'deny'
        ? {
            behavior: 'deny' as const,
            message: toDenyReason(input.reason),
          }
        : {
            behavior: 'allow' as const,
            updatedInput: {},
          };

    return {
      agentType: 'claude',
      decision: input.decision,
      callbackType: 'claude_control_response',
      callbackPayload: {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: input.requestId,
          response,
        },
      },
      routing,
    };
  }

  if (input.agentType === 'opencode') {
    let reply: 'once' | 'always' | 'reject';
    if (input.decision === 'deny') {
      reply = 'reject';
    } else if (input.decision === 'always_approve' || input.decision === 'whitelist') {
      reply = 'always';
    } else {
      reply = 'once';
    }

    return {
      agentType: 'opencode',
      decision: input.decision,
      callbackType: 'opencode_permission_response',
      callbackPayload: {
        type: 'permission_response',
        request_id: input.requestId,
        reply,
        reason: input.reason,
      },
      routing,
    };
  }

  return {
    agentType: 'codex',
    decision: input.decision,
    callbackType: 'codex_exec_approval_response',
    callbackPayload: {
      type: 'exec_approval_response',
      call_id: input.requestId,
      session_id: input.sessionId,
      approved: input.decision !== 'deny',
      decision: input.decision,
      reason: input.reason,
    },
    routing,
  };
};
