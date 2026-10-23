import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MessageStatus,
  MessageType,
  type MessageResponseDto,
} from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { useSubmitRepositoryImportReply } from "../useSubmitRepositoryImportReply";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { submitRepositoryImportReply: vi.fn() },
}));
const submitRepositoryImportReply = vi.mocked(
  unifiedApiClient.submitRepositoryImportReply
);

describe("useSubmitRepositoryImportReply", () => {
  const message = {
    id: "message-1",
    projectId: "project-1",
    type: MessageType.User,
    status: MessageStatus.Completed,
    data: { repository_action: { action: "start" } },
    conversationId: "conversation-1",
    parentMessageId: "parent-message-1",
    createdAt: "2026-09-17T00:00:00.000Z",
  } satisfies MessageResponseDto;

  beforeEach(() => {
    vi.clearAllMocks();
    submitRepositoryImportReply.mockResolvedValue({
      data: {
        success: true,
        message: "Reply accepted",
        data: message,
        timestamp: message.createdAt,
        statusCode: 202,
      },
    });
  });

  it("uses the repository-import admission operation and closed DTO", async () => {
    const variables = {
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      parentMessageId: "parent-message-1",
      expectedConversationVersion: 9,
      answers: { repository_action: { action: "start" as const } },
    };
    const { result } = renderHook(() => useSubmitRepositoryImportReply());
    await act(async () => {
      await expect(result.current.mutate(variables)).resolves.toEqual(message);
    });
    expect(submitRepositoryImportReply).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      submitRepositoryImportReplyRequestDto: {
        parentMessageId: "parent-message-1",
        expectedConversationVersion: 9,
        answers: variables.answers,
      },
    });
  });
});
