import { useMemo } from "react";
import type {
  WorkItemGraphAggregateResponseDto,
  WorkItemGraphParticipationType,
} from "../../api";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { workItemGraphRead } from "../collections/workItemGraphs";
import { useGraphQLRead } from "../graphql/useGraphQLRead";

export type UseWorkItemGraphReturn =
  DataHookReturn<WorkItemGraphAggregateResponseDto>;

export function useWorkItemGraph(
  organizationId: string | undefined,
  projectId: string | undefined,
  workItemId: string | undefined,
  options: CollectionHookOptions<WorkItemGraphAggregateResponseDto> & {
    incidentRelationshipTypes?: readonly WorkItemGraphParticipationType[];
  } = {},
): UseWorkItemGraphReturn {
  const typesKey = [...new Set(options.incidentRelationshipTypes)]
    .sort()
    .join(",");
  const spec = useMemo(
    () =>
      workItemGraphRead(
        { organizationId: organizationId ?? "", projectId: projectId ?? "" },
        workItemId ?? "",
        typesKey
          ? (typesKey.split(",") as WorkItemGraphParticipationType[])
          : [],
      ),
    [organizationId, projectId, workItemId, typesKey],
  );

  return useGraphQLRead(spec, {
    enabled:
      (options.enabled ?? true) &&
      Boolean(organizationId && projectId && workItemId),
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
  });
}
