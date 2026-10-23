import type { Stable } from "../../types";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { type SessionMethodContext } from "../../agents/prompts";
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
  sessionMethod: SessionMethodContext | undefined;
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
        // Workflow-bound methods leave continuation selection with the active
        // workflow. Every ordinary coding-session follow-up is deliberately
        // mode-agnostic, regardless of the handler used to start the run.
        const followupLocalPromptType: LocalPromptType = sessionMethod
          ? getMethodConfig(sessionMethod.method).dispatch.kind === "workflow"
            ? LocalPromptType.WorkflowDefined
            : LocalPromptType.CodingFreeform
          : LocalPromptType.CodingFreeform;

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
            }
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
    ]
  );
}
