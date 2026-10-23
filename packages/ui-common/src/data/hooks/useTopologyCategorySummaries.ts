import type {
  TopologyCategorySummaryDto,
  TopologySummaryCategory,
} from "../../api";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { topologyCategorySummariesQueryOptions } from "../collections/topologyCategorySummaries";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseTopologyCategorySummariesOptions
  extends CollectionHookOptions<TopologyCategorySummaryDto> {
  category?: TopologySummaryCategory;
}

export interface UseTopologyCategorySummariesReturn
  extends DataCollectionHookReturn<TopologyCategorySummaryDto> {
  summaries: TopologyCategorySummaryDto[];
}

export function useTopologyCategorySummaries(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseTopologyCategorySummariesOptions = {}
): UseTopologyCategorySummariesReturn {
  const { category } = options;
  const { result, state } = useDataLayerQuery(
    topologyCategorySummariesQueryOptions(
      organizationId ?? "",
      projectId ?? "",
      { category }
    ),
    {
      ...options,
      enabled:
        (options.enabled ?? true) && Boolean(organizationId && projectId),
    }
  );
  const data = result.data ?? [];
  return { ...state, data, summaries: data };
}
