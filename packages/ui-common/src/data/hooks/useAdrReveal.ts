/**
 * ADR Reveal Hook
 *
 * Handles progressive disclosure of ADR sections via Staged Content API
 * Uses design-doc contentType since ADRs are DesignDocs with template="ADR"
 */

import { useCallback } from "react";
import { log } from "../../utils/logger";
import type { AdrLevelType } from "../../types/adr";
import { StagedContentTypeId } from "../../api";
import { useStagedContentReveal } from "./useStagedContentReveal";

export interface UseAdrRevealProps {
  organizationId: string;
  projectId: string;
  adrId: string;
  conversationId?: string;
  currentLevel: AdrLevelType;
  onLevelChange: (level: AdrLevelType) => void;
  onError: (error: string) => void;
}

export interface UseAdrRevealReturn {
  isRevealingDecision: boolean;
  isRevealingConsequences: boolean;
  handleRevealDecision: () => Promise<void>;
  handleRevealConsequences: () => Promise<void>;
}

/**
 * Hook for revealing ADR sections progressively
 * Thin wrapper around useStagedContentReveal with ADR-specific stage handlers
 */
export const useAdrReveal = ({
  organizationId,
  projectId,
  adrId,
  conversationId,
  currentLevel,
  onLevelChange,
  onError,
}: UseAdrRevealProps): UseAdrRevealReturn => {
  const { revealStage, isRevealing } = useStagedContentReveal({
    organizationId,
    projectId,
    contentType: StagedContentTypeId.Adr,
    entityId: adrId,
    conversationId,
    onError,
  });

  const handleRevealDecision = useCallback(async (): Promise<void> => {
    if (isRevealing("decision") || !conversationId) {
      return;
    }

    log.uiInteraction("Ready for Decision button clicked", {
      currentLevel,
      targetLevel: "decision",
    });

    try {
      await revealStage("decision");
      // Update the current level to show the revealed content
      onLevelChange("decision");
    } catch (err) {
      // Error handling is done in the generic hook
      log.error("api", "Failed to reveal decision", err);
    }
  }, [currentLevel, conversationId, revealStage, onLevelChange, isRevealing]);

  const handleRevealConsequences = useCallback(async (): Promise<void> => {
    if (isRevealing("consequences") || !conversationId) {
      return;
    }

    log.uiInteraction("Ready for Consequences button clicked", {
      currentLevel,
      targetLevel: "consequences",
    });

    try {
      await revealStage("consequences");
      // Update the current level to show consequences
      onLevelChange("consequences");
    } catch (err) {
      // Error handling is done in the generic hook
      log.error("api", "Failed to reveal consequences", err);
    }
  }, [currentLevel, conversationId, revealStage, onLevelChange, isRevealing]);

  return {
    isRevealingDecision: isRevealing("decision"),
    isRevealingConsequences: isRevealing("consequences"),
    handleRevealDecision,
    handleRevealConsequences,
  };
};
