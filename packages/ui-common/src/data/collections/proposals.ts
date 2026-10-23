import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type {
  PaginatedProposalsResponse,
  ProposalResponseDto,
  ProposalType,
  ProposalAction,
  ProposalStatus,
  TargetEntityType,
  WorkItemTypeRole,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";

export interface ProposalListFilters {
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

export const proposalKeys = {
  root: () => ["proposals"] as const,
  project: (organizationId: string, projectId: string) =>
    ["proposals", organizationId, projectId] as const,
  detail: (organizationId: string, projectId: string, proposalId: string) =>
    [
      ...proposalKeys.project(organizationId, projectId),
      "detail",
      proposalId,
    ] as const,
  lists: (organizationId: string, projectId: string) =>
    [...proposalKeys.project(organizationId, projectId), "list"] as const,
  list: (
    organizationId: string,
    projectId: string,
    filters: ProposalListFilters = {},
  ) =>
    [
      ...proposalKeys.lists(organizationId, projectId),
      {
        ...filters,
        limit: filters.limit ?? 20,
        offset: filters.offset ?? 0,
      },
    ] as const,
  group: (organizationId: string, projectId: string, groupId: string) =>
    [
      ...proposalKeys.project(organizationId, projectId),
      "group",
      groupId,
    ] as const,
};

export interface ProposalPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
  windowStart?: string;
  windowEnd?: string;
}
export interface ProposalListData {
  proposals: ProposalResponseDto[];
  pagination: ProposalPagination;
}

function proposalPagination(
  response: PaginatedProposalsResponse | undefined,
  filters: ProposalListFilters,
  length: number,
): ProposalPagination {
  const limit = response?.limit ?? filters.limit ?? 20;
  const offset = response?.offset ?? filters.offset ?? 0;
  const total = response?.total ?? offset + length;
  const safeLimit = limit > 0 ? limit : Math.max(filters.limit ?? 20, 1);
  return {
    page: Math.floor(offset / safeLimit) + 1,
    limit: safeLimit,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    hasNext: offset + length < total,
    hasPrevious: offset > 0,
    windowStart: response?.windowStart,
    windowEnd: response?.windowEnd,
  };
}

export function proposalQueryOptions(
  organizationId: string,
  projectId: string,
  proposalId: string,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: proposalKeys.detail(organizationId, projectId, proposalId),
    queryFn: async ({ signal }) => {
      const response = await proposalsClient.getProposal(
        { organizationId, projectId, proposalId },
        { ...captureRequestOptions(), signal },
      );
      return response.data.data ?? null;
    },
  });
}

export function proposalsQueryOptions(
  organizationId: string,
  projectId: string,
  filters: ProposalListFilters = {},
) {
  const parameters = {
    ...filters,
    limit: filters.limit ?? 20,
    offset: filters.offset ?? 0,
  };
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: proposalKeys.list(organizationId, projectId, parameters),
    queryFn: async ({ signal }): Promise<ProposalListData> => {
      const response = await proposalsClient.listProposals(
        { organizationId, projectId, ...parameters },
        { ...captureRequestOptions(), signal },
      );
      const proposals = response.data.data?.data ?? [];
      return {
        proposals,
        pagination: proposalPagination(
          response.data.data,
          parameters,
          proposals.length,
        ),
      };
    },
  });
}

export function invalidateProposalLists(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
) {
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: proposalKeys.lists(organizationId, projectId),
  });
}
