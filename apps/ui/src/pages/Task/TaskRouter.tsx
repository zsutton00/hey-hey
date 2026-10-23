import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { type TaskResponseDto } from "@hey-hey/ui-common/api";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
} from "@hey-hey/ui-common/context";
import { useWorkItem } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { EvalPage } from "../Eval/EvalPage";
import { FeaturePage } from "../Features/FeaturePage";
import { GoalPage } from "../Goals/GoalPage";
import { TaskPage } from "./TaskPage";
import { PlanPage } from "../Plan/PlanPage";
import { TaskMonitorPage } from "./TaskMonitorPage";
import { WorkflowDetailPage } from "./WorkflowDetailPage";
import { WorkflowStepPage } from "./WorkflowStepPage";
import { isWorkflowStepType } from "./workflowStepEdges";

export const TaskRouter: React.FC = () => {
  const {
    projectId,
    taskId: taskIdParam,
    id,
  } = useParams<{
    projectId?: string;
    taskId?: string;
    id?: string;
  }>();
  const taskId = taskIdParam ?? id ?? "";
  const navigate = useNavigate();
  const userIdentity = useUserIdentity();
  const organizationId = userIdentity?.currentOrgId || "";

  const { workItem, isLoading, error } = useWorkItem(
    organizationId,
    "task",
    taskId,
    {
      projectId,
      enabled: !!organizationId && !!taskId,
    },
  );

  const task = workItem as TaskResponseDto | null;
  useEffect(() => {
    if (!projectId && task?.projectId && taskId) {
      navigate(`/projects/${task.projectId}/tasks/${taskId}`, {
        replace: true,
      });
    }
  }, [projectId, task, taskId, navigate]);

  if (error) {
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

  if (isLoading || !task) {
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
          Loading...
        </Typography>
      </Box>
    );
  }

  if (!projectId) {
    return null;
  }

  // GoalPage owns its canonical descriptor, so it bypasses the generic task boundary.
  if (task.type === WORK_ITEM_TYPE_KEYS.Goal) {
    return (
      <GoalPage
        organizationId={organizationId}
        projectId={projectId}
        taskId={taskId}
      />
    );
  }

  let page: React.ReactNode;
  if (task.type === "PLAN") {
    return (
      <PlanPage
        organizationId={organizationId}
        projectId={projectId}
        planId={taskId}
      />
    );
  } else if (task.type === "PLAN_STAGE") {
    return task.parentTaskId ? (
      <PlanPage
        organizationId={organizationId}
        projectId={projectId}
        planId={task.parentTaskId}
        stageId={task.id}
      />
    ) : (
      <Alert severity="error">The Stage is missing its parent Plan.</Alert>
    );
  } else if (task.type === WORK_ITEM_TYPE_KEYS.Feature) {
    page = <FeaturePage task={task} />;
  } else if (task.type === WORK_ITEM_TYPE_KEYS.Eval) {
    page = (
      <EvalPage
        organizationId={organizationId}
        projectId={projectId}
        task={task}
      />
    );
  } else if (isWorkflowStepType(task)) {
    page = <WorkflowStepPage />;
  } else if (
    task.type === WORK_ITEM_TYPE_KEYS.Diagram ||
    task.type === WORK_ITEM_TYPE_KEYS.Workflow
  ) {
    page = <WorkflowDetailPage />;
  } else if (task.type === WORK_ITEM_TYPE_KEYS.TaskMonitor) {
    page = (
      <TaskMonitorPage
        organizationId={organizationId}
        projectId={projectId}
        monitorId={taskId}
        task={task}
      />
    );
  } else {
    page = (
      <TaskPage
        organizationId={organizationId}
        projectId={projectId}
        initiativeId={task.initiativeId ?? undefined}
        taskId={taskId}
      />
    );
  }

  return (
    <CanonicalPageBoundary
      composition={{
        kind: "canonical",
        descriptor: createCanonicalPageDescriptor("task", taskId, null, {
          kind: "task",
          label: task.name,
          taskType: task.type,
        }),
      }}
    >
      {page}
    </CanonicalPageBoundary>
  );
};
