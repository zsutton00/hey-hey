import { type SecondaryActionConfig, type SystemMessage } from "../../api";
export {
  collectSystemMessages,
  getConversationSystemThread,
} from "../../utils/conversationThread";

// Type guard to check if a message has ROUTING data
function hasRoutingData(data: SystemMessage["data"]): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === "ROUTING"
  );
}

export const isRoutingMessage = (m: SystemMessage): boolean => {
  return m.type === "SYSTEM" && hasRoutingData(m.data);
};

/**
 * True for SYSTEM messages carrying `data.triggersAgent` — workflow-engine
 * plumbing that instructs the CLI to dispatch a prompt handler. Hidden from
 * the rendered timeline; the UI never renders nor authors trigger messages.
 */
export const isExternalAgentTriggerMessage = (m: SystemMessage): boolean => {
  if (m.type !== "SYSTEM") {
    return false;
  }
  const data = m.data as { triggersAgent?: unknown } | null;
  return !!data && typeof data === "object" && !!data.triggersAgent;
};

const hasNonEmptyStringResponse = (data: unknown): boolean => {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const response = (data as { response?: unknown }).response;
  return typeof response === "string" && response.trim().length > 0;
};

const AGENT_HIDDEN_FIELD_TYPE = "agent_hidden";

/** A hidden marker suppresses its entire SYSTEM message, including its response. */
export const isAgentHiddenSystemMessage = (m: SystemMessage): boolean => {
  if (m.type !== "SYSTEM" || !m.data || !("uiElements" in m.data)) {
    return false;
  }
  return (
    m.data.uiElements?.some(
      (element) => element.type === AGENT_HIDDEN_FIELD_TYPE,
    ) ?? false
  );
};

const hasAnyVisibleUiElements = (data: unknown): boolean => {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const uiElements = (data as { uiElements?: unknown }).uiElements;
  if (!Array.isArray(uiElements) || uiElements.length === 0) {
    return false;
  }
  return uiElements.some((element) => {
    if (typeof element !== "object" || element === null) {
      return false;
    }
    return (element as { type?: unknown }).type !== AGENT_HIDDEN_FIELD_TYPE;
  });
};

const hasAnySecondaryActions = (data: unknown): boolean => {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const secondaryActions = (
    data as { secondaryActions?: SecondaryActionConfig[] }
  ).secondaryActions;
  return Array.isArray(secondaryActions) && secondaryActions.length > 0;
};

/**
 * True for a SYSTEM completion-shaped message (carries
 * `data.completesExternalAgentNode`) whose body has no user-visible content:
 * no narrative `response`, no proposals, no uiElements, no secondary actions.
 * Empty completions are workflow bookkeeping and are hidden from the timeline.
 */
export const isEmptyExternalAgentCompletionMessage = (
  m: SystemMessage,
): boolean => {
  if (m.type !== "SYSTEM") {
    return false;
  }
  const data = m.data as { completesExternalAgentNode?: unknown } | null;
  if (!data || typeof data !== "object" || !data.completesExternalAgentNode) {
    return false;
  }

  if (hasNonEmptyStringResponse(data)) {
    return false;
  }
  if (hasAnyVisibleUiElements(data)) {
    return false;
  }
  if (hasAnySecondaryActions(data)) {
    return false;
  }
  if (Array.isArray(m.proposals) && m.proposals.length > 0) {
    return false;
  }
  return true;
};

/**
 * True for a SYSTEM QUESTIONS-shaped message with nothing to render: empty
 * response, no proposals, no secondary actions, and every uiElement (if
 * any) is `agent_hidden`. Produced by workflow gate nodes like the
 * feature-sync opener, which pause for a user message but deliberately
 * show nothing in the conversation because the triggering input was
 * collected on a preceding screen (e.g. the agent setup page).
 */
export const isHiddenQuestionsMessage = (m: SystemMessage): boolean => {
  if (m.type !== "SYSTEM") {
    return false;
  }
  if (m.data?.type !== "QUESTIONS") {
    return false;
  }
  if (hasNonEmptyStringResponse(m.data)) {
    return false;
  }
  if (hasAnyVisibleUiElements(m.data)) {
    return false;
  }
  if (hasAnySecondaryActions(m.data)) {
    return false;
  }
  if (Array.isArray(m.proposals) && m.proposals.length > 0) {
    return false;
  }
  return true;
};
