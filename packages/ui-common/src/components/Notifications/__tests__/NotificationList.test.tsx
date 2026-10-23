import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationList } from "../NotificationList";

const renderInRouter = (ui: ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const useNotificationsMock = vi.fn();

vi.mock("../../../data/hooks/useNotifications", () => ({
  useNotifications: (...args: unknown[]) => useNotificationsMock(...args),
  getReadStatusLabel: (status: string) => {
    switch (status) {
      case "unread":
        return "New";
      case "read":
        return "Seen";
      case "acknowledged":
        return "Done";
      case "dismissed":
        return "Dismissed";
      default:
        return status;
    }
  },
}));

const baseNotification = {
  id: "notification-1" as never,
  notificationId: "notification-1",
  eventType: "report.created",
  reportId: "report-1",
  createdAt: "2026-03-03T10:00:00.000Z",
  status: "unread",
  readAt: null,
  acknowledgedAt: null,
  dismissedAt: null,
  affectedEntityCount: 1,
  isRead: false,
  isAcknowledged: false,
  preview: {
    title: "Report created",
    summary: "Review report output",
  },
  source: {
    id: "notification-1",
    eventType: "report.created",
    entityId: "report-1",
    entityType: "REPORT",
    entityTitle: "Release Readiness Report",
    affectedEntities: [],
    payload: {
      nextSteps: [],
      verificationTasks: [],
      recommendedUpdates: [],
    },
    createdAt: "2026-03-03T10:00:00.000Z",
    status: "unread",
  },
};

describe("NotificationList", () => {
  const acknowledge = vi.fn();
  const markBulkRead = vi.fn();
  const baseHookReturn = {
    data: {
      items: [baseNotification],
      records: [baseNotification],
      pagination: { limit: 50, offset: 0, totalCount: 1, nextOffset: null },
    },
    notifications: [baseNotification],
    records: [baseNotification],
    pagination: { limit: 50, offset: 0, totalCount: 1, nextOffset: null },
    markRead: vi.fn(),
    markUnread: vi.fn(),
    markBulkRead,
    acknowledge,
    unreadCount: 1,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    acknowledge.mockResolvedValue(undefined);
    markBulkRead.mockResolvedValue([]);
    useNotificationsMock.mockReturnValue(baseHookReturn);
  });

  it("renders notifications and triggers acknowledge on click", async () => {
    renderInRouter(<NotificationList organizationId="org-1" />);

    expect(screen.getByTestId("notification-list")).toBeInTheDocument();
    expect(
      screen.getByTestId("notification-item-notification-1")
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("notification-item-button-notification-1")
      );
    });
    expect(acknowledge).toHaveBeenCalledWith("notification-1");
  });

  it("renders loading state", () => {
    useNotificationsMock.mockReturnValueOnce({
      ...baseHookReturn,
      isLoading: true,
      notifications: [],
    });

    renderInRouter(<NotificationList organizationId="org-1" />);
    expect(screen.getByTestId("notification-list-loading")).toBeInTheDocument();
  });

  it("renders error state", () => {
    useNotificationsMock.mockReturnValueOnce({
      ...baseHookReturn,
      isLoading: false,
      error: new Error("Notification error"),
      notifications: [],
    });

    renderInRouter(<NotificationList organizationId="org-1" />);
    expect(screen.getByTestId("notification-list-error")).toBeInTheDocument();
  });
});
