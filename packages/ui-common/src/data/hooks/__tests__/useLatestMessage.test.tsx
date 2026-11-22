import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  FakeConversationServer,
  threadOf,
} from "../../../test/conversationGraphQL";
import { useConversationMessages } from "../useConversationMessages";
import { useLatestMessage } from "../useLatestMessage";

vi.mock("../../../clients/serviceClients", () => ({
  projectsClient: {
    getQueuedConversationInputs: vi.fn(async () => ({ data: { data: [] } })),
  },
}));

vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

import { useWebsocketSubscriptions } from "../useWebsocketSubscriptions";

const mockUseWebsocketSubscriptions = useWebsocketSubscriptions as Mock;

describe("useLatestMessage", () => {
  let server: FakeConversationServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new FakeConversationServer(threadOf(3));
  });

  it("reads the newest dated message of the conversation", async () => {
    // An undated queued input never counts as the latest.
    server.append({ id: "queued", createdAt: null });
    const { result } = renderHook(
      () => useLatestMessage("org-1", "project-1", "conv-1"),
      { wrapper: server.wrapper },
    );

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.data?.id).toBe("m3");
    expect(server.received("GetLatestMessage")).toEqual([
      { conversationId: "conv-1" },
    ]);
  });

  it("does not read when conversationId is missing, and is not an error", () => {
    const { result } = renderHook(
      () => useLatestMessage("org-1", "project-1", undefined),
      { wrapper: server.wrapper },
    );

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isReady).toBe(false);
    expect(server.requests).toEqual([]);
  });

  it("subscribes to the conversation websocket room when enabled", () => {
    renderHook(() => useLatestMessage("org-1", "project-1", "conv-1"), {
      wrapper: server.wrapper,
    });

    expect(mockUseWebsocketSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({ conversationIds: ["conv-1"] }),
      { enabled: true },
    );
  });

  it("reuses the cached latest message when mounted again", async () => {
    const first = renderHook(
      () => useLatestMessage("org-1", "project-1", "conv-1"),
      { wrapper: server.wrapper },
    );
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    first.unmount();

    const { result } = renderHook(
      () =>
        useLatestMessage("org-1", "project-1", "conv-1", {
          skipInitialFetchIfCached: true,
        }),
      { wrapper: server.wrapper },
    );

    expect(result.current.data?.id).toBe("m3");
    expect(server.received("GetLatestMessage")).toHaveLength(1);
  });

  it("shows a newer message after an explicit refresh", async () => {
    const { result } = renderHook(
      () => useLatestMessage("org-1", "project-1", "conv-1"),
      { wrapper: server.wrapper },
    );
    await waitFor(() => expect(result.current.data?.id).toBe("m3"));

    server.append(...threadOf(4).slice(3));
    let refreshed: unknown;
    await act(async () => {
      refreshed = await result.current.refetch();
    });

    expect(refreshed).toMatchObject({ id: "m4" });
    await waitFor(() => expect(result.current.data?.id).toBe("m4"));
  });

  it("shares the message record with the thread view of the same conversation", async () => {
    const { result } = renderHook(
      () => ({
        thread: useConversationMessages("org-1", "project-1", "conv-1"),
        latest: useLatestMessage("org-1", "project-1", "conv-1"),
      }),
      { wrapper: server.wrapper },
    );

    await waitFor(() => {
      expect(result.current.thread.isReady).toBe(true);
      expect(result.current.latest.isReady).toBe(true);
    });

    expect(result.current.latest.data).toEqual(
      result.current.thread.orderedData.at(-1),
    );
  });
});
