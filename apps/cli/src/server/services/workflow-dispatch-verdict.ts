/**
 * Shared interpretation of the platform's `getConversationPromptType`
 * response — the three-state verdict the CLI uses to decide how to dispatch.
 *
 * Consulted by `resolveWireWorkflowDefined` when a wire `workflow-defined`
 * sentinel arrives, and by the Run to read the current workflow node.
 */

import type { WorkflowsApiGetConversationPromptTypeRequest } from '../../shared/api';
import type { WorkflowsApiGetConversationWorkflowNodeRequest } from '../../shared/api/generated/api';
import type { FeatureSyncDiscrepancy } from '../../shared/agent-bridge-contract/generated/api';

/**
 * The FEATURE_SYNC_REVIEW variant of the prompt-type response's `gate` union.
 * Present only in the `live-non-agent` state when the conversation is parked
 * on the plan-shaping feature-sync review gate. Carries everything a chat
 * turn's review persona needs sourced from the wire contract — the design
 * doc, the plan, and the outstanding flagged items — so dispatch routes on
 * `gate.type` (never on the terminal promptType) and the persona never
 * re-derives the flagged set from conversation text.
 */
type FeatureSyncReviewGate = {
  type: 'FEATURE_SYNC_REVIEW';
  designDocId: string;
  planId: string;
  discrepancies: FeatureSyncDiscrepancy[];
};

export type WorkflowDispatchVerdict =
  | {
      state: 'agent-pending';
      promptType: string;
      externalAgentNodeId: string;
      triggerMessageId: string;
      availableActions?: readonly string[];
    }
  | {
      state: 'live-non-agent';
      promptType: string | null;
      gate: FeatureSyncReviewGate | null;
      availableActions?: readonly string[];
    }
  | { state: 'terminal'; promptType: string | null; availableActions?: readonly string[] };

export interface WorkflowDispatchIdentity {
  organizationId: string;
  projectId: string;
  conversationId: string;
}

/**
 * Shape of the raw response from `WorkflowsApi.getConversationPromptType`,
 * narrowed to just the fields the interpreter reads. Declared here so the
 * interpreter has a single typed input and `WorkflowsPromptTypeApiClient`
 * in `message.service.ts` can reference it without duplicating the shape.
 */
export interface PromptTypeResponseRaw {
  data?: {
    data?: {
      /**
       * Three-state discriminator from the platform. Required on the DTO —
       * only the success envelope's `data` wrapper is optional.
       */
      workflowState: 'agent-pending' | 'live-non-agent' | 'terminal';
      promptType?: string | null;
      nodeId?: string | null;
      triggerMessageId?: string | null;
      /**
       * Optional current action vocabulary. Its absence is the canonical
       * response-only continuation case; a present list is enforced exactly.
       */
      actions?: string[] | null;
      /**
       * The user-review gate the conversation is parked on, when that gate
       * needs a review-aware persona. Present only in the `live-non-agent`
       * state; absent/null otherwise. A discriminated union keyed on `type`.
       */
      gate?: WireGate | null;
    };
  };
}

export interface WorkflowDispatchVerdictApiClient {
  getConversationPromptType(
    request: WorkflowsApiGetConversationPromptTypeRequest,
  ): Promise<PromptTypeResponseRaw>;
  getConversationWorkflowNode(
    request: WorkflowsApiGetConversationWorkflowNodeRequest,
  ): Promise<WorkflowNodeResponseRaw>;
}

/**
 * Shape of the raw response from `WorkflowsApi.getConversationWorkflowNode`.
 * The CLI only needs the authoritative current node id; the workflow name is
 * intentionally left at the platform boundary.
 */
interface WorkflowNodeResponseRaw {
  data?: {
    data?: {
      currentNodeId?: unknown;
    };
  };
}

/**
 * Wire shape of the `gate` field as it arrives from the platform — narrowed
 * to the fields the interpreter validates before promoting it to a typed
 * {@link FeatureSyncReviewGate}. Modeled loosely (string `type`) so an
 * unrecognized future variant is dropped to null rather than mistyped.
 */
interface WireGate {
  type?: string | null;
  designDocId?: string | null;
  planId?: string | null;
  discrepancies?: FeatureSyncDiscrepancy[] | null;
}

/**
 * Read the prompt-type response into the canonical verdict. The platform's
 * `workflowState` is the load-bearing field and the only thing the
 * interpreter branches on — the pair fields are never used to infer state.
 *
 * Contract violations downgrade to `terminal`: a response missing the DTO
 * envelope entirely, or an `agent-pending` verdict missing the pair fields
 * the workflow promised. The dispatch path treats `terminal` as no pending
 * agent work.
 */
export const interpretPromptTypeResponse = (
  response: PromptTypeResponseRaw,
): WorkflowDispatchVerdict => {
  const data = response.data?.data;
  const promptType = data?.promptType ?? null;
  const availableActions = data?.actions ?? [];

  if (data?.workflowState === 'live-non-agent') {
    return {
      state: 'live-non-agent',
      promptType,
      gate: interpretGate(data.gate),
      availableActions,
    };
  }

  if (data?.workflowState === 'agent-pending') {
    const nodeId = data.nodeId ?? null;
    const triggerMessageId = data.triggerMessageId ?? null;
    if (promptType === null || nodeId === null || triggerMessageId === null) {
      return { state: 'terminal', promptType, availableActions };
    }
    return {
      state: 'agent-pending',
      promptType,
      externalAgentNodeId: nodeId,
      triggerMessageId,
      availableActions,
    };
  }

  return { state: 'terminal', promptType, availableActions };
};

/** Owns the platform read of a conversation's workflow verdict and current node. */
export class WorkflowDispatchVerdictReader {
  public constructor(private readonly apiClient: WorkflowDispatchVerdictApiClient) {}

  public async read(identity: WorkflowDispatchIdentity): Promise<WorkflowDispatchVerdict> {
    const response = await this.apiClient.getConversationPromptType(identity);
    return interpretPromptTypeResponse(response);
  }

  /** Read the platform-owned node currently serving this conversation. */
  public async readCurrentNodeId(identity: WorkflowDispatchIdentity): Promise<string | null> {
    const response = await this.apiClient.getConversationWorkflowNode(identity);
    const data = response.data?.data;
    if (!data || !Object.hasOwn(data, 'currentNodeId')) {
      throw new Error('Workflow node lookup returned no currentNodeId.');
    }

    const { currentNodeId } = data;
    if (currentNodeId === null) return null;
    if (typeof currentNodeId !== 'string' || currentNodeId.length === 0) {
      throw new Error('Workflow node lookup returned an invalid currentNodeId.');
    }
    return currentNodeId;
  }
}

/**
 * Promote the wire `gate` to a typed {@link FeatureSyncReviewGate}, or null.
 * Routing keys on the explicit `type` discriminator — an absent gate, an
 * unrecognized `type`, or a recognized variant missing any of its required
 * fields all degrade to null so the caller falls back to the generic
 * conversational path rather than dispatching a half-built persona.
 */
const interpretGate = (gate: WireGate | null | undefined): FeatureSyncReviewGate | null => {
  if (!gate || gate.type !== 'FEATURE_SYNC_REVIEW') {
    return null;
  }
  const { designDocId, planId, discrepancies } = gate;
  if (
    typeof designDocId !== 'string' ||
    designDocId.length === 0 ||
    typeof planId !== 'string' ||
    planId.length === 0 ||
    !Array.isArray(discrepancies)
  ) {
    return null;
  }
  return { type: 'FEATURE_SYNC_REVIEW', designDocId, planId, discrepancies };
};
