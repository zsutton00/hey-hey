import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  MessageReadMode,
  MessageStatus,
  type MessageResponseDto,
} from "../../../api";
import {
  platformClient,
  projectsClient,
} from "../../../clients/serviceClients";
import {
  invalidateConversationMessages,
  messageKeys,
} from "../../collections/messages";
import { resetConversationMessageHistoryStateForTests } from "../../collections/conversationMessageHistoryState";
import { useConversationMessages } from "../useConversationMessages";
import {
  beginOptimisticInput,
  confirmOptimisticInput,
  removeOptimisticInput,
} from "../../collections/optimisticConversationInputs";

vi.mock("../../../clients/serviceClients", () => ({
  projectsClient: { getQueuedConversationInputs: vi.fn() },
  platformClient: {
    getMessage: vi.fn(),
    getMessages: vi.fn(),
  },
}));

vi.mock("../../../utils/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const buildMessage = (
  overrides: Partial<MessageResponseDto> = {}
): MessageResponseDto => ({
  id: "msg-1",
  conversationId: "conv-1",
  type: "SYSTEM",
  content: "first response",
  createdAt: "2026-04-01T10:00:00.000Z",
  status: MessageStatus.Completed,
  ...overrides,
});

const okResponse = (messages: MessageResponseDto[]) => ({
  data: { data: messages, success: true, message: "ok", timestamp: "now" },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {},
});

const historyResponse = (
  messages: MessageResponseDto[],
  nextCursor?: string
) => ({
  data: {
    data: { messages, ...(nextCursor ? { nextCursor } : {}) },
    success: true,
    message: "ok",
    timestamp: "now",
  },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {},
});

const createQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });

const createWrapper =
  (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

const requestOptions = expect.objectContaining({
  signal: expect.any(AbortSignal),
});

/** What the websocket handler does for `conversation.updated`. */
const invalidateMessages = async (queryClient: QueryClient) => {
  await act(async () => {
    await invalidateConversationMessages(queryClient, "org-1", "proj-1", "conv-1");
  });
};

describe("useConversationMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [] },
    } as never);
    resetConversationMessageHistoryStateForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requests at most eight recent Messages on initial mount", async () => {
    const initial = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      buildMessage({
        id: "msg-2",
        createdAt: "2026-04-01T10:05:00.000Z",
        content: "second",
      }),
    ];
    (platformClient.getMessages as Mock).mockResolvedValue(
      historyResponse(initial, "older-page")
    );

    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });

    expect(platformClient.getMessages).toHaveBeenCalledTimes(1);
    expect(platformClient.getMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        mode: MessageReadMode.ReverseHistory,
        limit: 8,
        includeProposals: true,
        includeReports: true,
      }),
      requestOptions
    );
    expect(result.current.data.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
    expect(result.current.orderedData.map((m) => m.id)).toEqual([
      "msg-1",
      "msg-2",
    ]);
    expect(result.current.isReady).toBe(true);
    expect(result.current.hasOlder).toBe(true);
  });

  it("does not fetch when missing required ids", () => {
    const queryClient = createQueryClient();
    renderHook(() => useConversationMessages(undefined, "proj-1", "conv-1"), {
      wrapper: createWrapper(queryClient),
    });
    expect(platformClient.getMessages).not.toHaveBeenCalled();
  });

  it("lets a cache-only observer share the owner's in-flight result without scheduling another fetch", async () => {
    let resolveMessages:
      | ((response: ReturnType<typeof historyResponse>) => void)
      | undefined;
    const messagesResponse = new Promise<ReturnType<typeof historyResponse>>(
      (resolve) => {
        resolveMessages = resolve;
      }
    );
    (platformClient.getMessages as Mock).mockReturnValue(messagesResponse);

    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => {
        const owner = useConversationMessages("org-1", "proj-1", "conv-1");
        const observer = useConversationMessages("org-1", "proj-1", "conv-1", {
          refetchOnMount: false,
        });
        return { owner, observer };
      },
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(platformClient.getMessages).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveMessages?.(historyResponse([buildMessage()]));
      await messagesResponse;
    });

    await waitFor(() => {
      expect(result.current.owner.orderedData).toHaveLength(1);
      expect(result.current.observer.orderedData).toHaveLength(1);
    });
    expect(platformClient.getMessages).toHaveBeenCalledTimes(1);
  });

  it("renders cached messages immediately and authoritatively revalidates when remounted", async () => {
    const cached = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      buildMessage({ id: "msg-2", createdAt: "2026-04-01T10:05:00.000Z" }),
    ];
    (platformClient.getMessages as Mock).mockResolvedValueOnce(
      historyResponse(cached, "older-page")
    );

    const queryClient = createQueryClient();
    const firstMount = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(firstMount.result.current.isFetched).toBe(true);
    });
    firstMount.unmount();
    // The last observer leaving marks the list stale (after a microtask).
    await act(async () => {
      await Promise.resolve();
    });

    let resolveRevalidation:
      | ((response: ReturnType<typeof okResponse>) => void)
      | undefined;
    const revalidation = new Promise<ReturnType<typeof okResponse>>(
      (resolve) => {
        resolveRevalidation = resolve;
      }
    );
    (platformClient.getMessages as Mock).mockReturnValueOnce(revalidation);

    const secondMount = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );

    expect(secondMount.result.current.orderedData.map(({ id }) => id)).toEqual([
      "msg-1",
      "msg-2",
    ]);

    await waitFor(() => {
      expect(platformClient.getMessages).toHaveBeenCalledTimes(2);
    });
    expect(platformClient.getMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        since: "msg-1",
      }),
      requestOptions
    );

    await act(async () => {
      resolveRevalidation?.(
        okResponse([
          cached[1]!,
          buildMessage({
            id: "msg-3",
            createdAt: "2026-04-01T10:10:00.000Z",
          }),
        ])
      );
      await revalidation;
    });

    await waitFor(() => {
      expect(
        secondMount.result.current.orderedData.map(({ id }) => id)
      ).toEqual(["msg-1", "msg-2", "msg-3"]);
    });
  });

  it("serves a fresh cached list on mount without a read unless refetchOnMount is set", async () => {
    const queryClient = createQueryClient();
    const cached = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      buildMessage({ id: "msg-2", createdAt: "2026-04-01T10:05:00.000Z" }),
    ];
    queryClient.setQueryData(messageKeys.list("org-1", "proj-1", "conv-1"), cached);

    const plain = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );
    expect(plain.result.current.orderedData.map(({ id }) => id)).toEqual([
      "msg-1",
      "msg-2",
    ]);
    expect(plain.result.current.isReady).toBe(true);
    expect(platformClient.getMessages).not.toHaveBeenCalled();
    expect(projectsClient.getQueuedConversationInputs).not.toHaveBeenCalled();

    (platformClient.getMessages as Mock).mockResolvedValue(okResponse([]));
    renderHook(
      () =>
        useConversationMessages("org-1", "proj-1", "conv-1", {
          refetchOnMount: true,
        }),
      { wrapper: createWrapper(queryClient) }
    );
    await waitFor(() =>
      expect(platformClient.getMessages).toHaveBeenCalledTimes(1)
    );
    expect(platformClient.getMessages).toHaveBeenCalledWith(
      expect.objectContaining({ since: "msg-1" }),
      requestOptions
    );
  });

  it("surfaces a missing conversation as a settled 404 error without retrying", async () => {
    (platformClient.getMessages as Mock).mockRejectedValue(
      Object.assign(new Error("Not Found"), {
        isAxiosError: true,
        response: { status: 404, data: {} },
      })
    );
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toMatchObject({
      name: "ConversationMessagesNotFoundError",
      status: 404,
    });
    expect(result.current.isReady).toBe(false);
    expect(platformClient.getMessages).toHaveBeenCalledTimes(1);
  });

  it("returns the empty-but-ready shape when disabled", () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () =>
        useConversationMessages("org-1", "proj-1", "conv-1", {
          enabled: false,
        }),
      { wrapper: createWrapper(queryClient) }
    );
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(platformClient.getMessages).not.toHaveBeenCalled();
  });

  it("threads a flat list into a tree, returning roots with nested responses", async () => {
    const flat: MessageResponseDto[] = [
      buildMessage({
        id: "user-1",
        type: "USER",
        createdAt: "2026-04-01T10:00:00.000Z",
      }),
      buildMessage({
        id: "system-1",
        type: "SYSTEM",
        parentMessageId: "user-1",
        createdAt: "2026-04-01T10:00:01.000Z",
      }),
      buildMessage({
        id: "system-2",
        type: "SYSTEM",
        parentMessageId: "user-1",
        createdAt: "2026-04-01T10:00:02.000Z",
      }),
      buildMessage({
        id: "user-2",
        type: "USER",
        createdAt: "2026-04-01T10:01:00.000Z",
      }),
      buildMessage({
        id: "system-3",
        type: "SYSTEM",
        parentMessageId: "user-2",
        createdAt: "2026-04-01T10:01:01.000Z",
      }),
    ];
    (platformClient.getMessages as Mock).mockResolvedValue(
      historyResponse(flat)
    );

    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isFetched).toBe(true);
    });

    expect(result.current.data.map((m) => m.id)).toEqual(["user-1", "user-2"]);
    expect(result.current.data[0]?.responses?.map((r) => r.id)).toEqual([
      "system-1",
      "system-2",
    ]);
    expect(result.current.data[1]?.responses?.map((r) => r.id)).toEqual([
      "system-3",
    ]);
    expect(result.current.orderedData.map((message) => message.id)).toEqual([
      "user-1",
      "system-1",
      "system-2",
      "user-2",
      "system-3",
    ]);
  });

  it("keeps undated inputs out of the timeline, in send order, including after cancellation", async () => {
    const recent = buildMessage({ id: "recent" });
    const undated = (id: string) =>
      ({
        ...buildMessage({ id, type: "USER", executionStatus: "queued" }),
        createdAt: null,
      } as unknown as MessageResponseDto);
    // queued-inputs returns send order, which is not id order.
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [undated("sent-first-z"), undated("sent-second-a")] },
    } as never);
    (platformClient.getMessages as Mock).mockResolvedValue(
      historyResponse([recent])
    );

    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );
    await waitFor(() => expect(result.current.isFetched).toBe(true));

    expect(result.current.orderedData.map((m) => m.id)).toEqual(["recent"]);
    expect(result.current.data.map((m) => m.id)).toEqual(["recent"]);
    expect(result.current.undatedInputs.map((m) => m.id)).toEqual([
      "sent-first-z",
      "sent-second-a",
    ]);

    // A cancelled input never gets a date and never enters the timeline.
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [undated("sent-second-a")] },
    } as never);
    vi.mocked(platformClient.getMessage).mockResolvedValue({
      data: {
        data: { ...undated("sent-first-z"), executionStatus: "cancelled" },
      },
    } as never);
    (platformClient.getMessages as Mock).mockResolvedValue(
      historyResponse([recent])
    );
    await invalidateMessages(queryClient);
    await waitFor(() =>
      expect(
        result.current.undatedInputs.find((m) => m.id === "sent-first-z")
          ?.executionStatus
      ).toBe("cancelled")
    );
    expect(result.current.orderedData.map((m) => m.id)).toEqual(["recent"]);
  });

  it("prepends an older page by identity and coalesces concurrent requests", async () => {
    const recent = [
      buildMessage({ id: "msg-3", createdAt: "2026-04-01T10:03:00.000Z" }),
      buildMessage({ id: "msg-4", createdAt: "2026-04-01T10:04:00.000Z" }),
    ];
    const older = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:01:00.000Z" }),
      buildMessage({ id: "msg-3", createdAt: "2026-04-01T10:03:00.000Z" }),
    ];
    (platformClient.getMessages as Mock)
      .mockResolvedValueOnce(historyResponse(recent, "older-page"))
      .mockResolvedValueOnce(historyResponse(older));

    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );
    await waitFor(() => expect(result.current.hasOlder).toBe(true));

    await act(async () => {
      await Promise.all([
        result.current.loadOlder(),
        result.current.loadOlder(),
      ]);
    });

    expect(platformClient.getMessages).toHaveBeenCalledTimes(2);
    expect(platformClient.getMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({
        historyCursor: "older-page",
        mode: MessageReadMode.ReverseHistory,
      }),
      expect.anything()
    );
    // The older page is merged into the list; the list is not re-read.
    expect(projectsClient.getQueuedConversationInputs).toHaveBeenCalledTimes(1);
    expect(result.current.orderedData.map(({ id }) => id)).toEqual([
      "msg-1",
      "msg-3",
      "msg-4",
    ]);
    expect(result.current.hasOlder).toBe(false);
  });

  it("keeps loaded Messages visible and exposes an older-page retry error", async () => {
    (platformClient.getMessages as Mock)
      .mockResolvedValueOnce(historyResponse([buildMessage()], "older-page"))
      .mockRejectedValueOnce(new Error("older page failed"));

    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );
    await waitFor(() => expect(result.current.hasOlder).toBe(true));

    await act(async () => {
      await expect(result.current.loadOlder()).rejects.toThrow(
        "older page failed"
      );
    });

    expect(result.current.orderedData.map(({ id }) => id)).toEqual(["msg-1"]);
    expect(result.current.olderError?.message).toBe("older page failed");
    expect(result.current.hasOlder).toBe(true);
  });
  it("refreshes older queued inputs on message invalidation without polling and preserves identity when started", async () => {
    const queued = {
      ...buildMessage({
        id: "queued-old",
        executionStatus: "queued",
        executionQueueConfirmed: true,
      }),
      createdAt: null,
    } as unknown as MessageResponseDto;
    const recent = buildMessage({ id: "recent" });
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [queued] },
    } as never);
    vi.mocked(platformClient.getMessages).mockResolvedValue(
      historyResponse([recent]) as never
    );
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );
    await waitFor(() =>
      expect(result.current.undatedInputs.map((message) => message.id)).toEqual(
        ["queued-old"]
      )
    );
    expect(result.current.orderedData.map((message) => message.id)).toEqual([
      "recent",
    ]);
    expect(result.current.data?.map((message) => message.id)).toEqual([
      "recent",
    ]);
    vi.useFakeTimers();
    try {
      const fetchCount = vi.mocked(projectsClient.getQueuedConversationInputs)
        .mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(projectsClient.getQueuedConversationInputs).toHaveBeenCalledTimes(
        fetchCount
      );
    } finally {
      vi.useRealTimers();
    }
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [] },
    } as never);
    vi.mocked(platformClient.getMessage).mockResolvedValue({
      // The accepted start dates the input after earlier replies.
      data: {
        data: {
          ...queued,
          executionStatus: "started",
          createdAt: "2026-04-01T11:00:00.000Z",
        },
      },
    } as never);
    vi.mocked(platformClient.getMessages).mockResolvedValue(
      historyResponse([recent]) as never
    );
    await act(async () => {
      // conversation.updated dispatches this exact invalidation.
      await invalidateConversationMessages(
        queryClient,
        "org-1",
        "proj-1",
        "conv-1"
      );
    });
    await waitFor(() =>
      expect(result.current.data?.map((message) => message.id)).toContain(
        queued.id
      )
    );
    expect(result.current.orderedData.map((message) => message.id)).toEqual([
      "recent",
      queued.id,
    ]);
    expect(result.current.undatedInputs).toEqual([]);
    expect(result.current.data?.map((message) => message.id)).toContain(
      queued.id
    );
  });

  it("never lets a queue snapshot read before start regress the later dated record", async () => {
    const waiting = {
      ...buildMessage({
        id: "race",
        type: "USER",
        executionStatus: "queued",
        executionQueueConfirmed: true,
      }),
      createdAt: null,
    } as unknown as MessageResponseDto;
    const started = {
      ...waiting,
      executionStatus: "started",
      createdAt: "2026-04-01T11:00:00.000Z",
    } as unknown as MessageResponseDto;
    const recent = buildMessage({ id: "recent" });
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [waiting, waiting] },
    } as never);
    vi.mocked(platformClient.getMessages).mockResolvedValue(
      historyResponse([recent]) as never
    );
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );
    // Duplicate queue entries collapse to one identity.
    await waitFor(() =>
      expect(result.current.undatedInputs.map(({ id }) => id)).toEqual([
        "race",
      ])
    );

    const refresh = async () => {
      await invalidateMessages(queryClient);
    };
    // Queue is read before start; the timeline is read after start.
    vi.mocked(platformClient.getMessages).mockResolvedValue(
      historyResponse([recent, started]) as never
    );
    await refresh();
    await waitFor(() =>
      expect(result.current.orderedData.map(({ id }) => id)).toEqual([
        "recent",
        "race",
      ])
    );
    expect(result.current.undatedInputs).toEqual([]);
    expect(result.current.orderedData[1].createdAt).toBe(started.createdAt);
    expect(platformClient.getMessage).not.toHaveBeenCalled();

    // A later read does not regress the started message.
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [] },
    } as never);
    // With both messages dated, the next read is a since= delta.
    vi.mocked(platformClient.getMessages).mockResolvedValue(
      okResponse([started]) as never
    );
    await refresh();
    await waitFor(() =>
      expect(projectsClient.getQueuedConversationInputs).toHaveBeenCalledTimes(3)
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.orderedData.map(({ id }) => id)).toEqual([
      "recent",
      "race",
    ]);
    expect(result.current.undatedInputs).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(platformClient.getMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ since: "recent" }),
      requestOptions
    );
    expect(platformClient.getMessage).not.toHaveBeenCalled();
  });

  it("keeps confirmed local submissions out of the canonical undated inputs", async () => {
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [] },
    } as never);
    vi.mocked(platformClient.getMessages).mockResolvedValue(
      historyResponse([buildMessage({ id: "recent" })]) as never
    );
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useConversationMessages("org-1", "proj-1", "conv-1"),
      { wrapper: createWrapper(queryClient) }
    );
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    const confirmed = {
      ...buildMessage({
        id: "local-confirmed",
        type: "USER",
        executionStatus: "queued",
        executionQueueConfirmed: true,
      }),
      createdAt: null,
    } as unknown as MessageResponseDto;
    try {
      act(() => {
        beginOptimisticInput("local-operation", {
          organizationId: "org-1",
          projectId: "proj-1",
          conversationId: "conv-1",
          agentSessionId: "session",
          machineId: "machine",
          intent: {
            projectId: "proj-1",
            conversationId: "conv-1",
            parentMessageId: null,
            data: { comment: "Local" },
          },
        });
        confirmOptimisticInput("local-operation", confirmed);
      });
      // Temporary content stays outside canonical reads; previews own it.
      expect(result.current.undatedInputs).toEqual([]);
      expect(result.current.orderedData.map(({ id }) => id)).toEqual([
        "recent",
      ]);
    } finally {
      act(() => removeOptimisticInput("local-operation"));
    }
  });
});
