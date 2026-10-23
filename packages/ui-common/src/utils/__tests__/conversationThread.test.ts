import { describe, expect, it } from "vitest";
import {
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
  type MessageResponseDto,
} from "../../api";
import {
  collectSystemMessages,
  getConversationSystemThread,
} from "../conversationThread";

const createSystemMessage = (
  id: string,
  responses: MessageResponseDto[] = []
): MessageResponseDto => ({
  id,
  projectId: "project-1",
  type: MessageType.System,
  status: MessageStatus.Completed,
  data: {
    type: SystemMessageDataTypeEnum.Noop,
  },
  conversationId: "conversation-1",
  createdAt: "2026-07-01T00:00:00Z",
  awaitingResponse: false,
  responses,
});

const createUserMessage = (
  id: string,
  responses: MessageResponseDto[] = []
): MessageResponseDto => ({
  id,
  projectId: "project-1",
  type: MessageType.User,
  status: MessageStatus.Completed,
  data: {},
  conversationId: "conversation-1",
  createdAt: "2026-07-01T00:00:00Z",
  responses,
});

describe("conversationThread", () => {
  it("collects system messages in depth-first order and marks the active step after the last completed system response", () => {
    const thread = createSystemMessage("system-1", [
      createUserMessage("user-1", [createSystemMessage("system-2")]),
    ]);

    const result = collectSystemMessages(thread);

    expect(result.systemMessages.map((message) => message.id)).toEqual([
      "system-1",
      "system-2",
    ]);
    expect(result.activeStep).toBe(1);
  });

  it("returns the first system thread when the root list contains one", () => {
    const rootMessages = [
      createUserMessage("user-root"),
      createSystemMessage("system-root"),
    ];

    const result = getConversationSystemThread(rootMessages);

    expect(result.rootMessage?.id).toBe("system-root");
    expect(result.firstSystemMessage?.id).toBe("system-root");
    expect(result.systemMessages.map((message) => message.id)).toEqual([
      "system-root",
    ]);
    expect(result.activeStep).toBe(0);
  });

  it("falls back to the first root message when no system messages exist", () => {
    const result = getConversationSystemThread([
      createUserMessage("user-root"),
    ]);

    expect(result.rootMessage?.id).toBe("user-root");
    expect(result.firstSystemMessage).toBeNull();
    expect(result.systemMessages).toEqual([]);
    expect(result.activeStep).toBe(0);
  });

  it("returns an empty thread when no messages are provided", () => {
    expect(getConversationSystemThread(null)).toEqual({
      rootMessage: null,
      firstSystemMessage: null,
      systemMessages: [],
      activeStep: -1,
    });
    expect(getConversationSystemThread(undefined)).toEqual({
      rootMessage: null,
      firstSystemMessage: null,
      systemMessages: [],
      activeStep: -1,
    });
  });
});
