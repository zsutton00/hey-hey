import { useState, useMemo, useCallback } from "react";
import { FEATURE_TASK_TYPE } from "../../constants/taskTypes";
import { selectLocalFeatureNeighborhood } from "../../components/Features/localFeatureNeighborhood";
import type { WorkItemResponseDto } from "../collections/workItems";
import { useFeatureHierarchy } from "./useFeatureHierarchy";
import { useFeatureDocumentContent } from "./useFeatureDocumentContent";
import { useWorkItems } from "./useWorkItems";

export interface FeatureTreeNode {
  feature: WorkItemResponseDto;
  children: FeatureTreeNode[];
}

export interface UseFeatureTreeReturn {
  roots: FeatureTreeNode[];
  allFeatures: WorkItemResponseDto[];
  descendantsMap: Map<string, Set<string>>;
  isLoading: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: Error | null;
  reparent: (featureId: string, newParentId: string | null) => Promise<void>;
  errorMap: Map<string, string>;
  clearError: (featureId: string) => void;
}

export interface LocalFeatureNeighborhoodContext {
  focusedFeatureId: string;
}

/** Upper bound on features fetched for the tree in a single page. */
const FEATURE_TREE_LIMIT = 500;

function buildTree(features: WorkItemResponseDto[]): FeatureTreeNode[] {
  const featureMap = new Map<string, WorkItemResponseDto>();
  const childrenMap = new Map<string, WorkItemResponseDto[]>();

  for (const f of features) {
    featureMap.set(f.id, f);
  }

  for (const f of features) {
    const parentId = f.parentTaskId;
    if (parentId && featureMap.has(parentId)) {
      const siblings = childrenMap.get(parentId) ?? [];
      siblings.push(f);
      childrenMap.set(parentId, siblings);
    }
  }

  function toTreeNode(feature: WorkItemResponseDto): FeatureTreeNode {
    const children = (childrenMap.get(feature.id) ?? []).map(toTreeNode);
    return { feature, children };
  }

  const roots = features.filter(
    (f) => !f.parentTaskId || !featureMap.has(f.parentTaskId)
  );

  return roots.map(toTreeNode);
}

/**
 * Builds the feature hierarchy for a project.
 *
 * Features are sourced from the shared work-item collection (`useWorkItems`
 * filtered to `"FEATURE"`) rather than a one-shot fetch. This keeps the
 * tree in sync automatically: creating a feature anywhere — via the New Feature
 * modal, the create-subfeature action, etc. — goes through `useWorkItems`'s
 * `createTask`, which invalidates every work-item list query, so the tree
 * refetches and renders the new feature without a remount (preserving the
 * caller's expand/collapse state).
 */
export function useFeatureTree(
  organizationId: string,
  projectId: string,
  suppliedTree?: UseFeatureTreeReturn,
  localNeighborhood?: LocalFeatureNeighborhoodContext
): UseFeatureTreeReturn {
  const hierarchy = useFeatureHierarchy(
    organizationId,
    localNeighborhood ? projectId : ""
  );
  const localSelection = useMemo(
    () =>
      localNeighborhood
        ? selectLocalFeatureNeighborhood(
            localNeighborhood.focusedFeatureId,
            hierarchy.nodes
          )
        : null,
    [localNeighborhood?.focusedFeatureId, hierarchy.nodes]
  );
  const localFeatureIds = localSelection?.featureIds;
  const { workItems, isLoading, isFetched, isReady, error, updateTask } =
    useWorkItems(organizationId, "task", projectId, undefined, {
      taskType: FEATURE_TASK_TYPE,
      taskIds: localFeatureIds,
      limit: localFeatureIds ? localFeatureIds.length : FEATURE_TREE_LIMIT,
      includeSectionKeys: localNeighborhood
        ? undefined
        : ["description", "requirements"],
      enabled:
        !localNeighborhood && !suppliedTree && !!organizationId && !!projectId,
    });

  const { entries } = useFeatureDocumentContent(
    organizationId,
    projectId,
    localFeatureIds ?? [],
    undefined,
    "metadata"
  );
  const allFeatures = useMemo(
    () =>
      localFeatureIds
        ? localFeatureIds.flatMap((id) => {
            const data = entries.get(id)?.data;
            const feature = hierarchy.nodes.get(id)?.feature;
            return data && feature
              ? [
                  {
                    ...data,
                    ...feature,
                    parentTaskId: feature.parentTaskId ?? undefined,
                  },
                ]
              : [];
          })
        : workItems,
    [localFeatureIds, entries, hierarchy.nodes, workItems]
  );
  const [errorMap, setErrorMap] = useState<Map<string, string>>(new Map());

  const roots = useMemo(() => buildTree(allFeatures), [allFeatures]);

  const descendantsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    function walk(node: FeatureTreeNode): Set<string> {
      const desc = new Set<string>();
      for (const child of node.children) {
        desc.add(child.feature.id);
        for (const d of walk(child)) {
          desc.add(d);
        }
      }
      map.set(node.feature.id, desc);
      return desc;
    }
    for (const root of roots) {
      walk(root);
    }
    return map;
  }, [roots]);

  const clearError = useCallback((featureId: string) => {
    setErrorMap((prev) => {
      if (!prev.has(featureId)) return prev;
      const next = new Map(prev);
      next.delete(featureId);
      return next;
    });
  }, []);

  const reparent = useCallback(
    async (featureId: string, newParentId: string | null) => {
      const dragged = allFeatures.find((f) => f.id === featureId);
      if (!dragged) {
        throw new Error(`Feature ${featureId} not found`);
      }

      if (newParentId === featureId) {
        throw new Error("Cannot drop a feature onto itself");
      }

      if (newParentId && descendantsMap.get(featureId)?.has(newParentId)) {
        throw new Error("Cannot drop a feature into one of its descendants");
      }

      const currentParentId = dragged.parentTaskId ?? null;
      if (currentParentId === newParentId) {
        return;
      }

      setErrorMap((prev) => {
        if (!prev.has(featureId)) return prev;
        const next = new Map(prev);
        next.delete(featureId);
        return next;
      });

      try {
        // updateTask owns the optimistic move + rollback on the shared store.
        await updateTask(featureId, { parentTaskId: newParentId });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to move feature";
        setErrorMap((prev) => {
          const next = new Map(prev);
          next.set(featureId, message);
          return next;
        });
        throw err;
      }
    },
    [allFeatures, descendantsMap, updateTask]
  );

  const localFailure = localFeatureIds
    ?.map((id) => entries.get(id))
    .find((entry) => entry?.status === "error");
  const localError =
    hierarchy.error ??
    (localFailure?.status === "error" ? localFailure.error : null);
  const localReady =
    hierarchy.isReady && allFeatures.length === localFeatureIds?.length;
  return (
    suppliedTree ?? {
      roots,
      allFeatures,
      descendantsMap,
      isLoading: localNeighborhood ? !localReady && !localError : isLoading,
      isFetched: localNeighborhood ? localReady || !!localError : isFetched,
      isReady: localNeighborhood ? localReady && !localError : isReady,
      error: localNeighborhood ? localError : error,
      reparent,
      errorMap,
      clearError,
    }
  );
}
