import { useMemo } from "react";
import type { MessageResponseDto } from "../../api";
import { MessageType } from "../../api";
import { useConversationMessages } from "../../data/hooks/useConversationMessages";
import { useAgentSessionCurrentState } from "../../data/hooks/useAgentSessionCurrentState";
import { getAgentSessionCurrentStatePresentation } from "./agentSessionCurrentStatePresentation";

const JOURNEY_REVIEW_UI_ELEMENT_TYPE = "plan_generation_journey_review";

const walkTree = (
  messages: readonly MessageResponseDto[],
  visit: (message: MessageResponseDto) => void
) => {
  for (const message of messages) {
    visit(message);
    const responses = message.responses;
    if (Array.isArray(responses) && responses.length > 0) {
      walkTree(responses, visit);
    }
  }
};

const messageHasJourneyReviewUIElement = (
  message: MessageResponseDto
): boolean => {
  if (message.type !== MessageType.System) {
    return false;
  }
  const elements = message.data?.uiElements;
  if (!Array.isArray(elements)) {
    return false;
  }
  return elements.some(
    (element) => element?.type === JOURNEY_REVIEW_UI_ELEMENT_TYPE
  );
};

const messageIsAwaitingResponse = (message: MessageResponseDto): boolean => {
  if (message.type !== MessageType.System) {
    return false;
  }
  return message.awaitingResponse === true;
};

export interface PlanCreationCreatingStateOptions {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
}

/**
 * True once the user has submitted the JourneyMap approval and no further
 * user-input UI element is pending — i.e. the workflow has moved past the
 * journey-review gate and the agent is materializing the plan.
 *
 * Combines local-WS thinking/processing signals with the absence of an
 * unsubmitted plan_generation_journey_review element in the live message
 * stream. We do not simulate FlowContext writes client-side; the signal
 * comes entirely from server-emitted messages and run status.
 */
export const usePlanCreationCreatingState = ({
  organizationId,
  projectId,
  agentSessionId,
  conversationId,
}: PlanCreationCreatingStateOptions): boolean => {
  const { data: messages } = useConversationMessages(
    organizationId,
    projectId,
    conversationId
  );
  const currentState = useAgentSessionCurrentState(
    organizationId,
    projectId,
    agentSessionId
  ).currentState;
  const isActive = currentState
    ? getAgentSessionCurrentStatePresentation(currentState).isActive
    : false;

  return useMemo(() => {
    let sawJourneyReview = false;
    let hasUnsubmittedJourneyReview = false;
    walkTree(messages, (message) => {
      if (!messageHasJourneyReviewUIElement(message)) {
        return;
      }
      sawJourneyReview = true;
      if (messageIsAwaitingResponse(message)) {
        hasUnsubmittedJourneyReview = true;
      }
    });

    if (!sawJourneyReview || hasUnsubmittedJourneyReview) {
      return false;
    }

    return isActive;
  }, [isActive, messages]);
};
