import {
  queryOptions,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import type {
  NotificationChannel,
  NotificationDto,
  NotificationEventType,
  NotificationPreferencesDto,
  NotificationStatus,
  ReportType,
  UpdateNotificationPreferencesDto,
} from "../../api";
import { notificationsClient } from "../../clients/serviceClients";

type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

type NotificationId = Brand<string, "NotificationId">;

interface NotificationPreview {
  title: string;
  summary: string;
}

export interface NotificationRecord {
  id: NotificationId;
  notificationId: string;
  eventType: NotificationEventType;
  reportId: string | null;
  createdAt: string;
  status: NotificationStatus;
  readAt: string | null;
  acknowledgedAt: string | null;
  dismissedAt: string | null;
  affectedEntityCount: number;
  isRead: boolean;
  isAcknowledged: boolean;
  preview: NotificationPreview;
  source: NotificationDto;
}

export interface NotificationPagination {
  limit: number;
  offset: number;
  totalCount: number | null;
  nextOffset: number | null;
}

export interface NotificationsData {
  items: NotificationRecord[];
  records: NotificationRecord[];
  pagination: NotificationPagination;
}

export interface NotificationsFetchParams {
  organizationId: string;
  userId?: string;
  eventType?: NotificationEventType[];
  status?: NotificationStatus;
  channel?: NotificationChannel;
  includeDismissed?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
}

/** Server-side list parameters as they appear in the list key. */
export interface NotificationListParams {
  userId: string | null;
  eventType: NotificationEventType[] | null;
  status: NotificationStatus | null;
  channel: NotificationChannel | null;
  includeDismissed: boolean | null;
  createdAfter: string | null;
  createdBefore: string | null;
  limit: number | null;
  offset: number | null;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;
const MS_FALLBACK = 0;

const parseNumericHeader = (value: unknown): number | null => {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const normalizeEventTypes = (
  values?: NotificationEventType[],
): NotificationEventType[] | null => {
  if (!values?.length) {
    return null;
  }

  return [...new Set(values)].sort();
};

const toNotificationId = (value: string): NotificationId =>
  value as NotificationId;

const toNotificationTitle = (eventType: NotificationEventType): string => {
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

const toReportPreviewSummary = (
  notification: NotificationDto & { eventType: "report.created" },
): string => {
  const firstNextStep = notification.payload.nextSteps[0];
  if (firstNextStep?.title) {
    return firstNextStep.title;
  }

  const firstVerificationTask = notification.payload.verificationTasks[0];
  if (firstVerificationTask?.title) {
    return firstVerificationTask.title;
  }

  const firstRecommendedUpdate = notification.payload.recommendedUpdates[0];
  if (firstRecommendedUpdate?.summary) {
    return firstRecommendedUpdate.summary;
  }

  return "Notification update";
};

const SESSION_REPORT_READY_COPY: Partial<Record<ReportType, string>> = {
  CODING_RESEARCH: "The agent has finished investigating the codebase.",
  DAILY_SESSION: "Your daily session summary is ready for review.",
  SESSION_SUMMARY: "The agent has summarized this session.",
  COMMIT: "The agent has prepared a commit summary.",
  PLAN: "The agent has finished planning; the plan is ready for review.",
  IMPLEMENT:
    "The agent has finished implementing; the changes are ready for review.",
  FEATURE_SYNC: "The agent has completed its feature analysis.",
  FEATURE_SYNC_HANDOFF: "The agent has prepared a feature-sync handoff.",
  VALIDATION_WALKTHROUGH: "The agent has completed its validation walkthrough.",
  FEATURE_TREE_ANALYSIS: "The agent has completed its feature-tree analysis.",
  COMPETITIVE_ANALYSIS: "The agent has completed its competitive analysis.",
};

const toSessionReportReadySummary = (
  notification: NotificationDto & { eventType: "session_report_ready" },
): string => {
  const { reportType, sessionTitle } = notification.payload;
  return (
    SESSION_REPORT_READY_COPY[reportType] ??
    `Report ready for review on ${sessionTitle}`
  );
};

const toPreviewSummary = (notification: NotificationDto): string => {
  switch (notification.eventType) {
    case "task.completed":
      return `${notification.payload.taskName} completed`;
    case "system_message":
      return notification.payload.snippet;
    case "child_unblocked": {
      const count = notification.payload.unblockedChildIds.length;
      return `${count} ${count === 1 ? "task" : "tasks"} unblocked`;
    }
    case "report.created":
      return toReportPreviewSummary(notification);
    case "session_report_ready":
      return toSessionReportReadySummary(notification);
    case "pull_request.merged":
      return `${notification.payload.repositoryName} · #${notification.payload.pullRequestNumber} ${notification.payload.pullRequestTitle}`;
    default:
      return "Notification update";
  }
};

const toReportId = (notification: NotificationDto): string | null => {
  switch (notification.eventType) {
    case "report.created":
      return notification.entityId;
    case "session_report_ready":
      return notification.payload.reportId;
    default:
      return null;
  }
};

const toEpochMs = (value: string | null | undefined): number => {
  if (!value) {
    return MS_FALLBACK;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : MS_FALLBACK;
};

const getNotificationVersionMs = (
  record: Pick<
    NotificationRecord,
    "createdAt" | "readAt" | "acknowledgedAt" | "dismissedAt"
  >,
): number => {
  return Math.max(
    toEpochMs(record.createdAt),
    toEpochMs(record.readAt),
    toEpochMs(record.acknowledgedAt),
    toEpochMs(record.dismissedAt),
  );
};

export const mapNotificationDto = (
  notification: NotificationDto,
): NotificationRecord => {
  return {
    id: toNotificationId(notification.id),
    notificationId: notification.id,
    eventType: notification.eventType,
    reportId: toReportId(notification),
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
      title: toNotificationTitle(notification.eventType),
      summary: toPreviewSummary(notification),
    },
    source: notification,
  };
};

export const resolveNotificationConflict = (
  existingRecord: NotificationRecord,
  incomingRecord: NotificationRecord,
): NotificationRecord => {
  const existingVersion = getNotificationVersionMs(existingRecord);
  const incomingVersion = getNotificationVersionMs(incomingRecord);

  if (incomingVersion > existingVersion) {
    return incomingRecord;
  }

  if (incomingVersion < existingVersion) {
    return existingRecord;
  }

  return incomingRecord;
};

const sortNotifications = (
  records: NotificationRecord[],
): NotificationRecord[] => {
  const sortedRecords = [...records];
  sortedRecords.sort((left, right) => {
    const byCreatedAt = toEpochMs(right.createdAt) - toEpochMs(left.createdAt);

    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }

    return right.notificationId.localeCompare(left.notificationId);
  });

  return sortedRecords;
};

const mapNotificationDtos = (
  notifications: NotificationDto[],
): NotificationRecord[] => {
  const dedupedRecords = new Map<string, NotificationRecord>();

  notifications.forEach((notification) => {
    const mappedRecord = mapNotificationDto(notification);
    const currentRecord = dedupedRecords.get(mappedRecord.notificationId);

    if (!currentRecord) {
      dedupedRecords.set(mappedRecord.notificationId, mappedRecord);
      return;
    }

    dedupedRecords.set(
      mappedRecord.notificationId,
      resolveNotificationConflict(currentRecord, mappedRecord),
    );
  });

  return sortNotifications(Array.from(dedupedRecords.values()));
};

export async function fetchNotificationsPage(
  params: NotificationsFetchParams,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<NotificationsData> {
  const {
    organizationId,
    userId,
    eventType,
    status,
    channel,
    includeDismissed,
    createdAfter,
    createdBefore,
    limit = DEFAULT_LIMIT,
    offset = DEFAULT_OFFSET,
  } = params;

  const response = await notificationsClient.listNotifications(
    {
      organizationId: organizationId,
      userId: userId,
      eventType: eventType,
      status: status,
      channel: channel,
      includeDismissed: includeDismissed,
      createdAfter: createdAfter,
      createdBefore: createdBefore,
      limit: limit,
      offset: offset,
    },
    requestOptions,
  );

  const responsePayload = response.data;
  const records = Array.isArray(responsePayload?.data)
    ? responsePayload.data
    : [];
  const mappedRecords = mapNotificationDtos(records);
  const totalCount = parseNumericHeader(response.headers?.["x-total-count"]);
  const nextOffset = parseNumericHeader(response.headers?.["x-next-offset"]);

  const pagination: NotificationPagination = {
    limit,
    offset,
    totalCount,
    nextOffset,
  };

  return {
    items: mappedRecords,
    records: mappedRecords,
    pagination,
  };
}

export async function markNotificationRead(
  organizationId: string,
  notificationId: string,
): Promise<NotificationRecord> {
  const response = await notificationsClient.markNotificationRead({
    organizationId: organizationId,
    notificationId: notificationId,
  });

  return mapNotificationDto(response.data);
}

export async function markNotificationUnread(
  organizationId: string,
  notificationId: string,
): Promise<NotificationRecord> {
  const response = await notificationsClient.markNotificationUnread({
    organizationId: organizationId,
    notificationId: notificationId,
  });

  return mapNotificationDto(response.data);
}

export async function acknowledgeNotification(
  organizationId: string,
  notificationId: string,
): Promise<NotificationRecord> {
  const response = await notificationsClient.acknowledgeNotification({
    organizationId: organizationId,
    notificationId: notificationId,
  });

  return mapNotificationDto(response.data);
}

export async function fetchNotificationPreferences(
  organizationId: string,
  userId: string,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<NotificationPreferencesDto | null> {
  const response = await notificationsClient.getUserNotificationPreferences(
    {
      organizationId: organizationId,
      id: userId,
    },
    requestOptions,
  );

  return response.data.data ?? null;
}

export async function updateNotificationPreferences(
  organizationId: string,
  userId: string,
  updates: UpdateNotificationPreferencesDto,
): Promise<NotificationPreferencesDto | null> {
  const response = await notificationsClient.updateUserNotificationPreferences({
    organizationId: organizationId,
    id: userId,
    updateNotificationPreferencesDto: updates,
  });

  return response.data.data ?? null;
}

/**
 * Prefix tree for notification reads. A list key carries the server-side
 * parameters (filters and page); `lists` covers every list in the
 * organization, `all` adds preferences.
 */
export const notificationKeys = {
  root: () => ["notifications"] as const,
  all: (organizationId: string) => ["notifications", organizationId] as const,
  lists: (organizationId: string) =>
    [...notificationKeys.all(organizationId), "list"] as const,
  list: (organizationId: string, params: NotificationListParams) =>
    [...notificationKeys.lists(organizationId), params] as const,
  preferences: (organizationId: string, userId: string) =>
    [...notificationKeys.all(organizationId), "preferences", userId] as const,
};

export function toNotificationListParams(
  params: Omit<NotificationsFetchParams, "organizationId">,
): NotificationListParams {
  return {
    userId: params.userId ?? null,
    eventType: normalizeEventTypes(params.eventType),
    status: params.status ?? null,
    channel: params.channel ?? null,
    includeDismissed: params.includeDismissed ?? null,
    createdAfter: params.createdAfter ?? null,
    createdBefore: params.createdBefore ?? null,
    limit: params.limit ?? null,
    offset: params.offset ?? null,
  };
}

export function notificationListQueryOptions(
  organizationId: string,
  params: NotificationListParams,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: notificationKeys.list(organizationId, params),
    queryFn: ({ signal }) =>
      fetchNotificationsPage(
        {
          organizationId,
          userId: params.userId ?? undefined,
          eventType: params.eventType ?? undefined,
          status: params.status ?? undefined,
          channel: params.channel ?? undefined,
          includeDismissed: params.includeDismissed ?? undefined,
          createdAfter: params.createdAfter ?? undefined,
          createdBefore: params.createdBefore ?? undefined,
          limit: params.limit ?? undefined,
          offset: params.offset ?? undefined,
        },
        { ...captureRequestOptions(), signal },
      ),
  });
}

export function notificationPreferencesQueryOptions(
  organizationId: string,
  userId: string,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: notificationKeys.preferences(organizationId, userId),
    queryFn: async ({ signal }) => {
      const data = await fetchNotificationPreferences(organizationId, userId, {
        ...captureRequestOptions(),
        signal,
      });
      if (!data) {
        throw new Error("Notification preferences not found");
      }
      return data;
    },
  });
}

export const createEmptyNotificationPagination = (
  limit: number | null | undefined,
  offset: number | null | undefined,
): NotificationPagination => ({
  limit: limit ?? DEFAULT_LIMIT,
  offset: offset ?? DEFAULT_OFFSET,
  totalCount: null,
  nextOffset: null,
});

const isWithinCreatedRange = (
  createdAt: string,
  createdAfter: string | null,
  createdBefore: string | null,
): boolean => {
  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return true;
  if (createdAfter) {
    const createdAfterMs = new Date(createdAfter).getTime();
    if (Number.isFinite(createdAfterMs) && createdAtMs < createdAfterMs) {
      return false;
    }
  }
  if (createdBefore) {
    const createdBeforeMs = new Date(createdBefore).getTime();
    if (Number.isFinite(createdBeforeMs) && createdAtMs > createdBeforeMs) {
      return false;
    }
  }
  return true;
};

/**
 * Whether a record belongs in a list read with these parameters. A record
 * delivered without channel metadata stays in a channel-filtered list only if
 * it was already there.
 */
const matchesListParams = (
  record: NotificationRecord,
  params: NotificationListParams,
  channel: NotificationChannel | undefined,
  existedBefore: boolean,
): boolean => {
  if (params.eventType?.length && !params.eventType.includes(record.eventType))
    return false;
  if (params.status && record.status !== params.status) return false;
  if (params.includeDismissed !== true && record.dismissedAt) return false;
  if (
    !isWithinCreatedRange(
      record.createdAt,
      params.createdAfter,
      params.createdBefore,
    )
  )
    return false;
  if (params.channel) {
    if (!channel) return existedBefore;
    if (channel !== params.channel) return false;
  }
  return true;
};

export interface NotificationWriteOptions {
  /** Only lists read for this user (or for no specific user) are written. */
  userId?: string;
  /** Delivery channel of a pushed record, for channel-filtered lists. */
  channel?: NotificationChannel;
  /**
   * The record is this client's own change (optimistic or the server's
   * response to it) and replaces the cached version outright. Pushed records
   * instead keep whichever version is newer.
   */
  authoritative?: boolean;
}

/**
 * Upserts one record into a list page by notification id (never appending a
 * duplicate), keeping the newer version on conflict, dropping it when it no
 * longer matches the list's parameters and trimming to the page limit.
 */
export function reconcileNotificationList(
  data: NotificationsData | undefined,
  params: NotificationListParams,
  incoming: NotificationRecord,
  options: NotificationWriteOptions = {},
): NotificationsData {
  const { channel, authoritative = false } = options;
  const current = data?.records ?? [];
  const existing = current.find(
    (record) => record.notificationId === incoming.notificationId,
  );
  const merged =
    existing && !authoritative
      ? resolveNotificationConflict(existing, incoming)
      : incoming;
  const others = current.filter(
    (record) => record.notificationId !== incoming.notificationId,
  );
  const pagination =
    data?.pagination ??
    createEmptyNotificationPagination(params.limit, params.offset);
  const records = sortNotifications(
    matchesListParams(merged, params, channel, !!existing)
      ? [...others, merged]
      : others,
  );
  const limited =
    pagination.limit > 0 ? records.slice(0, pagination.limit) : records;
  const existsAfter = limited.some(
    (record) => record.notificationId === incoming.notificationId,
  );
  const count = pagination.totalCount ?? 0;
  const totalCount =
    !existing && existsAfter
      ? count + 1
      : existing && !existsAfter
        ? Math.max(0, count - 1)
        : count;
  return {
    items: limited,
    records: limited,
    pagination: { ...pagination, totalCount },
  };
}

type NotificationListEntry = [QueryKey, NotificationsData | undefined];

const listParamsOf = (queryKey: QueryKey): NotificationListParams =>
  queryKey[3] as NotificationListParams;

/** Loaded list pages in the organization, optionally only those read for this user. */
function loadedNotificationLists(
  client: QueryClient,
  organizationId: string,
  userId?: string,
): NotificationListEntry[] {
  return client
    .getQueriesData<NotificationsData>({
      queryKey: notificationKeys.lists(organizationId),
    })
    .filter(([queryKey, data]) => {
      if (!data) return false;
      const listUserId = listParamsOf(queryKey).userId;
      return !listUserId || !userId || listUserId === userId;
    });
}

/**
 * Writes records into every loaded list page in the organization. Returns a
 * rollback that restores each page it changed, unless that page has changed
 * again since, in which case the page is re-read instead.
 */
export function writeNotificationRecords(
  client: QueryClient,
  organizationId: string,
  records: NotificationRecord[],
  options: NotificationWriteOptions = {},
): () => void {
  const written: Array<{
    queryKey: QueryKey;
    previous: NotificationsData | undefined;
    next: NotificationsData | undefined;
  }> = [];
  for (const [queryKey, data] of loadedNotificationLists(
    client,
    organizationId,
    options.userId,
  )) {
    const params = listParamsOf(queryKey);
    const next = records.reduce<NotificationsData | undefined>(
      (page, record) =>
        reconcileNotificationList(page, params, record, options),
      data,
    );
    client.setQueryData(queryKey, next);
    written.push({
      queryKey,
      previous: data,
      next: client.getQueryData<NotificationsData>(queryKey),
    });
  }
  return () => {
    for (const { queryKey, previous, next } of written) {
      if (client.getQueryData(queryKey) === next) {
        client.setQueryData(queryKey, previous);
      } else {
        void client.invalidateQueries({ queryKey, exact: true });
      }
    }
  };
}

/** The local record a status change produces before the server confirms it. */
export function withOptimisticNotificationStatus(
  record: NotificationRecord,
  status: NotificationStatus,
  at: string,
): NotificationRecord {
  return mapNotificationDto({
    ...record.source,
    status,
    readAt: status === "unread" ? null : (record.source.readAt ?? at),
    acknowledgedAt:
      status === "acknowledged" ? at : (record.source.acknowledgedAt ?? null),
  } as NotificationDto);
}

/** The cached record for a notification in any loaded list page. */
export function findCachedNotification(
  client: QueryClient,
  organizationId: string,
  notificationId: string,
): NotificationRecord | undefined {
  for (const [, data] of loadedNotificationLists(client, organizationId)) {
    const record = data?.records.find(
      (candidate) => candidate.notificationId === notificationId,
    );
    if (record) return record;
  }
  return undefined;
}
