import { useCallback } from "react";
import type {
  ProposalResponseDto,
  ProposalType,
  ProposalAction,
  ProposalStatus,
  TargetEntityType,
  WorkItemTypeRole,
} from "../../api";
import {
  proposalsQueryOptions,
  type ProposalPagination,
} from "../collections/proposals";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseProposalsOptions extends CollectionHookOptions<ProposalResponseDto> {
  completionDependencyId?: string;
  type?: ProposalType;
  action?: ProposalAction;
  status?: ProposalStatus;
  targetEntityType?: TargetEntityType;
  workItemRole?: WorkItemTypeRole;
  targetEntityId?: string;
  windowStart?: string;
  windowEnd?: string;
  limit?: number;
  offset?: number;
}

export interface UseProposalsReturn extends DataCollectionHookReturn<ProposalResponseDto> {
  pagination: ProposalPagination | undefined;
}

export function useProposals(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseProposalsOptions = {},
): UseProposalsReturn {
  const {
    completionDependencyId,
    type,
    action,
    status,
    targetEntityType,
    workItemRole,
    targetEntityId,
    windowStart,
    windowEnd,
    limit = 20,
    offset = 0,
    ...baseOptions
  } = options;
  const enabled =
    baseOptions.enabled !== false && !!organizationId && !!projectId;
  const { result, state } = useDataLayerQuery(
    proposalsQueryOptions(organizationId ?? "", projectId ?? "", {
      completionDependencyId,
      type,
      action,
      status,
      targetEntityType,
      workItemRole,
      targetEntityId,
      windowStart,
      windowEnd,
      limit,
      offset,
    }),
    { ...baseOptions, enabled },
  );
  const { refetch: refetchList } = state;
  const refetch = useCallback(async (): Promise<
    ProposalResponseDto[] | null
  > => {
    try {
      return (await refetchList())?.proposals ?? null;
    } catch {
      return null;
    }
  }, [refetchList]);
  return {
    ...state,
    data: result.data?.proposals ?? [],
    pagination: result.data?.pagination,
    isReady: enabled && state.isReady,
    refetch,
  };
}
