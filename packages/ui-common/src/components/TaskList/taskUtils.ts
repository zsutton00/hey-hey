import type {
  Priority,
  TaskPriority,
  TaskResponseDto,
  WorkStatus,
} from "../../api";
import type { WorkItemTypeKey } from "../../constants/taskTypes";
import {
  formatStatus as formatUnifiedStatus,
  getPriorityColor as getUnifiedPriorityColor,
} from "../../utils/statusUtils";
import { getTaskSectionContent } from "../../utils/workItemSections";

/**
 * Get the MUI color for a task type
 */
export const getTypeColor = (
  type: WorkItemTypeKey
): "success" | "primary" | "info" | "warning" | "secondary" | "default" => {
  switch (type) {
    case "STANDARD":
      return "success";
    case "BUG":
      return "warning";
    default:
      return "default";
  }
};

/**
 * Get the MUI color for a task priority - uses unified priority utilities
 * @deprecated Use getPriorityColor from utils/statusUtils.ts instead
 */
export const getPriorityColor = (
  priority: TaskPriority | Priority
): "info" | "warning" | "error" | "default" => {
  return getUnifiedPriorityColor(priority as Priority);
};

/**
 * Format a status string for display - uses unified format utilities
 * @deprecated Use formatStatus from utils/statusUtils.ts instead
 */
export const formatStatus = formatUnifiedStatus;

/**
 * Format estimated hours for display
 */
export const formatEstimatedHours = (hours: number): string => {
  return `${hours}h`;
};

/**
 * Truncate a dependency ID for display
 */
export const formatDependency = (
  dependency: string,
  maxLength: number = 8
): string => {
  return dependency.length > maxLength
    ? dependency.substring(0, maxLength) + "..."
    : dependency;
};

/**
 * Task display constants
 */
export const TASK_DISPLAY_CONSTANTS = {
  DEFAULT_TITLE: "Untitled Task",
  DEFAULT_DESCRIPTION: "No description",
  DEFAULT_STATUS: "BACKLOG" as WorkStatus,
  DEFAULT_TYPE: "STANDARD" as WorkItemTypeKey,
  DEFAULT_PRIORITY: "MEDIUM" as TaskPriority,
  DEPENDENCY_MAX_LENGTH: 8,
} as const;

/**
 * Type for task data extracted from API response
 */
export interface TaskDisplayData {
  title: string;
  description: string;
  status: WorkStatus;
  type: WorkItemTypeKey;
  priority: TaskPriority | Priority;
  dependencies: string[];
  estimatedHours: number;
}

/**
 * Extract task display data from API response with proper fallbacks
 */
export const extractTaskDisplayData = (
  task: TaskResponseDto | (TaskResponseDto & { title?: string })
): TaskDisplayData => {
  const title = task.name || (task as { title?: string }).title;
  const description =
    getTaskSectionContent(task.sections, "description") ||
    TASK_DISPLAY_CONSTANTS.DEFAULT_DESCRIPTION;

  const status = task.status || TASK_DISPLAY_CONSTANTS.DEFAULT_STATUS;
  const priority =
    (task.priority as TaskPriority | Priority | undefined) ||
    TASK_DISPLAY_CONSTANTS.DEFAULT_PRIORITY;

  const derivedType = task.type || TASK_DISPLAY_CONSTANTS.DEFAULT_TYPE;

  return {
    title: title || TASK_DISPLAY_CONSTANTS.DEFAULT_TITLE,
    description,
    status,
    type: derivedType,
    priority,
    dependencies: (task as { dependencies?: string[] }).dependencies || [],
    estimatedHours: (task as { estimatedHours?: number }).estimatedHours || 0,
  };
};
