import {
  Alert,
  CircularProgress,
  List,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type MarkBulkReadFn = (ids: string[]) => Promise<unknown>;
import type { NotificationStatus } from "../../api";
import type { NotificationRecord } from "../../data/collections/notifications";
import { useNotifications } from "../../data/hooks/useNotifications";
import { NotificationItem } from "./NotificationItem";

const DWELL_THRESHOLD_MS = 500;

export interface NotificationListProps {
  organizationId: string;
  userId?: string;
  limit?: number;
  offset?: number;
  status?: NotificationStatus;
  includeDismissed?: boolean;
  emptyMessage?: string;
  realtimeEnabled?: boolean;
  isOpen?: boolean;
  onAcknowledge?: (notification: NotificationRecord) => void;
}

const addPendingId = (
  ids: Set<string>,
  notificationId: string
): Set<string> => {
  const nextIds = new Set(ids);
  nextIds.add(notificationId);
  return nextIds;
};

const removePendingId = (
  ids: Set<string>,
  notificationId: string
): Set<string> => {
  const nextIds = new Set(ids);
  nextIds.delete(notificationId);
  return nextIds;
};

export const NotificationList: React.FC<NotificationListProps> = ({
  organizationId,
  userId,
  limit,
  offset,
  status,
  includeDismissed,
  emptyMessage = "No notifications",
  realtimeEnabled = true,
  isOpen = false,
  onAcknowledge,
}) => {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFiredBulkReadRef = useRef(false);

  const { notifications, markBulkRead, acknowledge, isLoading, error } =
    useNotifications(organizationId, {
      userId,
      limit,
      offset,
      status,
      includeDismissed,
      realtimeEnabled,
    });

  const sortedNotifications = useMemo(
    () =>
      [...notifications].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
      ),
    [notifications]
  );

  const notificationsRef = useRef(sortedNotifications);
  notificationsRef.current = sortedNotifications;

  const markBulkReadRef = useRef<MarkBulkReadFn>(markBulkRead);
  markBulkReadRef.current = markBulkRead;

  useEffect(() => {
    if (isOpen && !hasFiredBulkReadRef.current) {
      const unreadIds = notificationsRef.current
        .filter((n) => !n.isRead)
        .map((n) => n.notificationId);

      if (unreadIds.length === 0) {
        return;
      }

      dwellTimerRef.current = setTimeout(() => {
        hasFiredBulkReadRef.current = true;
        void markBulkReadRef.current(unreadIds);
      }, DWELL_THRESHOLD_MS);

      return () => {
        if (dwellTimerRef.current !== null) {
          clearTimeout(dwellTimerRef.current);
          dwellTimerRef.current = null;
        }
      };
    }

    if (!isOpen) {
      if (dwellTimerRef.current !== null) {
        clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
      hasFiredBulkReadRef.current = false;
    }
  }, [isOpen]);

  const handleAcknowledge = useCallback(
    (notificationId: string): void => {
      const notification = sortedNotifications.find(
        (n) => n.notificationId === notificationId
      );

      setPendingIds((ids) => addPendingId(ids, notificationId));

      void acknowledge(notificationId)
        .then(() => {
          if (notification && onAcknowledge) {
            onAcknowledge(notification);
          }
        })
        .finally(() => {
          setPendingIds((ids) => removePendingId(ids, notificationId));
        });
    },
    [acknowledge, onAcknowledge, sortedNotifications]
  );

  if (isLoading) {
    return (
      <Paper
        data-testid="notification-list-loading"
        sx={{ p: 3, display: "flex", justifyContent: "center" }}
      >
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper data-testid="notification-list-error" sx={{ p: 2 }}>
        <Alert severity="error">{error.message}</Alert>
      </Paper>
    );
  }

  if (sortedNotifications.length === 0) {
    return (
      <Paper data-testid="notification-list-empty" sx={{ p: 2 }}>
        <Typography color="text.secondary" variant="body2">
          {emptyMessage}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper
      data-testid="notification-list"
      sx={(theme) => ({
        p: 2,
        width: "100%",
        backgroundColor:
          theme.palette.mode === "dark"
            ? theme.palette.grey[900]
            : "rgb(249, 249, 251)",
      })}
    >
      <Stack spacing={1}>
        <Typography variant="h6">Notifications</Typography>
        <List data-testid="notification-list-items" disablePadding>
          {sortedNotifications.map((notification) => (
            <NotificationItem
              isUpdating={pendingIds.has(notification.notificationId)}
              key={notification.notificationId}
              notification={notification}
              onAcknowledge={handleAcknowledge}
            />
          ))}
        </List>
      </Stack>
    </Paper>
  );
};
