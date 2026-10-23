import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionConfig } from "../../../services/webSocketService";
import axios from "axios";
import { createApiRuntime, registerApiRuntime } from "../../../clients";
import { useOpenItems } from "../useOpenItems";

const transport = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("../../../contexts/WebSocketContext", () => ({
  useOptionalWebSocketContext: () => ({
    service: transport,
    isAuthenticated: true,
  }),
}));

const canonical = (revision: number) => ({
  state: "PRESENT" as const,
  revision,
  items: [],
  groups: [],
});
const response = (revision: number) => ({
  data: { data: canonical(revision) },
});
function setup() {
  const scope = {
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  };
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const runtime = createApiRuntime({
    baseUrl: "/api/v1",
    transport: {
      axios: axios.create(),
      request: vi.fn(),
      setAuthToken: vi.fn(),
    },
  });
  registerApiRuntime(runtime);
  const openItemsClient = runtime.clients.openItems;
  const read = vi
    .spyOn(openItemsClient, "getOpenItems")
    .mockResolvedValue(
      response(1) as Awaited<
        ReturnType<
          typeof import("../../../api").OpenItemsApi.prototype.getOpenItems
        >
      >,
    );
  return { scope, wrapper, read };
}

describe("Open Items visible-screen synchronization", () => {
  beforeEach(() => {
    localStorage.clear();
    transport.subscribe
      .mockReset()
      .mockImplementation((config: SubscriptionConfig) => {
        queueMicrotask(() =>
          config.events?.onOpenItemsRoomJoined?.(
            config.openItemsProjectIds![0]!,
          ),
        );
        return "open-items-subscription";
      });
    transport.unsubscribe.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps a hidden tab silent and reads canonical state when shown", async () => {
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const { scope, wrapper, read } = setup();
    const { result, unmount } = renderHook(() => useOpenItems(scope), {
      wrapper,
    });
    expect(read).not.toHaveBeenCalled();
    expect(transport.subscribe).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() =>
      expect(result.current.collection).toEqual(canonical(1)),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(transport.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ openItemsProjectIds: [scope.projectId] }),
    );
    const config = transport.subscribe.mock.calls[0]![0] as SubscriptionConfig;
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(transport.unsubscribe).toHaveBeenCalledWith(
      "open-items-subscription",
    );
    const reads = read.mock.calls.length;
    act(() =>
      config.events!.onOpenItemsChanged!({
        type: "open_items.changed",
        projectId: scope.projectId,
        revision: 2,
      }),
    );
    expect(read.mock.calls.length).toBe(reads);
    read.mockResolvedValue(
      response(2) as Awaited<
        ReturnType<
          typeof import("../../../api").OpenItemsApi.prototype.getOpenItems
        >
      >,
    );
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() =>
      expect(result.current.collection).toEqual(canonical(2)),
    );
    unmount();
  });

  it("reads on a newer second-screen signal and an acknowledged reconnect, ignoring old and other-project signals", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { scope, wrapper, read } = setup();
    const { result, unmount } = renderHook(() => useOpenItems(scope), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.collection).toEqual(canonical(1)),
    );
    const config = transport.subscribe.mock.calls[0]![0] as SubscriptionConfig;
    const reads = read.mock.calls.length;
    act(() => {
      config.events!.onOpenItemsChanged!({
        type: "open_items.changed",
        projectId: scope.projectId,
        revision: 1,
      });
      config.events!.onOpenItemsChanged!({
        type: "open_items.changed",
        projectId: "other",
        revision: 9,
      });
    });
    expect(read.mock.calls.length).toBe(reads);
    read.mockResolvedValue(
      response(2) as Awaited<
        ReturnType<
          typeof import("../../../api").OpenItemsApi.prototype.getOpenItems
        >
      >,
    );
    act(() =>
      config.events!.onOpenItemsChanged!({
        type: "open_items.changed",
        projectId: scope.projectId,
        revision: 2,
      }),
    );
    await waitFor(() =>
      expect(result.current.collection).toEqual(canonical(2)),
    );
    read.mockResolvedValue(
      response(3) as Awaited<
        ReturnType<
          typeof import("../../../api").OpenItemsApi.prototype.getOpenItems
        >
      >,
    );
    act(() => config.events!.onOpenItemsRoomJoined!(scope.projectId));
    await waitFor(() =>
      expect(result.current.collection).toEqual(canonical(3)),
    );
    unmount();
  });
});
