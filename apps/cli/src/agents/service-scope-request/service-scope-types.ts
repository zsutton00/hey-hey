import type {
  AgentSessionServiceScopeRequest,
  AgentProviderId,
  ServicePlaceChoice,
} from '@hey-hey/contracts/api/models';
import type { ResolvedServiceBinding } from '../../shared/agent-bridge-contract/contract';

export interface RequestAgentSessionServiceScopeArgs {
  serviceIds: string[];
  reason: string;
}

interface ServiceScopeRequestPresentation {
  request: AgentSessionServiceScopeRequest;
  messageId: string;
}

export interface ServiceScopeDecisionInput {
  requestId: string;
  sessionId: string;
  agentType: AgentProviderId;
  decision: 'approve' | 'deny';
  reason: string | null;
  /** Where each newly requested Service works. Only valid with `approve`. */
  servicePlaceChoices?: ServicePlaceChoice[];
  idempotencyToken: string | null;
}

interface ServiceScopeCommit {
  serviceIds: string[];
  launchServiceId: string;
  services: ResolvedServiceBinding[];
}

export type ServiceScopeRequestResult =
  | { status: 'requested'; request: AgentSessionServiceScopeRequest }
  | { status: 'already_requested'; request: AgentSessionServiceScopeRequest }
  | { status: 'already_in_scope'; serviceIds: string[] };
