import type { ProposalResponseDto } from "../../api";
import { proposalQueryOptions } from "../collections/proposals";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseProposalReturn
  extends Omit<DataHookReturn<ProposalResponseDto>, "data"> {
  proposal: ProposalResponseDto | null;
}

export function useProposal(
  organizationId: string | undefined,
  projectId: string | undefined,
  proposalId: string | undefined,
  options: CollectionHookOptions<ProposalResponseDto> = {}
): UseProposalReturn {
  const enabled =
    options.enabled !== false && !!organizationId && !!projectId && !!proposalId;
  const { result, state } = useDataLayerQuery(
    proposalQueryOptions(organizationId ?? "", projectId ?? "", proposalId ?? ""),
    { ...options, enabled }
  );
  return {
    ...state,
    proposal: result.data ?? null,
    isReady: enabled && state.isReady,
  };
}
