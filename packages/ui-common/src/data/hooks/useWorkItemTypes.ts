import {
  useQuery as useTanStackQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import {
  filterWorkItemTypes,
  workItemTypeByKeyQueryOptions,
  workItemTypeCatalogQueryOptions,
} from "../collections/workItemTypes";
import {
  dataLayerQueryPolicy,
  shouldRetryOnMount,
} from "../query/queryPolicy";
import { useCollectionQueryState } from "../query/useCollectionQueryState";
import {
  resolveMentionWorkItemTypeAlias,
  resolveMentionWorkItemTypeKey,
} from "../../utils/mentionWorkItemType";
import type {
  EntityType,
  WorkItemTypeDefinitionDto,
  WorkItemTypeSummaryDto,
  WorkItemTypeLifecycleStatus,
} from "../../api";
import {
  buildWorkItemTypeRelationshipIndex,
  selectAllowedChildWorkItemTypes,
  selectAllowedParentEntityTypes,
  selectCanParentEntityType,
  selectIsTrackingSourceAllowed,
  selectTrackingTargetTaskTypes,
  type WorkItemTypeRelationshipIndex,
} from "../workItemTypeRelationshipIndex";

export interface UseWorkItemTypesOptions
  extends CollectionHookOptions<WorkItemTypeSummaryDto> {
  projectId?: string;
  status?: WorkItemTypeLifecycleStatus;
}

export interface UseWorkItemTypesReturn
  extends DataCollectionHookReturn<WorkItemTypeSummaryDto> {
  workItemTypes: WorkItemTypeSummaryDto[];
}

const DISABLED_SCOPE = "__noop__";
const NO_WORK_ITEM_TYPES: WorkItemTypeSummaryDto[] = [];

/**
 * Every consumer in a project shares the single catalog read. A `status`
 * option narrows that catalog through `select`; it never issues its own
 * request.
 */
export function useWorkItemTypes(
  organizationId: string | undefined,
  options: UseWorkItemTypesOptions = {}
): UseWorkItemTypesReturn {
  const {
    projectId,
    status,
    enabled = true,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
  } = options;

  const queryClient = useQueryClient();
  const isEnabled = enabled && !!organizationId && !!projectId;
  const catalogOptions = useMemo(
    () =>
      workItemTypeCatalogQueryOptions(
        organizationId || DISABLED_SCOPE,
        projectId || DISABLED_SCOPE
      ),
    [organizationId, projectId]
  );
  const staleTime = staleTimeMs ?? dataLayerQueryPolicy.staleTime;
  const select = useCallback(
    (workItemTypes: WorkItemTypeSummaryDto[]) =>
      filterWorkItemTypes(workItemTypes, { status }),
    [status]
  );

  const result = useTanStackQuery({
    ...catalogOptions,
    enabled: isEnabled,
    staleTime,
    retryOnMount: shouldRetryOnMount(
      isEnabled ? queryClient.getQueryState(catalogOptions.queryKey) : undefined,
      staleTime
    ),
    ...(refetchOnMount ? { refetchOnMount: "always" as const } : {}),
    ...(refetchOnWindowFocus ? { refetchOnWindowFocus: "always" as const } : {}),
    select,
  });
  const queryState = useCollectionQueryState(
    result,
    catalogOptions.queryKey,
    isEnabled
  );

  const workItemTypes = result.data ?? NO_WORK_ITEM_TYPES;

  return {
    ...queryState,
    workItemTypes,
    data: workItemTypes,
  };
}

export interface UseWorkItemTypeRelationshipIndexReturn
  extends UseWorkItemTypesReturn {
  relationshipIndex: WorkItemTypeRelationshipIndex | undefined;
}

/**
 * Projects relationship answers only after the unfiltered project snapshot is
 * ready. An unavailable index is intentionally distinct from a loaded index
 * with no eligible relationships.
 */
export function useWorkItemTypeRelationshipIndex(
  organizationId: string | undefined,
  projectId: string | undefined
): UseWorkItemTypeRelationshipIndexReturn {
  const workItemTypes = useWorkItemTypes(organizationId, { projectId });
  const relationshipIndex = useMemo(
    () =>
      workItemTypes.isReady
        ? buildWorkItemTypeRelationshipIndex(workItemTypes.workItemTypes)
        : undefined,
    [workItemTypes.isReady, workItemTypes.workItemTypes]
  );

  return { ...workItemTypes, relationshipIndex };
}

export interface UseAllowedChildWorkItemTypesReturn
  extends UseWorkItemTypeRelationshipIndexReturn {
  allowedChildTypes: readonly string[] | undefined;
}

export function useAllowedChildWorkItemTypes(
  organizationId: string | undefined,
  projectId: string | undefined,
  parentType: string
): UseAllowedChildWorkItemTypesReturn {
  const relationship = useWorkItemTypeRelationshipIndex(
    organizationId,
    projectId
  );
  const allowedChildTypes = useMemo(
    () =>
      selectAllowedChildWorkItemTypes(
        relationship.relationshipIndex,
        parentType
      ),
    [relationship.relationshipIndex, parentType]
  );

  return { ...relationship, allowedChildTypes };
}

export interface UseAllowedParentEntityTypesReturn
  extends UseWorkItemTypeRelationshipIndexReturn {
  allowedParentEntityTypes: readonly EntityType[] | undefined;
}

export function useAllowedParentEntityTypes(
  organizationId: string | undefined,
  projectId: string | undefined,
  childType: string
): UseAllowedParentEntityTypesReturn {
  const relationship = useWorkItemTypeRelationshipIndex(
    organizationId,
    projectId
  );
  const allowedParentEntityTypes = useMemo(
    () =>
      selectAllowedParentEntityTypes(
        relationship.relationshipIndex,
        childType
      ),
    [relationship.relationshipIndex, childType]
  );

  return { ...relationship, allowedParentEntityTypes };
}

export interface UseCanParentEntityTypeReturn
  extends UseWorkItemTypeRelationshipIndexReturn {
  canParent: boolean | undefined;
}

export function useCanParentEntityType(
  organizationId: string | undefined,
  projectId: string | undefined,
  parentEntityType: EntityType,
  childType: string
): UseCanParentEntityTypeReturn {
  const relationship = useWorkItemTypeRelationshipIndex(
    organizationId,
    projectId
  );
  const canParent = useMemo(
    () =>
      selectCanParentEntityType(
        relationship.relationshipIndex,
        parentEntityType,
        childType
      ),
    [relationship.relationshipIndex, parentEntityType, childType]
  );

  return { ...relationship, canParent };
}

export interface UseTrackingTargetWorkItemTypesReturn
  extends UseWorkItemTypeRelationshipIndexReturn {
  trackingTargetTaskTypes: readonly string[] | undefined;
}

export function useTrackingTargetWorkItemTypes(
  organizationId: string | undefined,
  projectId: string | undefined,
  sourceTaskType: string
): UseTrackingTargetWorkItemTypesReturn {
  const relationship = useWorkItemTypeRelationshipIndex(
    organizationId,
    projectId
  );
  const trackingTargetTaskTypes = useMemo(
    () =>
      selectTrackingTargetTaskTypes(
        relationship.relationshipIndex,
        sourceTaskType
      ),
    [relationship.relationshipIndex, sourceTaskType]
  );

  return { ...relationship, trackingTargetTaskTypes };
}

export interface UseWorkItemTypeTrackingEligibilityReturn
  extends UseWorkItemTypeRelationshipIndexReturn {
  isAllowed: boolean | undefined;
}

export function useWorkItemTypeTrackingEligibility(
  organizationId: string | undefined,
  projectId: string | undefined,
  targetTaskType: string | undefined,
  sourceEntityType: EntityType,
  sourceTaskType?: string
): UseWorkItemTypeTrackingEligibilityReturn {
  const relationship = useWorkItemTypeRelationshipIndex(
    organizationId,
    projectId
  );
  const isAllowed = useMemo(
    () =>
      targetTaskType
        ? selectIsTrackingSourceAllowed(
            relationship.relationshipIndex,
            targetTaskType,
            sourceEntityType,
            sourceTaskType
          )
        : relationship.relationshipIndex
          ? false
          : undefined,
    [
      relationship.relationshipIndex,
      sourceEntityType,
      sourceTaskType,
      targetTaskType,
    ]
  );

  return { ...relationship, isAllowed };
}

export interface UseWorkItemTypeByKeyReturn {
  workItemTypeSummary: WorkItemTypeSummaryDto | undefined;
  workItemTypeDefinition: WorkItemTypeDefinitionDto | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: Error | null;
  isStale: boolean;
  refetch: () => Promise<WorkItemTypeSummaryDto | null>;
  markStale: () => void;
}

export interface UseMentionWorkItemTypeKeyReturn {
  /** Registered key the mention kind names, when it names one. */
  typeKey: string | undefined;
  /** False while the catalog needed to decide is still loading. */
  isResolved: boolean;
}

/**
 * Resolves a mention kind to a registered type key so renderers never request
 * a key the registry lacks. Platform aliases resolve immediately; any other
 * kind is checked against the shared project catalog. A kind with no
 * registered key, or a failed catalog read, resolves to `undefined`.
 */
export function useMentionWorkItemTypeKey(
  organizationId: string | undefined,
  projectId: string | undefined,
  mentionKind: string | undefined
): UseMentionWorkItemTypeKeyReturn {
  const alias = mentionKind
    ? resolveMentionWorkItemTypeAlias(mentionKind)
    : undefined;
  const catalog = useWorkItemTypes(organizationId, {
    projectId,
    enabled: !!mentionKind && !alias,
  });
  const registeredKeys = useMemo(
    () => catalog.workItemTypes.map((workItemType) => workItemType.definition.key),
    [catalog.workItemTypes]
  );

  if (!mentionKind) return { typeKey: undefined, isResolved: false };
  if (alias) return { typeKey: alias, isResolved: true };
  if (catalog.error) return { typeKey: undefined, isResolved: true };
  if (!catalog.isReady) return { typeKey: undefined, isResolved: false };
  return {
    typeKey: resolveMentionWorkItemTypeKey(mentionKind, registeredKeys),
    isResolved: true,
  };
}

/**
 * Reads one registered type. Callers pass only registry keys; a key the
 * caller cannot name yet should be passed as `undefined` until it can.
 */
export function useWorkItemTypeByKey(
  organizationId: string | undefined,
  projectId: string | undefined,
  typeKey: string | undefined
): UseWorkItemTypeByKeyReturn {
  const queryClient = useQueryClient();
  const isEnabled = !!organizationId && !!projectId && !!typeKey;
  const byKeyOptions = useMemo(
    () =>
      workItemTypeByKeyQueryOptions(
        queryClient,
        organizationId || DISABLED_SCOPE,
        projectId || DISABLED_SCOPE,
        typeKey || DISABLED_SCOPE
      ),
    [queryClient, organizationId, projectId, typeKey]
  );

  const result = useTanStackQuery({
    ...byKeyOptions,
    enabled: isEnabled,
    retryOnMount: shouldRetryOnMount(
      isEnabled ? queryClient.getQueryState(byKeyOptions.queryKey) : undefined
    ),
  });
  const queryState = useCollectionQueryState(
    result,
    byKeyOptions.queryKey,
    isEnabled
  );

  const workItemTypeSummary = result.data ?? undefined;

  return {
    ...queryState,
    workItemTypeSummary,
    workItemTypeDefinition: workItemTypeSummary?.definition,
  };
}
