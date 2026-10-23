import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationResponseDto, MessageResponseDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { WebSocketHandler } from "../websockets/handler";
import { useConversationByWorkflow } from "./useConversationByWorkflow";

vi.mock("../../clients/serviceClients", () => ({
  platformClient: {
    getActiveConversations: vi.fn(),
    getAllConversations: vi.fn(),
    getMessages: vi.fn(),
  },
  projectsClient: {
    getQueuedConversationInputs: vi.fn(async () => ({ data: { data: [] } })),
  },
}));
vi.mock("./useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

const conversation = (
  id: string,
  createdAt = "2026-09-01T00:00:00Z"
): ConversationResponseDto => ({
  id,
  organizationId: "org",
  projectId: "project",
  initiatedBy: "USER",
  status: "IN_PROGRESS",
  workflowName: "onboarding",
  version: 1,
  createdAt,
  updatedAt: createdAt,
});
const message = (conversationId: string): MessageResponseDto => ({
  id: "message-" + conversationId,
  conversationId,
  projectId: "project",
  type: "SYSTEM",
  status: "completed",
  createdAt: "2026-09-01T00:00:01Z",
  awaitingResponse: false,
  data: {
    type: "QUESTIONS",
    response: "Ready",
    uiElements: [{ id: "question", type: "text", label: "Question" }],
  },
});
const response = <T>(data: T) => ({ data: { data } });
const historyResponse = (messages: MessageResponseDto[]) =>
  response({ messages });
const listResponse = (data: ConversationResponseDto[]) => response({ data });
const options = { requireFirstMessage: true, requireUiElements: true };
let store: ReturnType<typeof createStore>;
let queryClient: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: queryClient }, children);
const createHandler = () => new WebSocketHandler(store, undefined, queryClient);
/**
 * Message reads that were not abandoned. A notification arriving mid-read
 * cancels and restarts it; axios never sends a request whose signal is
 * already aborted, so only unaborted reads reach the server.
 */
const liveMessageReads = () =>
  vi
    .mocked(platformClient.getMessages)
    .mock.calls.filter(
      ([, options]) => !(options as { signal?: AbortSignal })?.signal?.aborted
    ).length;
const requestOptions = expect.objectContaining({
  signal: expect.any(AbortSignal),
});
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  store = createStore();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  vi.mocked(platformClient.getActiveConversations).mockResolvedValue(
    listResponse([conversation("new")])
  );
  vi.mocked(platformClient.getMessages).mockResolvedValue(
    historyResponse([message("new")])
  );
});
afterEach(() => {
  vi.useRealTimers();
  queryClient.clear();
});

describe("canonical workflow conversation readiness", () => {
  it("reads metadata and canonical Messages separately", async () => {
    const { result } = renderHook(
      () => useConversationByWorkflow("org", "project", "onboarding", options),
      { wrapper }
    );
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.data?.id).toBe("new");
    expect(result.current.messages[0].data.response).toBe("Ready");
    expect(platformClient.getMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "new",
        includeProposals: true,
        includeReports: true,
      }),
      requestOptions
    );
  });
  it("keeps the newer unready candidate instead of displaying an older ready conversation", async () => {
    vi.mocked(platformClient.getActiveConversations).mockResolvedValue(
      listResponse([
        conversation("old"),
        conversation("new", "2026-09-02T00:00:00Z"),
      ])
    );
    vi.mocked(platformClient.getMessages).mockResolvedValue(historyResponse([]));
    const { result } = renderHook(
      () => useConversationByWorkflow("org", "project", "onboarding", options),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(platformClient.getMessages).toHaveBeenCalledTimes(1);
    expect(platformClient.getMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "new" }),
      requestOptions
    );
  });
  it("does not expose previous Messages when scope changes", async () => {
    const { result, rerender } = renderHook(
      ({ project }) =>
        useConversationByWorkflow("org", project, "onboarding", options),
      { wrapper, initialProps: { project: "project" } }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    vi.mocked(platformClient.getActiveConversations).mockResolvedValue(
      listResponse([])
    );
    rerender({ project: "other" });
    expect(result.current.data).toBeNull();
    expect(result.current.messages).toEqual([]);
  });
  it("surfaces Message failures as errors", async () => {
    vi.mocked(platformClient.getMessages).mockRejectedValue(
      new Error("Message read failed")
    );
    const { result } = renderHook(
      () => useConversationByWorkflow("org", "project", "onboarding", options),
      { wrapper }
    );
    await waitFor(() =>
      expect(result.current.error?.message).toBe("Message read failed")
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
  });
  it("refetch checks Messages belonging to the newly selected candidate", async () => {
    const { result } = renderHook(
      () => useConversationByWorkflow("org", "project", "onboarding", options),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    vi.mocked(platformClient.getActiveConversations).mockResolvedValue(
      listResponse([conversation("replacement")])
    );
    vi.mocked(platformClient.getMessages).mockResolvedValue(
      historyResponse([message("replacement")])
    );
    let refreshed: ConversationResponseDto | null = null;
    await act(async () => {
      refreshed = await result.current.refetch();
    });
    expect(refreshed?.id).toBe("replacement");
    expect(platformClient.getMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: "replacement" }),
      requestOptions
    );
  });
  it("discovers an absent conversation after a missed notification", async () => {
    vi.useFakeTimers();
    vi.mocked(platformClient.getActiveConversations).mockResolvedValue(
      listResponse([])
    );
    const { result } = renderHook(
      () => useConversationByWorkflow("org", "project", "onboarding", options),
      { wrapper }
    );
    await advance(100);
    expect(result.current.data).toBeNull();
    vi.mocked(platformClient.getActiveConversations).mockResolvedValue(
      listResponse([conversation("new")])
    );
    await advance(3000);
    await advance(100);
    expect(result.current.data?.id).toBe("new");
  });
  it("recovers pending Messages on a fixed deadline without an envelope refresh", async () => {
    vi.useFakeTimers();
    vi.mocked(platformClient.getMessages).mockResolvedValue(historyResponse([]));
    const { result } = renderHook(
      () => useConversationByWorkflow("org", "project", "onboarding", options),
      { wrapper }
    );
    await advance(100);
    await advance(100);
    vi.mocked(platformClient.getMessages).mockResolvedValue(
      historyResponse([message("new")])
    );
    await advance(3000);
    await advance(100);
    expect(result.current.data?.id).toBe("new");
    expect(platformClient.getActiveConversations).toHaveBeenCalledTimes(1);
  });
  it("coalesces duplicate completion frames into one Message read and no envelope reads", async () => {
    const { result } = renderHook(
      () => useConversationByWorkflow("org", "project", "onboarding", options),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    vi.mocked(platformClient.getMessages).mockResolvedValue(
      historyResponse([
        {
          ...message("new"),
          data: { ...message("new").data, response: "Completed update" },
        },
      ])
    );
    const handler = createHandler();
    act(() => {
      for (let i = 0; i < 3; i++)
        handler.handleEvent({
          type: "conversation.updated",
          organizationId: "org",
          projectId: "project",
          conversationId: "new",
          timestamp: "2026-09-01T00:00:02Z",
          previousVersion: 1,
          newVersion: 2,
          changeType: "message_added",
        });
    });
    await waitFor(() =>
      expect(result.current.messages[0].data.response).toBe("Completed update")
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(liveMessageReads()).toBe(2);
    expect(platformClient.getActiveConversations).toHaveBeenCalledTimes(1);
  });
  it("applies an authoritative follow-up after invalidation during an in-flight read", async () => {
    const { result } = renderHook(
      () => useConversationByWorkflow("org", "project", "onboarding", options),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    let resolveFirst: (
      value: ReturnType<typeof historyResponse>
    ) => void = () => {};
    const first = new Promise<ReturnType<typeof historyResponse>>((resolve) => {
      resolveFirst = resolve;
    });
    // Every read that starts after the in-flight one sees the completion.
    vi.mocked(platformClient.getMessages)
      .mockReturnValueOnce(first)
      .mockResolvedValue(
        historyResponse([
          {
            ...message("new"),
            data: {
              ...message("new").data,
              response: "Authoritative completion",
            },
          },
        ])
      );
    const handler = createHandler();
    const notify = () =>
      handler.handleEvent({
        type: "conversation.updated",
        organizationId: "org",
        projectId: "project",
        conversationId: "new",
        timestamp: "2026-09-01T00:00:02Z",
        previousVersion: 1,
        newVersion: 2,
        changeType: "message_updated",
      });
    act(notify);
    await waitFor(() =>
      expect(platformClient.getMessages).toHaveBeenCalledTimes(2)
    );
    act(() => {
      notify();
      notify();
    });
    await act(async () => {
      resolveFirst(historyResponse([message("new")]));
    });
    await waitFor(() =>
      expect(result.current.messages[0].data.response).toBe(
        "Authoritative completion"
      )
    );
    // The stale in-flight read resolving late never overwrites the follow-up.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.messages[0].data.response).toBe(
      "Authoritative completion"
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    // Initial read plus one live follow-up; the in-flight read was abandoned.
    expect(liveMessageReads()).toBe(2);
    expect(platformClient.getActiveConversations).toHaveBeenCalledTimes(1);
  });

  it("does not postpone pending-content recovery during continuous notifications", async () => {
    vi.useFakeTimers();
    vi.mocked(platformClient.getMessages).mockResolvedValue(historyResponse([]));
    renderHook(
      () => useConversationByWorkflow("org", "project", "onboarding", options),
      { wrapper }
    );
    await advance(100);
    await advance(100);
    const handler = createHandler();
    // Notify continuously up to just before the 3s recovery deadline.
    for (let elapsed = 0; elapsed < 2700; elapsed += 100) {
      act(() =>
        handler.handleEvent({
          type: "conversation.updated",
          organizationId: "org",
          projectId: "project",
          conversationId: "new",
          timestamp: "2026-09-01T00:00:02Z",
          previousVersion: 1,
          newVersion: 2,
          changeType: "message_updated",
        })
      );
      await advance(100);
    }
    const readsAtDeadline = vi.mocked(platformClient.getMessages).mock.calls
      .length;
    await advance(200);
    expect(
      vi.mocked(platformClient.getMessages).mock.calls.length
    ).toBeGreaterThan(readsAtDeadline);
    expect(platformClient.getActiveConversations).toHaveBeenCalledTimes(1);
  });
});
