import { useCallback } from "react";
import type { InitiativeResponseDto, UpdateInitiativeDto } from "../../api";
import { initiativeQueryOptions } from "../collections/initiatives";
import type { CollectionHookOptions, MutationCallbacks } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useInitiativeUpdate } from "./initiativeMutations";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";
export const ENTITY_TYPE = "Initiative";
export interface UseInitiativeReturn {
  data: InitiativeResponseDto | null;
  isLoading: boolean;
  isFetched: boolean;
  error: Error | null;
  isStale: boolean;
  update: (
    updates: UpdateInitiativeDto,
    callbacks?: MutationCallbacks<InitiativeResponseDto>
  ) => Promise<InitiativeResponseDto>;
  refetch: () => Promise<InitiativeResponseDto | null>;
  markStale: () => void;
}
type Options = CollectionHookOptions<InitiativeResponseDto> & {
  includeDesignDocCounts?: boolean;
};
export function useInitiative(
  orgId: string,
  initiativeId: string,
  options: Options = {}
): UseInitiativeReturn {
  const { result, state: query } = useDataLayerQuery(
    initiativeQueryOptions(orgId, initiativeId),
    {
      ...options,
      enabled: !!orgId && !!initiativeId && options.enabled !== false,
    }
  );
  const updateById = useInitiativeUpdate(orgId);
  const data = result.data ?? null;
  const update = useCallback(
    (
      updates: UpdateInitiativeDto,
      callbacks?: MutationCallbacks<InitiativeResponseDto>
    ) => {
      if (!data)
        return Promise.reject(
          new Error("Cannot update: no initiative data available")
        );
      return updateById(initiativeId, updates, callbacks);
    },
    [data, initiativeId, updateById]
  );
  useWebsocketSubscriptions(
    { initiativeIds: [initiativeId] },
    { enabled: options.enabled ?? true }
  );
  return { ...query, data, update };
}
