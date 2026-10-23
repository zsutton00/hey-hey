import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { MessageStatus, type MessageResponseDto } from "../../../api";
import { platformClient, projectsClient } from "../../../clients/serviceClients";
import { messageKeys } from "../../collections/messages";
import { useConversationMessages } from "../useConversationMessages";
import { useLatestMessage } from "../useLatestMessage";

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getLatestMessage: vi.fn(),
    getMessages: vi.fn(),
    getMessage: vi.fn(),
  },
  projectsClient: {
    getQueuedConversationInputs: vi.fn(),
  },
}));

vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

import { useWebsocketSubscriptions } from "../useWebsocketSubscriptions";

const mockGetLatestMessage = platformClient.getLatestMessage as Mock;
const mockGetMessages = platformClient.getMessages as Mock;
const mockGetQueuedInputs = projectsClient.getQueuedConversationInputs as Mock;
const mockUseWebsocketSubscriptions = useWebsocketSubscriptions as Mock;

const message = (
  overrides: Partial<MessageResponseDto> = {}
): MessageResponseDto => ({
  id: "msg-001",
  projectId: "project-123",
  conversationId: "conv-123",
  type: "SYSTEM",
  content: "message",
  status: MessageStatus.Completed,
  createdAt: "2026-03-06T00:00:01.000Z",
  ...overrides,
});

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const listKey = messageKeys.list("org-123", "project-123", "conv-123");
const latestKey = messageKeys.latest("org-123", "project-123", "conv-123");

describe("useLatestMessage", () => {
  const serverLatest = message({ id: "msg-server", content: "server latest" });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLatestMessage.mockResolvedValue({ data: { data: serverLatest } });
    mockGetQueuedInputs.mockResolvedValue({ data: { data: [] } });
  });

  it("reads the latest-message endpoint when inputs are present and no list is loaded", async () => {
    const { wrapper, queryClient } = createHarness();
    const { result } = renderHook(
      () => useLatestMessage("org-123", "project-123", "conv-123"),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toEqual(serverLatest));
    expect(result.current.isReady).toBe(true);
    expect(mockGetLatestMessage).toHaveBeenCalledWith(
      {
        organizationId: "org-123",
        projectId: "project-123",
        conversationId: "conv-123",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(queryClient.getQueryData(latestKey)).toEqual(serverLatest);
  });

  it("does not read when conversationId is missing, and is not an error", () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () => useLatestMessage("org-123", "project-123", undefined),
      { wrapper }
    );

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(mockGetLatestMessage).not.toHaveBeenCalled();
  });

  it("subscribes to the conversation websocket room when enabled", () => {
    const { wrapper } = createHarness();
    renderHook(() => useLatestMessage("org-123", "project-123", "conv-123"), {
      wrapper,
    });

    expect(mockUseWebsocketSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationIds: ["conv-123"],
      }),
      { enabled: true }
    );
  });

  it("skips the initial mount read when cached data already exists", () => {
    const { wrapper, queryClient } = createHarness();
    const cached = message({ id: "msg-1", content: "cached latest message" });
    queryClient.setQueryData(latestKey, cached);

    const { result } = renderHook(
      () =>
        useLatestMessage("org-123", "project-123", "conv-123", {
          skipInitialFetchIfCached: true,
        }),
      { wrapper }
    );

    expect(result.current.data).toEqual(cached);
    expect(mockGetLatestMessage).not.toHaveBeenCalled();
  });

  it("re-reads when its latest-message key is invalidated (as message.created/deleted do centrally)", async () => {
    const { wrapper, queryClient } = createHarness();
    const { result } = renderHook(
      () => useLatestMessage("org-123", "project-123", "conv-123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.data).toEqual(serverLatest));

    const newer = message({
      id: "msg-newer",
      createdAt: "2026-03-06T00:00:09.000Z",
    });
    mockGetLatestMessage.mockResolvedValueOnce({ data: { data: newer } });
    await act(() => queryClient.invalidateQueries({ queryKey: latestKey }));

    await waitFor(() => expect(result.current.data).toEqual(newer));
    expect(mockGetLatestMessage).toHaveBeenCalledTimes(2);
  });

  it("selects from the loaded conversation Message list without a read of its own", async () => {
    const { wrapper, queryClient } = createHarness();
    const canonicalLatestMessage = message({
      id: "msg-002",
      type: "AGENT",
      content: "canonical latest message",
      createdAt: "2026-03-06T00:00:02.000Z",
    });
    queryClient.setQueryData(listKey, [
      message({ id: "msg-001" }),
      canonicalLatestMessage,
      // An undated queued input never counts as the latest.
      { ...message({ id: "queued" }), createdAt: null },
    ]);

    const { result } = renderHook(
      () => useLatestMessage("org-123", "project-123", "conv-123"),
      { wrapper }
    );

    expect(result.current.data).toEqual(canonicalLatestMessage);
    expect(result.current.isReady).toBe(true);

    // List updates flow through without any request.
    const appended = message({
      id: "msg-003",
      createdAt: "2026-03-06T00:00:03.000Z",
    });
    act(() => {
      queryClient.setQueryData<MessageResponseDto[]>(listKey, (current = []) => [
        ...current,
        appended,
      ]);
    });
    await waitFor(() => expect(result.current.data).toEqual(appended));
    expect(mockGetLatestMessage).not.toHaveBeenCalled();
    expect(mockGetMessages).not.toHaveBeenCalled();
  });

  it("answers from an in-flight list read instead of calling the latest-message endpoint", async () => {
    const { wrapper } = createHarness();
    const newest = message({
      id: "msg-002",
      createdAt: "2026-03-06T00:00:02.000Z",
    });
    mockGetMessages.mockResolvedValue({
      data: { data: { messages: [message(), newest], nextCursor: null } },
    });

    // Same render: the list read starts alongside the latest read.
    const { result } = renderHook(
      () => ({
        list: useConversationMessages("org-123", "project-123", "conv-123"),
        latest: useLatestMessage("org-123", "project-123", "conv-123"),
      }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.latest.data).toEqual(newest));
    expect(mockGetLatestMessage).not.toHaveBeenCalled();
    expect(mockGetMessages).toHaveBeenCalledTimes(1);
  });

  it("routes explicit refreshes through the canonical Message list", async () => {
    const { wrapper, queryClient } = createHarness();
    queryClient.setQueryData(listKey, [
      message({ id: "msg-001" }),
      message({ id: "msg-002", createdAt: "2026-03-06T00:00:02.000Z" }),
    ]);
    const refreshed = message({
      id: "msg-003",
      createdAt: "2026-03-06T00:00:03.000Z",
    });
    mockGetMessages.mockResolvedValueOnce({ data: { data: [refreshed] } });

    const { result } = renderHook(
      () => useLatestMessage("org-123", "project-123", "conv-123"),
      { wrapper }
    );

    let refetched: MessageResponseDto | null = null;
    await act(async () => {
      refetched = await result.current.refetch();
    });
    expect(refetched).toEqual(refreshed);
    expect(mockGetMessages).toHaveBeenCalledTimes(1);
    expect(mockGetMessages).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-123", since: "msg-001" }),
      expect.anything()
    );
    expect(mockGetLatestMessage).not.toHaveBeenCalled();
  });

  it("ignores invalidation of other conversations", async () => {
    const { wrapper, queryClient } = createHarness();
    const { result } = renderHook(
      () => useLatestMessage("org-123", "project-123", "conv-123"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(() =>
      queryClient.invalidateQueries({
        queryKey: messageKeys.latest("org-123", "project-123", "conv-999"),
      })
    );

    expect(mockGetLatestMessage).toHaveBeenCalledTimes(1);
  });
});
