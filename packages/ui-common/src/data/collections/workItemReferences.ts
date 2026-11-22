import {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum,
  type OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum as WorkItemReferenceSortBy,
  type OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum as WorkItemReferenceSortOrder,
  type PaginatedWorkItemReferenceResponseDto,
  type TaskResponseDto,
  type WorkItemReferenceDto,
} from "../../api";
import {
  GetAllWorkItemReferencesDocument,
  GetWorkItemReferencePageDocument,
  type GetAllWorkItemReferencesQuery,
  type GetAllWorkItemReferencesQueryVariables,
  type GetWorkItemReferencePageQuery,
  type GetWorkItemReferencePageQueryVariables,
} from "../../graphql/generated/graphql";
import {
  toReferencePageResponse,
  toReferenceResponse,
} from "../graphql/records";
import type { GraphQLReadSpec } from "../graphql/useGraphQLRead";

export type { WorkItemReferenceDto } from "../../api";

export const WORK_ITEM_REFERENCE_PICKER_PAGE_LIMIT = 20 as const;
export const WORK_ITEM_REFERENCE_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

export interface WorkItemReferenceScope {
  organizationId: string;
  projectId: string;
  workItemType: string;
}

export interface WorkItemReferencePageQuery extends WorkItemReferenceScope {
  page: number;
  limit: number;
  filter?: string;
  statuses?: readonly TaskResponseDto["status"][];
  sortBy?: WorkItemReferenceSortBy;
  sortOrder?: WorkItemReferenceSortOrder;
}

const DEFAULT_WORK_ITEM_REFERENCE_SORT = {
  sortBy:
    OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.Name,
  sortOrder:
    OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Asc,
} as const;

/** Every reference of one type, in name order. */
export const workItemReferencesRead = ({
  organizationId,
  projectId,
  workItemType,
}: WorkItemReferenceScope): GraphQLReadSpec<
  GetAllWorkItemReferencesQuery,
  GetAllWorkItemReferencesQueryVariables,
  WorkItemReferenceDto[]
> => ({
  document: GetAllWorkItemReferencesDocument,
  variables: { type: workItemType },
  scope: { organizationId, projectId },
  select: (data) => data.references.map(toReferenceResponse),
});

/** One page of references, as the picker shows it. */
export const workItemReferencePageRead = (
  query: WorkItemReferencePageQuery,
): GraphQLReadSpec<
  GetWorkItemReferencePageQuery,
  GetWorkItemReferencePageQueryVariables,
  PaginatedWorkItemReferenceResponseDto
> => ({
  document: GetWorkItemReferencePageDocument,
  variables: {
    type: query.workItemType,
    page: query.page,
    limit: query.limit,
    filter: query.filter?.trim() || undefined,
    statuses: query.statuses?.length ? [...query.statuses] : undefined,
    sortBy: query.sortBy ?? DEFAULT_WORK_ITEM_REFERENCE_SORT.sortBy,
    sortOrder: query.sortOrder ?? DEFAULT_WORK_ITEM_REFERENCE_SORT.sortOrder,
  },
  scope: {
    organizationId: query.organizationId,
    projectId: query.projectId,
  },
  select: (data) => toReferencePageResponse(data.workItemReferences),
});
