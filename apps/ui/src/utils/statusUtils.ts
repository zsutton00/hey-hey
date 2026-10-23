import type { AdrStatus, WorkStatus } from "@hey-hey/ui-common/api";
import {
  BrainstormStatus,
  DecisionStatus,
  DesignDocTemplate,
} from "@hey-hey/ui-common/api";

/**
 * Get user-friendly label for work status
 */
export const getStatusLabel = (status: WorkStatus): string => {
  switch (status) {
    case "REFINING_DESCRIPTION":
      return "Needs review";
    case "ACTIVE":
      return "Ready";
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
    default:
      return "Refining";
  }
};

/**
 * Get MUI color for work status
 */
export const getStatusColor = (
  status: WorkStatus,
):
  | "default"
  | "primary"
  | "secondary"
  | "error"
  | "info"
  | "success"
  | "warning" => {
  switch (status) {
    case "REFINING_DESCRIPTION":
      return "warning";
    case "REFINING_DETAILS":
      return "info";
    case "REFINING_ACCEPTANCE_CRITERIA":
      return "primary";
    case "ACTIVE":
      return "success";
    case "ON_HOLD":
      return "warning";
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "error";
    case "VERIFYING":
      return "info";
    case "ARCHIVED":
      return "default";
    case "GENERATING_DESCRIPTION":
    case "GENERATING_DETAILS":
    case "GENERATING_ACCEPTANCE_CRITERIA":
    case "GENERATING_DESCRIPTION_AND_DETAILS":
    case "GENERATING_ALL":
      return "info";
    case "BACKLOG":
      return "default";
    default:
      return "default";
  }
};

/**
 * Check if a task is in a refining or generating state
 * These states indicate the task content is being actively refined or generated
 */
export const isTaskRefining = (
  task: { status?: WorkStatus } | null | undefined,
): boolean => {
  if (!task?.status) return false;

  const refiningStatuses: WorkStatus[] = [
    "GENERATED",
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
};

/**
 * Check if an ADR/design doc is in a refining or generating state
 * These states indicate the ADR content is being actively refined or generated
 */
const isAdrRefining = (
  adr: { status?: string | AdrStatus } | null | undefined,
): boolean => {
  if (!adr?.status) return false;

  const refiningStatuses = [
    "ADR_CONTEXT",
    "ADR_GENERATING_DECISION",
    "ADR_DECISION",
    "ADR_GENERATING_CONSEQUENCES",
    "ADR_CONSEQUENCES",
  ];

  return refiningStatuses.includes(adr.status);
};

/**
 * Check if a design doc is in a refining state, accounting for template-specific statuses.
 */
export const isDesignDocRefining = (
  designDoc:
    | {
        status?: string | AdrStatus | BrainstormStatus | DecisionStatus;
        template?: DesignDocTemplate;
      }
    | null
    | undefined,
): boolean => {
  if (!designDoc?.status) return false;

  if (designDoc.template === DesignDocTemplate.Adr) {
    return isAdrRefining(designDoc);
  }

  if (designDoc.template === DesignDocTemplate.Brainstorm) {
    return designDoc.status === BrainstormStatus.RefiningContent;
  }

  if (designDoc.template === DesignDocTemplate.PlanDocument) {
    return designDoc.status === BrainstormStatus.RefiningContent;
  }

  if (designDoc.template === DesignDocTemplate.Decision) {
    return designDoc.status === DecisionStatus.RefiningContent;
  }

  return false;
};
