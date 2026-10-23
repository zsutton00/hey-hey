/**
 * Generic Staged Content Refine Hook
 *
 * Handles sending user messages to refine staged content via conversations
 */

import { useState, useCallback, useRef } from "react";
import { stagedContentClient } from "../../clients/serviceClients";
import { logger } from "../../utils/logger";
import type { StagedContentTypeId } from "../../api";

export interface UseStagedContentRefineProps {
  organizationId: string;
  projectId: string;
  contentType: StagedContentTypeId;
  entityId: string;
  planId?: string;
  enabled?: boolean;
}

export interface UseStagedContentRefineReturn {
  refine: (message?: string) => Promise<{
    conversationId?: string;
    workflowId?: string | null;
    errors?: Array<{ message: string; field?: string }>;
    warnings?: Array<string>;
  } | void>;
  isRefining: boolean;
  refineError: string | null;
}

/**
 * Generic hook for refining staged content via user messages
 * Works with any content type (ADR, initiatives, design docs, etc.)
 */
export const useStagedContentRefine = ({
  organizationId,
  projectId,
  contentType,
  entityId,
  planId,
}: UseStagedContentRefineProps): UseStagedContentRefineReturn => {
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const isRefiningRef = useRef(false);

  const refine = useCallback(
    async (message: string = "") => {
      // Prevent concurrent refine calls
      if (isRefiningRef.current) {
        return;
      }

      isRefiningRef.current = true;
      setIsRefining(true);
      setRefineError(null);

      try {
        logger.info("data_hooks", "[useStagedContentRefine] Refining content", {
          organizationId,
          projectId,
          contentType,
          entityId,
          messageLength: message.length,
        });

        const response = await stagedContentClient.refineStagedContent({
          organizationId: organizationId,
          projectId: projectId,
          contentType: contentType,
          entityId: entityId,
          stagedContentRefineRequest: {
            message,
            planId,
          },
        });

        logger.info(
          "data_hooks",
          "[useStagedContentRefine] Refinement successful",
          {
            organizationId,
            projectId,
            contentType,
            entityId,
            conversationId: response.data.data?.conversationId,
            workflowId: response.data.data?.workflowId,
          }
        );

        // Return the important fields from the response
        return {
          conversationId: response.data.data?.conversationId,
          workflowId: response.data.data?.workflowId,
          errors: response.data.data?.errors?.map((err) => ({
            message: err.message || "Validation error",
            field: err.field,
          })),
          warnings: response.data.data?.warnings,
        };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to refine content";
        logger.error(
          "data_hooks",
          "[useStagedContentRefine] Refinement failed",
          {
            error: err,
          }
        );
        setRefineError(errorMessage);
        throw err;
      } finally {
        isRefiningRef.current = false;
        setIsRefining(false);
      }
    },
    [organizationId, projectId, contentType, entityId, planId]
  );

  return {
    refine,
    isRefining,
    refineError,
  };
};
