import {
  Alert,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import type { EntityType } from "../../api";
import { useCorrelatedActivity } from "../../data/hooks/useCorrelatedActivity";
import { ActivityDetailLayout } from "./ActivityDetailLayout";

export interface ActivityDetailPageProps {
  organizationId: string;
  projectId: string;
  entityType: EntityType;
  entityId: string;
}

export const ActivityDetailPage: React.FC<ActivityDetailPageProps> = ({
  organizationId,
  projectId,
  entityType,
  entityId,
}) => {
  const { records, isLoading, error } = useCorrelatedActivity(organizationId, {
    entityType,
    entityId,
    limit: 1,
    view: "full",
  });

  const activity = records[0] ?? null;

  if (isLoading) {
    return (
      <Paper
        data-testid="activity-detail-page-loading"
        sx={{ p: 3, display: "flex", justifyContent: "center" }}
      >
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper data-testid="activity-detail-page-error" sx={{ p: 2 }}>
        <Alert severity="error">{error.message}</Alert>
      </Paper>
    );
  }

  if (!activity) {
    return (
      <Paper data-testid="activity-detail-page-empty" sx={{ p: 3 }}>
        <Typography color="text.secondary" variant="body2">
          No activity found for this entity.
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack data-testid="activity-detail-page" spacing={2}>
      <ActivityDetailLayout
        activity={activity}
        organizationId={organizationId}
        projectId={projectId}
      />
    </Stack>
  );
};
