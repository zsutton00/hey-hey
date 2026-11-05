import { useCallback } from "react";
import type {
  AgentSessionDto,
  ConversationResponseDto,
  ProjectResponseDto,
} from "@hey-hey/ui-common/api";
import {
  AgentSessionMetadata,
  Conversation,
  DISABLED_CONVERSATION_SCROLL_POLICY,
  type OnboardingReplySubmission,
} from "@hey-hey/ui-common/components";

import { ProjectDetailsForm } from "../Onboarding/components/ProjectDetailsForm";
import { savedOnboardingRuntime } from "./localOnboardingRuntime";
import { useLocalOnboardingReply } from "./useLocalOnboardingReply";

const isExistingWorkChoice = (answer: unknown): boolean =>
  answer === "yes" ||
  (typeof answer === "object" &&
    answer !== null &&
    (answer as { choice?: unknown }).choice === "yes");

/** The running local onboarding session: its intake conversation and saved runtime. */
export function LocalOnboardingSession({
  project,
  conversation,
  session,
  onActivated,
}: {
  project: ProjectResponseDto;
  conversation: ConversationResponseDto;
  session: AgentSessionDto;
  onActivated: () => Promise<void>;
}) {
  const submitReply = useLocalOnboardingReply({
    organizationId: project.organizationId,
    projectId: project.id,
    conversationId: conversation.id,
    session,
  });
  const runtime = savedOnboardingRuntime(session);

  const handleSubmitOnboardingReply = useCallback(
    async (submission: OnboardingReplySubmission) => {
      await submitReply(submission);

      if (
        isExistingWorkChoice(submission.answers.repository_grounding_intent)
      ) {
        await onActivated();
      }
    },
    [onActivated, submitReply],
  );

  return (
    <>
      <ProjectDetailsForm
        project={project}
        organizationId={project.organizationId}
      />
      <Conversation
        animationType="minimal"
        navigationOrientation="vertical"
        conversation={conversation}
        project={project}
        agentSessionId={session.id}
        agentSessionCurrentState={session.currentState}
        scrollPolicy={DISABLED_CONVERSATION_SCROLL_POLICY}
        stepCount={-1}
        showNavigation
        onSubmitOnboardingReply={handleSubmitOnboardingReply}
      />
      {runtime && (
        <AgentSessionMetadata
          placement="below-conversation"
          provider={runtime.provider}
          model={runtime.model}
          {...(runtime.reasoningEffort
            ? { effort: runtime.reasoningEffort }
            : {})}
          {...(runtime.fastMode !== undefined
            ? { fastMode: runtime.fastMode }
            : {})}
        />
      )}
    </>
  );
}
