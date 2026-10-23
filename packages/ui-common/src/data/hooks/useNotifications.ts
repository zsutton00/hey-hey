import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  NotificationChannel,
  NotificationEventType,
  NotificationPreferencesDto,
  NotificationStatus,
  UpdateNotificationPreferencesDto,
} from "../../api";
import { useOptionalWebSocketService } from "../../contexts/WebSocketContext";
import {
  type NotificationPagination,
  type NotificationRecord,
  type NotificationsData,
  acknowledgeNotification,
  createEmptyNotificationPagination,
  findCachedNotification,
  markNotificationRead,
  markNotificationUnread,
  notificationKeys,
  notificationListQueryOptions,
  notificationPreferencesQueryOptions,
  toNotificationListParams,
  updateNotificationPreferences,
  withOptimisticNotificationStatus,
  writeNotificationRecords,
} from "../collections/notifications";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

const DEFAULT_NOTIFICATION_WEBSOCKET_FALLBACK_STALE_TIME_MS = 5 * 60 * 1000;
const BULK_READ_CHUNK_SIZE = 5;

interface NotificationWebSocketState {
  connectionError: string | null;
  isAuthenticated: boolean;
  isConnected: boolean;
}

const DISCONNECTED_STATE: NotificationWebSocketState = {
  connectionError: null,
  isAuthenticated: false,
  isConnected: false,
};

const isNotificationReadStatus = (status: NotificationStatus): boolean =>
  status !== "unread";

/** Connection health decides whether lists poll while mounted. */
function useWebSocketHealth(): NotificationWebSocketState {
  const webSocketService = useOptionalWebSocketService();
  const [state, setState] = useState<NotificationWebSocketState>(() =>
    webSocketService
      ? pickState(webSocketService.getState())
      : DISCONNECTED_STATE
  );

  useEffect(() => {
    if (!webSocketService) {
      setState(DISCONNECTED_STATE);
      return;
    }
    setState(pickState(webSocketService.getState()));
    return webSocketService.onStateChange((next) => setState(pickState(next)));
  }, [webSocketService]);

  return state;
}

function pickState(
  state: NotificationWebSocketState
): NotificationWebSocketState {
  return {
    connectionError: state.connectionError,
    isAuthenticated: state.isAuthenticated,
    isConnected: state.isConnected,
  };
}

export interface UseNotificationsOptions
  extends Omit<CollectionHookOptions<NotificationsData>, "sort"> {
  userId?: string;
  eventType?: NotificationEventType[];
  status?: NotificationStatus;
  channel?: NotificationChannel;
  includeDismissed?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
  /**
   * Whether pushed notifications are trusted to keep the list current. When
   * false, or while the connection is unhealthy, a mounted list re-reads
   * every stale interval.
   */
  realtimeEnabled?: boolean;
  /**
   * @deprecated Local changes are written to the query cache and win over
   * older pushed versions without a time window; this option is ignored.
   */
  localReconciliationWindowMs?: number;
}

export interface UseNotificationsReturn
  extends Omit<DataHookReturn<NotificationsData>, "data"> {
  data: NotificationsData | null;
  notifications: NotificationRecord[];
  records: NotificationRecord[];
  pagination: NotificationPagination;
  unreadCount: number;
  markRead: (notificationId: string) => Promise<NotificationRecord>;
  markUnread: (notificationId: string) => Promise<NotificationRecord>;
  markBulkRead: (notificationIds: string[]) => Promise<NotificationRecord[]>;
  acknowledge: (notificationId: string) => Promise<NotificationRecord>;
}

export function useNotifications(
  organizationId: string | undefined,
  options: UseNotificationsOptions = {}
): UseNotificationsReturn {
  const {
    userId,
    eventType,
    status,
    channel,
    includeDismissed,
    createdAfter,
    createdBefore,
    limit,
    offset,
    enabled = true,
    refetchOnMount,
    refetchOnWindowFocus,
    refetchOnStale,
    staleTimeMs,
    maxCacheAgeMs,
    realtimeEnabled = true,
  } = options;

  const queryClient = useQueryClient();
  const isEnabled = enabled && !!organizationId;
  const eventTypeKey = eventType?.join(",");
  const params = useMemo(
    () =>
      toNotificationListParams({
        userId,
        eventType,
        status,
        channel,
        includeDismissed,
        createdAfter,
        createdBefore,
        limit,
        offset,
      }),
    // eventType is compared by value so inline arrays do not change the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      userId,
      eventTypeKey,
      status,
      channel,
      includeDismissed,
      createdAfter,
      createdBefore,
      limit,
      offset,
    ]
  );

  const webSocketState = useWebSocketHealth();
  const isRealtimeHealthy =
    realtimeEnabled &&
    webSocketState.isConnected &&
    webSocketState.isAuthenticated &&
    !webSocketState.connectionError;
  const effectiveStaleTimeMs =
    staleTimeMs ?? DEFAULT_NOTIFICATION_WEBSOCKET_FALLBACK_STALE_TIME_MS;
  const pollWhileMounted = refetchOnStale ?? !isRealtimeHealthy;

  const { result, state } = useDataLayerQuery(
    {
      ...notificationListQueryOptions(organizationId ?? "", params),
      refetchInterval:
        isEnabled && pollWhileMounted ? effectiveStaleTimeMs : false,
    },
    {
      enabled: isEnabled,
      refetchOnMount,
      refetchOnWindowFocus,
      staleTimeMs: effectiveStaleTimeMs,
      maxCacheAgeMs,
    }
  );

  const data = isEnabled ? result.data ?? null : null;
  const notifications = data?.items ?? [];
  const pagination =
    data?.pagination ?? createEmptyNotificationPagination(limit, offset);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  /**
   * Writes the local status into every loaded list, then the server's record.
   * A failure restores each list; a list read that was in flight during the
   * change reads again so an older response does not undo it.
   */
  const changeStatus = useCallback(
    async (
      notificationId: string,
      nextStatus: NotificationStatus,
      request: (
        organizationId: string,
        notificationId: string
      ) => Promise<NotificationRecord>,
      action: string
    ): Promise<NotificationRecord> => {
      if (!organizationId) {
        throw new Error(`organizationId is required to ${action}`);
      }
      const lists = notificationKeys.lists(organizationId);
      await queryClient.cancelQueries({ queryKey: lists });
      const cached = findCachedNotification(
        queryClient,
        organizationId,
        notificationId
      );
      const rollback = cached
        ? writeNotificationRecords(
            queryClient,
            organizationId,
            [
              withOptimisticNotificationStatus(
                cached,
                nextStatus,
                new Date().toISOString()
              ),
            ],
            { authoritative: true }
          )
        : () => undefined;

      try {
        const updated = await request(organizationId, notificationId);
        writeNotificationRecords(queryClient, organizationId, [updated], {
          authoritative: true,
        });
        if (queryClient.isFetching({ queryKey: lists }) > 0) {
          void invalidateWithFollowUpRead(queryClient, { queryKey: lists });
        }
        return updated;
      } catch (error) {
        rollback();
        throw error;
      }
    },
    [organizationId, queryClient]
  );

  const markRead = useCallback(
    (notificationId: string) =>
      changeStatus(
        notificationId,
        "read",
        markNotificationRead,
        "mark notification read"
      ),
    [changeStatus]
  );

  const markUnread = useCallback(
    (notificationId: string) =>
      changeStatus(
        notificationId,
        "unread",
        markNotificationUnread,
        "mark notification unread"
      ),
    [changeStatus]
  );

  const acknowledge = useCallback(
    (notificationId: string) =>
      changeStatus(
        notificationId,
        "acknowledged",
        acknowledgeNotification,
        "acknowledge notification"
      ),
    [changeStatus]
  );

  /** Partial failures are not thrown: only the successful records return. */
  const markBulkRead = useCallback(
    async (notificationIds: string[]): Promise<NotificationRecord[]> => {
      if (!organizationId) {
        throw new Error(
          "organizationId is required to mark notifications read"
        );
      }
      if (notificationIds.length === 0) return [];

      const results: NotificationRecord[] = [];
      for (let i = 0; i < notificationIds.length; i += BULK_READ_CHUNK_SIZE) {
        const chunk = notificationIds.slice(i, i + BULK_READ_CHUNK_SIZE);
        const settled = await Promise.allSettled(
          chunk.map((id) => markRead(id))
        );
        settled.forEach((outcome) => {
          if (outcome.status === "fulfilled") results.push(outcome.value);
        });
      }
      return results;
    },
    [markRead, organizationId]
  );

  return {
    data,
    notifications,
    records: notifications,
    pagination,
    unreadCount,
    markRead,
    markUnread,
    markBulkRead,
    acknowledge,
    ...state,
  };
}

export type UseNotificationPreferencesOptions = Omit<
  CollectionHookOptions<NotificationPreferencesDto>,
  "sort"
>;

export interface UseNotificationPreferencesReturn
  extends Omit<DataHookReturn<NotificationPreferencesDto>, "data"> {
  data: NotificationPreferencesDto | null;
  update: (
    updates: UpdateNotificationPreferencesDto
  ) => Promise<NotificationPreferencesDto | null>;
}

export function useNotificationPreferences(
  organizationId: string | undefined,
  userId: string | undefined,
  options: UseNotificationPreferencesOptions = {}
): UseNotificationPreferencesReturn {
  const {
    enabled = true,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  } = options;

  const queryClient = useQueryClient();
  const isEnabled = enabled && !!organizationId && !!userId;
  const queryOptions = notificationPreferencesQueryOptions(
    organizationId ?? "",
    userId ?? ""
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled: isEnabled,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  });
  const data = isEnabled ? result.data ?? null : null;

  const update = useCallback(
    async (
      updates: UpdateNotificationPreferencesDto
    ): Promise<NotificationPreferencesDto | null> => {
      if (!organizationId || !userId) {
        throw new Error(
          "organizationId and userId are required to update notification preferences"
        );
      }
      const queryKey = notificationKeys.preferences(organizationId, userId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous =
        queryClient.getQueryData<NotificationPreferencesDto>(queryKey);
      if (previous) {
        queryClient.setQueryData(queryKey, { ...previous, ...updates });
      }
      // Compare against the stored value: structural sharing may copy it.
      const optimistic = previous
        ? queryClient.getQueryData<NotificationPreferencesDto>(queryKey)
        : undefined;

      try {
        const updated = await updateNotificationPreferences(
          organizationId,
          userId,
          updates
        );
        if (updated) {
          queryClient.setQueryData(queryKey, updated);
        } else {
          void invalidateWithFollowUpRead(queryClient, {
            queryKey,
            exact: true,
          });
        }
        return updated;
      } catch (error) {
        if (optimistic && queryClient.getQueryData(queryKey) === optimistic) {
          queryClient.setQueryData(queryKey, previous);
        }
        throw error;
      }
    },
    [organizationId, queryClient, userId]
  );

  return { data, update, ...state };
}

export const getReadStatusLabel = (status: NotificationStatus): string => {
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
      return isNotificationReadStatus(status) ? "Seen" : "New";
  }
};
