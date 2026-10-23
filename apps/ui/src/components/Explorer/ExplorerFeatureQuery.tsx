import React, { useEffect, useMemo } from "react";
import { WorkStatus } from "@hey-hey/ui-common/api";
import {
  useFeatureHierarchy,
  useFeatureDocumentContent,
} from "@hey-hey/ui-common/data";
import type { ExplorerWorkItemQueryProps } from "./ExplorerWorkItemQuery";

export const ExplorerFeatureQuery: React.FC<ExplorerWorkItemQueryProps> = ({
  organizationId,
  projectId,
  definition,
  enabled,
  onStateChange,
}) => {
  const hierarchy = useFeatureHierarchy(
    organizationId,
    enabled ? projectId : ""
  );
  const ids = enabled ? hierarchy.roots.map((node) => node.feature.id) : [];
  const { entries } = useFeatureDocumentContent(
    organizationId,
    projectId,
    ids,
    undefined,
    "metadata"
  );
  const workItems = useMemo(
    () =>
      enabled
        ? hierarchy.roots.flatMap((node) => {
            const metadata = entries.get(node.feature.id)?.data;
            return metadata?.status === WorkStatus.Active
              ? [
                  {
                    ...metadata,
                    ...node.feature,
                    parentTaskId: node.feature.parentTaskId ?? undefined,
                    hasFeatureChildren: node.children.length > 0,
                  },
                ]
              : [];
          })
        : [],
    [enabled, hierarchy.roots, entries]
  );
  const failure = ids
    .map((id) => entries.get(id))
    .find((entry) => entry?.status === "error");
  const error =
    hierarchy.error ?? (failure?.status === "error" ? failure.error : null);
  const isLoading =
    enabled &&
    !error &&
    (hierarchy.isLoading || ids.some((id) => !entries.get(id)?.data));
  useEffect(() => {
    onStateChange(definition.key, { workItems, isLoading, error });
  }, [definition.key, workItems, isLoading, error, onStateChange]);
  return null;
};
