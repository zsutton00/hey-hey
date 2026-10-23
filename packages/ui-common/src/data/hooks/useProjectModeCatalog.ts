import { useMemo } from "react";
import { AgentEdgeType, WorkStatus } from "../../api";
import type { ProjectModeCatalogEntry } from "../../agents/coordination/projectModeCatalog";
import {
  isProjectModeSelectionEligible,
  mapProjectModeCatalog,
} from "../../agents/coordination/projectModeCatalog";
import { useWorkItems } from "./useWorkItems";
import { useWorkItemTypeByKey } from "./useWorkItemTypes";

export interface UseProjectModeCatalogInput {
  organizationId: string;
  projectId: string;
  effectiveWorkItemTypeKey: string | null;
  focalFeatureIds?: ReadonlySet<string> | null;
}

export interface UseProjectModeCatalogReturn {
  catalog: readonly ProjectModeCatalogEntry[];
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: Error | null;
  isSelectionEligible: (
    selection: Parameters<typeof isProjectModeSelectionEligible>[0],
  ) => boolean;
}

export const useProjectModeCatalog = ({
  organizationId,
  projectId,
  effectiveWorkItemTypeKey,
  focalFeatureIds,
}: UseProjectModeCatalogInput): UseProjectModeCatalogReturn => {
  const enabled = Boolean(
    organizationId && projectId && effectiveWorkItemTypeKey,
  );
  const modeTypeQuery = useWorkItemTypeByKey(
    organizationId,
    enabled ? projectId : undefined,
    enabled ? "MODE" : undefined,
  );
  const modeItemsQuery = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      enabled,
      status: WorkStatus.Active,
      taskType: "MODE",
      includeSectionKeys: ["description", "settings"],
      includeServiceRelations: false,
      includeEdges: true,
      edgeTypes: [AgentEdgeType.DependsOn],
      includeDescendants: false,
      includeTrackedEntities: false,
      websocketsEnabled: false,
      sortBy: "title",
      sortDir: "asc",
    },
  );

  const catalog = useMemo(
    () =>
      mapProjectModeCatalog({
        projectId,
        effectiveWorkItemTypeKey,
        modeTypeSummary: modeTypeQuery.workItemTypeSummary,
        modeItems: modeItemsQuery.workItems,
        focalFeatureIds,
      }),
    [
      effectiveWorkItemTypeKey,
      modeItemsQuery.workItems,
      modeTypeQuery.workItemTypeSummary,
      focalFeatureIds,
      projectId,
    ],
  );
  const error = modeTypeQuery.error ?? modeItemsQuery.error;
  const isFetched =
    !enabled || (modeTypeQuery.isFetched && modeItemsQuery.isFetched);

  return {
    catalog,
    isLoading: enabled && (modeTypeQuery.isLoading || modeItemsQuery.isLoading),
    isFetching:
      enabled && (modeTypeQuery.isFetching || modeItemsQuery.isFetching),
    isFetched,
    isReady: isFetched && !error,
    error,
    isSelectionEligible: (selection) =>
      isProjectModeSelectionEligible(selection, catalog),
  };
};
