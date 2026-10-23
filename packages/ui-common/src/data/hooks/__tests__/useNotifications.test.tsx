import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NotificationDto,
  WebSocketSystemNotificationEvent,
} from "../../../api";
import {
  notificationKeys,
  toNotificationListParams,
} from "../../collections/notifications";
import { dataLayerQueryRoots } from "../../query/dataLayerInvalidation";
import { WebSocketHandler } from "../../websockets/handler";
import {
  useNotificationPreferences,
  useNotifications,
} from "../useNotifications";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  acknowledge: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  webSocketService: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notificationsClient: {
    listNotifications: mocks.list,
    markNotificationRead: mocks.markRead,
    markNotificationUnread: mocks.markUnread,
    acknowledgeNotification: mocks.acknowledge,
    getUserNotificationPreferences: mocks.getPreferences,
    updateUserNotificationPreferences: mocks.updatePreferences,
  },
}));

vi.mock("../../../contexts/WebSocketContext", () => ({
  useOptionalWebSocketService: mocks.webSocketService,
}));

const dto = (overrides: Partial<NotificationDto> = {}): NotificationDto =>
  ({
    id: "n-1",
    eventType: "report.created",
    entityId: "report-1",
    entityType: "REPORT",
    entityTitle: "Release Readiness Report",
    affectedEntities: [],
    payload: { nextSteps: [], verificationTasks: [], recommendedUpdates: [] },
    createdAt: "2026-03-03T10:00:00.000Z",
    status: "unread",
    ...overrides,
  } as NotificationDto);

const listResponse = (items: NotificationDto[]) => ({
  data: { data: items },
  headers: { "x-total-count": String(items.length) },
});

const preferences = (updatedAt: string) => ({
  userId: "user-1",
  organizationId: "org-1",
  subscriptions: [],
  updatedAt,
});

const pushEvent = (
  notification: NotificationDto,
  userId = "user-1"
): WebSocketSystemNotificationEvent =>
  ({
    type: "system.notification",
    timestamp: "2026-03-03T10:05:00.000Z",
    organizationId: "org-1",
    userId,
    notification,
    delivery: { channel: "in-app" },
    clientHints: {},
  } as unknown as WebSocketSystemNotificationEvent);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const handler = new WebSocketHandler(createStore(), undefined, client);
  return { client, wrapper, handler };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.webSocketService.mockReturnValue({
    getState: () => ({
      connectionError: null,
      isAuthenticated: true,
      isConnected: true,
    }),
    onStateChange: vi.fn(() => vi.fn()),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  });
  mocks.list.mockResolvedValue(listResponse([dto()]));
  mocks.getPreferences.mockResolvedValue({
    data: { data: preferences("2026-03-03T10:00:00.000Z") },
  });
});

describe("useNotifications", () => {
  it("shares one read per key across consumers and remounts", async () => {
    const { wrapper } = setup();
    const read = () => ({
      a: useNotifications("org-1", { userId: "user-1" }),
      b: useNotifications("org-1", { userId: "user-1" }),
      prefsA: useNotificationPreferences("org-1", "user-1"),
      prefsB: useNotificationPreferences("org-1", "user-1"),
    });
    const first = renderHook(read, { wrapper });
    expect(first.result.current.a.isLoading).toBe(true);
    expect(first.result.current.a.error).toBeNull();

    await waitFor(() => {
      expect(first.result.current.a.isReady).toBe(true);
      expect(first.result.current.prefsB.isReady).toBe(true);
    });
    expect(first.result.current.b.notifications).toHaveLength(1);
    expect(first.result.current.a.unreadCount).toBe(1);
    first.unmount();

    const next = renderHook(read, { wrapper });
    expect(next.result.current.a.notifications).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.getPreferences).toHaveBeenCalledTimes(1);
  });

  it("reports a disabled read as neither loading nor failed, and empty only after success", async () => {
    const { wrapper } = setup();
    const disabled = renderHook(() => useNotifications(undefined), { wrapper });
    expect(disabled.result.current.error).toBeNull();
    expect(disabled.result.current.isFetched).toBe(false);
    expect(mocks.list).not.toHaveBeenCalled();

    mocks.list.mockResolvedValueOnce(listResponse([]));
    const empty = renderHook(() => useNotifications("org-1"), { wrapper });
    expect(empty.result.current.isReady).toBe(false);
    await waitFor(() => expect(empty.result.current.isReady).toBe(true));
    expect(empty.result.current.notifications).toEqual([]);
  });

  it("surfaces an error only after the read fails", async () => {
    const { wrapper } = setup();
    mocks.list.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 })
    );
    const { result } = renderHook(() => useNotifications("org-1"), {
      wrapper,
    });
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isReady).toBe(false);
  });

  it("upserts pushed notifications by id through the central handler with one follow-up read", async () => {
    const { wrapper, handler, client } = setup();
    const service = mocks.webSocketService();
    const { result } = renderHook(
      () => useNotifications("org-1", { userId: "user-1" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    const refresh = deferred<ReturnType<typeof listResponse>>();
    mocks.list.mockReturnValueOnce(refresh.promise);
    const pushed = dto({ id: "n-2", createdAt: "2026-03-03T10:04:00.000Z" });
    act(() => handler.handleEvent(pushEvent(pushed)));
    await waitFor(() =>
      expect(result.current.notifications.map((n) => n.notificationId)).toEqual(
        ["n-2", "n-1"]
      )
    );
    await act(async () => {
      refresh.resolve(listResponse([pushed, dto()]));
      await refresh.promise;
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(mocks.list).toHaveBeenCalledTimes(2);

    // A repeated delivery replaces the entry by id rather than appending.
    mocks.list.mockResolvedValueOnce(listResponse([pushed, dto()]));
    act(() => handler.handleEvent(pushEvent(pushed)));
    expect(
      client.getQueryData<{ records: unknown[] }>(
        notificationKeys.list(
          "org-1",
          toNotificationListParams({ userId: "user-1" })
        )
      )?.records
    ).toHaveLength(2);
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.notifications).toHaveLength(2);
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(service.subscribe).not.toHaveBeenCalled();
  });

  it("ignores pushed notifications for another user", async () => {
    const { wrapper, handler } = setup();
    const { result } = renderHook(
      () => useNotifications("org-1", { userId: "user-1" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    act(() => handler.handleEvent(pushEvent(dto({ id: "n-9" }), "user-2")));
    expect(result.current.notifications).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("marks read optimistically and removes it from an unread-filtered list", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        all: useNotifications("org-1"),
        unread: useNotifications("org-1", { status: "unread" }),
      }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.unread.isReady).toBe(true));

    const response = deferred<{ data: NotificationDto }>();
    mocks.markRead.mockReturnValueOnce(response.promise);
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.all.markRead("n-1");
    });

    await waitFor(() => {
      expect(result.current.all.notifications[0]?.isRead).toBe(true);
      expect(result.current.unread.notifications).toHaveLength(0);
    });
    await act(async () => {
      response.resolve({
        data: dto({ status: "read", readAt: "2026-03-03T10:06:00.000Z" }),
      });
      await done;
    });
    await waitFor(() =>
      expect(result.current.all.notifications[0]?.readAt).toBe(
        "2026-03-03T10:06:00.000Z"
      )
    );
    expect(result.current.all.unreadCount).toBe(0);
  });

  it("rolls back an optimistic status change when the request fails", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useNotifications("org-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    const response = deferred<{ data: NotificationDto }>();
    mocks.markRead.mockReturnValueOnce(response.promise);
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.markRead("n-1").catch((error) => error);
    });
    await waitFor(() =>
      expect(result.current.notifications[0]?.isRead).toBe(true)
    );

    await act(async () => {
      response.reject(new Error("boom"));
      expect(await done).toBeInstanceOf(Error);
    });
    await waitFor(() =>
      expect(result.current.notifications[0]?.isRead).toBe(false)
    );
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("marks unread over a newer cached read version", async () => {
    const { wrapper } = setup();
    mocks.list.mockResolvedValueOnce(
      listResponse([
        dto({ status: "read", readAt: "2026-03-03T10:30:00.000Z" }),
      ])
    );
    mocks.markUnread.mockResolvedValueOnce({ data: dto() });
    const { result } = renderHook(() => useNotifications("org-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await result.current.markUnread("n-1");
    });
    await waitFor(() =>
      expect(result.current.notifications[0]?.isRead).toBe(false)
    );
  });

  it("registers the notifications root for reconnect invalidation", () => {
    expect(dataLayerQueryRoots()).toContainEqual(notificationKeys.root());
  });
});

describe("useNotificationPreferences", () => {
  it("updates optimistically and stores the server response", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useNotificationPreferences("org-1", "user-1"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    const subscriptions = [{ channel: "email", eventTypes: [] }] as never;
    const response = deferred<unknown>();
    mocks.updatePreferences.mockReturnValueOnce(response.promise);
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.update({ subscriptions });
    });
    await waitFor(() =>
      expect(result.current.data?.subscriptions).toEqual(subscriptions)
    );

    await act(async () => {
      response.resolve({
        data: {
          data: {
            ...preferences("2026-03-03T11:00:00.000Z"),
            subscriptions,
          },
        },
      });
      await done;
    });
    await waitFor(() =>
      expect(result.current.data?.updatedAt).toBe("2026-03-03T11:00:00.000Z")
    );
    expect(mocks.getPreferences).toHaveBeenCalledTimes(1);
  });

  it("restores preferences when the update fails", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useNotificationPreferences("org-1", "user-1"),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));

    mocks.updatePreferences.mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      await expect(
        result.current.update({ subscriptions: [{}] as never })
      ).rejects.toThrow("boom");
    });
    await waitFor(() => expect(result.current.data?.subscriptions).toEqual([]));
  });

  it("returns null on refetch when identifiers are missing", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useNotificationPreferences(undefined, "user-1"),
      { wrapper }
    );
    await expect(result.current.refetch()).resolves.toBeNull();
    expect(mocks.getPreferences).not.toHaveBeenCalled();
  });
});
