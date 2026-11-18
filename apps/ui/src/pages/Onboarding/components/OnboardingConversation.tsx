import type { ComponentProps } from "react";
import {
  Conversation,
  DISABLED_CONVERSATION_SCROLL_POLICY,
} from "@hey-hey/ui-common/components";

import { ProjectDetailsForm } from "./ProjectDetailsForm";

type ConversationProps = ComponentProps<typeof Conversation>;

/**
 * The onboarding project form and conversation with one set of presentation
 * settings, shared by hosted and local onboarding.
 */
export function OnboardingConversation({
  project,
  conversation,
  agentSessionId,
  agentSessionCurrentState,
  showAgentSessionCurrentStateIndicator,
  onSubmitOnboardingReply,
}: Pick<
  ConversationProps,
  | "project"
  | "conversation"
  | "agentSessionId"
  | "agentSessionCurrentState"
  | "showAgentSessionCurrentStateIndicator"
  | "onSubmitOnboardingReply"
>) {
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
        agentSessionId={agentSessionId}
        agentSessionCurrentState={agentSessionCurrentState}
        showAgentSessionCurrentStateIndicator={
          showAgentSessionCurrentStateIndicator
        }
        scrollPolicy={DISABLED_CONVERSATION_SCROLL_POLICY}
        sidebarMode="minimal"
        stepCount={-1}
        showNavigation
        onSubmitOnboardingReply={onSubmitOnboardingReply}
      />
    </>
  );
}
