import { MessageType, type MessageResponseDto } from "../api";

export interface ConversationSystemThread {
  rootMessage: MessageResponseDto | null;
  firstSystemMessage: MessageResponseDto | null;
  systemMessages: MessageResponseDto[];
  activeStep: number;
}

export const collectSystemMessages = (
  message: MessageResponseDto | undefined
) => {
  const systemMessages: MessageResponseDto[] = [];
  let lastCompletedStep = -1;

  const collectSystemMessagesRec = (currentMessage: MessageResponseDto) => {
    if (currentMessage.type === MessageType.System) {
      const index = systemMessages.length;
      systemMessages.push(currentMessage);

      if (currentMessage.responses && currentMessage.responses.length > 0) {
        const hasUserResponse =
          currentMessage.responses[0].type === MessageType.User;
        if (hasUserResponse) {
          lastCompletedStep = index;
        }
      }
    }

    if (currentMessage.responses && currentMessage.responses.length > 0) {
      for (const response of currentMessage.responses) {
        collectSystemMessagesRec(response);
      }
    }
  };

  if (message) {
    collectSystemMessagesRec(message);
  }

  return {
    systemMessages,
    activeStep: Math.min(lastCompletedStep + 1, systemMessages.length - 1),
  };
};

export const getConversationSystemThread = (
  messages: MessageResponseDto[] | null | undefined
): ConversationSystemThread => {
  if (!messages || messages.length === 0) {
    return {
      rootMessage: null,
      firstSystemMessage: null,
      systemMessages: [],
      activeStep: -1,
    };
  }

  for (const rootMessage of messages) {
    const { systemMessages, activeStep } = collectSystemMessages(rootMessage);
    if (systemMessages.length > 0) {
      return {
        rootMessage,
        firstSystemMessage: systemMessages[0] ?? null,
        systemMessages,
        activeStep,
      };
    }
  }

  return {
    rootMessage: messages[0] ?? null,
    firstSystemMessage: null,
    systemMessages: [],
    activeStep: 0,
  };
};
