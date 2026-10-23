import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationEventType } from "../../../api";
import type { NotificationRecord } from "../../../data/collections/notifications";
import { NotificationItem } from "../NotificationItem";

const LocationProbe: React.FC<{
  onLocation: (pathname: string) => void;
}> = ({ onLocation }) => {
  const location = useLocation();
  onLocation(location.pathname);
  return null;
};

const renderInRouter = (
  ui: ReactElement,
  {
    initialPath = "/",
    onLocation,
  }: {
    initialPath?: string;
    onLocation?: (pathname: string) => void;
  } = {}
) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      {ui}
      {onLocation ? <LocationProbe onLocation={onLocation} /> : null}
    </MemoryRouter>
  );

const notificationFixture: NotificationRecord = {
  id: "notification-1" as NotificationRecord["id"],
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

describe("NotificationItem", () => {
  const onAcknowledge = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders unread notification with bold title and New chip", () => {
    renderInRouter(
      <NotificationItem
        notification={notificationFixture}
        onAcknowledge={onAcknowledge}
      />
    );

    expect(
      screen.getByTestId("notification-item-status-notification-1")
    ).toHaveTextContent("New");

    expect(
      screen.getByTestId("notification-item-title-notification-1")
    ).toBeInTheDocument();
  });

  it("calls onAcknowledge when clicked", () => {
    renderInRouter(
      <NotificationItem
        notification={notificationFixture}
        onAcknowledge={onAcknowledge}
      />
    );

    fireEvent.click(
      screen.getByTestId("notification-item-button-notification-1")
    );

    expect(onAcknowledge).toHaveBeenCalledWith("notification-1");
  });

  it("renders read/seen notification with Seen chip", () => {
    renderInRouter(
      <NotificationItem
        notification={{
          ...notificationFixture,
          status: "read",
          isRead: true,
          isAcknowledged: false,
          readAt: "2026-03-03T11:00:00.000Z",
        }}
        onAcknowledge={onAcknowledge}
      />
    );

    expect(
      screen.getByTestId("notification-item-status-notification-1")
    ).toHaveTextContent("Seen");
  });

  it("renders acknowledged notification with Done chip and dimmed style", () => {
    renderInRouter(
      <NotificationItem
        notification={{
          ...notificationFixture,
          status: "acknowledged",
          isRead: true,
          isAcknowledged: true,
          readAt: "2026-03-03T11:00:00.000Z",
          acknowledgedAt: "2026-03-03T12:00:00.000Z",
        }}
        onAcknowledge={onAcknowledge}
      />
    );

    expect(
      screen.getByTestId("notification-item-status-notification-1")
    ).toHaveTextContent("Done");
  });

  it("does not call onAcknowledge when updating", () => {
    renderInRouter(
      <NotificationItem
        isUpdating
        notification={notificationFixture}
        onAcknowledge={onAcknowledge}
      />
    );

    fireEvent.click(
      screen.getByTestId("notification-item-button-notification-1")
    );

    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it.each<{
    label: string;
    eventType: NotificationEventType;
    preview: { title: string; summary: string };
  }>([
    {
      label: "task.completed",
      eventType: "task.completed",
      preview: { title: "Task completed", summary: "Implement auth completed" },
    },
    {
      label: "system_message",
      eventType: "system_message",
      preview: {
        title: "System message",
        summary: "Deployment completed successfully",
      },
    },
    {
      label: "child_unblocked",
      eventType: "child_unblocked",
      preview: { title: "Child unblocked", summary: "3 tasks unblocked" },
    },
  ])("renders $label preview text", ({ eventType, preview }) => {
    const record: NotificationRecord = {
      ...notificationFixture,
      eventType,
      preview,
    };

    renderInRouter(
      <NotificationItem notification={record} onAcknowledge={onAcknowledge} />
    );

    expect(
      screen.getByTestId(`notification-item-title-${record.notificationId}`)
    ).toHaveTextContent(preview.title);
    expect(
      screen.getByTestId(`notification-item-summary-${record.notificationId}`)
    ).toHaveTextContent(preview.summary);
  });

  describe("session_report_ready variant", () => {
    const sessionId = "session-7";
    const reportId = "report-7";
    const sessionTitle = "Pricing rollout review";
    const projectId = "project-42";

    const sessionReportReadyFixture: NotificationRecord = {
      ...notificationFixture,
      id: "notification-session-1" as NotificationRecord["id"],
      notificationId: "notification-session-1",
      eventType: "session_report_ready",
      reportId,
      preview: {
        title: "Report ready",
        summary: "The agent has summarized this session.",
      },
      source: {
        id: "notification-session-1",
        eventType: "session_report_ready",
        entityId: sessionId,
        entityType: "AGENT_SESSION",
        entityTitle: sessionTitle,
        affectedEntities: [],
        payload: {
          sessionId,
          reportId,
          sessionTitle,
          reportTitle: "Session Summary",
          reportType: "SESSION_SUMMARY",
        },
        createdAt: "2026-03-03T10:00:00.000Z",
        status: "unread",
      },
    };

    it("renders the dedicated icon and report-type copy", () => {
      renderInRouter(
        <NotificationItem
          notification={sessionReportReadyFixture}
          onAcknowledge={onAcknowledge}
        />,
        { initialPath: `/projects/${projectId}/something` }
      );

      expect(
        screen.getByTestId("notification-item-icon-notification-session-1")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("notification-item-title-notification-session-1")
      ).toHaveTextContent("Report ready");
      expect(
        screen.getByTestId("notification-item-summary-notification-session-1")
      ).toHaveTextContent("The agent has summarized this session.");
    });

    it("acknowledges and navigates to the agent session on click", () => {
      let lastPath = "";
      renderInRouter(
        <NotificationItem
          notification={sessionReportReadyFixture}
          onAcknowledge={onAcknowledge}
        />,
        {
          initialPath: `/projects/${projectId}/dashboard`,
          onLocation: (pathname) => {
            lastPath = pathname;
          },
        }
      );

      fireEvent.click(
        screen.getByTestId("notification-item-button-notification-session-1")
      );

      expect(onAcknowledge).toHaveBeenCalledWith("notification-session-1");
      expect(lastPath).toBe(
        `/projects/${projectId}/resolve-agent-session-by-id/${sessionId}`
      );
    });

    it("does not render the Preview affordance without onPreview", () => {
      renderInRouter(
        <NotificationItem
          notification={sessionReportReadyFixture}
          onAcknowledge={onAcknowledge}
        />
      );

      expect(
        screen.queryByTestId("notification-item-preview-notification-session-1")
      ).not.toBeInTheDocument();
    });

    it("invokes onPreview with the session id without acknowledging or navigating", () => {
      const onPreview = vi.fn();
      let lastPath = "";
      renderInRouter(
        <NotificationItem
          notification={sessionReportReadyFixture}
          onAcknowledge={onAcknowledge}
          onPreview={onPreview}
        />,
        {
          initialPath: `/projects/${projectId}/dashboard`,
          onLocation: (pathname) => {
            lastPath = pathname;
          },
        }
      );

      fireEvent.click(
        screen.getByTestId("notification-item-preview-notification-session-1")
      );

      expect(onPreview).toHaveBeenCalledWith(sessionId);
      expect(onAcknowledge).not.toHaveBeenCalled();
      expect(lastPath).toBe(`/projects/${projectId}/dashboard`);
    });

    it("does not render the Preview affordance for non-session rows", () => {
      const onPreview = vi.fn();
      renderInRouter(
        <NotificationItem
          notification={notificationFixture}
          onAcknowledge={onAcknowledge}
          onPreview={onPreview}
        />
      );

      expect(
        screen.queryByTestId("notification-item-preview-notification-1")
      ).not.toBeInTheDocument();
    });
  });

  describe("pull_request.merged variant", () => {
    const pullRequestMergedFixture = {
      ...notificationFixture,
      id: "notification-pr-1" as NotificationRecord["id"],
      notificationId: "notification-pr-1",
      eventType: "pull_request.merged",
      reportId: null,
      preview: {
        title: "Pull request merged",
        summary: "hey-hey/ui · #314 Render merge activity",
      },
      source: {
        id: "notification-pr-1",
        eventType: "pull_request.merged",
        entityId: "project-42",
        entityType: "PROJECT",
        entityTitle: "Hey Hey",
        affectedEntities: [{ type: "PROJECT", id: "project-42" }],
        payload: {
          repositoryName: "hey-hey/ui",
          pullRequestNumber: 314,
          pullRequestTitle: "Render merge activity",
          pullRequestUrl: "https://github.com/hey-hey/ui/pull/314",
          mergedAt: "2026-08-19T05:30:00.000Z",
          actorLogin: "octocat",
          taskId: "task-314",
        },
        createdAt: "2026-08-19T05:30:00.000Z",
        status: "unread",
      },
    } as NotificationRecord;

    it("renders merge context and both navigation actions", () => {
      const onOpenPullRequest = vi.fn();
      const onOpenTask = vi.fn();
      renderInRouter(
        <NotificationItem
          notification={pullRequestMergedFixture}
          onAcknowledge={onAcknowledge}
          onOpenPullRequest={onOpenPullRequest}
          onOpenTask={onOpenTask}
        />
      );

      expect(screen.getByText("hey-hey/ui · #314 Render merge activity")).toBeInTheDocument();
      expect(screen.getByText(/Merged by @octocat/)).toBeInTheDocument();

      fireEvent.click(screen.getByText("Open pull request"));
      fireEvent.click(screen.getByText("Open linked task"));

      expect(onOpenPullRequest).toHaveBeenCalledWith(
        "https://github.com/hey-hey/ui/pull/314"
      );
      expect(onOpenTask).toHaveBeenCalledWith("task-314");
      expect(onAcknowledge).not.toHaveBeenCalled();
    });

    it("omits linked-task navigation when no task is attached", () => {
      renderInRouter(
        <NotificationItem
          notification={{
            ...pullRequestMergedFixture,
            source: {
              ...pullRequestMergedFixture.source,
              payload: {
                ...pullRequestMergedFixture.source.payload,
                taskId: undefined,
              },
            },
          } as NotificationRecord}
          onAcknowledge={onAcknowledge}
        />
      );

      expect(screen.queryByText("Open linked task")).not.toBeInTheDocument();
    });
  });
});
