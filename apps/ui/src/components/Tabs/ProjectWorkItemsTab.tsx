import { Box, Checkbox, FormControlLabel, Stack } from "@mui/material";
import LayersIcon from "@mui/icons-material/Layers";
import {
  EntityFilters,
  FeaturePicker,
  TaskList,
  type FilterConfig,
} from "@hey-hey/ui-common/components";
import { WorkStatus } from "@hey-hey/ui-common/api";
import { useWorkItems } from "@hey-hey/ui-common/data";
import { useTranslation } from "react-i18next";
import { parseAsBoolean, parseAsString, useQueryState } from "nuqs";
import React, { useMemo } from "react";
import { CardHeader } from "../CardHeader";
import { TabContainer } from "./TabContainer";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import {
  TaskListPagination,
  type TaskListSortKey,
  useTaskListPaging,
} from "./useTaskListPaging";

const PAGE_LIMIT = 50;

const getProjectWorkItemQueryKeyPrefix = (taskType: string): string => {
  if (taskType === WORK_ITEM_TYPE_KEYS.Standard) return "tasks";
  if (taskType === WORK_ITEM_TYPE_KEYS.Bug) return "bugs";

  const encodedTypeKey = Array.from(taskType)
    .map((character) =>
      character.codePointAt(0)!.toString(16).padStart(6, "0"),
    )
    .join("");
  return `workItems_${encodedTypeKey}`;
};

export interface ProjectWorkItemsTabProps {
  organizationId: string;
  projectId: string;
  taskType: string;
  title: string;
  emptyMessage: string;
  queryKeyPrefix?: string;
}

export const ProjectWorkItemsTab: React.FC<ProjectWorkItemsTabProps> = ({
  organizationId,
  projectId,
  taskType,
  title,
  emptyMessage,
  queryKeyPrefix: queryKeyPrefixOverride,
}) => {
  const { t } = useTranslation();
  const queryKeyPrefix =
    queryKeyPrefixOverride ?? getProjectWorkItemQueryKeyPrefix(taskType);

  const [parentTaskId, setParentTaskId] = useQueryState(
    `${queryKeyPrefix}ParentTaskId`,
    parseAsString,
  );
  const [includeDescendants, setIncludeDescendants] = useQueryState(
    `${queryKeyPrefix}IncludeDescendants`,
    parseAsBoolean.withDefault(false),
  );

  const {
    page,
    setPage,
    sortKey,
    setSortKey,
    search,
    setSearch,
    status: statusFilter,
    setStatus: setStatusFilter,
    sortBy,
    sortDir,
    getPaginationProps,
  } = useTaskListPaging({
    keyPrefix: queryKeyPrefix,
    defaultLimit: PAGE_LIMIT,
  });

  const { workItems, isLoading } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      taskType,
      page,
      limit: PAGE_LIMIT,
      sortBy,
      sortDir,
      status: statusFilter ? (statusFilter as WorkStatus) : undefined,
      includeSectionKeys: ["description"],
      parentTaskId: parentTaskId ?? undefined,
      includeDescendants: includeDescendants || undefined,
      enabled: !!organizationId && !!projectId,
    },
  );

  const paginationProps = getPaginationProps({ itemCount: workItems.length });

  const visibleItems = useMemo(() => {
    if (!search.trim()) return workItems;
    const searchLower = search.toLowerCase();
    return workItems.filter((item) =>
      item.name?.toLowerCase().includes(searchLower),
    );
  }, [workItems, search]);

  const searchPlaceholder =
    taskType === WORK_ITEM_TYPE_KEYS.Bug
      ? t("bugs.filters.searchPlaceholder", "Search bugs...")
      : t("tasks.filters.searchPlaceholder", "Search tasks...");

  const filters: FilterConfig[] = [
    {
      type: "search",
      key: "search",
      label: searchPlaceholder,
      placeholder: searchPlaceholder,
    },
    {
      type: "select",
      key: "status",
      label: t("tasks.filters.status", "Status"),
      options: [
        { value: WorkStatus.Backlog, label: t("tasks.status.backlog", "Backlog") },
        { value: WorkStatus.Active, label: t("tasks.status.active", "Active") },
        { value: WorkStatus.OnHold, label: t("tasks.status.onHold", "On Hold") },
        { value: WorkStatus.Verifying, label: t("tasks.status.verifying", "Verifying") },
        { value: WorkStatus.Completed, label: t("tasks.status.completed", "Completed") },
        { value: WorkStatus.Cancelled, label: t("tasks.status.cancelled", "Cancelled") },
        { value: WorkStatus.RefiningAcceptanceCriteria, label: t("tasks.status.refining", "Refining") },
      ],
    },
    {
      type: "custom",
      key: "parentTaskId",
      label: t("tasks.filters.feature", "Feature"),
      icon: LayersIcon,
      customRender: (value, onChange) => (
        <Box sx={{ position: "relative" }}>
          <FeaturePicker
            organizationId={organizationId}
            projectId={projectId}
            label={t("tasks.filters.feature", "Feature")}
            value={(value as string) || null}
            onChange={(featureId) => onChange(featureId)}
            sx={{ minWidth: 200 }}
          />
          {parentTaskId && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={includeDescendants}
                  onChange={(e) => {
                    void setIncludeDescendants(e.target.checked);
                    void setPage(1);
                  }}
                  size="small"
                />
              }
              label={t("tasks.filters.includeDescendants", "Include descendants")}
              sx={{ position: "absolute", top: "100%", left: 0, mt: 0.5, ml: 0, whiteSpace: "nowrap" }}
            />
          )}
        </Box>
      ),
    },
  ];

  const sortOptions = [
    { value: "createdAt:desc", label: t("common.sortCreatedDesc", "Newest") },
    { value: "createdAt:asc", label: t("common.sortCreatedAsc", "Oldest first") },
    { value: "updatedAt:desc", label: t("tasks.sortLastUpdated", "Last Updated") },
    { value: "title:asc", label: t("common.sortNameAsc", "Name (A-Z)") },
    { value: "title:desc", label: t("common.sortNameDesc", "Name (Z-A)") },
    { value: "status:asc", label: t("tasks.sortStatus", "Status") },
    { value: "priority:asc", label: t("tasks.sortPriority", "Priority") },
  ];

  const handleFilterChange = (key: string, value: unknown): void => {
    if (key === "search") {
      setSearch(value as string);
    } else if (key === "status") {
      setStatusFilter(value as string);
    } else if (key === "parentTaskId") {
      void setParentTaskId((value as string) || null);
      void setIncludeDescendants(false);
      void setPage(1);
    }
  };

  const handleSortChange = (value: string): void => {
    setSortKey(value as TaskListSortKey);
  };

  return (
    <TabContainer>
      <Stack spacing={3}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <CardHeader title={title} />
        </Box>

        <EntityFilters
          filters={filters}
          values={{ search, status: statusFilter, parentTaskId: parentTaskId ?? "" }}
          onChange={handleFilterChange}
          sortOptions={sortOptions}
          sortBy={sortKey}
          onSortChange={handleSortChange}
          layout="row"
          spacing={2}
          sx={parentTaskId ? { pb: 6 } : undefined}
        />

        <TaskList
          tasks={visibleItems}
          loading={isLoading}
          projectId={projectId}
          organizationId={organizationId}
          emptyMessage={emptyMessage}
        />

        <TaskListPagination {...paginationProps} />
      </Stack>
    </TabContainer>
  );
};
