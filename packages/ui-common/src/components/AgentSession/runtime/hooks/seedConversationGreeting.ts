import {
  MessageType,
  SystemMessageDataTypeEnum,
  type ConversationsApiPostMessageRequest,
  type CreateSystemMessage,
} from "../../../../api/index";

const LOG_PREFIX = "[seedConversationGreeting]";

const log = (action: string, data?: Record<string, unknown>) => {
  if (data) {
    console.log(`${LOG_PREFIX} ${action}`, data);
  } else {
    console.log(`${LOG_PREFIX} ${action}`);
  }
};

const logError = (
  action: string,
  error: unknown,
  data?: Record<string, unknown>,
) => {
  console.error(`${LOG_PREFIX} ${action}`, { error, ...data });
};

/**
 * Minimal contract the helper needs from the platform API client to author a
 * SYSTEM row. The codegen'd `ConversationsApi.postMessage` accepts the
 * `CreateMessageDto` supertype (of which `CreateSystemMessage` is an arm), so
 * the real `UnifiedApiClient` satisfies this directly; the narrower SYSTEM type
 * here keeps the call site honest and lets tests pass a stub.
 */
interface PlatformSystemMessagePoster {
  postMessage: (
    request: ConversationsApiPostMessageRequest,
  ) => Promise<unknown>;
}

export interface SeedConversationGreetingInput {
  apiClient: PlatformSystemMessagePoster;
  organizationId: string;
  projectId: string;
  conversationId: string;
  /** Greeting text rendered as the conversation's opening QUESTIONS bubble. */
  text: string;
}

/**
 * Authors the refiner's opening greeting as a real, persisted SYSTEM (QUESTIONS)
 * message row on a runless conversation — no run, no start-run, no agent turn.
 * This is the honest replacement for the old client-side synthetic greeting: the
 * greeting becomes a real row the conversation owns, and the Run is born only
 * from the user's first reply (which rides the USER `initialMessage` start-run
 * kickoff).
 *
 * The SYSTEM row carries no `triggersAgent`, so the API's create-path trigger
 * projection (`emitConversationTriggerForMessage` → `extractTriggersAgent`)
 * drops it and no CLI is woken. `parentMessageId` is sent as explicit null so
 * the server resolves the conversation tail atomically (see task b657c4c6).
 */
export const seedConversationGreeting = async ({
  apiClient,
  organizationId,
  projectId,
  conversationId,
  text,
}: SeedConversationGreetingInput): Promise<void> => {
  const systemMessage: CreateSystemMessage = {
    projectId,
    conversationId,
    type: MessageType.System,
    parentMessageId: null,
    data: {
      type: SystemMessageDataTypeEnum.Questions,
      response: text,
    },
  };

  log("calling apiClient.postMessage", { conversationId });
  try {
    await apiClient.postMessage({
      organizationId: organizationId,
      projectId: projectId,
      postMessageRequest: { ...systemMessage, type: MessageType.System },
    });
    log("apiClient.postMessage acknowledged", { conversationId });
  } catch (error) {
    logError("apiClient.postMessage threw", error, { conversationId });
    throw error;
  }
};
