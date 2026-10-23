import {
  queryOptions,
  type QueryClient,
  type QueryKey,
  type InvalidateQueryFilters,
} from "@tanstack/react-query";
import type { DesignDocResponseDto, DesignDocLibraryNodeDto } from "../../api";
import { dataClient } from "../../clients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import type { CollectionInvalidator } from "../relationships/invalidator";

export interface DesignDocsFilters {
  status?: string;
  projectId?: string;
  taskId?: string;
  initiativeId?: string;
  planId?: string;
  designDocId?: string;
  tags?: string;
  includeSectionKeys?: string;
  page?: number;
  limit?: number;
}

function normalizeFilters(filters: DesignDocsFilters): DesignDocsFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([, value]) => value !== undefined && value !== ""
    )
  );
}

export const designDocKeys = {
  root: () => ["designDocs"] as const,
  all: (organizationId: string) => ["designDocs", organizationId] as const,
  detail: (organizationId: string, id: string) =>
    [...designDocKeys.all(organizationId), "detail", id] as const,
  lists: (organizationId: string) =>
    [...designDocKeys.all(organizationId), "list"] as const,
  list: (organizationId: string, filters: DesignDocsFilters = {}) =>
    [
      ...designDocKeys.lists(organizationId),
      normalizeFilters(filters),
    ] as const,
  libraries: (organizationId: string) =>
    [...designDocKeys.all(organizationId), "library"] as const,
  library: (organizationId: string, projectId: string) =>
    [...designDocKeys.libraries(organizationId), projectId] as const,
};

export function designDocQueryOptions(organizationId: string, id: string) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: designDocKeys.detail(organizationId, id),
    queryFn: async ({ signal }) => {
      const response = await dataClient.request<{
        data?: DesignDocResponseDto | null;
      }>({
        ...captureRequestOptions(),
        signal,
        method: "GET",
        url: `/organizations/${organizationId}/design-docs/${id}`,
      });
      if (!response.data.data) throw new Error(`Design doc not found: ${id}`);
      return response.data.data;
    },
  });
}

export function designDocsQueryOptions(
  organizationId: string,
  filters: DesignDocsFilters = {}
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: designDocKeys.list(organizationId, filters),
    queryFn: async ({ signal }) => {
      const response = await dataClient.request<{
        data?: DesignDocResponseDto[];
      }>({
        ...captureRequestOptions(),
        signal,
        method: "GET",
        url: `/organizations/${organizationId}/design-docs`,
        params: normalizeFilters(filters),
      });
      return response.data.data ?? [];
    },
  });
}

/** The factory establishes the runtime shape; unrelated keys are never parsed. */
function listFilters(key: QueryKey): DesignDocsFilters {
  return key[3] as DesignDocsFilters;
}

function matchesDoc(
  doc: DesignDocResponseDto,
  filters: DesignDocsFilters
): boolean {
  if (filters.projectId && filters.projectId !== doc.projectId) return false;
  if (filters.status && filters.status !== doc.status) return false;
  if (
    filters.tags &&
    !filters.tags.split(",").every((tag) => doc.tags.includes(tag))
  )
    return false;
  const parents = [
    [filters.taskId, "TASK"],
    [filters.designDocId, "DESIGN_DOC"],
  ] as const;
  return parents.every(
    ([id, type]) =>
      !id || (doc.parentEntityId === id && doc.parentEntityType === type)
  );
}

/** Preserve fields omitted by a section-projected response. */
export function writeDesignDoc(
  queryClient: QueryClient,
  organizationId: string,
  doc: DesignDocResponseDto | null,
  id = doc?.id
) {
  if (!id) return;
  queryClient.setQueryData<DesignDocResponseDto | null>(
    designDocKeys.detail(organizationId, id),
    (old) => (doc ? mergeDoc(old, doc) : null)
  );
  for (const [key, rows] of queryClient.getQueriesData<DesignDocResponseDto[]>({
    queryKey: designDocKeys.lists(organizationId),
  })) {
    if (!rows) continue;
    const filters = listFilters(key);
    const existing = rows.find((row) => row.id === id);
    const next =
      doc && matchesDoc(doc, filters) ? mergeDoc(existing, doc) : null;
    // New rows' server ordering/page is unknown; refetch those after success.
    const canInsert =
      filters.page === undefined &&
      filters.limit === undefined &&
      !filters.initiativeId &&
      !filters.planId;
    if (!existing && (!next || !canInsert)) continue;
    queryClient.setQueryData(
      key,
      next
        ? existing
          ? rows.map((row) => (row.id === id ? next : row))
          : canInsert
          ? [...rows, next]
          : rows
        : rows.filter((row) => row.id !== id)
    );
  }
}

function mergeDoc(
  old: DesignDocResponseDto | null | undefined,
  doc: DesignDocResponseDto
): DesignDocResponseDto {
  return doc.sections === undefined && old?.sections !== undefined
    ? { ...doc, sections: old.sections }
    : doc;
}

export function findDesignDoc(
  queryClient: QueryClient,
  organizationId: string,
  id: string
): DesignDocResponseDto | undefined {
  const detail = queryClient.getQueryData<DesignDocResponseDto | null>(
    designDocKeys.detail(organizationId, id)
  );
  if (detail) return detail;
  const row = queryClient
    .getQueriesData<DesignDocResponseDto[]>({
      queryKey: designDocKeys.lists(organizationId),
    })
    .flatMap(([, rows]) => rows ?? [])
    .find((doc) => doc.id === id);
  if (row) return row;
  return findLibraryDoc(
    queryClient
      .getQueriesData<DesignDocLibraryNodeDto[]>({
        queryKey: designDocKeys.libraries(organizationId),
      })
      .flatMap(([, nodes]) => nodes ?? []),
    id
  );
}

function findLibraryDoc(
  nodes: DesignDocLibraryNodeDto[],
  id: string
): DesignDocResponseDto | undefined {
  for (const node of nodes) {
    if (node.designDoc?.id === id) return node.designDoc;
    const child = findLibraryDoc(node.children, id);
    if (child) return child;
  }
  return undefined;
}

function restoreListDoc(
  saved: DesignDocResponseDto[],
  current: DesignDocResponseDto[],
  id: string
) {
  const savedOthers = saved.filter((doc) => doc.id !== id);
  const currentOthers = current.filter((doc) => doc.id !== id);
  const hasOtherChanges =
    savedOthers.length !== currentOthers.length ||
    savedOthers.some((doc, index) => doc !== currentOthers[index]);
  if (!hasOtherChanges) return { data: saved, hasOtherChanges };
  const savedIndex = saved.findIndex((doc) => doc.id === id);
  if (savedIndex !== -1) {
    currentOthers.splice(
      Math.min(savedIndex, currentOthers.length),
      0,
      saved[savedIndex]
    );
  }
  return { data: currentOthers, hasOtherChanges };
}

export async function snapshotDesignDocs(
  queryClient: QueryClient,
  organizationId: string,
  id: string,
  candidate = findDesignDoc(queryClient, organizationId, id)
) {
  const filters: InvalidateQueryFilters = {
    queryKey: designDocKeys.all(organizationId),
    predicate: ({ queryKey, state }) => {
      if (queryKey[2] === "detail") return queryKey[3] === id;
      if (queryKey[2] !== "list" || state.data === undefined) return false;
      const rows = state.data as DesignDocResponseDto[];
      return (
        rows.some((doc) => doc.id === id) ||
        (!!candidate && matchesDoc(candidate, listFilters(queryKey)))
      );
    },
  };
  const interruptedFirstReads = queryClient
    .getQueryCache()
    .findAll(filters)
    .filter(
      (query) =>
        query.state.data === undefined && query.state.fetchStatus === "fetching"
    );
  await queryClient.cancelQueries(filters);
  const snapshots = queryClient
    .getQueryCache()
    .findAll(filters)
    .map((query) => ({ query, state: query.state }));
  return () => {
    for (const { query, state } of snapshots) {
      if (query.queryKey[2] !== "list") {
        query.setState(state);
        continue;
      }
      // Roll back this entity only; another mutation or realtime read may
      // have changed other documents since the snapshot was taken.
      const restored = restoreListDoc(
        state.data as DesignDocResponseDto[],
        (query.state.data ?? []) as DesignDocResponseDto[],
        id
      );
      query.setState({
        ...(restored.hasOtherChanges ? query.state : state),
        data: restored.data,
      });
    }
    if (id && !snapshots.some(({ query }) => query.queryKey[2] === "detail"))
      queryClient.removeQueries({
        queryKey: designDocKeys.detail(organizationId, id),
        exact: true,
      });
    for (const query of interruptedFirstReads) {
      void invalidateWithFollowUpRead(queryClient, {
        queryKey: query.queryKey,
        exact: true,
      });
    }
  };
}

/** Central mapping for design-doc events and relationship changes. */
export function invalidateDesignDocQueries(
  queryClient: QueryClient,
  organizationId: string,
  projectId?: string,
  id?: string,
  previousProjectId?: string
) {
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: designDocKeys.all(organizationId),
    predicate: ({ queryKey, state }) => {
      if (queryKey[2] === "detail") return queryKey[3] === id;
      if (queryKey[2] === "library")
        return (
          !projectId ||
          queryKey[3] === projectId ||
          queryKey[3] === previousProjectId
        );
      if (queryKey[2] !== "list") return false;
      const filters = listFilters(queryKey);
      const rows = state.data as DesignDocResponseDto[] | undefined;
      return (
        !projectId ||
        !filters.projectId ||
        filters.projectId === projectId ||
        filters.projectId === previousProjectId ||
        !!rows?.some((doc) => doc.id === id)
      );
    },
  });
}

export function createDesignDocInvalidator(
  organizationId: string,
  projectId: string | undefined,
  invalidate: (filters: InvalidateQueryFilters) => void
): CollectionInvalidator<QueryKey> {
  return {
    dispatch: ({ queryKey }) => {
      invalidate({ queryKey });
      if (queryKey[2] === "list") {
        const affectedProject = listFilters(queryKey).projectId ?? projectId;
        invalidate({
          queryKey: affectedProject
            ? designDocKeys.library(organizationId, affectedProject)
            : designDocKeys.libraries(organizationId),
        });
      }
    },
    buildScopeKey: ({ lookupField, lookupValue }) => {
      const value = typeof lookupValue === "string" ? lookupValue : undefined;
      return designDocKeys.list(
        organizationId,
        lookupField === "projectId"
          ? { projectId: value ?? projectId }
          : { [lookupField]: value }
      );
    },
    buildItemKey: ({ id }) => designDocKeys.detail(organizationId, id),
  };
}
