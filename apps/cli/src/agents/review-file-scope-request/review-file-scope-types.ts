import type {
  AgentSessionReviewFileScopeRequest,
  PermissionRequestAgentType,
} from '../../shared/api/generated/api';
import type { LocalCodeReviewPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import type { InternalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';

export interface ReviewFileScopeRequestPresentation {
  request: AgentSessionReviewFileScopeRequest;
  messageId: string;
  closed?: boolean;
}

export interface ReviewFileScopeDecisionInput {
  requestId: string;
  sessionId: string;
  agentType: PermissionRequestAgentType;
  decision: 'approve' | 'deny';
  reason: string | null;
  idempotencyToken: string;
}

export interface ReviewFileScopeContinuation {
  input: InternalRunPromptRequest;
}

/** Kept independently from the original evidence and presentation retry. */
export interface ReviewFileScopeReconciliation {
  requestId: string;
  stableKey: string;
  turnId: string;
  disposition: 'continue' | 'settled';
  input: LocalCodeReviewPromptPayload | null;
  userId: string;
  delivered: boolean;
}
