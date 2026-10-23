import { captureRequestOptions } from "../core/requestInitiator";
import {
  queryOptions,
  type InvalidateQueryFilters,
  type QueryKey,
} from "@tanstack/react-query";
import type { WorkStatus } from "../../api";
import {
  platformClient,
  conversationsClient,
} from "../../clients/serviceClients";
import type { WorkItemSectionKey } from "../../utils/workItemSections";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import type { CollectionInvalidator } from "../relationships";
export interface InitiativeListFilters {
  projectId?: string;
  conversationId?: string;
  includeSectionKeys?: WorkItemSectionKey[];
  status?: WorkStatus | WorkStatus[];
}
const normalizeFilters = (filters: InitiativeListFilters) => ({
  projectId: filters.projectId || undefined,
  conversationId: filters.conversationId || undefined,
  includeSectionKeys:
    !filters.conversationId && filters.includeSectionKeys?.length
      ? [...new Set(filters.includeSectionKeys)].sort()
      : undefined,
  status:
    !filters.conversationId && filters.status
      ? [
          ...new Set(
            Array.isArray(filters.status) ? filters.status : [filters.status],
          ),
        ].sort()
      : undefined,
});
export const initiativeKeys = {
  root: () => ["initiatives"] as const,
  all: (organizationId: string) =>
    [...initiativeKeys.root(), organizationId] as const,
  details: (organizationId: string) =>
    [...initiativeKeys.all(organizationId), "detail"] as const,
  detail: (organizationId: string, initiativeId: string) =>
    [...initiativeKeys.details(organizationId), initiativeId] as const,
  lists: (organizationId: string) =>
    [...initiativeKeys.all(organizationId), "list"] as const,
  list: (organizationId: string, filters: InitiativeListFilters = {}) =>
    [
      ...initiativeKeys.lists(organizationId),
      normalizeFilters(filters),
    ] as const,
};
export const initiativeQueryOptions = (
  organizationId: string,
  initiativeId: string,
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: initiativeKeys.detail(organizationId, initiativeId),
    queryFn: async ({ signal }) => {
      const response = await platformClient.getInitiative(
        { organizationId, initiativeId },
        { ...captureRequestOptions(), signal },
      );
      return response.data?.data ?? null;
    },
  });
export const initiativesQueryOptions = (
  organizationId: string,
  filters: InitiativeListFilters = {},
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: initiativeKeys.list(organizationId, filters),
    queryFn: async ({ signal }) => {
      const normalized = normalizeFilters(filters);
      if (normalized.conversationId) {
        if (!normalized.projectId)
          throw new Error("Conversation initiatives require projectId");
        const response = await conversationsClient.getConversationInitiatives(
          {
            organizationId,
            projectId: normalized.projectId,
            conversationId: normalized.conversationId,
          },
          { ...captureRequestOptions(), signal },
        );
        return response.data?.data ?? [];
      }
      const response = await platformClient.getOrganizationInitiatives(
        {
          organizationId,
          projectId: normalized.projectId,
          status: normalized.status,
          includeSectionKeys: normalized.includeSectionKeys,
        },
        { ...captureRequestOptions(), signal },
      );
      return response.data?.data ?? [];
    },
  });

export function initiativeListMatchesProject(
  queryKey: QueryKey,
  projectId: string | undefined,
): boolean {
  const filters = queryKey[3];
  return (
    !projectId ||
    (typeof filters === "object" &&
      filters !== null &&
      "projectId" in filters &&
      (!filters.projectId || filters.projectId === projectId))
  );
}

/** Project events affect organization lists and every projection in that project. */
function initiativeListFilter(
  organizationId: string,
  projectId?: string,
): InvalidateQueryFilters {
  return {
    queryKey: initiativeKeys.lists(organizationId),
    predicate: ({ queryKey }) =>
      initiativeListMatchesProject(queryKey, projectId),
  };
}
export function createInitiativeInvalidator(
  organizationId: string,
  projectId: string | undefined,
  invalidate: (filters: InvalidateQueryFilters) => void,
  coveredChange?: {
    projectId: string | undefined;
    initiativeId: string | undefined;
  },
): CollectionInvalidator<QueryKey> {
  return {
    dispatch: ({ queryKey }) => {
      if (queryKey[2] === "list") {
        const scope = queryKey[3];
        const project = typeof scope === "string" ? scope : undefined;
        if (
          coveredChange &&
          (!coveredChange.projectId || coveredChange.projectId === project)
        )
          return;
        invalidate(initiativeListFilter(organizationId, project));
      } else {
        if (
          coveredChange?.initiativeId &&
          queryKey[3] === coveredChange.initiativeId
        )
          return;
        invalidate({ queryKey });
      }
    },
    buildScopeKey: ({ lookupField, lookupValue }) => [
      ...initiativeKeys.lists(organizationId),
      lookupField === "projectId" && typeof lookupValue === "string"
        ? lookupValue
        : projectId,
    ],
    buildItemKey: ({ id }) => initiativeKeys.detail(organizationId, id),
  };
}
