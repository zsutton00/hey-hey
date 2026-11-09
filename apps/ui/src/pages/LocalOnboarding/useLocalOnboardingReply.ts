import { useCallback } from "react";
import {
  AgentSessionStatus,
  type AgentSessionDto,
} from "@hey-hey/ui-common/api";
import {
  buildDirectTriggerInput,
  useAgentSessionInteractionAccessResolver,
  type OnboardingReplySubmission,
} from "@hey-hey/ui-common/components";
import { useSubmitOnboardingReply } from "@hey-hey/ui-common/data";

/**
 * Submits an onboarding reply for the session started on `/welcome`. If that
 * session's run has stopped, the reply first wakes it on its own machine; it
 * never starts a new session.
 */
export const useLocalOnboardingReply = ({
  organizationId,
  projectId,
  conversationId,
  session,
}: {
  organizationId: string;
  projectId: string;
  conversationId: string;
  session: AgentSessionDto;
}) => {
  const { mutate: submitOnboardingReply } = useSubmitOnboardingReply();
  const accessResolver = useAgentSessionInteractionAccessResolver();

  const resumeStoppedRun = useCallback(async () => {
    const access = accessResolver.getAccess(session.machineId);
    if (!access.isDeviceEnabled) {
      throw new Error(access.unavailable.message);
    }

    const result = await access.interactions.submitMessage(
      buildDirectTriggerInput({
        organizationId,
        projectId,
        agentSessionId: session.id,
        conversationId,
        data: {
          agentInput: {
            promptType: "local_onboarding",
            conversationId,
            userMessage: "",
          },
        },
      }),
    );
    if (result.state !== "succeeded" && result.state !== "accepted") {
      throw new Error(
        result.state === "cancelled"
          ? "The operation was cancelled."
          : result.message,
      );
    }
  }, [
    accessResolver,
    conversationId,
    organizationId,
    projectId,
    session.id,
    session.machineId,
  ]);

  return useCallback(
    async (submission: OnboardingReplySubmission) => {
      if (session.status !== AgentSessionStatus.InProgress) {
        await resumeStoppedRun();
      }

      await submitOnboardingReply({
        organizationId,
        projectId,
        conversationId,
        ...submission,
      });
    },
    [
      conversationId,
      organizationId,
      projectId,
      resumeStoppedRun,
      session.status,
      submitOnboardingReply,
    ],
  );
};
