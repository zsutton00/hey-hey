import React from "react";
import { Box } from "@mui/material";
import { EntityFilters, type FilterConfig } from "../Entity/EntityFilters";
import type { SearchFilterState } from "./types";
import { EntityType, WorkStatus } from "../../api";
import {
  FEATURE_TASK_TYPE,
  STANDARD_TASK_TYPE,
} from "../../constants/taskTypes";

const TASK_STANDARD = `${EntityType.Task}:${STANDARD_TASK_TYPE}` as const;
const TASK_FEATURE = `${EntityType.Task}:${FEATURE_TASK_TYPE}` as const;

/**
 * Props for SearchFilters component
 */
export interface SearchFiltersProps {
  /**
   * Current filter values
   */
  filters: SearchFilterState;

  /**
   * Callback when filters change
   */
  onChange: (filters: SearchFilterState) => void;

  /**
   * Layout direction (controlled by parent based on screen width)
   */
  layout?: "sidebar" | "stacked";
}

/**
 * Entity type options for filtering
 */
const ENTITY_TYPE_OPTIONS = [
  { value: TASK_STANDARD, label: "Task" },
  { value: TASK_FEATURE, label: "Feature" },
  { value: EntityType.Initiative, label: "Initiative" },
  { value: EntityType.DesignDoc, label: "Design Doc" },
  { value: EntityType.Artifact, label: "Artifact" },
  { value: EntityType.AgentSession, label: "Agent Session" },
  { value: EntityType.Conversation, label: "Conversation" },
  { value: EntityType.Service, label: "Service" },
  { value: EntityType.Message, label: "Message" },
];

/**
 * Work status options for filtering
 */
const STATUS_OPTIONS = [
  { value: WorkStatus.Backlog, label: "Backlog" },
  { value: WorkStatus.Active, label: "Active" },
  { value: WorkStatus.OnHold, label: "On Hold" },
  { value: WorkStatus.Completed, label: "Completed" },
  { value: WorkStatus.Cancelled, label: "Cancelled" },
  { value: WorkStatus.Verifying, label: "Verifying" },
  { value: WorkStatus.Generated, label: "Generated" },
  { value: WorkStatus.RefiningDescription, label: "Refining Description" },
  { value: WorkStatus.RefiningDetails, label: "Refining Details" },
  {
    value: WorkStatus.RefiningAcceptanceCriteria,
    label: "Refining Acceptance Criteria",
  },
];

/**
 * Search filter component for advanced search
 *
 * Provides filtering options:
 * - Entity type (multiselect)
 * - Status (multiselect)
 * - Parent initiative ID (text input)
 * - Parent task ID (text input)
 *
 * Adapts layout based on screen width (sidebar or stacked).
 */
export const SearchFilters: React.FC<SearchFiltersProps> = ({
  filters,
  onChange,
  layout = "sidebar",
}) => {
  const filterConfigs: FilterConfig[] = [
    {
      type: "multiselect",
      key: "entityTypes",
      label: "Entity Type",
      options: ENTITY_TYPE_OPTIONS,
    },
    {
      type: "multiselect",
      key: "statuses",
      label: "Status",
      options: STATUS_OPTIONS,
    },
    {
      type: "search",
      key: "initiativeId",
      label: "Initiative ID",
      placeholder: "Filter by initiative ID...",
    },
    {
      type: "search",
      key: "parentTaskId",
      label: "Parent Task ID",
      placeholder: "Filter by parent task ID...",
    },
  ];

  const handleFilterChange = (key: string, value: unknown): void => {
    onChange({
      ...filters,
      [key]: value,
    });
  };

  const filterValues = {
    entityTypes: filters.entityTypes || [],
    statuses: filters.statuses || [],
    initiativeId: filters.initiativeId || "",
    parentTaskId: filters.parentTaskId || "",
  };

  if (layout === "sidebar") {
    return (
      <Box
        sx={{
          width: 280,
          mr: 2,
          flexShrink: 0,
        }}
      >
        <EntityFilters
          filters={filterConfigs}
          values={filterValues}
          onChange={handleFilterChange}
          layout="column"
          spacing={2}
        />
      </Box>
    );
  }

  // Stacked layout
  return (
    <EntityFilters
      filters={filterConfigs}
      values={filterValues}
      onChange={handleFilterChange}
      layout="row"
      spacing={2}
    />
  );
};
