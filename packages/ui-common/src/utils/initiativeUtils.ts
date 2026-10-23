import type { WorkStatus } from "../api";
import { WorkStatus as WorkStatusValues } from "../api";

// Helper function to determine current level from initiative status
export function getCurrentLevelFromStatus(
  status: WorkStatus | string,
): "description" | "details" | "acceptanceCriteria" {
  switch (status) {
    // Legacy workflow statuses - may need backend updates
    case "REFINING_DESCRIPTION":
      return "description";
    case "GENERATING_DETAILS":
    case "REFINING_DETAILS":
      return "details";
    case "GENERATING_ACCEPTANCE_CRITERIA":
    case "REFINING_ACCEPTANCE_CRITERIA":
      return "acceptanceCriteria";
    // New WorkStatus enum values
    case WorkStatusValues.Verifying:
    case WorkStatusValues.Backlog:
    case WorkStatusValues.Refining:
    case WorkStatusValues.Blocked:
    case WorkStatusValues.Active:
    case WorkStatusValues.OnHold:
    case WorkStatusValues.Completed:
    case WorkStatusValues.Cancelled:
      return "acceptanceCriteria";
    default:
      return "description"; // Default for other statuses
  }
}
