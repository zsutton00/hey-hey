import type { WorkStatus } from "@hey-hey/ui-common/api";
import {
  TaskList,
  useFilteredWorkItems,
  WorkItemEntityFilters,
} from "@hey-hey/ui-common";
import { useWorkItems } from "@hey-hey/ui-common/data";
import { Box, Typography } from "@mui/material";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TabContainer } from "../../components/Tabs";

interface UserTasksTabProps {
  organizationId: string;
  projectId: string;
  userId: string;
}

export const UserTasksTab: React.FC<UserTasksTabProps> = ({
  organizationId,
  projectId,
  userId,
}) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkStatus | "">("");
  const [sortBy, setSortBy] = useState("created-desc");

  const { workItems, isLoading } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      enabled: !!organizationId && !!projectId,
    },
  );

  const assignedTasks = useMemo(
    () => workItems.filter((item) => item.assigneeId === userId),
    [workItems, userId],
  );

  const filteredTasks = useFilteredWorkItems(
    assignedTasks,
    searchTerm,
    statusFilter,
    sortBy,
  );

  return (
    <TabContainer>
      <WorkItemEntityFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
      />

      {isLoading ? (
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {t("common.loading", "Loading...")}
          </Typography>
        </Box>
      ) : filteredTasks.length === 0 ? (
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {searchTerm || statusFilter
              ? t(
                  "userPage.tasks.noResults",
                  "No tasks match the current filters.",
                )
              : t(
                  "userPage.tasks.empty",
                  "No tasks assigned to this user.",
                )}
          </Typography>
        </Box>
      ) : (
        <TaskList
          tasks={filteredTasks}
          projectId={projectId}
          organizationId={organizationId}
          expandable
        />
      )}
    </TabContainer>
  );
};
