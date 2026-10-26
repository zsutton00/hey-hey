import { workflowsClient } from "../../clients/serviceClients";
import type { Stable } from "../../types";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { type SessionMethodSelection } from "../../agents/coordination/types";
import { getMethodConfig } from "../../agents/coordination/sessionMethodRegistry";
import { LocalPromptType } from "../../api";
import type { RunAttachmentReference, AgentSkillSelection } from "../../api";
import {
  logError,
  type FollowupSubmissionAction,
} from "./runtime/coding/agent-session-helpers";
import { type SubmitPromptResult } from "./runtime/hooks/usePromptRunSubmission";
import { submitFreeformViaPlatform } from "./runtime/hooks/submitFreeformViaPlatform";
import type { AgentProvider } from "./runtime/index";
import type { AgentSessionInteractionAccess } from "./operations/AgentOperationCoordinator";

const resolveFollowupPromptType = (
  selection: SessionMethodSelection | undefined,
): LocalPromptType => {
  if (selection?.projectModeSelection) return LocalPromptType.ProjectMode;
  const method = selection?.method;
  if (
    method &&
    method !== "validation" &&
    getMethodConfig(method).dispatch.kind === "workflow"
  ) {
    return LocalPromptType.WorkflowDefined;
  }
  return LocalPromptType.CodingFreeform;
};

export function useSubmitFollowupByText({
  runId,
  providerRunId,
  provider,
  setSubmissionError,
  setSubmittingPrompt,
  setSubmittingFollowupAction,
  sessionMethod,
  interactionAccess,
  organizationId,
  agentSessionId,
  conversationId,
  projectId,
  trackSubmitPromptTelemetry,
  setPromptDraft,
}: {
  runId: string | null;
  providerRunId: string;
  provider: AgentProvider;
  setSubmissionError: Dispatch<SetStateAction<string | null>>;
  setSubmittingPrompt: Dispatch<SetStateAction<boolean>>;
  setSubmittingFollowupAction: Dispatch<
    SetStateAction<FollowupSubmissionAction | null>
  >;
  sessionMethod: SessionMethodSelection | undefined;
  interactionAccess: AgentSessionInteractionAccess;
  organizationId: string;
  agentSessionId: string;
  conversationId: string;
  projectId: string;
  trackSubmitPromptTelemetry: Stable<(result: SubmitPromptResult) => void>;
  setPromptDraft: Dispatch<SetStateAction<string>>;
}) {
  return useCallback(
    async ({
      promptText,
      clearDraftOnSuccess,
      actionName,
      followupAction,
      skillSelection,
      attachments = [],
    }: {
      promptText: string;
      clearDraftOnSuccess: boolean;
      actionName:
        | "submitFollowupPrompt"
        | "submitCodeReviewPrompt"
        | "submitCommitPrompt"
        | "submitSystemDiagramPrompt";
      followupAction: FollowupSubmissionAction | null;
      skillSelection?: AgentSkillSelection;
      attachments?: RunAttachmentReference[];
    }) => {
      if (!runId) {
        logError(`${actionName}: NO ACTIVE RUN`, null);
        throw new Error("No active run available.");
      }
      if (!interactionAccess.isDeviceEnabled) {
        throw new Error(interactionAccess.unavailable.message);
      }

      setSubmittingPrompt(true);
      setSubmittingFollowupAction(followupAction);
      setSubmissionError(null);

      try {
        // The captured project mode owns ordinary replies for the whole session.
        // Built-in workflow methods leave continuation selection with the workflow.
        let followupLocalPromptType = resolveFollowupPromptType(sessionMethod);

        if (followupLocalPromptType === LocalPromptType.WorkflowDefined) {
          const node = (
            await workflowsClient.getConversationWorkflowNode({
              organizationId,
              projectId,
              conversationId,
            })
          ).data.data;
          if (node?.currentNodeId === "feature-sync-coding-plan") {
            followupLocalPromptType = LocalPromptType.StartupSession;
          }
        }

        const result = await submitFreeformViaPlatform({
          interactions: interactionAccess.interactions,
          run: { runId, providerRunId, provider },
          organizationId,
          agentSessionId,
          conversationId,
          projectId,
          promptText,
          localPromptType: followupLocalPromptType,
          skillSelection,
          attachments,
        });
        trackSubmitPromptTelemetry(result);
        if (!result.ok) {
          logError(
            `${actionName}: submitFreeformViaPlatform FAILED`,
            result.error,
            {
              runId,
            },
          );
          throw new Error(result.error);
        }
        if (clearDraftOnSuccess) {
          setPromptDraft("");
        }
      } finally {
        setSubmittingPrompt(false);
        setSubmittingFollowupAction(null);
      }
    },
    [
      runId,
      providerRunId,
      provider,
      interactionAccess,
      organizationId,
      agentSessionId,
      conversationId,
      projectId,
      sessionMethod,
      trackSubmitPromptTelemetry,
      setPromptDraft,
      setSubmissionError,
      setSubmittingPrompt,
      setSubmittingFollowupAction,
    ],
  );
}
