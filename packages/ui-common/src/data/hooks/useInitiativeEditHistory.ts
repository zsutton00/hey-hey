import { useWorkItemEditHistory } from "./useWorkItemEditHistory";
import type { EditHistoryEntry } from "../collections/editHistory";

export interface UseInitiativeEditHistoryParams {
  organizationId: string;
  initiativeId: string;
  enabled?: boolean;
}

export interface UseInitiativeEditHistoryReturn {
  editHistory: EditHistoryEntry[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<EditHistoryEntry[] | null>;
}

export const useInitiativeEditHistory = ({
  organizationId,
  initiativeId,
  enabled = true,
}: UseInitiativeEditHistoryParams): UseInitiativeEditHistoryReturn =>
  useWorkItemEditHistory({
    organizationId,
    workItemId: initiativeId,
    entityType: "initiative",
    enabled,
  });
