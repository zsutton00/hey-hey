import React from "react";
import { useTranslation } from "react-i18next";
import type { WorkStatus } from "../../api";
import { KEYS } from "../../i18n/keys";
import { EntityFilters, type FilterConfig } from "./EntityFilters";

interface WorkItemEntityFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: WorkStatus | "";
  onStatusFilterChange: (value: WorkStatus | "") => void;
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
      options: [
        {
          value: "REFINING_DESCRIPTION",
          label: "Refining Description",
        },
        {
          value: "REFINING_DETAILS",
          label: "Refining Details",
        },
        {
          value: "REFINING_ACCEPTANCE_CRITERIA",
          label: "Refining Acceptance Criteria",
        },
        {
          value: "ACTIVE",
          label: "Active",
        },
        {
          value: "ON_HOLD",
          label: "On Hold",
        },
        {
          value: "COMPLETED",
          label: "Completed",
        },
        {
          value: "CANCELLED",
          label: "Cancelled",
        },
        {
          value: "SUPERSEDED",
          label: "Superseded",
        },
      ],
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
      onStatusFilterChange(value as WorkStatus | "");
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
