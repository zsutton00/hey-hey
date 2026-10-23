import { useCallback, type Dispatch, type SetStateAction } from "react";
import { LocalPromptType, WorkflowReviewAction } from "../../api";
import { log } from "./runtime/coding/agent-session-helpers";
import type {
  ResponseActionRegistry,
  StartupPlanSubmission,
} from "./runtime/index";
import { RESPONSE_ACTION_EVENT_TYPE } from "./runtime/response-actions/types";
import type { AgentSessionLaunchOrchestration } from "../..";

export function useSubmitStartupReview({
  runId,
  setStartupReviewError,
  setSubmittingStartupReview,
  launch,
  responseRegistry,
  organizationId,
  serviceId,
  agentSessionId,
}: {
  runId: string | null;
  setStartupReviewError: Dispatch<SetStateAction<string | null>>;
  setSubmittingStartupReview: Dispatch<SetStateAction<boolean>>;
  launch: AgentSessionLaunchOrchestration;
  responseRegistry: ResponseActionRegistry;
  organizationId: string;
  serviceId: string;
  agentSessionId: string;
}) {
  return useCallback(
    async (
      submission: StartupPlanSubmission,
      promptText: string,
      userMessageData: Record<string, unknown>
    ) => {
      log("useSubmitStartupReview: enter", {
        decision: submission.decision,
        hasFeedback: !!submission.feedback,
      });
      if (!runId) {
        setStartupReviewError("No active run for startup plan review.");
        return;
      }
      setSubmittingStartupReview(true);
      setStartupReviewError(null);
      try {
        let result: { ok: true } | { ok: false; error: string };
        if (submission.decision === "approve") {
          log("useSubmitStartupReview: branch approve -> submitNodeDecision");
          result = await launch.submitNodeDecision(
            runId,
            WorkflowReviewAction.Approved,
            userMessageData,
            promptText
          );
        } else {
          log(
            "useSubmitStartupReview: branch improve -> submitStartupPlanReview"
          );
          result = await launch.submitStartupPlanReview(
            runId,
            submission,
            promptText,
            userMessageData,
            LocalPromptType.WorkflowDefined
          );
        }
        if (!result.ok) {
          setStartupReviewError(result.error);
          return;
        }

        await responseRegistry.execute({
          eventType: RESPONSE_ACTION_EVENT_TYPE.startupPlanReplied,
          organizationId,
          serviceId,
          agentSessionId,
          submission,
          runId,
        });
      } finally {
        setSubmittingStartupReview(false);
      }
    },
    [runId, launch, organizationId, serviceId, agentSessionId, responseRegistry]
  );
}
