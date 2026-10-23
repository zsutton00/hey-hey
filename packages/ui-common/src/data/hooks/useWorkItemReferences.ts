import { keepPreviousData, useQuery as useReactQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum,
  PaginatedWorkItemReferenceResponseDto,
  WorkStatus,
  WorkItemReferenceDto,
} from "../../api";
import {
  type WorkItemReferencePageQuery,
  workItemReferencePageQueryOptions,
  workItemReferencesQueryOptions,
  WORK_ITEM_REFERENCE_PICKER_PAGE_LIMIT,
} from "../collections/workItemReferences";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export interface UseWorkItemReferencesInput {
  organizationId?: string;
  projectId?: string;
  workItemType?: string;
}

export type WorkItemReferencesState =
  | { status: "disabled"; references: readonly []; isFetching: false }
  | { status: "loading"; references: readonly []; isFetching: true }
  | {
      status: "updating";
      references: readonly WorkItemReferenceDto[];
      isFetching: true;
    }
  | {
      status: "ready";
      references: readonly WorkItemReferenceDto[];
      isFetching: false;
    }
  | { status: "empty"; references: readonly []; isFetching: false }
  | {
      status: "error";
      references: readonly [];
      isFetching: false;
      error: Error;
    };

const DISABLED_SCOPE = "__disabled__";

const hasValue = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0;

export function useWorkItemReferences({
  organizationId,
  projectId,
  workItemType,
}: UseWorkItemReferencesInput): WorkItemReferencesState {
  const hasCompleteScope =
    hasValue(organizationId) && hasValue(projectId) && hasValue(workItemType);
  const isEnabled = hasCompleteScope;
  const queryOptions = useMemo(
    () =>
      workItemReferencesQueryOptions({
        organizationId: hasCompleteScope ? organizationId : DISABLED_SCOPE,
        projectId: hasCompleteScope ? projectId : DISABLED_SCOPE,
        workItemType: hasCompleteScope ? workItemType : DISABLED_SCOPE,
      }),
    [hasCompleteScope, organizationId, projectId, workItemType],
  );
  const { result, state: query } = useDataLayerQuery(queryOptions, {
    enabled: isEnabled,
  });

  useWebsocketSubscriptions(
    {
      projectIds: hasCompleteScope ? [projectId] : [],
    },
    { enabled: isEnabled },
  );

  if (!isEnabled) {
    return { status: "disabled", references: [], isFetching: false };
  }

  const references = result.data ?? [];

  if (query.error) {
    return {
      status: "error",
      references: [],
      isFetching: false,
      error: query.error,
    };
  }
  if (query.isFetching && query.isFetched) {
    return { status: "updating", references, isFetching: true };
  }
  if (query.isLoading || !query.isFetched) {
    return { status: "loading", references: [], isFetching: true };
  }
  if (references.length === 0) {
    return { status: "empty", references: [], isFetching: false };
  }
  return { status: "ready", references, isFetching: false };
}

export interface UseWorkItemReferencePageInput {
  organizationId?: string;
  projectId?: string;
  workItemType?: string;
  page: number;
  limit?: number;
  filter?: string;
  statuses?: readonly WorkStatus[];
  sortBy?: OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum;
  sortOrder?: OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum;
}

type ReferencePage = PaginatedWorkItemReferenceResponseDto;

export type WorkItemReferencePageState =
  | { status: "disabled"; page: null; isFetching: false }
  | { status: "loading"; page: null; isFetching: true }
  | { status: "updating"; page: ReferencePage; isFetching: true }
  | { status: "ready"; page: ReferencePage; isFetching: false }
  | { status: "empty"; page: ReferencePage; isFetching: false }
  | { status: "error"; page: null; isFetching: false; error: Error };

export function useWorkItemReferencePage({
  organizationId,
  projectId,
  workItemType,
  page,
  limit = WORK_ITEM_REFERENCE_PICKER_PAGE_LIMIT,
  filter,
  statuses,
  sortBy,
  sortOrder,
}: UseWorkItemReferencePageInput): WorkItemReferencePageState {
  const enabled =
    hasValue(organizationId) &&
    hasValue(projectId) &&
    hasValue(workItemType) &&
    Number.isInteger(page) &&
    page >= 1 &&
    Number.isInteger(limit) &&
    limit >= 1;
  const queryInput: WorkItemReferencePageQuery = {
    organizationId: organizationId ?? "__disabled__",
    projectId: projectId ?? "__disabled__",
    workItemType: workItemType ?? "__disabled__",
    page,
    limit,
    filter,
    statuses,
    sortBy,
    sortOrder,
  };
  const query = useReactQuery({
    ...workItemReferencePageQueryOptions(queryInput),
    enabled,
    placeholderData: keepPreviousData,
  });

  if (!enabled) return { status: "disabled", page: null, isFetching: false };
  if (query.error) {
    return {
      status: "error",
      page: null,
      isFetching: false,
      error:
        query.error instanceof Error
          ? query.error
          : new Error("Unable to load work-item references."),
    };
  }
  if (!query.data) return { status: "loading", page: null, isFetching: true };
  if (query.isFetching) {
    return { status: "updating", page: query.data, isFetching: true };
  }
  if (query.data.items.length === 0) {
    return { status: "empty", page: query.data, isFetching: false };
  }
  return { status: "ready", page: query.data, isFetching: false };
}

export type { WorkItemReferenceDto } from "../../api";
