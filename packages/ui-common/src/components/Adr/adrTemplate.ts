/**
 * ADR Template Factory
 *
 * Creates EditorTemplate for Architecture Decision Records with progressive disclosure
 */

import type { EditorSection } from "../../types/editorTemplate";
import type { AdrLevelType } from "../../types/adr";
import { getCurrentLevelFromStatus } from "../../utils/adrUtils";

/**
 * Reveal handlers for ADR sections
 */
interface AdrRevealHandlers {
  handleRevealDecision: () => Promise<void>;
  handleRevealConsequences: () => Promise<void>;
  isRevealingDecision: boolean;
  isRevealingConsequences: boolean;
}

export function buildContextSectionConfig(): EditorSection {
  return {
    id: "context",
    header: { text: "Context", level: 2, editable: false },
    content: {
      initialText: "",
      showAsSkeleton: false,
      skeletonConfig: {
        type: "text",
        lines: 3,
        width: "full",
        animated: false,
      },
    },
    editable: true,
    required: true,
  };
}

export interface DecisionSectionConfigInput {
  currentLevel: AdrLevelType;
  revealHandlers: AdrRevealHandlers;
  status?: string;
}

export function buildDecisionSectionConfig({
  currentLevel,
  revealHandlers,
  status,
}: DecisionSectionConfigInput): EditorSection {
  const isGenerating = status === "ADR_GENERATING_DECISION";
  const showSkeleton = currentLevel === "context" || isGenerating;

  return {
    id: "decision",
    header: { text: "Decision", level: 2, editable: false },
    content: {
      initialText: "",
      showAsSkeleton: showSkeleton,
      skeletonConfig: {
        type: "text",
        lines: 4,
        width: "partial",
        animated: isGenerating,
        ...(currentLevel === "context" && {
          buttonText: "Ready for Decision",
          onReveal: revealHandlers.handleRevealDecision,
          isLoading: revealHandlers.isRevealingDecision,
        }),
      },
    },
    editable: true,
    required: true,
  };
}

export interface ConsequencesSectionConfigInput {
  currentLevel: AdrLevelType;
  revealHandlers: AdrRevealHandlers;
  status?: string;
}

export function buildConsequencesSectionConfig({
  currentLevel,
  revealHandlers,
  status,
}: ConsequencesSectionConfigInput): EditorSection {
  const isGenerating = status === "ADR_GENERATING_CONSEQUENCES";
  const showSkeleton =
    currentLevel === "context" || currentLevel === "decision" || isGenerating;

  return {
    id: "consequences",
    header: { text: "Consequences", level: 2, editable: false },
    content: {
      initialText: "",
      showAsSkeleton: showSkeleton,
      skeletonConfig: {
        type: "text",
        lines: 3,
        width: "partial",
        animated: isGenerating,
        ...(currentLevel === "decision" && {
          buttonText: "Ready for Consequences",
          onReveal: revealHandlers.handleRevealConsequences,
          isLoading: revealHandlers.isRevealingConsequences,
        }),
      },
    },
    editable: true,
    required: true,
  };
}

// getCurrentLevelFromStatus moved to utils/adrUtils.ts
export { getCurrentLevelFromStatus };
