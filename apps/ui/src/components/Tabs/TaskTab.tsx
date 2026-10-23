import AddIcon from "@mui/icons-material/Add";
import ForumIcon from "@mui/icons-material/ForumOutlined";
import { Box, Button, Stack } from "@mui/material";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ConversationResponseDto,
  WorkStatus,
} from "@hey-hey/ui-common/api";
import type { WorkItemResponseDto } from "@hey-hey/ui-common/data";
import { CardHeader } from "../CardHeader";
import {
  KEYS,
  TaskGenerationAssistant,
  TaskList,
  useFilteredWorkItems,
  useUserIdentity,
  WorkItemEntityFilters,
} from "@hey-hey/ui-common";
import { useDeleteTask } from "@hey-hey/ui-common/data";
import { TabContainer } from "./TabContainer";

interface TaskTabProps {
  hasGenerationAssistant?: boolean;
  parentTaskId?: string;
  projectId: string;
  initiativeId: string;
  initiativeName: string;
  organizationId?: string;
  expandable?: boolean;
  tasks?: WorkItemResponseDto[];
  loading?: boolean;
  onNewTask: () => void;
  onDiscussTasks?: () => void;
  onTaskGenerationConversationCreated?: (
    conversation: ConversationResponseDto,
  ) => void;
  onTaskGenerationError?: (error: unknown) => void;
  enableFilters?: boolean;
}

export const TaskTab: React.FC<TaskTabProps> = ({
  hasGenerationAssistant = false,
  parentTaskId,
  projectId,
  initiativeId,
  organizationId,
  initiativeName,
  tasks = [],
  expandable = false,
  loading = false,
  onNewTask,
  onDiscussTasks,
  onTaskGenerationConversationCreated,
  onTaskGenerationError,
  enableFilters = false,
}) => {
  const { t } = useTranslation();
  const { currentOrgId } = useUserIdentity() || {};
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkStatus | "">("");
  const [sortBy, setSortBy] = useState("status");

  // Use the deleteTask hook
  const { deleteTask } = useDeleteTask({
    organizationId: currentOrgId!,
    initiativeId,
    projectId,
  });

  const handleTaskDelete = useCallback(
    async (task: WorkItemResponseDto) => {
      if (!task) {
        return;
      }

      try {
        await deleteTask(task.id);
      } catch (error) {
        console.error("Failed to delete task:", error);
        // TODO: Show error toast/notification
      }
    },
    [deleteTask],
  );

  const filteredTasks = useFilteredWorkItems<WorkItemResponseDto>(
    tasks,
    searchTerm,
    statusFilter,
    sortBy,
  );
  const visibleTasks = enableFilters ? filteredTasks : tasks;

  return (
    <TabContainer>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <CardHeader title={t(KEYS.tasks.title)} />
        <Stack direction="row" spacing={1}>
          {onDiscussTasks && (
            <Button
              onClick={onDiscussTasks}
              variant="outlined"
              startIcon={<ForumIcon />}
              data-testid="task-list-discuss-tasks-button"
            >
              {t("tasks.discussTasks", "Discuss Tasks")}
            </Button>
          )}
          <Button
            onClick={onNewTask}
            variant="contained"
            startIcon={<AddIcon />}
            sx={{
              backgroundColor: "actionable.main",
              color: "actionable.contrastText",
              "&:hover": {
                backgroundColor: "actionable.dark",
              },
            }}
            data-testid="task-list-new-task-button"
          >
            Create Task
          </Button>
        </Stack>
      </Box>

      {enableFilters && (
        <WorkItemEntityFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          sortBy={sortBy}
          onSortByChange={setSortBy}
        />
      )}

      <TaskList
        expandable={expandable}
        tasks={visibleTasks}
        loading={loading}
        initiativeId={initiativeId}
        organizationId={organizationId}
        projectId={projectId}
        onDelete={handleTaskDelete}
        emptyMessage={t(KEYS.tasks.assistant.emptyMessage)}
      />

      {hasGenerationAssistant && (
        <TaskGenerationAssistant
          parentTaskId={parentTaskId}
          projectId={projectId}
          initiativeId={initiativeId}
          initiativeName={initiativeName}
          onConversationCreated={onTaskGenerationConversationCreated}
          onError={onTaskGenerationError}
        />
      )}
    </TabContainer>
  );
};
