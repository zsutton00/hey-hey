import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ConversationResponseDto, MessageResponseDto } from "../../api";
import { useConversationPolling } from "./useConversationPolling";

const createConversation = (
  messages: MessageResponseDto[]
): ConversationResponseDto => {
  canonicalMessagesMock.mockReturnValue({ data: messages });
  return {
    id: "conv-1",
    projectId: "project-1",
    workflowId: "workflow-1",
    workflowName: "onboarding",
    initiatedBy: "SYSTEM",
    triggerEvent: "test",
    status: "IN_PROGRESS",
    title: "Test Conversation",
    version: 1,
    lastModifiedBy: null,
    initiativeId: null,
    workflowAboutId: null,
    createdAt: "2025-01-01T10:00:00.000Z",
    updatedAt: "2025-01-01T10:00:00.000Z",
  } as ConversationResponseDto;
};

describe("useConversationPolling", () => {
  it("keeps waiting when a user-rooted conversation has no system reply yet", () => {
    const conversation = createConversation([
      {
        id: "user-root",
        workflowId: "workflow-1",
        projectId: "project-1",
        status: "completed",
        conversationId: "conv-1",
        parentMessageId: null,
        createdAt: "2025-01-01T10:00:00.000Z",
        responses: [],
        type: "USER",
        data: { comment: "Start conversation" },
        awaitingResponse: false,
      } as MessageResponseDto,
    ]);

    const { result } = renderHook(() =>
      useConversationPolling(conversation, { enabled: false })
    );

    expect(result.current.isWaitingForFirstMessage).toBe(true);
  });

  it("stops waiting when a user-rooted conversation has a nested system reply with uiElements", () => {
    const conversation = createConversation([
      {
        id: "user-root",
        workflowId: "workflow-1",
        projectId: "project-1",
        status: "completed",
        conversationId: "conv-1",
        parentMessageId: null,
        createdAt: "2025-01-01T10:00:00.000Z",
        responses: [
          {
            id: "nested-system",
            workflowId: "workflow-1",
            projectId: "project-1",
            status: "open",
            conversationId: "conv-1",
            parentMessageId: "user-root",
            createdAt: "2025-01-01T10:01:00.000Z",
            responses: [],
            type: "SYSTEM",
            data: {
              type: "QUESTIONS",
              response: "What do you want to do?",
              uiElements: [
                {
                  id: "prompt",
                  type: "textarea",
                  label: "Prompt",
                  influences: [],
                },
              ],
            },
            awaitingResponse: true,
          } as MessageResponseDto,
        ],
        type: "USER",
        data: { comment: "Start conversation" },
        awaitingResponse: false,
      } as MessageResponseDto,
    ]);

    const { result } = renderHook(() =>
      useConversationPolling(conversation, { enabled: false })
    );

    expect(result.current.isWaitingForFirstMessage).toBe(false);
  });
});

const canonicalMessagesMock = vi.hoisted(() => vi.fn());
vi.mock("./useConversationMessages", () => ({
  useConversationMessages: canonicalMessagesMock,
}));
