import type { TaskResponseDto } from "../../api/api";
import React from "react";
import { useTranslation } from "react-i18next";

import type { WorkItemStatusFilterOption } from "../../utils/workItemStatusVocabulary";
import { KEYS } from "../../i18n/keys";
import { EntityFilters, type FilterConfig } from "./EntityFilters";

interface WorkItemEntityFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: TaskResponseDto["status"] | "";
  onStatusFilterChange: (value: TaskResponseDto["status"] | "") => void;
  /** Status choices drawn from the types of the items being filtered. */
  statusOptions: WorkItemStatusFilterOption[];
  sortBy: string;
  onSortByChange: (value: string) => void;
}

/**
 * WorkItemEntityFilters - Work item specific filter component using generic EntityFilters
 *
 * This component wraps EntityFilters with work-item specific configuration,
 * maintaining backward compatibility with WorkItemFilters API.
 *
 * @example
 * ```typescript
 * <WorkItemEntityFilters
 *   searchTerm={searchTerm}
 *   onSearchChange={setSearchTerm}
 *   statusFilter={statusFilter}
 *   onStatusFilterChange={setStatusFilter}
 *   statusOptions={statusOptions}
 *   sortBy={sortBy}
 *   onSortByChange={setSortBy}
 * />
 * ```
 */
export const WorkItemEntityFilters: React.FC<WorkItemEntityFiltersProps> = ({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  statusOptions,
  sortBy,
  onSortByChange,
}) => {
  const { t } = useTranslation();

  // Define filter configurations
  const filters: FilterConfig[] = [
    {
      type: "search",
      key: "search",
      label: t(KEYS.initiatives.filters.searchPlaceholder),
      placeholder: t(KEYS.initiatives.filters.searchPlaceholder),
    },
    {
      type: "select",
      key: "status",
      label: t(KEYS.initiatives.filters.status),
      options: statusOptions,
    },
  ];

  // Define sort options
  const sortOptions = [
    {
      value: "created-desc",
      label: t(KEYS.initiatives.filters.sortCreatedDesc),
    },
    {
      value: "created-asc",
      label: t(KEYS.initiatives.filters.sortCreatedAsc),
    },
    {
      value: "name-asc",
      label: t(KEYS.initiatives.filters.sortNameAsc),
    },
    {
      value: "name-desc",
      label: t(KEYS.initiatives.filters.sortNameDesc),
    },
    {
      value: "status",
      label: t(KEYS.initiatives.filters.sortStatus),
    },
    {
      value: "priority",
      label: t(KEYS.initiatives.filters.sortPriority),
    },
  ];

  // Map filter values to EntityFilters format
  const filterValues = {
    search: searchTerm,
    status: statusFilter,
  };

  // Handle filter changes
  const handleFilterChange = (key: string, value: unknown): void => {
    if (key === "search") {
      onSearchChange(value as string);
    } else if (key === "status") {
      onStatusFilterChange(value as TaskResponseDto["status"] | "");
    }
  };

  return (
    <EntityFilters
      filters={filters}
      values={filterValues}
      onChange={handleFilterChange}
      sortOptions={sortOptions}
      sortBy={sortBy}
      onSortChange={onSortByChange}
      layout="row"
      spacing={2}
    />
  );
};
