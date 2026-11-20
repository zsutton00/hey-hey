import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPathService,
  resetPathService,
  setPathService,
  type PathService,
} from "@hey-hey/ui-common/services";
import { ProjectNotificationCenter } from "./ProjectNotificationCenter";
import type {
  PullRequestMergedToastItem,
  SessionReportReadyToastItem,
  UseProjectNotificationActivityReturn,
} from "../../hooks/useProjectNotificationActivity";

const { openPreviewMock } = vi.hoisted(() => ({
  openPreviewMock: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/context", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/context")
  >("@hey-hey/ui-common/context");
  return {
    ...actual,
    usePreviewHost: () => ({ openPreview: openPreviewMock }),
  };
});

vi.mock("../../hooks/useProjectNotificationActivity", () => ({
  useProjectNotificationActivity: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components/Notifications", () => ({
  NotificationItem: ({
    notification,
    onAcknowledge,
    onPreview,
    onOpenPullRequest,
    onOpenTask,
  }: {
    notification: {
      notificationId: string;
      preview: { title: string };
      source: { eventType: string; payload: { sessionId: string } };
    };
    onAcknowledge: (notificationId: string) => void;
    onPreview?: (sessionId: string) => void;
    onOpenPullRequest?: (url: string) => void;
    onOpenTask?: (taskId: string) => void;
  }) => {
    const location = useLocation();
    const navigate = useNavigate();
    return (
      <>
        <button
          data-testid={`notification-item-${notification.notificationId}`}
          onClick={() => {
            onAcknowledge(notification.notificationId);
            if (notification.source.eventType === "session_report_ready") {
              const projectIdMatch =
                location.pathname.match(/^\/projects\/([^/]+)/);
              const projectId = projectIdMatch ? projectIdMatch[1] : "";
              navigate(
                `/projects/${projectId}/resolve-agent-session-by-id/${notification.source.payload.sessionId}`,
              );
            }
          }}
          type="button"
        >
          {notification.preview.title}
        </button>
        {onPreview &&
        notification.source.eventType === "session_report_ready" ? (
          <button
            data-testid={`notification-item-preview-${notification.notificationId}`}
            onClick={() => onPreview(notification.source.payload.sessionId)}
            type="button"
          >
            preview
          </button>
        ) : null}
        {notification.source.eventType === "pull_request.merged" ? (
          <>
            <button
              data-testid={`notification-item-open-pull-request-${notification.notificationId}`}
              onClick={() =>
                onOpenPullRequest?.(
                  (notification.source.payload as { pullRequestUrl: string })
                    .pullRequestUrl,
                )
              }
              type="button"
            >
              open pull request
            </button>
            {(notification.source.payload as { taskId?: string }).taskId ? (
              <button
                data-testid={`notification-item-open-task-${notification.notificationId}`}
                onClick={() =>
                  onOpenTask?.(
                    (notification.source.payload as { taskId: string }).taskId,
                  )
                }
                type="button"
              >
                open linked task
              </button>
            ) : null}
          </>
        ) : null}
      </>
    );
  },
}));

import { useProjectNotificationActivity } from "../../hooks/useProjectNotificationActivity";

const useProjectNotificationActivityMock = vi.mocked(
  useProjectNotificationActivity,
);

const setMatchMediaMatches = (matches: boolean): void => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const buildToastItem = (
  overrides: Partial<SessionReportReadyToastItem> = {},
): SessionReportReadyToastItem => {
  const notificationId = overrides.notificationId ?? "notif-1";
  const sessionId = overrides.sessionId ?? "session-1";
  const reportId = overrides.reportId ?? "report-1";
  const reportType = overrides.reportType ?? "IMPLEMENT";
  const sessionTitle = overrides.sessionTitle ?? "Implement reports tab";
  const reportTitle = overrides.reportTitle ?? "Implementation summary";

  return {
    notificationId,
    sessionId,
    reportId,
    reportType,
    sessionTitle,
    reportTitle,
    notification: {
      id: notificationId,
      notificationId,
      eventType: "session_report_ready",
      reportId,
      createdAt: "2026-05-17T00:00:00.000Z",
      status: "unread",
      readAt: null,
      acknowledgedAt: null,
      dismissedAt: null,
      affectedEntityCount: 0,
      isRead: false,
      isAcknowledged: false,
      preview: { title: sessionTitle, summary: "ready" },
      source: {
        eventType: "session_report_ready",
        payload: {
          sessionId,
          reportId,
          reportType,
          sessionTitle,
          reportTitle,
        },
      },
    } as unknown as SessionReportReadyToastItem["notification"],
    ...overrides,
  };
};

const buildHookReturn = (
  overrides: Partial<UseProjectNotificationActivityReturn> = {},
): UseProjectNotificationActivityReturn => ({
  alertItems: [],
  currentDailySessionReportReadyToast: null,
  currentPullRequestMergedToast: null,
  currentToast: null,
  currentSessionReportReadyToast: null,
  dismissNotification: vi.fn().mockResolvedValue(undefined),
  error: null,
  hasUnseenDailySessionReportReady: false,
  hasUnseenPullRequestMerged: false,
  hasUnseenSessionReportReady: false,
  isLoading: false,
  pagination: {
    limit: 50,
    offset: 0,
    totalCount: null,
    nextOffset: null,
  } as unknown as UseProjectNotificationActivityReturn["pagination"],
  popCurrentDailySessionReportReadyToast: vi.fn(),
  popCurrentPullRequestMergedToast: vi.fn(),
  popCurrentToast: vi.fn(),
  popCurrentSessionReportReadyToast: vi.fn(),
  resetDailySessionReportReadyIndicator: vi.fn(),
  resetPullRequestMergedIndicator: vi.fn(),
  resetSessionReportReadyIndicator: vi.fn(),
  ...overrides,
});

const buildPullRequestMergedToast = (): PullRequestMergedToastItem => ({
  notificationId: "notif-pr-1",
  projectId: "project-1",
  pullRequestUrl: "https://github.com/hey-hey/ui/pull/314",
  taskId: "task-314",
  notification: {
    id: "notif-pr-1",
    notificationId: "notif-pr-1",
    eventType: "pull_request.merged",
    reportId: null,
    createdAt: "2026-08-19T05:30:00.000Z",
    status: "unread",
    readAt: null,
    acknowledgedAt: null,
    dismissedAt: null,
    affectedEntityCount: 1,
    isRead: false,
    isAcknowledged: false,
    preview: { title: "Pull request merged", summary: "hey-hey/ui · #314" },
    source: {
      eventType: "pull_request.merged",
      affectedEntities: [{ type: "PROJECT", id: "project-1" }],
      payload: {
        pullRequestUrl: "https://github.com/hey-hey/ui/pull/314",
        taskId: "task-314",
      },
    },
  } as unknown as PullRequestMergedToastItem["notification"],
});

describe("ProjectNotificationCenter", () => {
  beforeEach(() => {
    openPreviewMock.mockReset();
    useProjectNotificationActivityMock.mockReturnValue(buildHookReturn());
    resetPathService();
  });

  afterEach(() => {
    setMatchMediaMatches(false);
    resetPathService();
    vi.clearAllMocks();
  });

  it("renders a single Sessions link with a visible label on desktop", () => {
    setMatchMediaMatches(false);
    render(
      <MemoryRouter>
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("coding-link")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.queryByTestId("daily-session-link")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily Session")).not.toBeInTheDocument();
    expect(screen.queryByText("Activity")).not.toBeInTheDocument();
  });

  it("renders only the icon-only Sessions link on mobile", () => {
    setMatchMediaMatches(true);
    render(
      <MemoryRouter>
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("coding-link")).toBeInTheDocument();
    expect(screen.queryByTestId("daily-session-link")).not.toBeInTheDocument();
    expect(screen.queryByText("Sessions")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Daily Session" })).toBeNull();
  });

  it("shows no Daily Session control or toast, even when a daily report is ready", () => {
    useProjectNotificationActivityMock.mockReturnValue(
      buildHookReturn({
        currentDailySessionReportReadyToast: buildToastItem({
          reportType: "DAILY_SESSION",
          sessionTitle: "Daily Session",
        }),
        hasUnseenDailySessionReportReady: true,
      }),
    );

    render(
      <MemoryRouter>
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("daily-session-link")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily Session")).not.toBeInTheDocument();
  });

  it("opts into session report toast coordination scoped to the project", () => {
    render(
      <MemoryRouter>
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(useProjectNotificationActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        activityEnabled: false,
        coordinateSessionReportToasts: true,
      }),
    );
  });

  it("Sessions button links to the Project Page Agents Coding view", () => {
    render(
      <MemoryRouter>
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    const codingLink = screen.getByTestId("coding-link");
    expect(codingLink).toHaveAttribute(
      "href",
      "/projects/project-1?view=coding&tab=agents",
    );
  });

  it("uses the injected Path Service for the Sessions destination", () => {
    const basePathService = getPathService();
    const override: PathService = {
      ...basePathService,
      projectAgentsCoding: ({ projectId }) =>
        `/custom/projects/${projectId}?destination=agents-coding`,
    };
    setPathService(override);

    render(
      <MemoryRouter>
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("coding-link")).toHaveAttribute(
      "href",
      "/custom/projects/project-1?destination=agents-coding",
    );
  });

  it("shows an indicator color on the Coding button and renders the toast when a session_report_ready notification arrives for a session the user is NOT viewing", () => {
    const toast = buildToastItem({ sessionId: "session-other" });
    useProjectNotificationActivityMock.mockReturnValue(
      buildHookReturn({
        currentSessionReportReadyToast: toast,
        hasUnseenSessionReportReady: true,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1?tab=project"]}>
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    const codingLink = screen.getByTestId("coding-link");
    expect(codingLink).toHaveStyle({
      color: "rgb(25, 118, 210)",
    });

    expect(
      screen.getByTestId("session-report-ready-toast"),
    ).toBeInTheDocument();
    expect(screen.getByText("Implement reports tab")).toBeInTheDocument();
  });

  it("renders merge attention and supports GitHub and linked-task navigation", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const resetPullRequestMergedIndicator = vi.fn();
    useProjectNotificationActivityMock.mockReturnValue(
      buildHookReturn({
        currentPullRequestMergedToast: buildPullRequestMergedToast(),
        hasUnseenPullRequestMerged: true,
        resetPullRequestMergedIndicator,
      }),
    );

    const LocationProbe: React.FC = () => {
      const location = useLocation();
      return <div data-testid="merge-probe">{location.pathname}</div>;
    };

    render(
      <MemoryRouter initialEntries={["/projects/project-1?tab=project"]}>
        <Routes>
          <Route
            path="/projects/:projectId/*"
            element={
              <>
                <ProjectNotificationCenter
                  organizationId="org-1"
                  projectId="project-1"
                />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("pull-request-merged-toast")).toBeInTheDocument();
    expect(screen.getByTestId("coding-link")).toHaveStyle({
      color: "rgb(25, 118, 210)",
    });

    fireEvent.click(
      screen.getByTestId("notification-item-open-pull-request-notif-pr-1"),
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/hey-hey/ui/pull/314",
      "_blank",
      "noopener,noreferrer",
    );

    fireEvent.click(
      screen.getByTestId("notification-item-open-task-notif-pr-1"),
    );
    expect(screen.getByTestId("merge-probe")).toHaveTextContent(
      "/projects/project-1/tasks/task-314",
    );

    fireEvent.click(screen.getByTestId("coding-link"));
    expect(resetPullRequestMergedIndicator).toHaveBeenCalledTimes(1);
  });

  it("suppresses toast and indicator when the user is currently viewing the session that produced the report", () => {
    useProjectNotificationActivityMock.mockReturnValue(
      buildHookReturn({
        currentSessionReportReadyToast: null,
        hasUnseenSessionReportReady: false,
      }),
    );

    render(
      <MemoryRouter
        initialEntries={[
          "/projects/project-1/resolve-agent-session-by-id/session-1",
        ]}
      >
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByTestId("session-report-ready-toast"),
    ).not.toBeInTheDocument();

    const codingLink = screen.getByTestId("coding-link");
    expect(codingLink).not.toHaveStyle({ color: "rgb(25, 118, 210)" });
  });

  it("clicking the Coding button calls resetSessionReportReadyIndicator", () => {
    const resetSessionReportReadyIndicator = vi.fn();
    useProjectNotificationActivityMock.mockReturnValue(
      buildHookReturn({
        currentSessionReportReadyToast: buildToastItem({
          sessionId: "session-other",
        }),
        hasUnseenSessionReportReady: true,
        resetSessionReportReadyIndicator,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1?tab=project"]}>
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("coding-link"));

    expect(resetSessionReportReadyIndicator).toHaveBeenCalledTimes(1);
  });

  it("clicking the toast navigates to the agent session resolver route for that session", () => {
    const dismissNotification = vi.fn().mockResolvedValue(undefined);
    const popCurrentSessionReportReadyToast = vi.fn();
    const toast = buildToastItem({
      notificationId: "notif-42",
      sessionId: "session-other",
    });

    useProjectNotificationActivityMock.mockReturnValue(
      buildHookReturn({
        currentSessionReportReadyToast: toast,
        hasUnseenSessionReportReady: true,
        dismissNotification,
        popCurrentSessionReportReadyToast,
      }),
    );

    const LocationProbe: React.FC = () => {
      const location = useLocation();
      return <div data-testid="probe">{location.pathname}</div>;
    };

    render(
      <MemoryRouter initialEntries={["/projects/project-1?tab=project"]}>
        <Routes>
          <Route
            path="/projects/:projectId/*"
            element={
              <>
                <ProjectNotificationCenter
                  organizationId="org-1"
                  projectId="project-1"
                />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("notification-item-notif-42"));

    expect(dismissNotification).toHaveBeenCalledWith("notif-42");
    expect(popCurrentSessionReportReadyToast).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("probe").textContent).toBe(
      "/projects/project-1/resolve-agent-session-by-id/session-other",
    );
  });

  it("opens the preview modal for the session without navigating", () => {
    useProjectNotificationActivityMock.mockReturnValue(
      buildHookReturn({
        currentSessionReportReadyToast: buildToastItem({
          notificationId: "notif-7",
          sessionId: "session-preview",
        }),
        hasUnseenSessionReportReady: true,
      }),
    );

    const PreviewLocationProbe: React.FC = () => {
      const location = useLocation();
      return <div data-testid="probe">{location.pathname}</div>;
    };

    render(
      <MemoryRouter initialEntries={["/projects/project-1?tab=project"]}>
        <Routes>
          <Route
            path="/projects/:projectId/*"
            element={
              <>
                <ProjectNotificationCenter
                  organizationId="org-1"
                  projectId="project-1"
                />
                <PreviewLocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("notification-item-preview-notif-7"));

    expect(openPreviewMock).toHaveBeenCalledWith({
      entityType: "agent_session",
      entityId: "session-preview",
    });
    expect(screen.getByTestId("probe").textContent).toBe("/projects/project-1");
  });

  it("routes every notification preview through the shared host", () => {
    useProjectNotificationActivityMock.mockReturnValue(
      buildHookReturn({
        currentSessionReportReadyToast: buildToastItem({
          notificationId: "notif-8",
          sessionId: "session-preview",
        }),
        hasUnseenSessionReportReady: true,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1?tab=project"]}>
        <ProjectNotificationCenter
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("notification-item-preview-notif-8"));
    expect(openPreviewMock).toHaveBeenCalledTimes(1);
    expect(openPreviewMock).toHaveBeenCalledWith({
      entityType: "agent_session",
      entityId: "session-preview",
    });
  });
});
