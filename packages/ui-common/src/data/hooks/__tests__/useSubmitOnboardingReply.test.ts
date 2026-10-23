import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MessageStatus,
  MessageType,
  type MessageResponseDto,
} from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { useSubmitOnboardingReply } from "../useSubmitOnboardingReply";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    submitOnboardingReply: vi.fn(),
    getConversationVersion: vi.fn(),
  },
}));

const submitOnboardingReply = vi.mocked(unifiedApiClient.submitOnboardingReply);
const getConversationVersion = vi.mocked(
  unifiedApiClient.getConversationVersion
);
const versionResponse = (version: number) => ({
  data: {
    success: true,
    message: "Current version",
    data: { version },
    timestamp: "2026-09-16T00:00:00Z",
    statusCode: 200,
  },
});

const responseMessage = {
  id: "message-1",
  projectId: "project-1",
  type: MessageType.User,
  status: MessageStatus.Completed,
  data: { project_concept: "A graph-backed project workspace" },
  conversationId: "conversation-1",
  parentMessageId: "parent-message-1",
  createdAt: "2026-08-28T00:00:00.000Z",
} satisfies MessageResponseDto;

const variables = {
  organizationId: "org-1",
  projectId: "project-1",
  conversationId: "conversation-1",
  parentMessageId: "parent-message-1",
  answers: {
    project_concept: "A graph-backed project workspace",
    feature_choice: {
      action: "CREATE_INITIATIVE",
      payload: { name: "Project discovery" },
    },
  },
};

describe("useSubmitOnboardingReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConversationVersion.mockResolvedValue(versionResponse(7));
    submitOnboardingReply.mockResolvedValue({
      data: {
        success: true,
        message: "Reply accepted",
        data: responseMessage,
        timestamp: "2026-08-28T00:00:00.000Z",
        statusCode: 202,
      },
    });
  });

  it("sends the complete answers in the closed admission DTO", async () => {
    const { result } = renderHook(() => useSubmitOnboardingReply());
    let message: unknown;

    await act(async () => {
      message = await result.current.mutate(variables);
    });

    expect(message).toEqual(responseMessage);
    expect(submitOnboardingReply).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      submitOnboardingReplyRequestDto: {
        parentMessageId: "parent-message-1",
        expectedConversationVersion: 7,
        answers: variables.answers,
      },
    });
    expect(
      submitOnboardingReply.mock.calls[0]?.[0].submitOnboardingReplyRequestDto
    ).not.toHaveProperty("organizationId");
    expect(
      submitOnboardingReply.mock.calls[0]?.[0].submitOnboardingReplyRequestDto
    ).not.toHaveProperty("controllerCredentialId");
  });

  it("propagates server rejection", async () => {
    const error = new Error("The onboarding form is stale.");
    submitOnboardingReply.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useSubmitOnboardingReply());

    await act(async () => {
      await expect(result.current.mutate(variables)).rejects.toBe(error);
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBe(error);
    });
  });

  it("reads the current version for consecutive replies without refreshing the conversation", async () => {
    getConversationVersion.mockResolvedValueOnce(versionResponse(8));
    getConversationVersion.mockResolvedValueOnce(versionResponse(10));
    const { result } = renderHook(() => useSubmitOnboardingReply());
    await act(async () => {
      await result.current.mutate(variables);
    });
    await act(async () => {
      await result.current.mutate({
        ...variables,
        parentMessageId: "next-form",
      });
    });
    expect(getConversationVersion).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
    });
    expect(
      submitOnboardingReply.mock.calls.map(
        ([request]) =>
          request.submitOnboardingReplyRequestDto.expectedConversationVersion
      )
    ).toEqual([8, 10]);
    expect(
      submitOnboardingReply.mock.calls[1][0].submitOnboardingReplyRequestDto
        .parentMessageId
    ).toBe("next-form");
  });

  it("does not submit when the version read fails", async () => {
    getConversationVersion.mockRejectedValueOnce(
      new Error("Version unavailable")
    );
    const { result } = renderHook(() => useSubmitOnboardingReply());
    await act(async () => {
      await expect(result.current.mutate(variables)).rejects.toThrow(
        "Version unavailable"
      );
    });
    expect(submitOnboardingReply).not.toHaveBeenCalled();
    expect(result.current.isError).toBe(true);
  });

  it("keeps the reply pending until its version is available", async () => {
    let resolveVersion: (
      value: ReturnType<typeof versionResponse>
    ) => void = () => {
      throw new Error("Version read has not started");
    };
    getConversationVersion.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveVersion = resolve;
      })
    );
    const { result } = renderHook(() => useSubmitOnboardingReply());
    let pending: Promise<MessageResponseDto>;
    act(() => {
      pending = result.current.mutate(variables);
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(submitOnboardingReply).not.toHaveBeenCalled();
    await act(async () => {
      resolveVersion(versionResponse(9));
      await pending;
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isPending).toBe(false);
  });

  it("does not submit when the version response has no version", async () => {
    getConversationVersion.mockResolvedValueOnce({
      data: { ...versionResponse(7).data, data: undefined },
    });
    const { result } = renderHook(() => useSubmitOnboardingReply());
    await act(async () => {
      await expect(result.current.mutate(variables)).rejects.toThrow(
        "No current conversation version returned from API"
      );
    });
    expect(submitOnboardingReply).not.toHaveBeenCalled();
  });

  it("rejects an incomplete successful response", async () => {
    submitOnboardingReply.mockResolvedValueOnce({
      data: {
        success: false,
        message: "No data returned",
        data: undefined,
        timestamp: "2026-08-28T00:00:00.000Z",
        statusCode: 202,
      },
    });
    const { result } = renderHook(() => useSubmitOnboardingReply());

    await act(async () => {
      await expect(result.current.mutate(variables)).rejects.toThrow(
        "No onboarding reply message returned from API"
      );
    });
  });
});
