/**
 * ADR Status Utilities
 *
 * Helper functions for working with ADR statuses and levels
 */

import type { AdrLevelType } from "../types/adr";

/**
 * Map ADR status to the current level
 */
export function getCurrentLevelFromStatus(status: string): AdrLevelType {
  // Map status to editing level for progressive disclosure
  switch (status) {
    case "ADR_CONTEXT":
      return "context";
    case "ADR_GENERATING_DECISION":
    case "ADR_DECISION":
      return "decision";
    case "ADR_GENERATING_CONSEQUENCES":
    case "ADR_CONSEQUENCES":
    case "READY":
      return "consequences";
    default:
      return "context";
  }
}

/**
 * Check if a status indicates the system is generating content
 */
function isGeneratingStatus(status: string): boolean {
  return (
    status === "ADR_GENERATING_DECISION" ||
    status === "ADR_GENERATING_CONSEQUENCES"
  );
}

/**
 * Check if a status indicates processing (show loading state)
 * For ADRs, this is when the system is generating a section
 */
export function isProcessingStatus(status: string): boolean {
  return isGeneratingStatus(status);
}

/**
 * Determine if a section should have a CRDT WebSocket connection based on ADR status
 *
 * Connection rules:
 * - ADR_CONTEXT: Only context section connects
 * - ADR_GENERATING_DECISION: Context stays connected (AI is generating decision)
 * - ADR_DECISION: Context + decision sections connect
 * - ADR_GENERATING_CONSEQUENCES: Context + decision stay connected (AI is generating)
 * - ADR_CONSEQUENCES/READY: All sections connect
 *
 * This prevents premature connections to unrevealed sections and maintains
 * connections to earlier sections during generation phases.
 */
/**
 * Determine if a design doc section should be visible based on the current status.
 * During progressive refinement, only sections at or before the current level are shown.
 */
export function shouldShowDesignDocSection(
  sectionKey: string,
  status: string,
): boolean {
  const adrLevels: AdrLevelType[] = ["context", "decision", "consequences"];
  if (!adrLevels.includes(sectionKey as AdrLevelType)) return true;

  const level = sectionKey as AdrLevelType;
  switch (status) {
    case "ADR_CONTEXT":
    case "ADR_REFINING_CONTEXT":
      return level === "context";
    case "ADR_GENERATING_DECISION":
      return level === "context";
    case "ADR_DECISION":
    case "ADR_REFINING_DECISION":
      return level === "context" || level === "decision";
    case "ADR_GENERATING_CONSEQUENCES":
      return level === "context" || level === "decision";
    case "ADR_CONSEQUENCES":
    case "ADR_REFINING_CONSEQUENCES":
    case "REFINING_CONTENT":
    case "IN_REVIEW":
    case "READY":
    default:
      return true;
  }
}
