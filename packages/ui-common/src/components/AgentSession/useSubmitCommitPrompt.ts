import type { Stable } from "../../types";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import { LocalPromptType } from "../../api";
import { type FollowupSubmissionAction } from "./runtime/coding/agent-session-helpers";
import {
  submitPromptForRun,
  type FollowupAgentOverride,
  type SubmitPromptResult,
} from "./runtime/hooks/usePromptRunSubmission";
import type { AgentProvider } from "./runtime/index";
import type { AgentSessionInteractionAccess } from "./operations/AgentOperationCoordinator";

type SubmitCommitPromptInput = FollowupAgentOverride & {
  additionalInstructions?: string;
};

export function useSubmitCommitPrompt({
  runId,
  providerRunId,
  provider,
  setSubmittingPrompt,
  setSubmittingFollowupAction,
  agentSessionId,
  conversationId,
  projectId,
  organizationId,
  trackSubmitPromptTelemetry,
  interactionAccess,
}: {
  runId: string | null;
  providerRunId: string;
  provider: AgentProvider;
  setSubmittingPrompt: Dispatch<SetStateAction<boolean>>;
  setSubmittingFollowupAction: Dispatch<
    SetStateAction<FollowupSubmissionAction | null>
  >;
  agentSessionId: string;
  conversationId: string;
  projectId: string;
  organizationId: string;
  trackSubmitPromptTelemetry: Stable<(result: SubmitPromptResult) => void>;
  interactionAccess: AgentSessionInteractionAccess;
}) {
  return useCallback(
    async ({
      additionalInstructions,
      provider: overrideProvider,
      model,
      reasoningEffort,
      fastMode,
    }: SubmitCommitPromptInput) => {
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
      setSubmittingFollowupAction("commit");
      try {
        const result = await submitPromptForRun({
          interactions: interactionAccess.interactions,
          run: { runId, providerRunId, provider, status: "running" },
          organizationId,
          projectId,
          conversationId,
          agentSessionId,
          promptDraft: additionalInstructions?.trim() ?? "",
          startupPrompt: null,
          localPromptType: LocalPromptType.Commit,
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
      trackSubmitPromptTelemetry,
      interactionAccess,
      setSubmittingPrompt,
      setSubmittingFollowupAction,
    ]
  );
}
