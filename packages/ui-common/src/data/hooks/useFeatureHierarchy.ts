import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UpdateTaskResultStatus, type WorkItemReferenceDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useRelationshipMutationInvalidation } from "./relationshipMutationInvalidation";
import type { FeatureTreeNode, UseFeatureTreeReturn } from "./useFeatureTree";
import { useFeatureDocumentContent } from "./useFeatureDocumentContent";
import { useWorkItemReferences } from "./useWorkItemReferences";

const EMPTY_FEATURE_REFERENCES: readonly WorkItemReferenceDto[] = [];

/** Structural identity intentionally excludes hydrated sections and metadata. */
export interface FeatureHierarchyNode {
  feature: Pick<WorkItemReferenceDto, "id" | "name" | "type"> & {
    parentTaskId?: string | null;
  };
  children: FeatureHierarchyNode[];
}

/** Tree-only metadata omits section keys: the list provider then loads no sections. */
export function useFeatureTreePageData(
  organizationId: string,
  projectId: string
): UseFeatureTreeReturn {
  const hierarchy = useFeatureHierarchy(organizationId, projectId);
  const ids = [...hierarchy.nodes.keys()];
  const { entries } = useFeatureDocumentContent(
    organizationId,
    projectId,
    ids,
    undefined,
    "metadata"
  );
  const invalidateRelationships = useRelationshipMutationInvalidation();
  const [moves, setMoves] = useState(new Map<string, string | null>());
  const [errorMap, setErrorMap] = useState(new Map<string, string>());
  useEffect(() => {
    setMoves((previous) => {
      const next = new Map(previous);
      for (const [id, parent] of previous) {
        const node = hierarchy.nodes.get(id);
        if (!node || (node.feature.parentTaskId ?? null) === parent)
          next.delete(id);
      }
      return next.size === previous.size ? previous : next;
    });
  }, [hierarchy.nodes]);
  const clearError = useCallback(
    (id: string) =>
      setErrorMap((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      }),
    []
  );
  const allFeatures = useMemo(
    () =>
      [...hierarchy.nodes.values()].flatMap((node) => {
        const metadata = entries.get(node.feature.id)?.data;
        if (!metadata) return [];
        return [
          {
            ...metadata,
            ...node.feature,
            parentTaskId:
              (moves.has(node.feature.id)
                ? moves.get(node.feature.id)
                : node.feature.parentTaskId) ?? undefined,
          },
        ];
      }),
    [hierarchy.nodes, entries, moves]
  );
  const roots = useMemo(() => {
    const nodes = new Map(
      allFeatures.map((feature) => [
        feature.id,
        { feature, children: [] as FeatureTreeNode[] },
      ])
    );
    const result: FeatureTreeNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.feature.parentTaskId
        ? nodes.get(node.feature.parentTaskId)
        : undefined;
      if (parent) parent.children.push(node);
      else result.push(node);
    }
    const compare = (a: FeatureTreeNode, b: FeatureTreeNode) =>
      a.feature.name.localeCompare(b.feature.name, undefined, {
        sensitivity: "base",
      }) || a.feature.id.localeCompare(b.feature.id);
    result.sort(compare);
    for (const node of nodes.values()) node.children.sort(compare);
    return result;
  }, [allFeatures]);
  const descendantsMap = useMemo(() => {
    const result = new Map<string, Set<string>>();
    const visit = (node: FeatureTreeNode): Set<string> => {
      const descendants = new Set<string>();
      for (const child of node.children) {
        descendants.add(child.feature.id);
        for (const id of visit(child)) descendants.add(id);
      }
      result.set(node.feature.id, descendants);
      return descendants;
    };
    roots.forEach(visit);
    return result;
  }, [roots]);
  const reparent = useCallback(
    async (id: string, parentId: string | null) => {
      if (
        !hierarchy.nodes.has(id) ||
        (parentId && !hierarchy.nodes.has(parentId))
      )
        throw new Error("Feature is no longer available.");
      if (
        id === parentId ||
        (parentId && descendantsMap.get(id)?.has(parentId))
      )
        throw new Error(
          "Cannot move a feature into itself or its descendants."
        );
      clearError(id);
      setMoves((previous) => new Map(previous).set(id, parentId));
      try {
        const response = await unifiedApiClient.updateTask({
          organizationId,
          projectId,
          taskId: id,
          updateTaskDto: { parentTaskId: parentId },
        });
        const result = response.data.data;
        if (!result) throw new Error("Update response data is missing.");
        if (result.status === UpdateTaskResultStatus.Pending) {
          setMoves((previous) => {
            const next = new Map(previous);
            next.delete(id);
            return next;
          });
        } else {
          setMoves((previous) =>
            new Map(previous).set(id, result.task.parentTaskId ?? null)
          );
          invalidateRelationships({ entityType: "Task", operation: "update", sourceEntity: result.task, organizationId, projectId });
        }
      } catch (error) {
        setMoves((previous) => {
          const next = new Map(previous);
          next.delete(id);
          return next;
        });
        setErrorMap((previous) =>
          new Map(previous).set(
            id,
            error instanceof Error ? error.message : "Unable to move feature."
          )
        );
        throw error;
      }
    },
    [
      hierarchy.nodes,
      descendantsMap,
      clearError,
      organizationId,
      projectId,
      invalidateRelationships,
    ]
  );
  const failure = ids
    .map((id) => entries.get(id))
    .find((entry) => entry?.status === "error");
  const error =
    hierarchy.error ?? (failure?.status === "error" ? failure.error : null);
  const ready = hierarchy.isReady && allFeatures.length === ids.length;
  return {
    roots,
    allFeatures,
    descendantsMap,
    reparent,
    errorMap,
    clearError,
    error,
    isLoading: !ready && !error,
    isFetched: ready || !!error,
    isReady: ready && !error,
  };
}

export function buildFeatureHierarchy(
  references: readonly WorkItemReferenceDto[]
) {
  const nodes = new Map<string, FeatureHierarchyNode>();
  for (const feature of references) {
    if (feature.type === "FEATURE") {
      nodes.set(feature.id, { feature, children: [] });
    }
  }
  const roots: FeatureHierarchyNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.feature.parentTaskId
      ? nodes.get(node.feature.parentTaskId)
      : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const compare = (left: FeatureHierarchyNode, right: FeatureHierarchyNode) =>
    left.feature.name.localeCompare(right.feature.name, undefined, {
      sensitivity: "base",
    }) || left.feature.id.localeCompare(right.feature.id);
  roots.sort(compare);
  for (const node of nodes.values()) node.children.sort(compare);

  const resolveRoot = (featureId: string): FeatureHierarchyNode | null => {
    let node = nodes.get(featureId);
    const visited = new Set<string>();
    while (node) {
      if (visited.has(node.feature.id)) return null;
      visited.add(node.feature.id);
      const parent = node.feature.parentTaskId
        ? nodes.get(node.feature.parentTaskId)
        : undefined;
      if (!parent) return node;
      node = parent;
    }
    return null;
  };
  // Reject malformed cycles rather than exposing an incomplete outline as ready.
  for (const id of nodes.keys()) {
    if (!resolveRoot(id))
      throw new Error("Feature hierarchy contains a parent cycle.");
  }
  return { roots, nodes, resolveRoot };
}

export function useFeatureHierarchy(organizationId: string, projectId: string) {
  const references = useWorkItemReferences({
    organizationId,
    projectId,
    workItemType: "FEATURE",
  });
  const previous = useRef<
    { scope: string; references: readonly WorkItemReferenceDto[] } | undefined
  >(undefined);
  const scope = `${organizationId}:${projectId}`;
  if (
    references.status === "ready" ||
    references.status === "empty" ||
    references.status === "updating"
  ) {
    previous.current = { scope, references: references.references };
  }
  const scopedReferences =
    references.status === "error" && previous.current?.scope === scope
      ? previous.current.references
      : references.references;
  // Empty reference states allocate arrays per render. Keep lookup callbacks
  // stable so effects consuming a loading or disabled hierarchy can settle.
  const structuralReferences = scopedReferences.length
    ? scopedReferences
    : EMPTY_FEATURE_REFERENCES;
  const hierarchy = useMemo(() => {
    try {
      return { ...buildFeatureHierarchy(structuralReferences), error: null };
    } catch (error) {
      return {
        ...buildFeatureHierarchy([]),
        error:
          error instanceof Error
            ? error
            : new Error("Invalid feature hierarchy."),
      };
    }
  }, [structuralReferences]);
  return {
    ...hierarchy,
    isLoading:
      references.status === "loading" || references.status === "disabled",
    isFetching: references.isFetching,
    isReady:
      !hierarchy.error &&
      (references.status === "ready" ||
        references.status === "empty" ||
        references.status === "updating"),
    error: references.status === "error" ? references.error : hierarchy.error,
  };
}

export interface FeatureLookupEntry {
  id: string;
  name: string;
  parentTaskId: string | null;
}

export interface FeatureAncestry {
  /** Root-first structural feature ancestors. */
  ancestors: { id: string; name: string }[];
  /** False when the walk meets an id outside the cached hierarchy. */
  complete: boolean;
}

type FeatureHierarchyNodes = ReadonlyMap<string, FeatureHierarchyNode>;

export function getFeatureFromHierarchy(
  nodes: FeatureHierarchyNodes,
  id: string
): FeatureLookupEntry | undefined {
  const node = nodes.get(id);
  if (!node) return undefined;
  return {
    id: node.feature.id,
    name: node.feature.name,
    parentTaskId: node.feature.parentTaskId ?? null,
  };
}

export function resolveFeatureAncestry(
  nodes: FeatureHierarchyNodes,
  startId: string | null
): FeatureAncestry {
  const ancestors: FeatureAncestry["ancestors"] = [];
  const visited = new Set<string>();
  let currentId = startId;
  while (currentId) {
    const node = nodes.get(currentId);
    if (!node || visited.has(currentId)) return { ancestors: [], complete: false };
    visited.add(currentId);
    ancestors.unshift({ id: node.feature.id, name: node.feature.name });
    currentId = node.feature.parentTaskId ?? null;
  }
  return { ancestors, complete: true };
}

/**
 * Feature lookups over the cached hierarchy. Issues no request of its own;
 * callers fall back to their own read when `get` misses or ancestry is
 * incomplete (for example, a feature created since the last refresh).
 */
export function useFeatureLookup(organizationId: string, projectId: string) {
  const { nodes, isReady, isLoading } = useFeatureHierarchy(
    organizationId,
    projectId
  );
  const get = useCallback(
    (id: string) => getFeatureFromHierarchy(nodes, id),
    [nodes]
  );
  const resolveAncestry = useCallback(
    (startId: string | null) => resolveFeatureAncestry(nodes, startId),
    [nodes]
  );
  return useMemo(
    () => ({ isReady, isLoading, get, resolveAncestry }),
    [isReady, isLoading, get, resolveAncestry]
  );
}
