/**
 * Generic Staged Content Reveal Hook
 *
 * Handles progressive disclosure/advancement for any staged content type
 */

import { useState, useCallback, useRef } from "react";
import { log } from "../../utils/logger";
import { stagedContentClient } from "../../clients/serviceClients";
import type { StagedContentTypeId } from "../../api";

export interface UseStagedContentRevealProps {
  organizationId: string;
  projectId: string;
  contentType: StagedContentTypeId;
  entityId: string;
  conversationId?: string;
  onError: (error: string) => void;
}

export interface UseStagedContentRevealReturn {
  revealStage: (targetStage: string) => Promise<{
    errors?: Array<{ message: string; field?: string }>;
    warnings?: Array<string>;
    newStage?: string;
    progress?: number;
  } | void>;
  isRevealing: (stage: string) => boolean;
  clearRevealingStates: () => void;
}

/**
 * Generic hook for revealing/advancing staged content sections
 * Works with any content type (ADR, initiatives, design docs, etc.)
 */
export const useStagedContentReveal = ({
  organizationId,
  projectId,
  contentType,
  entityId,
  conversationId,
  onError,
}: UseStagedContentRevealProps): UseStagedContentRevealReturn => {
  // Track which stages are currently being revealed
  const [revealingStages, setRevealingStages] = useState<Set<string>>(
    new Set()
  );
  const revealingStagesRef = useRef<Set<string>>(new Set());

  const revealStage = useCallback(
    async (targetStage: string) => {
      // Prevent concurrent reveal calls for the same stage
      if (revealingStagesRef.current.has(targetStage) || !conversationId) {
        return;
      }

      log.uiInteraction(`Revealing stage: ${targetStage}`, {
        contentType,
        targetStage,
      });

      revealingStagesRef.current.add(targetStage);
      setRevealingStages((prev) => new Set(prev).add(targetStage));
      onError(""); // Clear any previous errors

      try {
        // Call staged content advance API
        const response = await stagedContentClient.advanceStagedContent({
          organizationId: organizationId,
          projectId: projectId,
          contentType: contentType,
          entityId: entityId,
          stagedContentAdvanceRequest: { targetStage },
        });

        log.info(
          "api",
          "[useStagedContentReveal] Advanced stage successfully",
          {
            organizationId,
            projectId,
            contentType,
            entityId,
            targetStage,
            newStage: response.data.data?.newStage,
            progress: response.data.data?.progress,
          }
        );

        // Return validation results and progress
        const result = {
          errors: response.data.data?.errors?.map((err) => ({
            message: err.message || "Validation error",
            field: err.field,
          })),
          warnings: response.data.data?.warnings,
          newStage: response.data.data?.newStage,
          progress: response.data.data?.progress,
        };

        // If there are errors, set them via onError
        if (result.errors && result.errors.length > 0) {
          onError(result.errors.map((e) => e.message).join("; "));
        }

        return result;
      } catch (err) {
        log.error("api", `Failed to reveal stage: ${targetStage}`, err);
        onError(
          err instanceof Error
            ? err.message
            : `Failed to reveal ${targetStage} content`
        );
        throw err;
      } finally {
        revealingStagesRef.current.delete(targetStage);
        setRevealingStages((prev) => {
          const next = new Set(prev);
          next.delete(targetStage);
          return next;
        });
      }
    },
    [conversationId, organizationId, projectId, contentType, entityId, onError]
  );

  const isRevealing = useCallback(
    (stage: string): boolean => {
      return revealingStages.has(stage);
    },
    [revealingStages]
  );

  const clearRevealingStates = useCallback(() => {
    revealingStagesRef.current.clear();
    setRevealingStages(new Set());
  }, []);

  return {
    revealStage,
    isRevealing,
    clearRevealingStates,
  };
};
