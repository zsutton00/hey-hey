import { notificationsClient } from "@hey-hey/ui-common/clients";
import type {
  NotificationDto,
  ReportDto,
  ReportType,
  WebSocketSystemNotificationEvent,
} from "@hey-hey/ui-common/api";
import { useOptionalWebSocketService } from "@hey-hey/ui-common/context";
import {
  useCorrelatedActivity,
  type UseNotificationsReturn,
} from "@hey-hey/ui-common/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  createSessionReportDismissalChannel,
  hasShownRecord,
  writeShownRecord,
  type SessionReportDismissalChannel,
} from "../utils/sessionReportToastCoordination";

const DEFAULT_ACTIVITY_LIMIT = 50;

type NotificationRecord = UseNotificationsReturn["notifications"][number];
type ReportCreatedNotificationDto = Extract<
  NotificationDto,
  { eventType: "report.created" }
>;
type SessionReportReadyNotificationDto = Extract<
  NotificationDto,
  { eventType: "session_report_ready" }
>;
type PullRequestMergedNotificationDto = Extract<
  NotificationDto,
  { eventType: "pull_request.merged" }
>;
type CorrelatedActivityRecord = ReturnType<
  typeof useCorrelatedActivity
>["records"][number];
type CorrelatedActivityPagination = ReturnType<
  typeof useCorrelatedActivity
>["pagination"];

export interface NotificationAlertItem {
  activity: CorrelatedActivityRecord;
  notification: NotificationDto | null;
  notificationId: string | null;
  report: ReportDto | null;
  reportId: string | null;
  taskId: string | null;
}

interface NotificationToastItem {
  notificationId: string;
  reportId: string;
  report: ReportDto | null;
  taskId: string | null;
  title: string;
  topNextStep: string | null;
  verificationHint: string | null;
}

export interface SessionReportReadyToastItem {
  notificationId: string;
  sessionId: string;
  reportId: string;
  reportType: ReportType;
  sessionTitle: string;
  reportTitle: string;
  notification: NotificationRecord;
}

export interface PullRequestMergedToastItem {
  notificationId: string;
  projectId: string;
  pullRequestUrl: string;
  taskId: string | null;
  notification: NotificationRecord;
}

export interface UseProjectNotificationActivityOptions {
  organizationId: string;
  /**
   * Project the hook instance is scoped to. Required for `session_report_ready`
   * toast coordination, which keys its localStorage shown-record and dismissal
   * channel per project.
   */
  projectId?: string;
  userId?: string;
  view?: "dropdown" | "full";
  activityLimit?: number;
  activityEnabled?: boolean;
  /**
   * Enable cross-tab `session_report_ready` toast coordination (focus-based
   * display decision, shown-record dedup, dismissal sync). Only the instance
   * that actually renders the toast should opt in — a non-rendering instance
   * would otherwise claim a report via the shown-record and suppress the
   * visible toast. Requires `projectId`.
   */
  coordinateSessionReportToasts?: boolean;
}

export interface UseProjectNotificationActivityReturn {
  alertItems: NotificationAlertItem[];
  currentDailySessionReportReadyToast: SessionReportReadyToastItem | null;
  currentPullRequestMergedToast: PullRequestMergedToastItem | null;
  currentToast: NotificationToastItem | null;
  currentSessionReportReadyToast: SessionReportReadyToastItem | null;
  dismissNotification: (notificationId: string) => Promise<void>;
  error: Error | null;
  hasUnseenDailySessionReportReady: boolean;
  hasUnseenPullRequestMerged: boolean;
  hasUnseenSessionReportReady: boolean;
  isLoading: boolean;
  pagination: CorrelatedActivityPagination;
  popCurrentDailySessionReportReadyToast: () => void;
  popCurrentPullRequestMergedToast: () => void;
  popCurrentToast: () => void;
  popCurrentSessionReportReadyToast: () => void;
  resetDailySessionReportReadyIndicator: () => void;
  resetPullRequestMergedIndicator: () => void;
  resetSessionReportReadyIndicator: () => void;
}

const isReportCreatedNotification = (
  notification: NotificationDto,
): notification is ReportCreatedNotificationDto =>
  notification.eventType === "report.created";

const isSessionReportReadyNotification = (
  notification: NotificationDto,
): notification is SessionReportReadyNotificationDto =>
  notification.eventType === "session_report_ready";

const isPullRequestMergedNotification = (
  notification: NotificationDto,
): notification is PullRequestMergedNotificationDto =>
  notification.eventType === "pull_request.merged";

const getReportIdFromNotification = (
  notification: NotificationDto,
): string | null => {
  if (notification.eventType === "report.created") {
    return notification.entityId;
  }
  if (notification.eventType === "session_report_ready") {
    return notification.payload.reportId;
  }
  return null;
};

const isViewingSession = (pathname: string, sessionId: string): boolean => {
  if (!sessionId) {
    return false;
  }
  return pathname.split("/").some((segment) => segment === sessionId);
};

const isViewingDailySession = (
  pathname: string,
  search: string,
  projectId: string,
): boolean => {
  const pathSegments = pathname.split("/").filter(Boolean);
  if (
    pathSegments.length !== 2 ||
    pathSegments[0] !== "projects" ||
    decodeURIComponent(pathSegments[1] ?? "") !== projectId
  ) {
    return false;
  }

  return new URLSearchParams(search).get("view") === "daily-session";
};

const isViewingProjectActivity = (
  pathname: string,
  search: string,
  projectId: string,
): boolean => {
  const pathSegments = pathname.split("/").filter(Boolean);
  if (
    pathSegments.length !== 2 ||
    pathSegments[0] !== "projects" ||
    decodeURIComponent(pathSegments[1] ?? "") !== projectId
  ) {
    return false;
  }

  return new URLSearchParams(search).get("view") === "coding";
};

const isDailySessionReportReady = (
  item: SessionReportReadyToastItem,
): boolean => item.reportType === "DAILY_SESSION";

const getNotificationTitle = (
  eventType: NotificationDto["eventType"],
): string => {
  switch (eventType) {
    case "report.created":
      return "Report created";
    case "task.completed":
      return "Task completed";
    case "child_unblocked":
      return "Child unblocked";
    case "system_message":
      return "System message";
    case "session_report_ready":
      return "Report ready";
    case "pull_request.merged":
      return "Pull request merged";
    default:
      return eventType;
  }
};

const getNotificationSummary = (notification: NotificationDto): string => {
  switch (notification.eventType) {
    case "task.completed":
      return `${notification.payload.taskName} completed`;
    case "system_message":
      return notification.payload.snippet;
    case "child_unblocked": {
      const count = notification.payload.unblockedChildIds.length;
      return `${count} ${count === 1 ? "task" : "tasks"} unblocked`;
    }
    case "report.created": {
      const firstNextStep = notification.payload.nextSteps[0];
      if (firstNextStep?.title) {
        return firstNextStep.title;
      }
      const firstVerification = notification.payload.verificationTasks[0];
      if (firstVerification?.title) {
        return firstVerification.title;
      }
      const firstRecommended = notification.payload.recommendedUpdates[0];
      if (firstRecommended?.summary) {
        return firstRecommended.summary;
      }
      return "Notification update";
    }
    case "session_report_ready":
      if (notification.payload.reportType === "DAILY_SESSION") {
        return "Your daily session summary is ready for review.";
      }
      return `Report ready for review on ${notification.payload.sessionTitle}`;
    case "pull_request.merged":
      return `${notification.payload.repositoryName} · #${notification.payload.pullRequestNumber} ${notification.payload.pullRequestTitle}`;
    default:
      return "Notification update";
  }
};

const toNotificationRecord = (
  notification: NotificationDto,
): NotificationRecord => ({
  id: notification.id as NotificationRecord["id"],
  notificationId: notification.id,
  eventType: notification.eventType,
  reportId: getReportIdFromNotification(notification),
  createdAt: notification.createdAt,
  status: notification.status,
  readAt: notification.readAt ?? null,
  acknowledgedAt: notification.acknowledgedAt ?? null,
  dismissedAt: notification.dismissedAt ?? null,
  affectedEntityCount: notification.affectedEntities.length,
  isRead: notification.status !== "unread",
  isAcknowledged:
    notification.status === "acknowledged" ||
    notification.status === "dismissed",
  preview: {
    title: getNotificationTitle(notification.eventType),
    summary: getNotificationSummary(notification),
  },
  source: notification,
});

const toSessionReportReadyToastItem = (
  notification: SessionReportReadyNotificationDto,
): SessionReportReadyToastItem => {
  return {
    notificationId: notification.id,
    sessionId: notification.payload.sessionId,
    reportId: notification.payload.reportId,
    reportType: notification.payload.reportType,
    sessionTitle: notification.payload.sessionTitle,
    reportTitle: notification.payload.reportTitle,
    notification: toNotificationRecord(notification),
  };
};

const getAffectedProjectId = (
  notification: PullRequestMergedNotificationDto,
): string | null =>
  notification.affectedEntities.find((entity) => entity.type === "PROJECT")
    ?.id ?? null;

const toPullRequestMergedToastItem = (
  notification: PullRequestMergedNotificationDto,
): PullRequestMergedToastItem | null => {
  const affectedProjectId = getAffectedProjectId(notification);
  if (!affectedProjectId) {
    return null;
  }

  return {
    notificationId: notification.id,
    projectId: affectedProjectId,
    pullRequestUrl: notification.payload.pullRequestUrl,
    taskId: notification.payload.taskId ?? null,
    notification: toNotificationRecord(notification),
  };
};

const getTaskIdFromNotification = (
  notification: NotificationDto,
): string | null => {
  const taskEntity = notification.affectedEntities.find(
    (entity) => entity.type === "TASK",
  );

  return taskEntity?.id ?? null;
};

const getTaskIdFromActivity = (
  activity: CorrelatedActivityRecord,
): string | null => {
  const taskEntity = activity.linkedEntities.find(
    (entity) => entity.entityType === "TASK",
  );

  return taskEntity?.entityId ?? null;
};

const getReportById = (
  records: CorrelatedActivityRecord[],
): Map<string, ReportDto> => {
  const reportsById = new Map<string, ReportDto>();

  records.forEach((activity) => {
    activity.reports.forEach((report) => {
      reportsById.set(report.id, report);
    });
  });

  return reportsById;
};

const getNotificationByReportId = (
  notifications: NotificationDto[],
): Map<string, NotificationDto> => {
  const notificationsByReportId = new Map<string, NotificationDto>();

  notifications.forEach((notification) => {
    const reportId = getReportIdFromNotification(notification);
    if (reportId === null) {
      return;
    }

    if (!notificationsByReportId.has(reportId)) {
      notificationsByReportId.set(reportId, notification);
    }
  });

  return notificationsByReportId;
};

const logDebug = console.debug.bind(
  console,
  "[useProjectNotificationActivity]",
);

const toToastItem = (
  notification: ReportCreatedNotificationDto,
  reportsById: Map<string, ReportDto>,
): NotificationToastItem => {
  return {
    notificationId: notification.id,
    reportId: notification.entityId,
    report: reportsById.get(notification.entityId) ?? null,
    taskId: getTaskIdFromNotification(notification),
    title: getNotificationTitle(notification.eventType),
    topNextStep: notification.payload.nextSteps[0]?.title ?? null,
    verificationHint: notification.payload.verificationTasks[0]?.title ?? null,
  };
};

export const useProjectNotificationActivity = ({
  organizationId,
  projectId,
  userId,
  view = "dropdown",
  activityLimit = DEFAULT_ACTIVITY_LIMIT,
  activityEnabled = true,
  coordinateSessionReportToasts = false,
}: UseProjectNotificationActivityOptions): UseProjectNotificationActivityReturn => {
  const webSocketService = useOptionalWebSocketService();
  const location = useLocation();
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedSeenRef = useRef(false);
  const currentPathnameRef = useRef(location.pathname);
  currentPathnameRef.current = location.pathname;
  const currentSearchRef = useRef(location.search);
  currentSearchRef.current = location.search;

  // Coordination runs only for the toast-rendering instance, and only once a
  // project scope is known to key the shown-record and dismissal channel.
  const coordinationEnabled =
    coordinateSessionReportToasts && Boolean(projectId);

  const [notifications, setNotifications] = useState<NotificationDto[]>([]);

  useEffect(() => {
    if (!webSocketService) {
      return;
    }

    const subscriptionId = webSocketService.subscribe({
      events: {
        onSystemNotification: (event: WebSocketSystemNotificationEvent) => {
          if (event.organizationId !== organizationId) {
            return;
          }

          if (userId && event.userId !== userId) {
            return;
          }

          setNotifications((existing) => {
            const incoming = event.notification;
            const filtered = existing.filter(
              (notification) => notification.id !== incoming.id,
            );
            return [incoming, ...filtered];
          });
        },
      },
    });

    return () => {
      webSocketService.unsubscribe(subscriptionId);
    };
  }, [organizationId, userId, webSocketService]);

  const subscribeToSystemNotification = useCallback(
    (onUpdate: () => void): (() => void) | void => {
      if (!webSocketService) {
        return;
      }

      const subscriptionId = webSocketService.subscribe({
        events: {
          onSystemNotification: (event: WebSocketSystemNotificationEvent) => {
            if (event.organizationId !== organizationId) {
              return;
            }

            if (userId && event.userId !== userId) {
              return;
            }

            onUpdate();
          },
        },
      });

      return () => {
        webSocketService.unsubscribe(subscriptionId);
      };
    },
    [organizationId, userId, webSocketService],
  );

  const {
    records,
    pagination,
    isLoading: isActivityLoading,
    error: activityError,
    refetch: refetchActivity,
  } = useCorrelatedActivity(organizationId, {
    enabled: activityEnabled,
    limit: activityLimit,
    refetchOnStale: false,
    subscribeToUpdates:
      activityEnabled && webSocketService
        ? subscribeToSystemNotification
        : undefined,
    view,
  });

  const [toastQueue, setToastQueue] = useState<NotificationToastItem[]>([]);
  const [pullRequestMergedToastQueue, setPullRequestMergedToastQueue] =
    useState<PullRequestMergedToastItem[]>([]);
  const [sessionReportReadyToastQueue, setSessionReportReadyToastQueue] =
    useState<SessionReportReadyToastItem[]>([]);
  const [
    dailySessionReportReadyToastQueue,
    setDailySessionReportReadyToastQueue,
  ] = useState<SessionReportReadyToastItem[]>([]);
  const [hasUnseenSessionReportReady, setHasUnseenSessionReportReady] =
    useState(false);
  const [hasUnseenPullRequestMerged, setHasUnseenPullRequestMerged] =
    useState(false);
  const pullRequestMergedScopeRef = useRef({ organizationId, projectId });
  const [
    hasUnseenDailySessionReportReady,
    setHasUnseenDailySessionReportReady,
  ] = useState(false);
  // session_report_ready toasts that arrived while the tab was unfocused.
  // Re-evaluated when the tab next gains focus (see the focus listener below).
  const [pendingSessionReportReady, setPendingSessionReportReady] = useState<
    SessionReportReadyToastItem[]
  >([]);

  const sessionReportReadyToastQueueRef = useRef(sessionReportReadyToastQueue);
  sessionReportReadyToastQueueRef.current = sessionReportReadyToastQueue;
  const dailySessionReportReadyToastQueueRef = useRef(
    dailySessionReportReadyToastQueue,
  );
  dailySessionReportReadyToastQueueRef.current =
    dailySessionReportReadyToastQueue;
  const pendingSessionReportReadyRef = useRef(pendingSessionReportReady);
  pendingSessionReportReadyRef.current = pendingSessionReportReady;
  const dismissalChannelRef = useRef<SessionReportDismissalChannel | null>(
    null,
  );

  const reportsById = useMemo(() => getReportById(records), [records]);

  useEffect(() => {
    const previousScope = pullRequestMergedScopeRef.current;
    pullRequestMergedScopeRef.current = { organizationId, projectId };

    if (
      previousScope.organizationId === organizationId &&
      previousScope.projectId === projectId
    ) {
      return;
    }

    setPullRequestMergedToastQueue([]);
    setHasUnseenPullRequestMerged(false);
  }, [organizationId, projectId]);

  const sortedNotifications = useMemo(
    () =>
      [...notifications].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      ),
    [notifications],
  );

  const notificationsByReportId = useMemo(
    () => getNotificationByReportId(sortedNotifications),
    [sortedNotifications],
  );

  const alertItems = useMemo<NotificationAlertItem[]>(
    () =>
      records.map((activity) => {
        const report = activity.reports[0] ?? null;
        const matchedNotification = report
          ? (notificationsByReportId.get(report.id) ?? null)
          : null;
        const reportId =
          report?.id ??
          (matchedNotification
            ? getReportIdFromNotification(matchedNotification)
            : null);

        return {
          activity,
          notification: matchedNotification,
          notificationId: matchedNotification?.id ?? null,
          report,
          reportId,
          taskId:
            getTaskIdFromActivity(activity) ??
            (matchedNotification
              ? getTaskIdFromNotification(matchedNotification)
              : null),
        };
      }),
    [notificationsByReportId, records],
  );

  /**
   * Apply the cross-tab display decision to a batch of `session_report_ready`
   * toast items. For each item, in order: a prior shown-record suppresses it;
   * viewing the originating session writes the shown-record and shows nothing;
   * a focused tab enqueues the toast and writes the shown-record; an unfocused
   * tab defers the item to pending state for re-evaluation on focus.
   */
  const evaluateSessionReportReadyItems = useCallback(
    (
      items: SessionReportReadyToastItem[],
      projectScopeId: string,
    ): {
      toastsToEnqueue: SessionReportReadyToastItem[];
      stillPending: SessionReportReadyToastItem[];
    } => {
      const toastsToEnqueue: SessionReportReadyToastItem[] = [];
      const stillPending: SessionReportReadyToastItem[] = [];
      const tabHasFocus =
        typeof document !== "undefined" && document.hasFocus();

      items.forEach((item) => {
        if (hasShownRecord(projectScopeId, item.reportId)) {
          return;
        }
        const isViewingDestination = isDailySessionReportReady(item)
          ? isViewingDailySession(
              currentPathnameRef.current,
              currentSearchRef.current,
              projectScopeId,
            )
          : isViewingSession(currentPathnameRef.current, item.sessionId);
        if (isViewingDestination) {
          writeShownRecord(projectScopeId, item.reportId);
          return;
        }
        if (tabHasFocus) {
          writeShownRecord(projectScopeId, item.reportId);
          toastsToEnqueue.push(item);
          return;
        }
        stillPending.push(item);
      });

      return { toastsToEnqueue, stillPending };
    },
    [],
  );

  useEffect(() => {
    const currentNotificationIds = new Set<string>();
    sortedNotifications.forEach((notification) => {
      currentNotificationIds.add(notification.id);
    });

    if (!hasInitializedSeenRef.current) {
      hasInitializedSeenRef.current = true;
      seenNotificationIdsRef.current = currentNotificationIds;
      return;
    }

    const newNotifications = sortedNotifications.filter(
      (notification) => !seenNotificationIdsRef.current.has(notification.id),
    );

    const newToastItems = newNotifications
      .filter(isReportCreatedNotification)
      .map((notification) => toToastItem(notification, reportsById));

    const newSessionReportReadyItems = newNotifications
      .filter(isSessionReportReadyNotification)
      .map(toSessionReportReadyToastItem);
    const newPullRequestMergedItems = newNotifications
      .filter(isPullRequestMergedNotification)
      .map(toPullRequestMergedToastItem)
      .filter((item): item is PullRequestMergedToastItem => item !== null);

    sortedNotifications.forEach((notification) => {
      seenNotificationIdsRef.current.add(notification.id);
    });

    seenNotificationIdsRef.current.forEach((notificationId) => {
      if (!currentNotificationIds.has(notificationId)) {
        seenNotificationIdsRef.current.delete(notificationId);
      }
    });

    if (newToastItems.length > 0) {
      logDebug("enqueueing new toast items", {
        count: newToastItems.length,
      });
      setToastQueue((existingItems) => [...existingItems, ...newToastItems]);
    }

    if (coordinationEnabled && projectId !== undefined) {
      const scopedMergeItems = newPullRequestMergedItems.filter(
        (item) => item.projectId === projectId,
      );
      if (
        scopedMergeItems.length > 0 &&
        !isViewingProjectActivity(
          currentPathnameRef.current,
          currentSearchRef.current,
          projectId,
        )
      ) {
        setPullRequestMergedToastQueue((existingItems) => [
          ...existingItems,
          ...scopedMergeItems,
        ]);
        setHasUnseenPullRequestMerged(true);
      }
    }

    if (
      !coordinationEnabled ||
      projectId === undefined ||
      newSessionReportReadyItems.length === 0
    ) {
      return;
    }

    const { toastsToEnqueue, stillPending } = evaluateSessionReportReadyItems(
      newSessionReportReadyItems,
      projectId,
    );

    if (toastsToEnqueue.length > 0) {
      logDebug("enqueueing new session_report_ready toast items", {
        count: toastsToEnqueue.length,
      });
      const dailySessionItems = toastsToEnqueue.filter(
        isDailySessionReportReady,
      );
      const sessionItems = toastsToEnqueue.filter(
        (item) => !isDailySessionReportReady(item),
      );
      if (sessionItems.length > 0) {
        setSessionReportReadyToastQueue((existingItems) => [
          ...existingItems,
          ...sessionItems,
        ]);
        setHasUnseenSessionReportReady(true);
      }
      if (dailySessionItems.length > 0) {
        setDailySessionReportReadyToastQueue((existingItems) => [
          ...existingItems,
          ...dailySessionItems,
        ]);
        setHasUnseenDailySessionReportReady(true);
      }
    }

    if (stillPending.length > 0) {
      logDebug("deferring session_report_ready toast items (tab unfocused)", {
        count: stillPending.length,
      });
      setPendingSessionReportReady((existingItems) => {
        const knownReportIds = new Set(
          existingItems.map((item) => item.reportId),
        );
        const freshItems = stillPending.filter(
          (item) => !knownReportIds.has(item.reportId),
        );
        return freshItems.length > 0
          ? [...existingItems, ...freshItems]
          : existingItems;
      });
    }
  }, [
    coordinationEnabled,
    evaluateSessionReportReadyItems,
    projectId,
    reportsById,
    sortedNotifications,
  ]);

  useEffect(() => {
    if (reportsById.size === 0) {
      return;
    }

    setToastQueue((existingItems) =>
      existingItems.map((item) => {
        if (item.report) {
          return item;
        }

        return {
          ...item,
          report: reportsById.get(item.reportId) ?? null,
        };
      }),
    );
  }, [reportsById]);

  /**
   * Re-run the display decision for every deferred `session_report_ready`
   * item. Browser focus is single-valued and focus events are serialized, so
   * the first tab to return here writes the shown-record and shows the toast
   * while later tabs find the record and suppress — no lock or election.
   */
  const reevaluatePendingSessionReportReady = useCallback((): void => {
    if (!coordinationEnabled || projectId === undefined) {
      return;
    }
    const pending = pendingSessionReportReadyRef.current;
    if (pending.length === 0) {
      return;
    }

    const { toastsToEnqueue, stillPending } = evaluateSessionReportReadyItems(
      pending,
      projectId,
    );

    if (toastsToEnqueue.length > 0) {
      logDebug("showing deferred session_report_ready toast items on focus", {
        count: toastsToEnqueue.length,
      });
      const dailySessionItems = toastsToEnqueue.filter(
        isDailySessionReportReady,
      );
      const sessionItems = toastsToEnqueue.filter(
        (item) => !isDailySessionReportReady(item),
      );
      if (sessionItems.length > 0) {
        setSessionReportReadyToastQueue((existingItems) => [
          ...existingItems,
          ...sessionItems,
        ]);
        setHasUnseenSessionReportReady(true);
      }
      if (dailySessionItems.length > 0) {
        setDailySessionReportReadyToastQueue((existingItems) => [
          ...existingItems,
          ...dailySessionItems,
        ]);
        setHasUnseenDailySessionReportReady(true);
      }
    }

    if (stillPending.length !== pending.length) {
      setPendingSessionReportReady(stillPending);
    }
  }, [coordinationEnabled, evaluateSessionReportReadyItems, projectId]);

  useEffect(() => {
    if (!coordinationEnabled) {
      return;
    }
    window.addEventListener("focus", reevaluatePendingSessionReportReady);
    document.addEventListener(
      "visibilitychange",
      reevaluatePendingSessionReportReady,
    );
    return () => {
      window.removeEventListener("focus", reevaluatePendingSessionReportReady);
      document.removeEventListener(
        "visibilitychange",
        reevaluatePendingSessionReportReady,
      );
    };
  }, [coordinationEnabled, reevaluatePendingSessionReportReady]);

  useEffect(() => {
    if (!coordinationEnabled || projectId === undefined) {
      return;
    }
    const channel = createSessionReportDismissalChannel(projectId);
    dismissalChannelRef.current = channel;
    const unsubscribe = channel.subscribe((reportId) => {
      setSessionReportReadyToastQueue((existingItems) =>
        existingItems.filter((item) => item.reportId !== reportId),
      );
      setDailySessionReportReadyToastQueue((existingItems) =>
        existingItems.filter((item) => item.reportId !== reportId),
      );
    });
    return () => {
      unsubscribe();
      channel.close();
      dismissalChannelRef.current = null;
    };
  }, [coordinationEnabled, projectId]);

  const dismissNotification = useCallback(
    async (notificationId: string): Promise<void> => {
      logDebug("dismissNotification start", {
        notificationId,
      });
      await notificationsClient.dismissNotification({
        organizationId,
        notificationId,
      });
      setNotifications((existing) =>
        existing.filter((notification) => notification.id !== notificationId),
      );
      await refetchActivity();
      logDebug("dismissNotification completed", {
        notificationId,
      });
    },
    [organizationId, refetchActivity],
  );

  const popCurrentToast = useCallback((): void => {
    setToastQueue((existingItems) => existingItems.slice(1));
  }, []);

  const popCurrentPullRequestMergedToast = useCallback((): void => {
    setPullRequestMergedToastQueue((existingItems) => existingItems.slice(1));
  }, []);

  const popCurrentSessionReportReadyToast = useCallback((): void => {
    const dismissed = sessionReportReadyToastQueueRef.current[0];
    if (dismissed) {
      dismissalChannelRef.current?.broadcastDismissal(dismissed.reportId);
    }
    setSessionReportReadyToastQueue((existingItems) => existingItems.slice(1));
  }, []);

  const popCurrentDailySessionReportReadyToast = useCallback((): void => {
    const dismissed = dailySessionReportReadyToastQueueRef.current[0];
    if (dismissed) {
      dismissalChannelRef.current?.broadcastDismissal(dismissed.reportId);
    }
    setDailySessionReportReadyToastQueue((existingItems) =>
      existingItems.slice(1),
    );
  }, []);

  const resetSessionReportReadyIndicator = useCallback((): void => {
    setHasUnseenSessionReportReady(false);
  }, []);

  const resetPullRequestMergedIndicator = useCallback((): void => {
    setHasUnseenPullRequestMerged(false);
  }, []);

  const resetDailySessionReportReadyIndicator = useCallback((): void => {
    setHasUnseenDailySessionReportReady(false);
  }, []);

  useEffect(() => {
    if (
      projectId === undefined ||
      !isViewingDailySession(location.pathname, location.search, projectId)
    ) {
      return;
    }

    setHasUnseenDailySessionReportReady(false);
    setDailySessionReportReadyToastQueue([]);
    setPendingSessionReportReady((existingItems) =>
      existingItems.filter((item) => !isDailySessionReportReady(item)),
    );
  }, [location.pathname, location.search, projectId]);

  useEffect(() => {
    if (
      projectId === undefined ||
      !isViewingProjectActivity(location.pathname, location.search, projectId)
    ) {
      return;
    }

    setHasUnseenPullRequestMerged(false);
    setPullRequestMergedToastQueue([]);
  }, [location.pathname, location.search, projectId]);

  const currentToast = toastQueue[0] ?? null;
  const currentPullRequestMergedToast = pullRequestMergedToastQueue[0] ?? null;
  const currentSessionReportReadyToast =
    sessionReportReadyToastQueue[0] ?? null;
  const currentDailySessionReportReadyToast =
    dailySessionReportReadyToastQueue[0] ?? null;

  return {
    alertItems,
    currentDailySessionReportReadyToast,
    currentPullRequestMergedToast,
    currentToast,
    currentSessionReportReadyToast,
    dismissNotification,
    error: activityError,
    hasUnseenDailySessionReportReady,
    hasUnseenPullRequestMerged,
    hasUnseenSessionReportReady,
    isLoading: isActivityLoading,
    pagination,
    popCurrentDailySessionReportReadyToast,
    popCurrentPullRequestMergedToast,
    popCurrentToast,
    popCurrentSessionReportReadyToast,
    resetDailySessionReportReadyIndicator,
    resetPullRequestMergedIndicator,
    resetSessionReportReadyIndicator,
  };
};
