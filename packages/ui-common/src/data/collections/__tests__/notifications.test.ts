import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EntityType,
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  ReportType,
  WorkStatus,
  type NotificationDto,
} from "../../../api";
import {
  fetchNotificationPreferences,
  fetchNotificationsPage,
  mapNotificationDto,
  markNotificationRead,
  markNotificationUnread,
  notificationKeys,
  reconcileNotificationList,
  resolveNotificationConflict,
  toNotificationListParams,
  updateNotificationPreferences,
} from "../notifications";

const {
  getUserNotificationPreferencesMock,
  listNotificationsMock,
  markNotificationReadMock,
  markNotificationUnreadMock,
  updateUserNotificationPreferencesMock,
} = vi.hoisted(() => ({
  listNotificationsMock: vi.fn(),
  markNotificationReadMock: vi.fn(),
  markNotificationUnreadMock: vi.fn(),
  getUserNotificationPreferencesMock: vi.fn(),
  updateUserNotificationPreferencesMock: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  notificationsClient: {
    listNotifications: listNotificationsMock,
    markNotificationRead: markNotificationReadMock,
    markNotificationUnread: markNotificationUnreadMock,
    getUserNotificationPreferences: getUserNotificationPreferencesMock,
    updateUserNotificationPreferences: updateUserNotificationPreferencesMock,
  },
}));

const buildNotificationDto = (
  overrides: Partial<NotificationDto> = {}
): NotificationDto => ({
  id: "notification-1",
  eventType: NotificationEventType.ReportCreated,
  entityId: "report-1",
  entityType: EntityType.Report,
  entityTitle: "Release Readiness Report",
  affectedEntities: [{ id: "task-1", type: EntityType.Task }],
  payload: {
    nextSteps: [{ title: "Review report outputs" }],
    verificationTasks: [],
    recommendedUpdates: [],
  },
  createdAt: "2026-03-03T10:00:00.000Z",
  status: NotificationStatus.Unread,
  ...overrides,
});

const buildSessionReportReadyDto = (
  reportType: ReportType,
  sessionTitle = "Pricing rollout review"
): NotificationDto => ({
  id: "notification-session-1",
  eventType: NotificationEventType.SessionReportReady,
  entityId: "session-1",
  entityType: EntityType.AgentSession,
  entityTitle: sessionTitle,
  affectedEntities: [],
  payload: {
    sessionId: "session-1",
    reportId: "report-1",
    sessionTitle,
    reportTitle: "Session report",
    reportType,
  },
  createdAt: "2026-03-03T10:00:00.000Z",
  status: NotificationStatus.Unread,
});

describe("notifications collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds normalized list keys", () => {
    const params = toNotificationListParams({
      userId: "user-1",
      eventType: [
        NotificationEventType.TaskCompleted,
        NotificationEventType.ReportCreated,
        NotificationEventType.TaskCompleted,
      ],
      status: NotificationStatus.Unread,
      channel: NotificationChannel.InApp,
      limit: 25,
    });

    expect(notificationKeys.list("org-1", params)).toEqual([
      "notifications",
      "org-1",
      "list",
      {
        userId: "user-1",
        eventType: [
          NotificationEventType.ReportCreated,
          NotificationEventType.TaskCompleted,
        ],
        status: NotificationStatus.Unread,
        channel: NotificationChannel.InApp,
        includeDismissed: null,
        createdAfter: null,
        createdBefore: null,
        limit: 25,
        offset: null,
      },
    ]);
  });

  it("upserts by id, keeps the newer pushed version and drops non-matching records", () => {
    const params = toNotificationListParams({
      status: NotificationStatus.Unread,
    });
    const unread = mapNotificationDto(buildNotificationDto());
    const page = {
      items: [unread],
      records: [unread],
      pagination: { limit: 50, offset: 0, totalCount: 1, nextOffset: null },
    };

    const duplicate = reconcileNotificationList(page, params, unread);
    expect(duplicate.records).toHaveLength(1);
    expect(duplicate.pagination.totalCount).toBe(1);

    const read = mapNotificationDto(
      buildNotificationDto({
        status: NotificationStatus.Read,
        readAt: "2026-03-03T11:00:00.000Z",
      })
    );
    const afterRead = reconcileNotificationList(page, params, read);
    expect(afterRead.records).toHaveLength(0);
    expect(afterRead.pagination.totalCount).toBe(0);

    const allParams = toNotificationListParams({});
    const readPage = { ...page, items: [read], records: [read] };
    expect(
      reconcileNotificationList(readPage, allParams, unread).records[0]?.status
    ).toBe(NotificationStatus.Read);
    expect(
      reconcileNotificationList(readPage, allParams, unread, {
        authoritative: true,
      }).records[0]?.status
    ).toBe(NotificationStatus.Unread);
  });

  it("maps DTO notifications into UI records", () => {
    const mapped = mapNotificationDto(buildNotificationDto());

    expect(mapped.notificationId).toBe("notification-1");
    expect(mapped.preview.title).toBe("Report created");
    expect(mapped.preview.summary).toBe("Review report outputs");
    expect(mapped.isRead).toBe(false);
  });

  it("maps pull-request merge notifications to recognizable repository and PR copy", () => {
    const dto = {
      ...buildNotificationDto(),
      eventType: "pull_request.merged",
      payload: {
        repositoryName: "hey-hey/ui",
        pullRequestNumber: 314,
        pullRequestTitle: "Render merge activity",
        pullRequestUrl: "https://github.com/hey-hey/ui/pull/314",
        mergedAt: "2026-08-19T05:30:00.000Z",
        actorLogin: "octocat",
        taskId: "task-314",
      },
    } as NotificationDto;

    const mapped = mapNotificationDto(dto);

    expect(mapped.preview).toEqual({
      title: "Pull request merged",
      summary: "hey-hey/ui · #314 Render merge activity",
    });
  });

  it("renders task.completed preview as taskName completed", () => {
    const dto: NotificationDto = {
      id: "notification-2",
      eventType: NotificationEventType.TaskCompleted,
      entityId: "task-1",
      entityType: EntityType.Task,
      entityTitle: "Implement auth",
      affectedEntities: [],
      payload: {
        taskId: "task-1",
        taskName: "Implement auth",
        previousStatus: WorkStatus.Backlog,
        newStatus: WorkStatus.Completed,
      },
      createdAt: "2026-03-03T10:00:00.000Z",
      status: NotificationStatus.Unread,
    };

    const mapped = mapNotificationDto(dto);
    expect(mapped.preview.title).toBe("Task completed");
    expect(mapped.preview.summary).toBe("Implement auth completed");
  });

  it("renders system_message preview as snippet", () => {
    const dto: NotificationDto = {
      id: "notification-3",
      eventType: NotificationEventType.SystemMessage,
      entityId: "msg-1",
      entityType: EntityType.Message,
      entityTitle: "System alert",
      affectedEntities: [],
      payload: {
        messageId: "msg-1",
        conversationId: "conv-1",
        title: "System alert",
        snippet: "Deployment completed successfully",
      },
      createdAt: "2026-03-03T10:00:00.000Z",
      status: NotificationStatus.Unread,
    };

    const mapped = mapNotificationDto(dto);
    expect(mapped.preview.title).toBe("System message");
    expect(mapped.preview.summary).toBe("Deployment completed successfully");
  });

  it("renders child_unblocked preview as N tasks unblocked", () => {
    const dto: NotificationDto = {
      id: "notification-4",
      eventType: NotificationEventType.ChildUnblocked,
      entityId: "task-parent",
      entityType: EntityType.Task,
      entityTitle: "Parent task",
      affectedEntities: [],
      payload: {
        parentEntityId: "task-parent",
        parentEntityType: EntityType.Task,
        unblockedChildIds: ["child-1", "child-2", "child-3"],
      },
      createdAt: "2026-03-03T10:00:00.000Z",
      status: NotificationStatus.Unread,
    };

    const mapped = mapNotificationDto(dto);
    expect(mapped.preview.title).toBe("Child unblocked");
    expect(mapped.preview.summary).toBe("3 tasks unblocked");
  });

  it("renders child_unblocked with singular form for one task", () => {
    const dto: NotificationDto = {
      id: "notification-5",
      eventType: NotificationEventType.ChildUnblocked,
      entityId: "task-parent",
      entityType: EntityType.Task,
      entityTitle: "Parent task",
      affectedEntities: [],
      payload: {
        parentEntityId: "task-parent",
        parentEntityType: EntityType.Task,
        unblockedChildIds: ["child-1"],
      },
      createdAt: "2026-03-03T10:00:00.000Z",
      status: NotificationStatus.Unread,
    };

    const mapped = mapNotificationDto(dto);
    expect(mapped.preview.summary).toBe("1 task unblocked");
  });

  it("falls back to generic summary for report.created with empty payload", () => {
    const dto: NotificationDto = {
      id: "notification-6",
      eventType: NotificationEventType.ReportCreated,
      entityId: "report-1",
      entityType: EntityType.Report,
      entityTitle: "Empty Report",
      affectedEntities: [],
      payload: {
        nextSteps: [],
        verificationTasks: [],
        recommendedUpdates: [],
      },
      createdAt: "2026-03-03T10:00:00.000Z",
      status: NotificationStatus.Unread,
    };

    const mapped = mapNotificationDto(dto);
    expect(mapped.preview.summary).toBe("Notification update");
  });

  it.each<{ reportType: ReportType; summary: string }>([
    {
      reportType: ReportType.FeatureSync,
      summary: "The agent has completed its feature analysis.",
    },
    {
      reportType: ReportType.Implement,
      summary:
        "The agent has finished implementing; the changes are ready for review.",
    },
    {
      reportType: ReportType.ValidationWalkthrough,
      summary: "The agent has completed its validation walkthrough.",
    },
  ])(
    "renders session_report_ready preview copy for $reportType",
    ({ reportType, summary }) => {
      const mapped = mapNotificationDto(buildSessionReportReadyDto(reportType));

      expect(mapped.preview.title).toBe("Report ready");
      expect(mapped.preview.summary).toBe(summary);
    }
  );

  it("falls back to generic session_report_ready copy for an unmapped report type", () => {
    const mapped = mapNotificationDto(
      buildSessionReportReadyDto(ReportType.Snapshot, "Pricing rollout review")
    );

    expect(mapped.preview.title).toBe("Report ready");
    expect(mapped.preview.summary).toBe(
      "Report ready for review on Pricing rollout review"
    );
  });

  it("prefers newer record when resolving duplicates", () => {
    const older = mapNotificationDto(buildNotificationDto());
    const newer = mapNotificationDto(
      buildNotificationDto({
        status: NotificationStatus.Read,
        readAt: "2026-03-03T11:00:00.000Z",
      })
    );

    const resolved = resolveNotificationConflict(older, newer);
    expect(resolved.status).toBe(NotificationStatus.Read);
    expect(resolved.readAt).toBe("2026-03-03T11:00:00.000Z");
  });

  it("fetches mapped paginated notifications", async () => {
    listNotificationsMock.mockResolvedValueOnce({
      data: {
        data: [buildNotificationDto()],
      },
      headers: {
        "x-total-count": "1",
        "x-next-offset": "25",
      },
    });

    const result = await fetchNotificationsPage({
      organizationId: "org-1",
      limit: 25,
      offset: 0,
    });

    expect(listNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        limit: 25,
        offset: 0,
      }),
      {}
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.notificationId).toBe("notification-1");
    expect(result.pagination).toEqual({
      limit: 25,
      offset: 0,
      totalCount: 1,
      nextOffset: 25,
    });
  });

  it("maps mark read and unread mutation responses", async () => {
    markNotificationReadMock.mockResolvedValueOnce({
      data: buildNotificationDto({
        status: NotificationStatus.Read,
        readAt: "2026-03-03T11:00:00.000Z",
      }),
    });
    markNotificationUnreadMock.mockResolvedValueOnce({
      data: buildNotificationDto({
        status: NotificationStatus.Unread,
        readAt: null,
      }),
    });

    const readRecord = await markNotificationRead("org-1", "notification-1");
    const unreadRecord = await markNotificationUnread(
      "org-1",
      "notification-1"
    );

    expect(markNotificationReadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        notificationId: "notification-1",
      })
    );
    expect(markNotificationUnreadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        notificationId: "notification-1",
      })
    );
    expect(readRecord.status).toBe(NotificationStatus.Read);
    expect(unreadRecord.status).toBe(NotificationStatus.Unread);
  });

  it("fetches and updates notification preferences", async () => {
    getUserNotificationPreferencesMock.mockResolvedValueOnce({
      data: {
        data: {
          userId: "user-1",
          organizationId: "org-1",
          subscriptions: [],
          updatedAt: "2026-03-03T10:00:00.000Z",
        },
      },
    });
    updateUserNotificationPreferencesMock.mockResolvedValueOnce({
      data: {
        data: {
          userId: "user-1",
          organizationId: "org-1",
          subscriptions: [],
          updatedAt: "2026-03-03T11:00:00.000Z",
        },
      },
    });

    const fetched = await fetchNotificationPreferences("org-1", "user-1");
    const updated = await updateNotificationPreferences("org-1", "user-1", {
      subscriptions: [],
    });

    expect(fetched?.updatedAt).toBe("2026-03-03T10:00:00.000Z");
    expect(updated?.updatedAt).toBe("2026-03-03T11:00:00.000Z");
    expect(updateUserNotificationPreferencesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        id: "user-1",
        updateNotificationPreferencesDto: { subscriptions: [] },
      })
    );
  });
});
