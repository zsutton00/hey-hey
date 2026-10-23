import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageStatus, type MessageRecordDto } from "../../../api";
import { conversationKeys } from "../../collections/conversations";
import { resetConversationMessageHistoryStateForTests } from "../../collections/conversationMessageHistoryState";
import { messageKeys } from "../../collections/messages";
import { useConversation } from "../../hooks/useConversation";
import { useConversationMessages } from "../../hooks/useConversationMessages";
import { useLatestMessage } from "../../hooks/useLatestMessage";
import { WebSocketHandler } from "../../websockets/handler";

const mocks = vi.hoisted(() => ({
  getMessages: vi.fn(),
  getConversation: vi.fn(),
  getLatestMessage: vi.fn(),
  getMessage: vi.fn(),
  getQueuedConversationInputs: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  platformClient: {
    getMessages: mocks.getMessages,
    getConversation: mocks.getConversation,
    getLatestMessage: mocks.getLatestMessage,
    getMessage: mocks.getMessage,
  },
  projectsClient: {
    getQueuedConversationInputs: mocks.getQueuedConversationInputs,
  },
}));
vi.mock("../../hooks/useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

const ORG = "org";
const PROJECT = "project";
const CID = "conversation";

const message = (
  id: string,
  minute: number,
  status: MessageStatus = MessageStatus.Completed
): MessageRecordDto =>
  ({
    id,
    conversationId: CID,
    type: "SYSTEM",
    status,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    parentMessageId: null,
    data: {},
  }) as unknown as MessageRecordDto;

const historyPage = (messages: MessageRecordDto[], nextCursor?: string) => ({
  data: { data: { messages, nextCursor } },
});
const delta = (messages: MessageRecordDto[]) => ({ data: { data: messages } });
const notFound = () =>
  Object.assign(new Error("Not Found"), {
    isAxiosError: true,
    response: { status: 404 },
  });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
const clientWrapper =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <Provider store={createStore()}>{children}</Provider>
    </QueryClientProvider>
  );

const conversationUpdated = () =>
  ({
    type: "conversation.updated",
    timestamp: new Date().toISOString(),
    organizationId: ORG,
    projectId: PROJECT,
    conversationId: CID,
  }) as unknown as Parameters<WebSocketHandler["handleEvent"]>[0];

const sinceOf = (call: unknown[]) =>
  (call[0] as { since?: string }).since ?? null;

const initial = [
  message("m1", 1),
  message("m2", 2),
  message("m3", 3),
  message("m4", 4, MessageStatus.Open),
];

beforeEach(() => {
  vi.resetAllMocks();
  resetConversationMessageHistoryStateForTests();
  mocks.getQueuedConversationInputs.mockResolvedValue({ data: { data: [] } });
  mocks.getConversation.mockResolvedValue({
    data: { data: { id: CID, createdAt: "2026-01-01T00:00:00.000Z" } },
  });
});

describe("shared conversation reads", () => {
  it("issues one read per key however many components show the conversation", async () => {
    mocks.getMessages.mockResolvedValue(historyPage(initial));
    const client = createClient();

    const { result } = renderHook(
      () => ({
        timeline: useConversationMessages(ORG, PROJECT, CID),
        sidebar: useConversationMessages(ORG, PROJECT, CID),
        latest: useLatestMessage(ORG, PROJECT, CID),
        header: useConversation(ORG, PROJECT, { conversationId: CID }),
        panel: useConversation(ORG, PROJECT, { conversationId: CID }),
      }),
      { wrapper: clientWrapper(client) }
    );

    await waitFor(() => {
      expect(result.current.timeline.isReady).toBe(true);
      expect(result.current.header.isReady).toBe(true);
    });

    expect(mocks.getMessages).toHaveBeenCalledTimes(1);
    expect(mocks.getQueuedConversationInputs).toHaveBeenCalledTimes(1);
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    // The latest message is a projection of the loaded list.
    expect(mocks.getLatestMessage).not.toHaveBeenCalled();
    expect(result.current.latest.data?.id).toBe("m4");
    // Both consumers render the same cached message objects.
    result.current.sidebar.orderedData.forEach((entry, index) =>
      expect(entry).toBe(result.current.timeline.orderedData[index])
    );
  });

  it("reads the latest-message endpoint only when no list is loaded", async () => {
    mocks.getLatestMessage.mockResolvedValue({ data: { data: initial[3] } });
    const client = createClient();

    const { result } = renderHook(() => useLatestMessage(ORG, PROJECT, CID), {
      wrapper: clientWrapper(client),
    });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.data?.id).toBe("m4");
    expect(mocks.getLatestMessage).toHaveBeenCalledTimes(1);
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });
});

describe("realtime message updates", () => {
  it("one conversation.updated causes exactly one since-cursor read and keeps unchanged messages", async () => {
    mocks.getMessages.mockResolvedValueOnce(historyPage(initial));
    const client = createClient();
    const { result } = renderHook(
      () => ({
        timeline: useConversationMessages(ORG, PROJECT, CID),
        other: useConversationMessages(ORG, PROJECT, CID),
        header: useConversation(ORG, PROJECT, { conversationId: CID }),
      }),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(result.current.timeline.isReady).toBe(true));
    const before = result.current.timeline.orderedData;

    const finished = message("m4", 4);
    const reply = message("m5", 5);
    mocks.getMessages.mockResolvedValueOnce(
      delta([message("m3", 3), finished, reply])
    );
    const handler = new WebSocketHandler(createStore(), undefined, client);
    await act(async () => {
      handler.handleEvent(conversationUpdated());
    });

    await waitFor(() =>
      expect(result.current.timeline.orderedData.map((m) => m.id)).toEqual([
        "m1",
        "m2",
        "m3",
        "m4",
        "m5",
      ])
    );
    expect(mocks.getMessages).toHaveBeenCalledTimes(2);
    // Cursor backs up one terminal message before the oldest non-terminal.
    expect(sinceOf(mocks.getMessages.mock.calls[1])).toBe("m2");
    // conversation.updated does not re-read the envelope.
    expect(mocks.getConversation).toHaveBeenCalledTimes(1);
    expect(result.current.timeline.orderedData[0]).toBe(before[0]);
    expect(result.current.timeline.orderedData[3].status).toBe(MessageStatus.Completed);

    // No repeat cluster after the read settles.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.getMessages).toHaveBeenCalledTimes(2);
  });

  it("falls back to one recent-page read when the cursor is rejected with 404", async () => {
    mocks.getMessages.mockResolvedValueOnce(historyPage(initial));
    const client = createClient();
    const { result } = renderHook(
      () => useConversationMessages(ORG, PROJECT, CID),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    mocks.getMessages
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce(historyPage([message("m4", 4), message("m5", 5)]));
    const handler = new WebSocketHandler(createStore(), undefined, client);
    await act(async () => {
      handler.handleEvent(conversationUpdated());
    });

    await waitFor(() =>
      expect(result.current.orderedData.map((m) => m.id)).toEqual([
        "m1",
        "m2",
        "m3",
        "m4",
        "m5",
      ])
    );
    expect(mocks.getMessages).toHaveBeenCalledTimes(3);
    expect(sinceOf(mocks.getMessages.mock.calls[1])).toBe("m2");
    expect(mocks.getMessages.mock.calls[2][0]).toMatchObject({
      mode: "REVERSE_HISTORY",
    });
    expect(result.current.error).toBeNull();
  });

  it("follows an invalidation that arrives mid-read with a read that starts after it", async () => {
    mocks.getMessages.mockResolvedValueOnce(historyPage(initial));
    const client = createClient();
    const { result } = renderHook(
      () => useConversationMessages(ORG, PROJECT, CID),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    const stale = deferred<ReturnType<typeof delta>>();
    mocks.getMessages
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(delta([message("m4", 4), message("m5", 5)]));
    const handler = new WebSocketHandler(createStore(), undefined, client);

    await act(async () => {
      handler.handleEvent(conversationUpdated());
    });
    await waitFor(() => expect(mocks.getMessages).toHaveBeenCalledTimes(2));
    await act(async () => {
      handler.handleEvent(conversationUpdated());
    });
    await waitFor(() => expect(mocks.getMessages).toHaveBeenCalledTimes(3));
    // The earlier response lands late and must not be the final state.
    stale.resolve(delta([message("m4", 4, MessageStatus.Open)]));

    await waitFor(() =>
      expect(result.current.orderedData.map((m) => m.id)).toContain("m5")
    );
    expect(result.current.orderedData.find((m) => m.id === "m4")?.status).toBe(
      MessageStatus.Completed
    );
    expect(
      client.getQueryState(messageKeys.list(ORG, PROJECT, CID))?.fetchStatus
    ).toBe("idle");
  });

  it("invalidates both message reads and every conversation dataset on reconnect", async () => {
    const client = createClient();
    client.setQueryData(messageKeys.list(ORG, PROJECT, CID), initial);
    client.setQueryData(conversationKeys.envelope(ORG, PROJECT, CID), {
      id: CID,
    });
    const handler = new WebSocketHandler(createStore(), undefined, client);

    handler.markAllStale();

    expect(
      client.getQueryState(messageKeys.list(ORG, PROJECT, CID))?.isInvalidated
    ).toBe(true);
    expect(
      client.getQueryState(conversationKeys.envelope(ORG, PROJECT, CID))
        ?.isInvalidated
    ).toBe(true);
  });
});

describe("remount", () => {
  it("re-reads once with the since cursor after the last view unmounts", async () => {
    mocks.getMessages.mockResolvedValueOnce(historyPage(initial));
    const client = createClient();
    const first = renderHook(
      () => useConversationMessages(ORG, PROJECT, CID),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    first.unmount();
    await waitFor(() =>
      expect(
        client.getQueryState(messageKeys.list(ORG, PROJECT, CID))?.isInvalidated
      ).toBe(true)
    );

    mocks.getMessages.mockResolvedValueOnce(
      delta([message("m4", 4), message("m5", 5)])
    );
    const second = renderHook(
      () => ({
        a: useConversationMessages(ORG, PROJECT, CID),
        b: useConversationMessages(ORG, PROJECT, CID),
      }),
      { wrapper: clientWrapper(client) }
    );
    // Cached messages show immediately while the read runs.
    expect(second.result.current.a.orderedData).toHaveLength(4);
    await waitFor(() =>
      expect(second.result.current.a.orderedData.map((m) => m.id)).toContain(
        "m5"
      )
    );
    expect(mocks.getMessages).toHaveBeenCalledTimes(2);
    expect(sinceOf(mocks.getMessages.mock.calls[1])).toBe("m2");
  });
});

describe("message history", () => {
  it("merges an older page into the cached list without re-reading recent messages", async () => {
    mocks.getMessages.mockResolvedValueOnce(
      historyPage(initial.slice(2), "older")
    );
    const client = createClient();
    const { result } = renderHook(
      () => useConversationMessages(ORG, PROJECT, CID),
      { wrapper: clientWrapper(client) }
    );
    await waitFor(() => expect(result.current.hasOlder).toBe(true));

    mocks.getMessages.mockResolvedValueOnce(historyPage(initial.slice(0, 2)));
    await act(async () => {
      await result.current.loadOlder();
    });

    expect(result.current.orderedData.map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
    expect(mocks.getMessages.mock.calls[1][0]).toMatchObject({
      historyCursor: "older",
    });
    expect(result.current.hasOlder).toBe(false);
  });
});

describe("read lifecycle", () => {
  it("reports a disabled read as unstarted, not failed", () => {
    const { result } = renderHook(
      () => useConversationMessages(ORG, PROJECT, undefined),
      { wrapper: clientWrapper(createClient()) }
    );
    expect(result.current.error).toBeNull();
    expect(result.current.isFetched).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it("reports empty only after a successful read with no messages", async () => {
    const pending = deferred<ReturnType<typeof historyPage>>();
    mocks.getMessages.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(
      () => useConversationMessages(ORG, PROJECT, CID),
      { wrapper: clientWrapper(createClient()) }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();

    pending.resolve(historyPage([]));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.orderedData).toEqual([]);
  });

  it("reports failure only after a settled read, without retrying a 404", async () => {
    mocks.getMessages.mockRejectedValue(notFound());
    const { result } = renderHook(
      () => useConversationMessages(ORG, PROJECT, CID),
      { wrapper: clientWrapper(createClient()) }
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.name).toBe(
      "ConversationMessagesNotFoundError"
    );
    expect(result.current.isReady).toBe(false);
    expect(mocks.getMessages).toHaveBeenCalledTimes(1);
  });
});
