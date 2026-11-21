import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore } from "jotai/vanilla";
import { WebSocketHandler } from "../../websockets/handler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectsClient } from "../../../clients/serviceClients";
import {
  FakeConversationServer,
  threadOf,
} from "../../../test/conversationGraphQL";
import { resetConversationMessageHistoryStateForTests } from "../../collections/conversationMessageHistoryState";
import { useConversationMessages } from "../useConversationMessages";

vi.mock("../../../clients/serviceClients", () => ({
  projectsClient: {
    getQueuedConversationInputs: vi.fn(async () => ({ data: { data: [] } })),
  },
}));

vi.mock("../../../utils/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const ids = (messages: readonly { id: string }[]) =>
  messages.map((message) => message.id);

const loadOlderAndWait = async (
  result: { current: ReturnType<typeof useConversationMessages> },
  oldestId: string,
) => {
  await act(() => result.current.loadOlder());
  await waitFor(() =>
    expect(ids(result.current.orderedData)[0]).toBe(oldestId),
  );
};

const mountThread = (server: FakeConversationServer) =>
  renderHook(
    () => useConversationMessages("org-1", "project-1", server.conversationId),
    { wrapper: server.wrapper },
  );

describe("useConversationMessages over GraphQL", () => {
  beforeEach(() => {
    resetConversationMessageHistoryStateForTests();
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [] },
    } as never);
  });

  it("opens with the eight newest messages, oldest first, and offers older ones", async () => {
    const server = new FakeConversationServer(threadOf(20));
    const { result } = mountThread(server);

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(ids(result.current.orderedData)).toEqual([
      "m13",
      "m14",
      "m15",
      "m16",
      "m17",
      "m18",
      "m19",
      "m20",
    ]);
    expect(result.current.hasOlder).toBe(true);
    expect(server.received("GetConversationMessageHistory")).toEqual([
      { id: "conv-1", last: 8 },
    ]);
  });

  it("adds each older page above the loaded ones until none remain", async () => {
    const server = new FakeConversationServer(threadOf(20));
    const { result } = mountThread(server);
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(() => result.current.loadOlder());
    await waitFor(() =>
      expect(ids(result.current.orderedData)).toEqual(
        threadOf(20)
          .slice(4)
          .map((m) => m.id),
      ),
    );
    expect(result.current.hasOlder).toBe(true);

    await act(() => result.current.loadOlder());
    await waitFor(() =>
      expect(ids(result.current.orderedData)).toEqual(
        threadOf(20).map((m) => m.id),
      ),
    );
    expect(result.current.hasOlder).toBe(false);
    expect(new Set(ids(result.current.orderedData)).size).toBe(20);
  });

  it("keeps loaded older history when a live message arrives", async () => {
    const server = new FakeConversationServer(threadOf(20));
    const { result } = mountThread(server);
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await loadOlderAndWait(result, "m5");

    server.append(...threadOf(22).slice(20));
    await act(() => result.current.refetch());
    await waitFor(() =>
      expect(ids(result.current.orderedData)).toContain("m22"),
    );

    expect(ids(result.current.orderedData)).toEqual(
      threadOf(22)
        .slice(4)
        .map((m) => m.id),
    );
    expect(result.current.hasOlder).toBe(true);
    // The refresh asked only for what is newer than the delta cursor.
    expect(server.received("GetConversationMessages")).toEqual([
      { id: "conv-1", after: "m19" },
    ]);
  });

  it("keeps older history and its continuation when focus refreshes the thread", async () => {
    const server = new FakeConversationServer(threadOf(20));
    const { result } = mountThread(server);
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await loadOlderAndWait(result, "m5");

    server.append(...threadOf(21).slice(20));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() =>
      expect(ids(result.current.orderedData)).toContain("m21"),
    );

    expect(ids(result.current.orderedData)[0]).toBe("m5");
    expect(result.current.hasOlder).toBe(true);
    await loadOlderAndWait(result, "m1");
  });

  it("recovers from a rejected delta cursor without dropping older history", async () => {
    const server = new FakeConversationServer(threadOf(20));
    const { result } = mountThread(server);
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await loadOlderAndWait(result, "m5");

    // The cursor message m19 is gone, so the delta is rejected.
    server.remove("m19");
    server.append(...threadOf(21).slice(20));
    await act(() => result.current.refetch());
    await waitFor(() =>
      expect(ids(result.current.orderedData)).toContain("m21"),
    );

    expect(result.current.error).toBeNull();
    expect(server.received("GetConversationMessages")).toHaveLength(1);
    expect(ids(result.current.orderedData)).toEqual([
      ...threadOf(18)
        .slice(4)
        .map((m) => m.id),
      "m20",
      "m21",
    ]);
    expect(result.current.hasOlder).toBe(true);
  });

  it("recovers backward across disjoint pages after the delta cursor is rejected", async () => {
    const server = new FakeConversationServer(threadOf(8));
    const { result } = mountThread(server);
    await waitFor(() => expect(result.current.isReady).toBe(true));

    server.remove("m7");
    server.append(...threadOf(25).slice(8));
    await act(() => result.current.refetch());

    expect(result.current.error).toBeNull();
    expect(ids(result.current.orderedData)).toEqual(ids(server.thread));
    expect(result.current.hasOlder).toBe(false);
    expect(server.received("GetConversationMessages")).toEqual([
      { id: "conv-1", after: "m7" },
    ]);
    expect(server.received("GetConversationMessageHistory")).toEqual([
      { id: "conv-1", last: 8 },
      { id: "conv-1", last: 8 },
      { id: "conv-1", last: 8, before: "m18" },
      { id: "conv-1", last: 8, before: "m10" },
    ]);
  });

  it("clears the thread on reconnect when all messages were deleted while disconnected", async () => {
    const server = new FakeConversationServer(threadOf(8));
    const { result } = mountThread(server);
    await waitFor(() => expect(result.current.orderedData).toHaveLength(8));
    const handler = new WebSocketHandler(
      createStore(),
      undefined,
      server.queryClient,
      server.graphql.apollo,
    );

    server.thread = [];
    act(() => handler.markAllStale());

    await waitFor(() => expect(result.current.orderedData).toEqual([]));
    expect(result.current.hasOlder).toBe(false);
  });

  it("shows the same thread to every view of the conversation", async () => {
    const server = new FakeConversationServer(threadOf(10));
    const first = mountThread(server);
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    await loadOlderAndWait(first.result, "m1");

    const second = mountThread(server);
    await waitFor(() => expect(second.result.current.isReady).toBe(true));

    expect(ids(second.result.current.orderedData)).toEqual(
      ids(first.result.current.orderedData),
    );
  });
});
