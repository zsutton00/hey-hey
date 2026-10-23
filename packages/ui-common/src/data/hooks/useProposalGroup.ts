import type { ProposalGroupSnapshot } from "../../api";
import { proposalGroupQueryOptions } from "../collections/proposalGroups";
import type { CollectionHookOptions } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseProposalGroupReturn {
  proposalGroup: ProposalGroupSnapshot | null;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  isDisabled: boolean;
  error: Error | null;
  isStale: boolean;
  refetch: () => Promise<ProposalGroupSnapshot | null>;
  markStale: () => void;
}

export function useProposalGroup(
  organizationId: string | undefined,
  projectId: string | undefined,
  groupId: string | undefined,
  options: CollectionHookOptions<ProposalGroupSnapshot> = {}
): UseProposalGroupReturn {
  const enabled =
    options.enabled !== false && !!organizationId && !!projectId && !!groupId;
  const { result, state } = useDataLayerQuery(
    proposalGroupQueryOptions(organizationId ?? "", projectId ?? "", groupId ?? ""),
    { ...options, enabled }
  );
  return {
    ...state,
    proposalGroup: result.data ?? null,
    isReady: enabled && state.isReady,
    isDisabled: !enabled,
  };
}
