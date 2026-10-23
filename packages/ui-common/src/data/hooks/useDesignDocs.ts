import { useMemo } from "react";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import type { DesignDocResponseDto } from "../../api";
import { designDocsQueryOptions } from "../collections/designDocs";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseDesignDocsOptions
  extends CollectionHookOptions<DesignDocResponseDto> {
  status?: string;
  projectId?: string;
  taskId?: string;
  initiativeId?: string;
  planId?: string;
  designDocId?: string;
  tags?: string | string[];
  includeSectionKeys?: string[];
  page?: number;
  limit?: number;
}

export interface UseDesignDocsReturn
  extends DataCollectionHookReturn<DesignDocResponseDto> {
  designDocs: DesignDocResponseDto[];
}

const EMPTY_DOCS: DesignDocResponseDto[] = [];
export function useDesignDocs(
  organizationId: string | undefined,
  options: UseDesignDocsOptions = {}
): UseDesignDocsReturn {
  const {
    status,
    projectId,
    taskId,
    initiativeId,
    planId,
    designDocId,
    tags,
    includeSectionKeys,
    page,
    limit,
  } = options;
  const queryOptions = useMemo(
    () =>
      designDocsQueryOptions(organizationId ?? "__noop__", {
        status,
        projectId,
        taskId,
        initiativeId,
        planId,
        designDocId,
        tags: Array.isArray(tags) ? tags.join(",") : tags,
        includeSectionKeys: includeSectionKeys?.join(","),
        page,
        limit,
      }),
    [
      organizationId,
      status,
      projectId,
      taskId,
      initiativeId,
      planId,
      designDocId,
      tags,
      includeSectionKeys,
      page,
      limit,
    ]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    ...options,
    enabled: (options.enabled ?? true) && !!organizationId,
  });
  const designDocs = result.data ?? EMPTY_DOCS;
  return { ...state, data: designDocs, designDocs };
}
