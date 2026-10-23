import {
  type ContextRelatedEntityDto,
  EntityType,
} from "@hey-hey/ui-common/api";
import {
  EntityIcon,
  EntityNodeStatusChip,
} from "@hey-hey/ui-common/components";
import { WebPathService } from "@hey-hey/ui-common/services";
import {
  Box,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  Typography,
} from "@mui/material";
import React from "react";
import { Link } from "react-router-dom";

interface DesignDocTasksTabProps {
  projectId: string;
  tasks: ContextRelatedEntityDto[];
  isLoading: boolean;
}

const formatRelationLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const DesignDocTasksTab: React.FC<DesignDocTasksTabProps> = ({
  projectId,
  tasks,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 4,
        }}
        data-testid="design-doc-tasks-loading"
      >
        <CircularProgress size={24} />
        <Typography variant="body2" sx={{ ml: 2 }}>
          Loading tasks...
        </Typography>
      </Box>
    );
  }

  if (tasks.length === 0) {
    return (
      <Box
        sx={{ p: 3, textAlign: "center" }}
        data-testid="design-doc-tasks-empty"
      >
        <Typography variant="body2" color="text.secondary">
          No tasks linked to this design document yet.
        </Typography>
      </Box>
    );
  }

  return (
    <List dense disablePadding data-testid="design-doc-tasks-list">
      {tasks.map((task) => {
        const href = WebPathService.task({
          projectId,
          taskId: task.entityId,
        });
        const pivot = task.via?.[0]?.displayName;
        const secondaryText = pivot
          ? task.reasoning
            ? `via ${pivot} — ${task.reasoning}`
            : `via ${pivot}`
          : task.reasoning;

        return (
          <ListItemButton
            key={task.entityId}
            component={Link}
            to={href}
            sx={{ borderRadius: 1, py: 0.75, alignItems: "flex-start" }}
            data-testid={`design-doc-task-${task.entityId}`}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                flex: 1,
                gap: 0.25,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  minWidth: 0,
                }}
              >
                <EntityIcon entityType={EntityType.Task} />
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ flex: 1, minWidth: 0 }}
                >
                  {task.displayName}
                </Typography>
                <Chip
                  label={formatRelationLabel(task.relationship)}
                  size="small"
                  variant="outlined"
                  sx={{
                    height: 18,
                    fontSize: "0.65rem",
                    "& .MuiChip-label": { px: 0.75 },
                  }}
                />
                <EntityNodeStatusChip status={task.status} />
              </Box>
              {secondaryText && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ pl: 4, display: "block" }}
                >
                  {secondaryText}
                </Typography>
              )}
            </Box>
          </ListItemButton>
        );
      })}
    </List>
  );
};

DesignDocTasksTab.displayName = "DesignDocTasksTab";
