import type { FeatureHierarchyEntryDto } from "@hey-hey/ui-common/api";
import { useFeatureLookup } from "@hey-hey/ui-common/data";
import { useMemo } from "react";

import {
  getStructuralFeatureAncestors,
  type BreadcrumbFeatureAncestor,
} from "./TaskBreadcrumbs";

interface AncestryWorkItem {
  id: string;
  parentTaskId?: string | null;
}

export interface UseFeatureAncestorsParams {
  organizationId: string;
  projectId: string;
  /** The item whose feature ancestors are resolved. */
  task: AncestryWorkItem | null | undefined;
  /** The item's already-loaded parent, used to step over one non-feature parent. */
  parent?: AncestryWorkItem | null;
  /** Server-derived hierarchy, used only when the cached hierarchy cannot resolve the chain. */
  fallbackHierarchy?: readonly FeatureHierarchyEntryDto[];
}

export interface FeatureAncestorsResult {
  /** Root-first structural feature ancestors. */
  ancestors: BreadcrumbFeatureAncestor[];
  /** True while the cached hierarchy is still loading. */
  isLoading: boolean;
  /** True when the ancestors came from the cached hierarchy. */
  isFromCache: boolean;
  /** True once the cached hierarchy has settled without resolving the chain. */
  needsFallback: boolean;
}

/**
 * Resolves an item's structural feature ancestors from the cached project
 * feature hierarchy. Chains through more than one non-feature parent, or
 * through features newer than the cache, use `fallbackHierarchy` instead.
 */
export function useFeatureAncestors({
  organizationId,
  projectId,
  task,
  parent,
  fallbackHierarchy,
}: UseFeatureAncestorsParams): FeatureAncestorsResult {
  const lookup = useFeatureLookup(organizationId, projectId);
  const startId = task?.parentTaskId ?? null;
  const parentId = parent?.id ?? null;
  const parentParentId = parent?.parentTaskId ?? null;
  const hasTask = Boolean(task);
  const { resolveAncestry, isReady, isLoading } = lookup;

  const cached = useMemo(() => {
    if (!hasTask || !isReady) return null;
    let resolved = resolveAncestry(startId);
    if (!resolved.complete && parentId && parentId === startId) {
      resolved = resolveAncestry(parentParentId);
    }
    return resolved.complete ? resolved.ancestors : null;
  }, [hasTask, isReady, resolveAncestry, startId, parentId, parentParentId]);

  const fallback = useMemo(
    () =>
      getStructuralFeatureAncestors(fallbackHierarchy).map(({ id, name }) => ({
        id,
        name,
      })),
    [fallbackHierarchy],
  );

  return {
    ancestors: cached ?? fallback,
    isLoading,
    isFromCache: cached !== null,
    needsFallback: hasTask && !isLoading && cached === null,
  };
}
