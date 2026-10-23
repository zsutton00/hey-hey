import type { Stable } from "../../types";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { LocalPromptType } from "../../api";
import { type FollowupSubmissionAction } from "./runtime/coding/agent-session-helpers";
import { buildCodeReviewDisplayText } from "./runtime/hooks/directTriggerInput";
import {
  submitPromptForRun,
  type FollowupAgentOverride,
  type SubmitPromptResult,
} from "./runtime/hooks/usePromptRunSubmission";
import type { AgentProvider } from "./runtime/index";
import type { AgentSessionInteractionAccess } from "./operations/AgentOperationCoordinator";

type SubmitCodeReviewPromptInput = FollowupAgentOverride & {
  additionalInstructions?: string;
};

export function useSubmitCodeReviewPrompt({
  runId,
  providerRunId,
  provider,
  setSubmittingPrompt,
  setSubmittingFollowupAction,
  organizationId,
  projectId,
  conversationId,
  agentSessionId,
  interactionAccess,
  trackSubmitPromptTelemetry,
}: {
  runId: string | null;
  providerRunId: string;
  provider: AgentProvider;
  setSubmittingPrompt: Dispatch<SetStateAction<boolean>>;
  setSubmittingFollowupAction: Dispatch<
    SetStateAction<FollowupSubmissionAction | null>
  >;
  organizationId: string;
  projectId: string;
  conversationId: string;
  agentSessionId: string;
  interactionAccess: AgentSessionInteractionAccess;
  trackSubmitPromptTelemetry: Stable<(result: SubmitPromptResult) => void>;
}) {
  return useCallback(
    async ({
      additionalInstructions,
      provider: overrideProvider,
      model,
      reasoningEffort,
      fastMode,
    }: SubmitCodeReviewPromptInput) => {
      if (!runId) {
        throw new Error("No active run available.");
      }
      if (!conversationId) {
        throw new Error("Conversation is not ready yet. Please wait.");
      }
      if (!interactionAccess.isDeviceEnabled) {
        throw new Error(interactionAccess.unavailable.message);
      }
      setSubmittingPrompt(true);
      setSubmittingFollowupAction("code_review");
      try {
        const promptDraft = additionalInstructions?.trim() ?? "";
        const result = await submitPromptForRun({
          interactions: interactionAccess.interactions,
          run: { runId, providerRunId, provider, status: "running" },
          organizationId,
          projectId,
          conversationId,
          agentSessionId,
          promptDraft,
          startupPrompt: null,
          localPromptType: LocalPromptType.CodeReview,
          displayText: buildCodeReviewDisplayText(promptDraft),
          agentOverride: {
            provider: overrideProvider,
            model,
            reasoningEffort,
            ...(fastMode !== undefined ? { fastMode } : {}),
          },
        });
        trackSubmitPromptTelemetry(result);
        if (!result.ok) {
          throw new Error(result.error);
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
      organizationId,
      projectId,
      conversationId,
      agentSessionId,
      interactionAccess,
      trackSubmitPromptTelemetry,
      setSubmittingPrompt,
      setSubmittingFollowupAction,
    ]
  );
}
