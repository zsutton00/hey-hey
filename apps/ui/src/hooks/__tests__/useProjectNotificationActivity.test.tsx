import { act, renderHook } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NotificationDto,
  WebSocketSystemNotificationEvent,
} from "@hey-hey/ui-common/api";
import {
  createSessionReportDismissalChannel,
  hasShownRecord,
} from "../../utils/sessionReportToastCoordination";

type SystemNotificationHandler = (
  event: WebSocketSystemNotificationEvent,
) => void;

const hoisted = vi.hoisted(() => {
  const systemNotificationHandlers: SystemNotificationHandler[] = [];
  return {
    systemNotificationHandlers,
    fakeWebSocketService: {
      subscribe: vi.fn(
        (config: {
          events?: { onSystemNotification?: SystemNotificationHandler };
        }) => {
          const handler = config.events?.onSystemNotification;
          if (handler) {
            systemNotificationHandlers.push(handler);
          }
          return "subscription-id";
        },
      ),
      unsubscribe: vi.fn(),
    },
    dismissNotificationMock: vi.fn().mockResolvedValue(undefined),
    refetchActivityMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@hey-hey/ui-common/clients", () => ({
  notificationsClient: {
    dismissNotification: hoisted.dismissNotificationMock,
  },
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useOptionalWebSocketService: () => hoisted.fakeWebSocketService,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useCorrelatedActivity: () => ({
    records: [],
    pagination: { limit: 50, offset: 0, totalCount: null, nextOffset: null },
    isLoading: false,
    error: null,
    refetch: hoisted.refetchActivityMock,
  }),
}));

import { useProjectNotificationActivity } from "../useProjectNotificationActivity";

const buildEvent = (
  notification: NotificationDto,
): WebSocketSystemNotificationEvent =>
  ({
    type: "system.notification",
    timestamp: "2026-05-21T00:00:00.000Z",
    organizationId: "org-1",
    notification,
    delivery: {},
    clientHints: {},
  }) as unknown as WebSocketSystemNotificationEvent;

const buildSessionReportReadyNotification = (
  overrides: {
    id?: string;
    reportId?: string;
    reportType?: "DAILY_SESSION" | "IMPLEMENT";
    sessionId?: string;
  } = {},
): NotificationDto => {
  const id = overrides.id ?? "notif-1";
  const reportId = overrides.reportId ?? "report-1";
  const sessionId = overrides.sessionId ?? "session-1";
  const reportType = overrides.reportType ?? "IMPLEMENT";

  return {
    id,
    entityId: reportId,
    entityType: "AGENT_SESSION",
    entityTitle: "Coding session",
    affectedEntities: [],
    payload: {
      sessionId,
      reportId,
      sessionTitle: "Implement reports tab",
      reportTitle: "Implementation summary",
      reportType,
    },
    createdAt: "2026-05-21T00:00:00.000Z",
    status: "unread",
    readAt: null,
    acknowledgedAt: null,
    dismissedAt: null,
    eventType: "session_report_ready",
  } as unknown as NotificationDto;
};

const buildPullRequestMergedNotification = (
  overrides: { id?: string; projectId?: string; taskId?: string | null } = {},
): NotificationDto => ({
  id: overrides.id ?? "notif-pr-1",
  entityId: overrides.projectId ?? "project-1",
  entityType: "PROJECT",
  entityTitle: "Hey Hey",
  affectedEntities: [
    { type: "PROJECT", id: overrides.projectId ?? "project-1" },
  ],
  payload: {
    repositoryName: "hey-hey/ui",
    pullRequestNumber: 314,
    pullRequestTitle: "Render merge activity",
    pullRequestUrl: "https://github.com/hey-hey/ui/pull/314",
    mergedAt: "2026-08-19T05:30:00.000Z",
    actorLogin: "octocat",
    ...(overrides.taskId === null
      ? {}
      : { taskId: overrides.taskId ?? "task-314" }),
  },
  createdAt: "2026-08-19T05:30:00.000Z",
  status: "unread",
  readAt: null,
  acknowledgedAt: null,
  dismissedAt: null,
  eventType: "pull_request.merged",
} as NotificationDto);

const emit = (notification: NotificationDto): void => {
  act(() => {
    hoisted.systemNotificationHandlers.forEach((handler) => {
      handler(buildEvent(notification));
    });
  });
};

const renderActivityHook = (
  options: { path?: string; coordinate?: boolean } = {},
) => {
  const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
    <MemoryRouter initialEntries={[options.path ?? "/projects/project-1"]}>
      {children}
    </MemoryRouter>
  );

  return renderHook(
    () =>
      useProjectNotificationActivity({
        organizationId: "org-1",
        projectId: "project-1",
        activityEnabled: false,
        coordinateSessionReportToasts: options.coordinate ?? true,
      }),
    { wrapper },
  );
};

describe("useProjectNotificationActivity — session_report_ready coordination", () => {
  beforeEach(() => {
    hoisted.systemNotificationHandlers.length = 0;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues the toast and records the report as shown when the tab has focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderActivityHook();

    emit(buildSessionReportReadyNotification());

    expect(result.current.currentSessionReportReadyToast?.reportId).toBe(
      "report-1",
    );
    expect(result.current.hasUnseenSessionReportReady).toBe(true);
    expect(hasShownRecord("project-1", "report-1")).toBe(true);
  });

  it("keeps Daily Session unseen state separate from Coding report state", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderActivityHook();

    emit(
      buildSessionReportReadyNotification({
        reportId: "daily-report",
        reportType: "DAILY_SESSION",
      }),
    );

    expect(
      result.current.currentDailySessionReportReadyToast?.reportId,
    ).toBe("daily-report");
    expect(result.current.hasUnseenDailySessionReportReady).toBe(true);
    expect(result.current.currentSessionReportReadyToast).toBeNull();
    expect(result.current.hasUnseenSessionReportReady).toBe(false);
    expect(
      result.current.currentDailySessionReportReadyToast?.notification.preview
        .summary,
    ).toBe("Your daily session summary is ready for review.");
    expect(hasShownRecord("project-1", "daily-report")).toBe(true);
  });

  it("defers the toast while unfocused and shows it when the tab regains focus", () => {
    const hasFocusSpy = vi
      .spyOn(document, "hasFocus")
      .mockReturnValue(false);
    const { result } = renderActivityHook();

    emit(buildSessionReportReadyNotification());

    expect(result.current.currentSessionReportReadyToast).toBeNull();
    expect(hasShownRecord("project-1", "report-1")).toBe(false);

    hasFocusSpy.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(result.current.currentSessionReportReadyToast?.reportId).toBe(
      "report-1",
    );
    expect(hasShownRecord("project-1", "report-1")).toBe(true);
  });

  it("does not re-toast a report that already has a shown record on replay", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderActivityHook();

    emit(
      buildSessionReportReadyNotification({
        id: "notif-1",
        reportId: "report-1",
      }),
    );
    expect(result.current.currentSessionReportReadyToast?.reportId).toBe(
      "report-1",
    );

    act(() => {
      result.current.popCurrentSessionReportReadyToast();
    });
    expect(result.current.currentSessionReportReadyToast).toBeNull();

    // A WebSocket reconnect replays the same report under a fresh id.
    emit(
      buildSessionReportReadyNotification({
        id: "notif-2",
        reportId: "report-1",
      }),
    );

    expect(result.current.currentSessionReportReadyToast).toBeNull();
  });

  it("suppresses the toast and records the report as shown when viewing the originating session", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderActivityHook({
      path: "/projects/project-1/resolve-agent-session-by-id/session-1",
    });

    emit(
      buildSessionReportReadyNotification({
        sessionId: "session-1",
        reportId: "report-1",
      }),
    );

    expect(result.current.currentSessionReportReadyToast).toBeNull();
    expect(hasShownRecord("project-1", "report-1")).toBe(true);
  });

  it("suppresses Daily Session presentation while viewing Daily Session for the project", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderActivityHook({
      path: "/projects/project-1?tab=project&view=daily-session",
    });

    emit(
      buildSessionReportReadyNotification({
        reportId: "daily-report",
        reportType: "DAILY_SESSION",
      }),
    );

    expect(result.current.currentDailySessionReportReadyToast).toBeNull();
    expect(result.current.hasUnseenDailySessionReportReady).toBe(false);
    expect(hasShownRecord("project-1", "daily-report")).toBe(true);
  });

  it("does not suppress a Daily Session report for another project route", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderActivityHook({
      path: "/projects/project-2?tab=project&view=daily-session",
    });

    emit(
      buildSessionReportReadyNotification({
        reportId: "daily-report",
        reportType: "DAILY_SESSION",
      }),
    );

    expect(
      result.current.currentDailySessionReportReadyToast?.reportId,
    ).toBe("daily-report");
    expect(result.current.hasUnseenDailySessionReportReady).toBe(true);
  });

  it("removes a toast when a sibling tab broadcasts its dismissal", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderActivityHook();

    emit(buildSessionReportReadyNotification({ reportId: "report-1" }));
    expect(result.current.currentSessionReportReadyToast?.reportId).toBe(
      "report-1",
    );

    const siblingTab = createSessionReportDismissalChannel("project-1");
    await act(async () => {
      siblingTab.broadcastDismissal("report-1");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    siblingTab.close();

    expect(result.current.currentSessionReportReadyToast).toBeNull();
  });

  it("removes a Daily Session toast when a sibling tab broadcasts its dismissal", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderActivityHook();

    emit(
      buildSessionReportReadyNotification({
        reportId: "daily-report",
        reportType: "DAILY_SESSION",
      }),
    );
    expect(
      result.current.currentDailySessionReportReadyToast?.reportId,
    ).toBe("daily-report");

    const siblingTab = createSessionReportDismissalChannel("project-1");
    await act(async () => {
      siblingTab.broadcastDismissal("daily-report");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    siblingTab.close();

    expect(result.current.currentDailySessionReportReadyToast).toBeNull();
  });

  it("does not enqueue session report toasts when coordination is disabled", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderActivityHook({ coordinate: false });

    emit(buildSessionReportReadyNotification());

    expect(result.current.currentSessionReportReadyToast).toBeNull();
  });

  it("enqueues a project-scoped pull-request merge with local Activity attention", () => {
    const { result } = renderActivityHook();

    emit(buildPullRequestMergedNotification());

    expect(result.current.currentPullRequestMergedToast).toMatchObject({
      notificationId: "notif-pr-1",
      projectId: "project-1",
      pullRequestUrl: "https://github.com/hey-hey/ui/pull/314",
      taskId: "task-314",
    });
    expect(result.current.hasUnseenPullRequestMerged).toBe(true);
    expect(
      result.current.currentPullRequestMergedToast?.notification.preview,
    ).toEqual({
      title: "Pull request merged",
      summary: "hey-hey/ui · #314 Render merge activity",
    });
  });

  it("ignores pull-request merge attention for another affected project", () => {
    const { result } = renderActivityHook();

    emit(buildPullRequestMergedNotification({ projectId: "project-2" }));

    expect(result.current.currentPullRequestMergedToast).toBeNull();
    expect(result.current.hasUnseenPullRequestMerged).toBe(false);
  });

  it("suppresses pull-request merge presentation in the matching Activity view", () => {
    const { result } = renderActivityHook({
      path: "/projects/project-1?tab=project&view=coding",
    });

    emit(buildPullRequestMergedNotification());

    expect(result.current.currentPullRequestMergedToast).toBeNull();
    expect(result.current.hasUnseenPullRequestMerged).toBe(false);
  });

  it("keeps merge attention when a different project's Activity view is open", () => {
    const { result } = renderActivityHook({
      path: "/projects/project-2?tab=project&view=coding",
    });

    emit(buildPullRequestMergedNotification());

    expect(result.current.currentPullRequestMergedToast?.notificationId).toBe(
      "notif-pr-1",
    );
    expect(result.current.hasUnseenPullRequestMerged).toBe(true);
  });

  it("clears merge attention when the hook scope changes to another project", () => {
    const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        {children}
      </MemoryRouter>
    );
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useProjectNotificationActivity({
          organizationId: "org-1",
          projectId,
          activityEnabled: false,
          coordinateSessionReportToasts: true,
        }),
      { initialProps: { projectId: "project-1" }, wrapper },
    );

    emit(buildPullRequestMergedNotification());
    expect(result.current.currentPullRequestMergedToast?.projectId).toBe(
      "project-1",
    );

    rerender({ projectId: "project-2" });

    expect(result.current.currentPullRequestMergedToast).toBeNull();
    expect(result.current.hasUnseenPullRequestMerged).toBe(false);
  });

  it("pops and dismisses merge notifications through the existing local path", async () => {
    const { result } = renderActivityHook();
    emit(buildPullRequestMergedNotification());

    act(() => result.current.popCurrentPullRequestMergedToast());
    expect(result.current.currentPullRequestMergedToast).toBeNull();

    await act(async () => {
      await result.current.dismissNotification("notif-pr-1");
    });
    expect(hoisted.dismissNotificationMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      notificationId: "notif-pr-1",
    });
  });
});
