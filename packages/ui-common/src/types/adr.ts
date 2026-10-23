/**
 * Architecture Decision Record (ADR) Types
 *
 * Types for managing Architecture Decision Records - documents that capture
 * important architectural decisions along with their context and consequences.
 */

import { AdrStatus } from "../api";

/**
 * ADR content structure for the editor
 *
 * This represents the editable content of an ADR, organized into progressive
 * disclosure sections.
 */
export interface AdrContent extends Record<string, unknown> {
  /** The context/situation that led to the decision */
  context: string;
  /** The decision that was made */
  decision: string;
  /** The positive and negative consequences of the decision */
  consequences: string;
}

/**
 * ADR level type for progressive disclosure
 *
 * Represents the main sections of an ADR that users progressively
 * reveal and complete.
 */
export type AdrLevelType = "context" | "decision" | "consequences";

// Re-export AdrStatus from generated API types
export type { AdrStatus };

/**
 * ADR status display information
 */
export interface AdrStatusInfo {
  label: string;
  color: "default" | "info" | "success" | "warning" | "error";
  description: string;
}

/**
 * Map of ADR statuses to their display information
 */
export const ADR_STATUS_INFO: Record<string, AdrStatusInfo> = {
  // Legacy statuses
  draft: {
    label: "Draft",
    color: "default",
    description: "Being written, not yet proposed",
  },
  proposed: {
    label: "Proposed",
    color: "info",
    description: "Proposed for review and decision",
  },
  accepted: {
    label: "Accepted",
    color: "success",
    description: "Accepted and active",
  },
  rejected: {
    label: "Rejected",
    color: "error",
    description: "Proposed but rejected",
  },
  deprecated: {
    label: "Deprecated",
    color: "warning",
    description: "No longer recommended",
  },
  superseded: {
    label: "Superseded",
    color: "warning",
    description: "Replaced by a newer ADR",
  },
  // ADR progressive statuses
  ADR_CONTEXT: {
    label: "Context",
    color: "default",
    description: "Documenting the context and background",
  },
  ADR_GENERATING_DECISION: {
    label: "Generating Decision",
    color: "info",
    description: "AI is generating the decision section",
  },
  ADR_DECISION: {
    label: "Decision",
    color: "info",
    description: "Documenting the decision",
  },
  ADR_GENERATING_CONSEQUENCES: {
    label: "Generating Consequences",
    color: "info",
    description: "AI is generating the consequences section",
  },
  ADR_CONSEQUENCES: {
    label: "Consequences",
    color: "info",
    description: "Documenting the consequences",
  },
  READY: {
    label: "Ready",
    color: "success",
    description: "ADR is complete and ready",
  },
};
