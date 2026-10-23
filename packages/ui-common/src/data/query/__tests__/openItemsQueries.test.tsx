import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityType, type OpenItemsCollection } from "../../../api";
import type { SubscriptionConfig } from "../../../services/webSocketService";
import { openItemsKeys } from "../../collections/openItems";
import { useOpenItems } from "../../hooks/useOpenItems";
import {
  dataLayerQueryRoots,
  invalidateAllDataLayerQueries,
} from "../dataLayerInvalidation";

const mocks = vi.hoisted(() => ({
  getOpenItems: vi.fn(),
  setOpenItemNote: vi.fn(),
  resetOpenItems: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
const websocket = vi.hoisted(() => ({
  service: {
    subscribe: (...args: unknown[]) => mocks.subscribe(...args),
    unsubscribe: (...args: unknown[]) => mocks.unsubscribe(...args),
  },
  isAuthenticated: true,
}));
vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openItemsClient: {
    getOpenItems: mocks.getOpenItems,
    setOpenItemNote: mocks.setOpenItemNote,
    resetOpenItems: mocks.resetOpenItems,
  },
}));
vi.mock("../../../contexts/WebSocketContext", () => ({
  useOptionalWebSocketContext: () => websocket,
}));

const entityId = "550e8400-e29b-41d4-a716-446655440000";
const item = (revision: number, note = "server note") => ({
  entityType: EntityType.Task,
  entityId,
  note,
  pinned: false,
  position: "A",
  groupId: null,
  memberPosition: null,
  goalTrackedWorkFilter: "ACTIVE_AND_BACKLOG" as const,
  goalCollapsed: true,
  revision,
  lineage: [],
  presentation: { label: "Task", workItemTypeKey: "STANDARD" },
  removedAt: null,
  updatedAt: "2026-10-07T00:00:00.000Z",
});
const present = (revision: number, items = [item(1)]): OpenItemsCollection => ({
  state: "PRESENT",
  revision,
  items,
  groups: [],
});
const wrap = <T,>(data: T) => ({ data: { data } });

function setup() {
  const scope = {
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  };
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { scope, queryClient, wrapper };
}
const config = () =>
  mocks.subscribe.mock.calls.at(-1)![0] as SubscriptionConfig;
const signal = (projectId: string, revision: number) =>
  act(() =>
    config().events!.onOpenItemsChanged!({
      type: "open_items.changed",
      projectId,
      revision,
    }),
  );

describe("Open Items on TanStack Query", () => {
  let visibility: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    localStorage.clear();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.subscribe.mockImplementation((subscription: SubscriptionConfig) => {
      queueMicrotask(() =>
        subscription.events?.onOpenItemsRoomJoined?.(
          subscription.openItemsProjectIds![0]!,
        ),
      );
      return "subscription";
    });
    mocks.getOpenItems.mockResolvedValue(wrap(present(1)));
    visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
  });
  afterEach(() => vi.restoreAllMocks());

  it("registers one typed collection key per organization, project and user", () => {
    expect(dataLayerQueryRoots()).toContainEqual(openItemsKeys.root());
    expect(
      openItemsKeys.collection({
        organizationId: "o",
        projectId: "p",
        userId: "u",
      }),
    ).toEqual(["openItems", "o", "p", "u", "collection"]);
  });

  it("keeps a hidden tab silent, then reads exactly once when shown", async () => {
    visibility.mockReturnValue("hidden");
    const { scope, queryClient, wrapper } = setup();
    const { result } = renderHook(() => useOpenItems(scope), { wrapper });
    await act(() => Promise.resolve());
    expect(mocks.getOpenItems).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(result.current.collection).toEqual(present(1)));
    expect(mocks.getOpenItems).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(openItemsKeys.collection(scope))).toEqual(
      present(1),
    );
  });

  it("re-reads only for a newer revision of its own project", async () => {
    const { scope, wrapper } = setup();
    const { result } = renderHook(() => useOpenItems(scope), { wrapper });
    await waitFor(() => expect(result.current.collection).toEqual(present(1)));
    signal(scope.projectId, 1);
    signal("another-project", 5);
    await act(() => Promise.resolve());
    expect(mocks.getOpenItems).toHaveBeenCalledTimes(1);
    mocks.getOpenItems.mockResolvedValue(wrap(present(2)));
    signal(scope.projectId, 2);
    await waitFor(() => expect(result.current.collection).toEqual(present(2)));
    expect(mocks.getOpenItems).toHaveBeenCalledTimes(2);
  });

  it("writes mutation responses into the query cache and ignores the tab's own signal", async () => {
    const { scope, queryClient, wrapper } = setup();
    const { result } = renderHook(() => useOpenItems(scope), { wrapper });
    await waitFor(() => expect(result.current.collection).toEqual(present(1)));
    mocks.setOpenItemNote.mockResolvedValue(
      wrap({
        collectionRevision: 2,
        items: [item(2, "Saved")],
        groups: [],
        deletedGroupIds: [],
        replayed: false,
      }),
    );
    await act(() =>
      result.current.adapter.mutate({
        kind: "setOpenItemNote",
        parameters: {
          entityType: EntityType.Task,
          entityId,
          setOpenItemNoteRequest: { idempotencyKey: "note", note: "Saved" },
        },
      }),
    );
    expect(queryClient.getQueryData(openItemsKeys.collection(scope))).toEqual(
      present(2, [item(2, "Saved")]),
    );
    expect(result.current.record.items[0]?.whyOpen).toBe("Saved");
    signal(scope.projectId, 2);
    await act(() => Promise.resolve());
    expect(mocks.getOpenItems).toHaveBeenCalledTimes(1);
  });

  it("replaces a cached collection with an empty server collection and serves the cache only as stale placeholder", async () => {
    const { scope, queryClient, wrapper } = setup();
    localStorage.setItem(
      `open-items:cache:v2:${scope.userId}:${scope.organizationId}:${scope.projectId}`,
      JSON.stringify({ version: 2, collection: present(1), preferences: {} }),
    );
    let finish!: (value: unknown) => void;
    mocks.getOpenItems.mockImplementation(
      () => new Promise((done) => (finish = done)),
    );
    const { result } = renderHook(() => useOpenItems(scope), { wrapper });
    expect(result.current.collection).toEqual(present(1));
    expect(result.current.stale).toBe(true);
    expect(queryClient.getQueryData(openItemsKeys.collection(scope))).toBe(
      undefined,
    );
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => finish(wrap(present(4, []))));
    await waitFor(() =>
      expect(result.current.collection).toEqual(present(4, [])),
    );
    expect(result.current.stale).toBe(false);
    expect(result.current.record.items).toEqual([]);
  });

  it("leaves the reconnect read to the hook: central invalidation only marks Open Items stale", async () => {
    const { scope, queryClient, wrapper } = setup();
    const { result } = renderHook(() => useOpenItems(scope), { wrapper });
    await waitFor(() => expect(result.current.collection).toEqual(present(1)));
    await act(() => invalidateAllDataLayerQueries(queryClient));
    expect(mocks.getOpenItems).toHaveBeenCalledTimes(1);
    expect(result.current.stale).toBe(true);
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => expect(mocks.getOpenItems).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.stale).toBe(false));
  });
});
