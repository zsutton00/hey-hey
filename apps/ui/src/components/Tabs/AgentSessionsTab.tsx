import {
  AgentSessionsList,
  EntityFilters,
} from "@hey-hey/ui-common/components";
import type { FilterConfig } from "@hey-hey/ui-common/components";
import { EntityType } from "@hey-hey/ui-common/api";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { PaginatedCodingSessionsFeed } from "../Activity/PaginatedCodingSessionsFeed";
import { TabContainer } from "./TabContainer";

interface AgentSessionsTabProps {
  organizationId: string;
  projectId: string;
  taskId?: string;
  initiativeId?: string;
  designDocId?: string;
  serviceId?: string;
  loading?: boolean;
  emptyMessage?: string;
  enableFilters?: boolean;
}

/**
 * Shared tab component for displaying coding sessions.
 * Can be filtered by task, initiative, or design document context.
 */
export const AgentSessionsTab: React.FC<AgentSessionsTabProps> = ({
  organizationId,
  projectId,
  taskId,
  initiativeId,
  designDocId,
  serviceId,
  loading = false,
  emptyMessage,
  enableFilters = false,
}) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("created-desc");

  const defaultEmptyMessage = taskId
    ? t(
        "codingSessions.emptyTask",
        "No coding sessions found for this task yet."
      )
    : initiativeId
      ? t(
          "codingSessions.emptyInitiative",
          "No coding sessions found for this initiative yet."
        )
      : designDocId
        ? t(
            "codingSessions.emptyDesignDoc",
            "No coding sessions found for this design document yet."
          )
        : t("codingSessions.empty", "No coding sessions found yet.");

  // Define filter configurations
  const filters: FilterConfig[] = [
    {
      type: "search",
      key: "search",
      label: t(
        "codingSessions.filters.searchPlaceholder",
        "Search coding sessions..."
      ),
      placeholder: t(
        "codingSessions.filters.searchPlaceholder",
        "Search coding sessions..."
      ),
    },
  ];

  // Define sort options
  const sortOptions = [
    {
      value: "created-desc",
      label: t("common.sortCreatedDesc", "Newest first"),
    },
    {
      value: "created-asc",
      label: t("common.sortCreatedAsc", "Oldest first"),
    },
    {
      value: "name-asc",
      label: t("common.sortNameAsc", "Name (A-Z)"),
    },
    {
      value: "name-desc",
      label: t("common.sortNameDesc", "Name (Z-A)"),
    },
  ];

  // Map filter values
  const filterValues = {
    search: searchTerm,
  };

  // Handle filter changes
  const handleFilterChange = (key: string, value: unknown): void => {
    if (key === "search") {
      setSearchTerm(value as string);
    }
  };

  return (
    <TabContainer>
      {enableFilters && (
        <EntityFilters
          filters={filters}
          values={filterValues}
          onChange={handleFilterChange}
          sortOptions={sortOptions}
          sortBy={sortBy}
          onSortChange={setSortBy}
          layout="row"
          spacing={2}
        />
      )}

      {serviceId ? (
        <PaginatedCodingSessionsFeed
          emptyMessage={emptyMessage || defaultEmptyMessage}
          loading={loading}
          organizationId={organizationId}
          projectId={projectId}
          search={searchTerm}
          serviceId={serviceId}
          sortBy={sortBy}
        />
      ) : (
        <AgentSessionsList
          organizationId={organizationId}
          projectId={projectId}
          entityType={
            taskId
              ? EntityType.Task
              : designDocId
                ? EntityType.DesignDoc
                : initiativeId
                  ? EntityType.Initiative
                  : undefined
          }
          entityId={taskId ?? designDocId ?? initiativeId ?? undefined}
          loading={loading}
          search={searchTerm}
          sortBy={sortBy}
          emptyMessage={emptyMessage || defaultEmptyMessage}
        />
      )}
    </TabContainer>
  );
};
