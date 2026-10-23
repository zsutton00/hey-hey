import { useCallback } from "react";
import type { UnifiedSearchRequest, UnifiedSearchResponse } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";

interface UseUnifiedSearchReturn {
  unifiedSearch: (
    request: UnifiedSearchRequest,
  ) => Promise<UnifiedSearchResponse | null>;
}

/**
 * Hook for unified graph + embeddings search in a project.
 */
export const useUnifiedSearch = (
  organizationId: string,
  projectId: string,
): UseUnifiedSearchReturn => {
  const unifiedSearch = useCallback(
    async (
      request: UnifiedSearchRequest,
    ): Promise<UnifiedSearchResponse | null> => {
      try {
        const response = await unifiedApiClient.unifiedSearch({
          organizationId: organizationId,
          projectId: projectId,
          unifiedSearchRequest: request,
        });
        return response.data?.data ?? null;
      } catch (error) {
        console.error("Unified search failed:", error);
        return null;
      }
    },
    [organizationId, projectId],
  );

  return { unifiedSearch };
};
