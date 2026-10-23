import type { WorkStatus, Priority } from "../api";

/**
 * Get user-friendly label for work status
 */
export const getStatusLabel = (status: WorkStatus): string => {
  switch (status) {
    case "GENERATED":
      return "Generated";
    case "READY":
      return "Ready";
    case "REFINING":
      return "Refining";
    case "BLOCKED":
      return "Blocked";
    case "REFINING_DESCRIPTION":
      return "Needs review";
    case "ACTIVE":
      return "In progress";
    case "ON_HOLD":
      return "On Hold";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "REFINING_DETAILS":
      return "Refining details";
    case "REFINING_ACCEPTANCE_CRITERIA":
      return "Refining criteria";
    case "GENERATING_DESCRIPTION":
      return "Generating description";
    case "GENERATING_DETAILS":
      return "Generating details";
    case "GENERATING_ACCEPTANCE_CRITERIA":
      return "Generating criteria";
    case "GENERATING_DESCRIPTION_AND_DETAILS":
      return "Generating content";
    case "GENERATING_ALL":
      return "Generating all";
    case "BACKLOG":
      return "Backlog";
    case "VERIFYING":
      return "Verifying";
    case "ARCHIVED":
      return "Archived";
    case "SUPERSEDED":
      return "Superseded";
    default:
      return formatStatus(status);
  }
};

/**
 * Get MUI color for work status
 */
export const getStatusColorMapping = (
  status: string,
):
  | "default"
  | "primary"
  | "secondary"
  | "error"
  | "info"
  | "success"
  | "warning"
  | "ready"
  | "active" => {
  switch (status.toUpperCase().replace(/_/g, " ")) {
    case "REFINING":
    case "REFINING DESCRIPTION":
    case "REFINING DETAILS":
    case "REFINING ACCEPTANCE CRITERIA":
    case "GENERATING DESCRIPTION":
    case "GENERATING DETAILS":
    case "GENERATING ACCEPTANCE CRITERIA":
    case "GENERATING DESCRIPTION AND DETAILS":
    case "GENERATING ALL":
    case "NEEDS REVIEW":
      return "primary";
    case "ACTIVE":
    case "IN PROGRESS":
      return "active";
    case "ON HOLD":
      return "info";
    case "VERIFYING":
      return "info";
    case "COMPLETED":
    case "COMPLETE":
      return "success";
    case "CANCELLED":
      return "error";
    case "ARCHIVED":
      return "default";
    case "SUPERSEDED":
      return "secondary";
    case "BLOCKED":
      return "warning";
    case "SKIPPED":
      return "secondary";
    case "BACKLOG":
    case "NOT STARTED":
      return "ready";
    default:
      return "default";
  }
};

/**
 * Get user-friendly label for priority
 */
export const getPriorityLabel = (priority: Priority): string => {
  switch (priority) {
    case "LOW":
      return "Low";
    case "MEDIUM":
      return "Medium";
    case "HIGH":
      return "High";
    default:
      return "Unknown";
  }
};

/**
 * Get MUI color for priority
 */
export const getPriorityColor = (
  priority: Priority,
): "info" | "warning" | "error" | "default" => {
  switch (priority) {
    case "LOW":
      return "info";
    case "MEDIUM":
      return "warning";
    case "HIGH":
      return "error";
    default:
      return "default";
  }
};

/**
 * Format a status string for display (replace underscores with spaces and capitalize)
 */
export const formatStatus = (status: string): string => {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Random prompt phrases for work item descriptions
 */
const WORK_ITEM_PROMPT_PHRASES = [
  "Ready to refine this?",
  "What details would you add?",
  "How would you expand on this?",
  "Need your input to finalize...",
  "Let's make this more specific together.",
] as const;

/**
 * Get a random prompt phrase
 */
export const getRandomPrompt = (): string => {
  return WORK_ITEM_PROMPT_PHRASES[
    Math.floor(Math.random() * WORK_ITEM_PROMPT_PHRASES.length)
  ];
};

/**
 * Determines if a work item is still in a refining status
 */
export function isTaskRefining(
  task: { status?: WorkStatus } | null | undefined,
): boolean {
  if (!task?.status) return false;

  const refiningStatuses: WorkStatus[] = [
    "GENERATED",
    "REFINING",
    "REFINING_DESCRIPTION",
    "REFINING_DETAILS",
    "REFINING_ACCEPTANCE_CRITERIA",
    "GENERATING_DESCRIPTION",
    "GENERATING_DETAILS",
    "GENERATING_DESCRIPTION_AND_DETAILS",
    "GENERATING_ACCEPTANCE_CRITERIA",
    "GENERATING_ALL",
  ];

  return refiningStatuses.includes(task.status);
}

/** Plan drafts use BACKLOG; other work-item types keep their own labels. */
export const getPlanStatusLabel = (status: WorkStatus): string =>
  status === "BACKLOG" ? "Draft" : getStatusLabel(status);
