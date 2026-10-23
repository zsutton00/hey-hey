import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { TaskResponseDto } from "@hey-hey/ui-common/api";
import { useWorkItem } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";

export const TaskRedirectPage: React.FC = () => {
  const navigate = useNavigate();
  const { projectId: routeProjectId, taskId } = useParams<{
    projectId?: string;
    taskId: string;
  }>();
  const userIdentity = useUserIdentity();
  const organizationId = userIdentity?.currentOrgId || "";

  const {
    workItem,
    isLoading: isTaskLoading,
    isFetched: isTaskFetched,
    error: taskError,
  } = useWorkItem(organizationId, "task", taskId ?? "", {
    projectId: routeProjectId,
    enabled: !!organizationId && !!taskId,
  });
  const task = workItem as TaskResponseDto;

  const projectId = routeProjectId ?? task?.projectId ?? "";

  useEffect(() => {
    if (!taskId || !organizationId || !task || !projectId) return;

    navigate(`/projects/${projectId}/tasks/${taskId}`, { replace: true });
  }, [taskId, organizationId, task, projectId, navigate]);

  const error = taskError;
  const isMissingTask =
    !!taskId && isTaskFetched && !isTaskLoading && !task && !taskError;

  if (error || isMissingTask) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "50vh",
          gap: 2,
        }}
      >
        <Alert severity="error">
          Unable to load task details. Please try again later.
        </Alert>
      </Box>
    );
  }

  const isLoading = isTaskLoading || !isTaskFetched;

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "50vh",
          gap: 2,
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="body1" color="text.secondary">
          Loading task details...
        </Typography>
      </Box>
    );
  }

  return null;
};
