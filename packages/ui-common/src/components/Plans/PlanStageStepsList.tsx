import React from "react";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { AgentEdgeType, WorkStatus } from "../../api";
import type {
  PlanStageStandardTask,
  PlanStageWorkItem,
} from "../../data/plans/canonicalPlan";
import { getStatusColorMapping } from "../../utils";
import { EntityIcon } from "../Entity/EntityIcon";

export interface PlanStageStepsListProps {
  stage: PlanStageWorkItem;
  tasks: readonly PlanStageStandardTask[];
  onTaskClick?: (task: PlanStageStandardTask) => void;
}

const getInternalDependencyIds = (
  task: PlanStageStandardTask,
  stageTaskIds: ReadonlySet<string>
): string[] => [
  ...new Set(
    (task.edges ?? []).flatMap((edge) =>
      edge.type === AgentEdgeType.DependsOn &&
      edge.sourceNodeId === task.id &&
      stageTaskIds.has(edge.targetNodeId)
        ? [edge.targetNodeId]
        : []
    )
  ),
];

const renderTaskSections = (task: PlanStageStandardTask) => {
  const populatedSections = (task.sections ?? []).filter((section) =>
    Boolean(section.materializedMarkdown.trim())
  );
  if (populatedSections.length === 0) return null;

  return (
    <Stack spacing={1.5} sx={{ mt: 2 }}>
      {populatedSections.map((section) => (
        <Box key={section.id}>
          <Typography
            variant="caption"
            fontWeight={600}
            sx={{ textTransform: "uppercase", color: "text.secondary" }}
          >
            {section.key}
          </Typography>
          <Typography
            variant="body2"
            sx={{ mt: 0.5, whiteSpace: "pre-wrap", color: "text.primary" }}
          >
            {section.materializedMarkdown}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
};

export const PlanStageStepsList: React.FC<PlanStageStepsListProps> = ({
  stage,
  tasks,
  onTaskClick,
}) => {
  const invalidTasks = tasks.filter((task) => task.parentTaskId !== stage.id);
  if (invalidTasks.length > 0) {
    return (
      <Box data-testid="plan-stage-task-list-error" sx={{ py: 4 }}>
        <Typography color="error">
          This Plan Stage contains Tasks with invalid ancestry.
        </Typography>
      </Box>
    );
  }

  if (tasks.length === 0) {
    return (
      <Box
        data-testid="plan-stage-task-list-empty"
        sx={{ textAlign: "center", py: 4 }}
      >
        <Typography variant="body1" color="text.secondary">
          No implementation Tasks are defined for this Plan Stage.
        </Typography>
      </Box>
    );
  }

  const stageTaskIds = new Set(tasks.map((task) => task.id));
  const taskNamesById = new Map(tasks.map((task) => [task.id, task.name]));

  return (
    <Stack
      data-testid="plan-stage-task-list"
      spacing={2}
      sx={{ position: "relative" }}
    >
      {tasks.map((task) => {
        const dependencyIds = getInternalDependencyIds(task, stageTaskIds);
        return (
          <Card
            key={task.id}
            component="a"
            href={`/tasks/${task.id}`}
            data-testid="plan-stage-task-card"
            data-work-item-id={task.id}
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey || event.button === 1) return;
              if (!onTaskClick) return;
              event.preventDefault();
              onTaskClick(task);
            }}
            sx={{
              textDecoration: "none",
              cursor: "pointer",
              transition: "all 0.2s ease-in-out",
              "&:hover": { boxShadow: 4 },
            }}
          >
            <CardContent>
              <Stack spacing={1}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <EntityIcon entityType={task.type} size={24} />
                    <Typography variant="h6" fontWeight={600}>
                      {task.name}
                    </Typography>
                  </Box>
                  <Chip
                    label={task.status}
                    color={getStatusColorMapping(task.status)}
                    size="small"
                  />
                </Stack>

                {dependencyIds.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    Depends on{" "}
                    {dependencyIds
                      .map((id) => taskNamesById.get(id))
                      .join(", ")}
                  </Typography>
                )}

                {task.status === WorkStatus.Blocked && (
                  <Typography variant="caption" color="warning.main">
                    Blocked
                  </Typography>
                )}

                {(task.sections?.some((section) =>
                  section.materializedMarkdown.trim()
                ) ??
                  false) && <Divider sx={{ my: 1 }} />}
                {renderTaskSections(task)}
              </Stack>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
};
