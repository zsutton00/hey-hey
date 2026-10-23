import type { WorkStatus } from "../api";
import { WorkStatus as WorkStatusValues } from "../api";
import {
  hasSelectedSection,
  type WorkItemSectionSelection,
} from "./workItemSections";

interface WorkItemLevelProfile {
  entityType?: "initiative" | "task";
  sectionSelection?: WorkItemSectionSelection;
}

// Helper function to determine current level from work item status
export function getCurrentLevelFromStatus(
  status: WorkStatus | string,
  profile: WorkItemLevelProfile = {},
): "description" | "acceptanceCriteria" {
  if (profile.entityType === "task") {
    const hasAcceptanceCriteria =
      profile.sectionSelection !== undefined &&
      hasSelectedSection(profile.sectionSelection, "acceptanceCriteria");
    switch (status) {
      case "REFINING_DESCRIPTION":
      case "GENERATING_DESCRIPTION":
        return "description";
      case "GENERATING_DETAILS":
      case "REFINING_DETAILS":
      case "GENERATING_ACCEPTANCE_CRITERIA":
      case "REFINING_ACCEPTANCE_CRITERIA":
      case WorkStatusValues.Backlog:
      case WorkStatusValues.Refining:
      case WorkStatusValues.Blocked:
      case WorkStatusValues.Verifying:
      case WorkStatusValues.Active:
      case WorkStatusValues.OnHold:
      case WorkStatusValues.Completed:
      case WorkStatusValues.Cancelled:
      case WorkStatusValues.Archived:
        return hasAcceptanceCriteria ? "acceptanceCriteria" : "description";
      default:
        return "description";
    }
  }

  switch (status) {
    // Legacy workflow statuses - may need backend updates
    case "REFINING_DESCRIPTION":
      return "description";
    case "GENERATING_DETAILS":
    case "REFINING_DETAILS":
      return "description";
    case "GENERATING_ACCEPTANCE_CRITERIA":
    case "REFINING_ACCEPTANCE_CRITERIA":
      return "acceptanceCriteria";
    // New WorkStatus enum values
    case WorkStatusValues.Backlog:
    case WorkStatusValues.Refining:
    case WorkStatusValues.Blocked:
    case WorkStatusValues.Verifying:
    case WorkStatusValues.Active:
    case WorkStatusValues.OnHold:
    case WorkStatusValues.Completed:
    case WorkStatusValues.Cancelled:
      return "acceptanceCriteria";
    default:
      return "description"; // Default for other statuses
  }
}

// Helper function to check if a status indicates generating content
function isGeneratingStatus(status: string): boolean {
  return status?.startsWith("GENERATING_") || false;
}

// Helper function to check if a status indicates refining content
function isRefiningStatus(status: string): boolean {
  return status === "REFINING" || status?.startsWith("REFINING_") || false;
}

/**
 * Statuses the system manages during generation/refinement: GENERATED plus all
 * GENERATING_* and REFINING_* states. These are valid statuses a task can
 * legitimately hold, but a user never sets them from the status picker — the
 * system drives those transitions. The picker uses this to filter them out of
 * the backend-provided per-type allowed set, which expresses validity, not
 * manual selectability.
 */
export function isMachineManagedStatus(status: string): boolean {
  return (
    status === WorkStatusValues.Generated ||
    isGeneratingStatus(status) ||
    isRefiningStatus(status)
  );
}

// Helper function to check if a status indicates any processing (loading state)
// Only GENERATING_ statuses should show loading - REFINING_ means ready for editing
export function isProcessingStatus(status: string): boolean {
  return isGeneratingStatus(status);
}
