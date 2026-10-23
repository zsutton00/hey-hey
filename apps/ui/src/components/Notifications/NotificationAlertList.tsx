import { Paper, Stack, Typography } from "@mui/material";
import React from "react";
import type {
  NotificationAlertItem,
  UseProjectNotificationActivityReturn,
} from "../../hooks/useProjectNotificationActivity";
import { NotificationAlert } from "./NotificationAlert";

export interface NotificationAlertListProps {
  emptyMessage?: string;
  items: NotificationAlertItem[];
  onDismiss?: (notificationId: string) => void;
  onNavigateFullActivity?: (activityId: string) => void;
  pagination: UseProjectNotificationActivityReturn["pagination"];
}

export const NotificationAlertList: React.FC<NotificationAlertListProps> = ({
  emptyMessage = "No activity notifications yet",
  items,
  onDismiss,
  onNavigateFullActivity,
}) => {
  return (
    <Stack spacing={1.5}>
      {items.length === 0 ? (
        <Paper sx={{ p: 2 }} variant="outlined">
          <Typography color="text.secondary" variant="body2">
            {emptyMessage}
          </Typography>
        </Paper>
      ) : (
        items.map((item) => (
          <NotificationAlert
            item={item}
            key={item.activity.activityId}
            onDismiss={onDismiss}
            onNavigateFullActivity={onNavigateFullActivity}
          />
        ))
      )}
    </Stack>
  );
};
