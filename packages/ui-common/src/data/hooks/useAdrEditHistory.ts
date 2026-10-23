/**
 * ADR Edit History Hook (Placeholder)
 *
 * Provides edit history for highlighting changes in the ADR editor
 * TODO: Replace with actual implementation when ADR collection and API are available
 */

import { useCallback, useMemo } from "react";
import type { EditHistoryEntryDto } from "../../utils/textDiff";

export interface UseAdrEditHistoryParams {
  organizationId: string;
  projectId: string;
  adrId: string;
  enabled?: boolean;
}

export interface UseAdrEditHistoryReturn {
  editHistory: EditHistoryEntryDto[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<EditHistoryEntryDto[] | null>;
}

/**
 * Hook for fetching ADR edit history
 *
 * NOTE: This is currently a placeholder implementation that returns empty edit history.
 * It needs to be connected to actual ADR collection system and API endpoints.
 */
export const useAdrEditHistory = ({
  organizationId: _organizationId,
  projectId: _projectId,
  adrId: _adrId,
  enabled: _enabled = true,
}: UseAdrEditHistoryParams): UseAdrEditHistoryReturn => {
  // Placeholder: return empty edit history
  const editHistory = useMemo<EditHistoryEntryDto[]>(() => [], []);

  // Placeholder refetch function
  const refetch = useCallback(async (): Promise<
    EditHistoryEntryDto[] | null
  > => {
    // TODO: Implement actual refetch when collection is available
    return [];
  }, []);

  return {
    editHistory,
    isLoading: false,
    error: null,
    refetch,
  };
};
