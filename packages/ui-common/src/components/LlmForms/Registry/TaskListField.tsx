import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  TaskResponseDto,
  TasksSystemMessageData,
  WorkStatus,
} from "../../../api";
import { isTask } from "../../../data/collections/workItems";
import type { WorkItemResponseDto } from "../../../data/collections/workItems";
import { useWorkItems } from "../../../data/hooks/useWorkItems";
import { getWorkItemSectionContent } from "../../../utils/workItemSections";
import type { FieldComponentContext, FieldComponentProps } from "./types";

export interface TaskListFieldProps extends Omit<
  FieldComponentProps<TasksSystemMessageData>,
  "onChange" | "value"
> {
  value: TasksSystemMessageData;
  onChange?: (value: unknown) => void;
  context: FieldComponentContext;
}

interface TaskItemProps {
  task: WorkItemResponseDto;
  index: number;
  isSubmitted: boolean;
  disabled?: boolean;
  isSubmitting: boolean;
  onAccept: (taskId: string) => void;
  onReject: (taskId: string) => void;
}

const TaskItem: React.FC<TaskItemProps> = ({
  task,
  index,
  isSubmitted,
  disabled,
  isSubmitting,
  onAccept,
  onReject,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const getPriorityColor = (priority: string | undefined): string => {
    if (!priority) {
      return theme.palette.text.secondary;
    }
    const priorityLower = priority.toLowerCase();
    switch (priorityLower) {
      case "high":
      case "critical":
        return theme.palette.error.main;
      case "medium":
      case "normal":
        return theme.palette.warning.main;
      case "low":
        return theme.palette.info.main;
      default:
        return theme.palette.text.secondary;
    }
  };

  return (
    <ListItem
      sx={{
        flexDirection: "column",
        alignItems: "stretch",
        py: 2,
        px: 0,
      }}
      data-testid={`task-item-${index}`}
    >
      <Card
        variant={isSubmitted ? "outlined" : "elevation"}
        sx={{
          width: "100%",
          opacity: isSubmitted ? 0.8 : 1,
          transition: "all 0.2s",
          ...(!isSubmitted &&
            !disabled && {
              "&:hover": {
                boxShadow: theme.shadows[3],
              },
            }),
        }}
      >
        <CardContent>
          {/* Task Title */}
          <Typography variant="h6" component="h3" gutterBottom>
            {task.name}
          </Typography>

          {/* Task Metadata Chips */}
          <Stack
            direction="row"
            spacing={1}
            sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}
          >
            {/* Priority Chip */}
            <Chip
              label={task.priority}
              size="small"
              sx={{
                color: getPriorityColor(task.priority),
                borderColor: getPriorityColor(task.priority),
              }}
              variant="outlined"
              data-testid={`task-priority-${index}`}
            />

            {/* Status Chip */}
            <Chip
              label={task.status}
              size="small"
              variant="outlined"
              data-testid={`task-status-${index}`}
            />
          </Stack>

          {/* Task Description */}
          {getWorkItemSectionContent(task.sections, "description") && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                mb: 2,
              }}
            >
              {getWorkItemSectionContent(task.sections, "description")}
            </Typography>
          )}

          {/* Task Acceptance Criteria */}
          {getWorkItemSectionContent(task.sections, "acceptanceCriteria") && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {getWorkItemSectionContent(task.sections, "acceptanceCriteria")}
            </Typography>
          )}
        </CardContent>

        {/* Action Buttons */}
        {!isSubmitted && !disabled && task.id && (
          <CardActions sx={{ justifyContent: "flex-start", px: 2, pb: 2 }}>
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={
                isSubmitting ? <CircularProgress size={16} /> : <CancelIcon />
              }
              onClick={() => onReject(task.id!)}
              disabled={isSubmitting}
              data-testid={`task-reject-${index}`}
            >
              {t("taskList.reject", "Reject")}
            </Button>
            <Button
              variant="contained"
              color="success"
              size="small"
              startIcon={
                isSubmitting ? (
                  <CircularProgress size={16} />
                ) : (
                  <CheckCircleIcon />
                )
              }
              onClick={() => onAccept(task.id!)}
              disabled={isSubmitting}
              data-testid={`task-accept-${index}`}
            >
              {t("taskList.accept", "Accept")}
            </Button>
          </CardActions>
        )}
      </Card>
    </ListItem>
  );
};

export const TaskListField: React.FC<TaskListFieldProps> = ({
  config,
  value,
  isSubmitted,
  disabled,
  context,
}) => {
  const { t } = useTranslation();
  const [submittingTasks, setSubmittingTasks] = useState<Set<string>>(
    new Set(),
  );

  // Extract task IDs from the value - memoize to avoid re-creating array
  const generatedTaskIds = useMemo(() => {
    const data = value as
      | (Partial<TasksSystemMessageData> & {
          generatedTaskIds?: string[];
        })
      | undefined;

    if (Array.isArray(data?.generatedTaskIds) && data.generatedTaskIds.length) {
      return data.generatedTaskIds;
    }

    const tasks = (data as Partial<TasksSystemMessageData>)?.tasks;
    if (Array.isArray(tasks)) {
      return tasks
        .map((task) => task?.id)
        .filter((id): id is string => typeof id === "string");
    }

    return [];
  }, [value]);

  const tasksFromMessage = useMemo(() => {
    const tasks = (value as Partial<TasksSystemMessageData>)?.tasks;
    if (!Array.isArray(tasks)) return [];

    return tasks.filter(
      (task): task is TaskResponseDto =>
        !!task && typeof task === "object" && typeof task.id === "string",
    );
  }, [value]);

  const initiativeIdFromTasks = useMemo(
    () =>
      tasksFromMessage.find((task) => typeof task?.initiativeId === "string")
        ?.initiativeId ?? undefined,
    [tasksFromMessage],
  );

  let initiativeId = initiativeIdFromTasks;
  if (!initiativeId && context.workflowAboutType === "initiative") {
    initiativeId = context.workflowAboutId;
  }
  const shouldFetchTasks = !!initiativeId && generatedTaskIds.length > 0;

  // Filter to only show GENERATED tasks that match the generatedTaskIds from this conversation
  const generatedStatus = "GENERATED" as WorkStatus;
  const refiningDescriptionStatus = "REFINING_DESCRIPTION" as WorkStatus;

  // Load tasks from database using the generated task IDs
  const {
    workItems = [],
    isLoading: tasksLoading,
    error: tasksError,
    updateTask,
    remove,
  } = useWorkItems(
    context.organizationId,
    "task",
    context.projectId,
    undefined,
    {
      initiativeId,
      status: generatedStatus,
      enabled: shouldFetchTasks,
      includeSectionKeys: ["description"],
    },
  );

  const tasks = useMemo(() => {
    const allTasks = workItems.filter(isTask);
    const taskIdSet = new Set(generatedTaskIds);

    // Use only API data since it's now filtered by GENERATED status server-side
    return allTasks.filter(
      (task) =>
        !taskIdSet.size ||
        (task.status === generatedStatus && taskIdSet.has(task.id)),
    );
  }, [workItems, generatedTaskIds]);

  const taskCount = tasks.length;

  console.debug("[task_list] resolved state", {
    messageTaskCount: tasksFromMessage.length,
    generatedTaskIds,
    initiativeId,
    shouldFetchTasks,
    tasksLoading,
    tasksError,
    fetchedTaskCount: taskCount,
  });

  // Handle accepting a task - move it to REFINING_DESCRIPTION status to start refinement
  const handleAccept = useCallback(
    async (taskId: string) => {
      setSubmittingTasks((prev) => new Set(prev).add(taskId));
      try {
        await updateTask(taskId, {
          status: refiningDescriptionStatus,
        });
      } catch (error) {
        console.error("Failed to accept task:", error);
        // TODO: Show error notification
      } finally {
        setSubmittingTasks((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [updateTask],
  );

  // Handle rejecting a task - remove it from the system
  const handleReject = useCallback(
    async (taskId: string) => {
      setSubmittingTasks((prev) => new Set(prev).add(taskId));
      try {
        await remove(taskId);
      } catch (error) {
        console.error("Failed to reject task:", error);
        // TODO: Show error notification
      } finally {
        setSubmittingTasks((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [remove],
  );

  // Show loading state
  if (tasksLoading && taskCount === 0) {
    return (
      <Box data-testid={`task-list-field-${config.field}`}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            py: 4,
          }}
        >
          <CircularProgress size={24} sx={{ mr: 2 }} />
          <Typography variant="body2" color="text.secondary">
            Loading tasks...
          </Typography>
        </Box>
      </Box>
    );
  }

  // Handle empty state
  if (generatedTaskIds.length === 0) {
    return (
      <Box data-testid={`task-list-field-${config.field}`}>
        {tasksError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {tasksError instanceof Error
              ? tasksError.message
              : "Failed to load tasks"}
          </Alert>
        )}
        <Alert severity="info">
          {t("taskList.empty", "No tasks have been generated yet.")}
        </Alert>
      </Box>
    );
  }

  // Render task list
  return (
    <Box data-testid={`task-list-field-${config.field}`}>
      {tasksError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {tasksError instanceof Error
            ? tasksError.message
            : "Failed to load tasks"}
        </Alert>
      )}

      {/* Task list */}
      <List sx={{ width: "100%" }}>
        {tasks.map((task, index) => (
          <React.Fragment key={task.id}>
            <TaskItem
              task={task}
              index={index}
              isSubmitted={isSubmitted || false}
              disabled={disabled}
              isSubmitting={task.id ? submittingTasks.has(task.id) : false}
              onAccept={handleAccept}
              onReject={handleReject}
            />
            {index < tasks.length - 1 && <Divider component="li" />}
          </React.Fragment>
        ))}
      </List>
    </Box>
  );
};
