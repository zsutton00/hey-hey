import { type WorkflowName } from "../../../../api/index";
import {
  submitControllerAuthorizedWorkflowAnswer,
  type WorkflowAnswerPoster,
} from "../../../../data/hooks/submitControllerAuthorizedWorkflowAnswer";

const LOG_PREFIX = "[submitNodeDecisionViaPlatform]";

const log = (action: string, data?: Record<string, unknown>) => {
  if (data) {
    console.log(`${LOG_PREFIX} ${action}`, data);
  } else {
    console.log(`${LOG_PREFIX} ${action}`);
  }
};

const logError = (
  action: string,
  error: unknown,
  data?: Record<string, unknown>
) => {
  console.error(`${LOG_PREFIX} ${action}`, { error, ...data });
};

export interface SubmitNodeDecisionViaPlatformInput {
  apiClient: WorkflowAnswerPoster;
  runId: string;
  organizationId: string | null;
  agentSessionId: string | null;
  conversationId: string;
  projectId: string;
  /**
   * The active conversation's workflow, routed onto `agentInput.workflowName`.
   * A node decision is a workflow-routed submission (the `workflowName` arm of
   * the dispatch union), never a `promptType` one.
   */
  workflowName: WorkflowName;
  nodeId: string;
  parentMessageId: string;
  action: string;
  userMessageData: Record<string, unknown>;
  comment?: string;
}

export type SubmitNodeDecisionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Authors a node-decision (QUESTIONS field action — Approve/Reject/etc.) as a
 * real platform USER message instead of pushing it down the local-CLI rail.
 * The dispatch instruction rides the `workflowName` arm of `data.agentInput`
 * (`{ workflowName, action, payload }`) — a workflow-routed submission, never a
 * `promptType` one. The freeform form answers (`userMessageData`) stay on the
 * top-level `data` bag.
 */
export const submitNodeDecisionViaPlatform = async ({
  apiClient,
  runId,
  organizationId,
  agentSessionId,
  conversationId,
  projectId,
  workflowName,
  nodeId,
  parentMessageId,
  action,
  userMessageData,
  comment,
}: SubmitNodeDecisionViaPlatformInput): Promise<SubmitNodeDecisionResult> => {
  log("called", {
    runId,
    conversationId,
    projectId,
    organizationId,
    agentSessionId,
    action,
    hasComment: comment != null && comment.length > 0,
  });

  if (!organizationId) {
    log("returning error: missing organizationId");
    return {
      ok: false,
      error: "Missing organization context required to submit node decision.",
    };
  }

  if (!agentSessionId) {
    log("returning error: missing agentSessionId");
    return {
      ok: false,
      error: "Agent session is required before submitting node decisions.",
    };
  }

  try {
    await submitControllerAuthorizedWorkflowAnswer({
      apiClient,
      operationId: crypto.randomUUID(),
      organizationId,
      agentSessionId,
      projectId,
      conversationId,
      workflowName,
      nodeId,
      parentMessageId,
      action,
      payload: userMessageData,
      ...(comment ? { evidence: { comment } } : {}),
    });
    log("workflow answer acknowledged", { conversationId, action });
    return { ok: true };
  } catch (error) {
    logError("apiClient.postMessage threw", error, { conversationId, action });
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to submit node decision.",
    };
  }
};
