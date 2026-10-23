import type {
  WorkItemGraphAggregateResponseDto,
  WorkItemGraphParticipationType,
} from "../../api";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { workItemGraphQueryOptions } from "../collections/workItemGraphs";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseWorkItemGraphReturn =
  DataHookReturn<WorkItemGraphAggregateResponseDto>;

export function useWorkItemGraph(
  organizationId: string | undefined,
  projectId: string | undefined,
  workItemId: string | undefined,
  options: CollectionHookOptions<WorkItemGraphAggregateResponseDto> & {
    incidentRelationshipTypes?: readonly WorkItemGraphParticipationType[];
  } = {}
): UseWorkItemGraphReturn {
  const { result, state } = useDataLayerQuery(
    workItemGraphQueryOptions(
      organizationId ?? "",
      projectId ?? "",
      workItemId ?? "",
      options.incidentRelationshipTypes
    ),
    {
      ...options,
      enabled:
        (options.enabled ?? true) &&
        Boolean(organizationId && projectId && workItemId),
    }
  );
  return { ...state, data: result.data ?? null };
}
