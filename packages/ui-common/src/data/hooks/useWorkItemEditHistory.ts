import { editHistoryQueryOptions, type EditHistoryEntry } from "../collections/editHistory";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export interface UseWorkItemEditHistoryParams {
  organizationId: string;
  workItemId: string;
  entityType: "initiative" | "task";
  enabled?: boolean;
}

export interface UseWorkItemEditHistoryReturn {
  editHistory: EditHistoryEntry[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<EditHistoryEntry[] | null>;
}

/**
 * Custom hook for fetching work item edit history using the new collection system
 * Used to show highlighted diffs of system vs user changes
 */
export const useWorkItemEditHistory = ({
  organizationId,
  workItemId,
  entityType,
  enabled = true,
}: UseWorkItemEditHistoryParams): UseWorkItemEditHistoryReturn => {
  const isEnabled = enabled && !!organizationId && !!workItemId && !!entityType;
  const { result, state } = useDataLayerQuery(
    editHistoryQueryOptions(organizationId, workItemId, entityType),
    { enabled: isEnabled }
  );
  useWebsocketSubscriptions({ initiativeIds: [workItemId] }, { enabled: isEnabled });
  return {
    editHistory: isEnabled ? result.data ?? [] : [],
    isLoading: state.isLoading,
    error: state.error,
    refetch: state.refetch,
  };
};
