import {
  EntityType,
  WorkItemTypeLifecycleStatus,
  type WorkItemTypeSummaryDto,
} from "../api";

export interface TrackingRules {
  readonly allowedSourceEntityTypes: readonly (typeof EntityType.Task)[];
  readonly allowedSourceTaskTypes: readonly string[];
}

interface TrackingDeclaration {
  readonly allowedSourceEntityTypes: readonly EntityType[];
  readonly allowedSourceTaskTypes: readonly string[];
}

export interface TrackingEligibilityIndex {
  readonly allowedSourcesByTargetTaskType: ReadonlyMap<string, TrackingRules>;
  readonly allowedTargetTaskTypesBySourceTaskType: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
}

/**
 * Deterministic relationship projection over one project's complete registry
 * snapshot. Only active definitions authorize new relationships. Archived
 * definitions remain available to their read-only consumers outside this
 * index, but never contribute relationship endpoints here.
 */
export class WorkItemTypeRelationshipIndex {
  private readonly activeTypes: ReadonlySet<string>;
  private readonly parentTypesByChildType = new Map<
    string,
    ReadonlySet<string>
  >();
  private readonly parentEntityTypesByChildType = new Map<
    string,
    ReadonlySet<EntityType>
  >();
  private readonly childTypesByParentType = new Map<string, Set<string>>();
  private readonly trackingRulesByTargetType = new Map<string, TrackingRules>();
  private readonly targetTypesByTrackingSourceType = new Map<
    string,
    Set<string>
  >();

  private constructor(activeDefinitions: readonly WorkItemTypeSummaryDto[]) {
    this.activeTypes = new Set(
      activeDefinitions.map(({ definition }) => definition.key)
    );

    for (const { definition } of activeDefinitions) {
      this.indexParentage(definition.key, definition.allowedParentTypes ?? []);
      this.indexEntityTypeParentage(
        definition.key,
        definition.allowedParentEntityTypes ?? []
      );
      this.indexTracking(
        definition.key,
        definition.tracking ?? {
          allowedSourceEntityTypes: [],
          allowedSourceTaskTypes: [],
        }
      );
    }
  }

  private indexEntityTypeParentage(
    childType: string,
    allowedParentEntityTypes: readonly EntityType[]
  ): void {
    this.parentEntityTypesByChildType.set(
      childType,
      new Set(allowedParentEntityTypes)
    );
  }

  static build(
    completeSnapshot: readonly WorkItemTypeSummaryDto[]
  ): WorkItemTypeRelationshipIndex {
    return new WorkItemTypeRelationshipIndex(
      completeSnapshot.filter(
        ({ status }) => status === WorkItemTypeLifecycleStatus.Active
      )
    );
  }

  private indexParentage(
    childType: string,
    allowedParentTypes: readonly string[]
  ): void {
    const parentTypes = new Set(
      allowedParentTypes.filter((parentType) =>
        this.activeTypes.has(parentType)
      )
    );
    this.parentTypesByChildType.set(childType, parentTypes);

    for (const parentType of parentTypes) {
      const childTypes =
        this.childTypesByParentType.get(parentType) ?? new Set<string>();
      childTypes.add(childType);
      this.childTypesByParentType.set(parentType, childTypes);
    }
  }

  private indexTracking(
    targetType: string,
    tracking: TrackingDeclaration
  ): void {
    const allowsTaskSources = tracking.allowedSourceEntityTypes.includes(
      EntityType.Task
    );
    const allowedSourceTaskTypes = new Set(
      tracking.allowedSourceTaskTypes.filter((sourceType) =>
        this.activeTypes.has(sourceType)
      )
    );
    const activeRules = {
      allowedSourceEntityTypes: allowsTaskSources ? [EntityType.Task] : [],
      allowedSourceTaskTypes: allowsTaskSources
        ? [...allowedSourceTaskTypes]
        : [],
    } satisfies TrackingRules;
    this.trackingRulesByTargetType.set(targetType, activeRules);

    if (!allowsTaskSources) return;
    for (const sourceType of allowedSourceTaskTypes) {
      const targetTypes =
        this.targetTypesByTrackingSourceType.get(sourceType) ??
        new Set<string>();
      targetTypes.add(targetType);
      this.targetTypesByTrackingSourceType.set(sourceType, targetTypes);
    }
  }

  canParentWorkItemType(parentType: string, childType: string): boolean {
    return (
      this.activeTypes.has(parentType) &&
      this.activeTypes.has(childType) &&
      (this.parentTypesByChildType.get(childType)?.has(parentType) ?? false)
    );
  }

  getAllowedParentWorkItemTypes(childType: string): readonly string[] {
    if (!this.activeTypes.has(childType)) return [];
    return [...(this.parentTypesByChildType.get(childType) ?? [])].sort();
  }

  getAllowedChildWorkItemTypes(parentType: string): readonly string[] {
    if (!this.activeTypes.has(parentType)) return [];
    return [...(this.childTypesByParentType.get(parentType) ?? [])].sort();
  }

  /**
   * An empty configured list means the active child type imposes no
   * EntityType-level parent constraint.
   */
  canParentEntityType(parentEntityType: EntityType, childType: string): boolean {
    if (!this.activeTypes.has(childType)) return false;
    const allowedParentEntityTypes =
      this.parentEntityTypesByChildType.get(childType);
    return (
      allowedParentEntityTypes !== undefined &&
      (allowedParentEntityTypes.size === 0 ||
        allowedParentEntityTypes.has(parentEntityType))
    );
  }

  getAllowedParentEntityTypes(childType: string): readonly EntityType[] {
    if (!this.activeTypes.has(childType)) return [];
    return [
      ...(this.parentEntityTypesByChildType.get(childType) ?? []),
    ].sort();
  }

  isTrackingSourceAllowed(
    targetType: string,
    sourceEntityType: EntityType,
    sourceTaskType?: string
  ): boolean {
    if (!this.activeTypes.has(targetType)) return false;
    const rules = this.trackingRulesByTargetType.get(targetType);
    if (
      sourceEntityType !== EntityType.Task ||
      !rules?.allowedSourceEntityTypes.includes(EntityType.Task)
    ) {
      return false;
    }
    return (
      typeof sourceTaskType === "string" &&
      this.activeTypes.has(sourceTaskType) &&
      rules.allowedSourceTaskTypes.includes(sourceTaskType)
    );
  }

  getTrackingSourceTypes(): readonly string[] {
    return [...this.targetTypesByTrackingSourceType.keys()].sort();
  }

  getTrackingTargetTaskTypes(sourceType: string): readonly string[] {
    if (!this.activeTypes.has(sourceType)) return [];
    return [
      ...(this.targetTypesByTrackingSourceType.get(sourceType) ?? []),
    ].sort();
  }

  getTrackingEligibilityIndex(): TrackingEligibilityIndex {
    return {
      allowedSourcesByTargetTaskType: this.trackingRulesByTargetType,
      allowedTargetTaskTypesBySourceTaskType:
        this.targetTypesByTrackingSourceType,
    };
  }
}

export function buildWorkItemTypeRelationshipIndex(
  completeSnapshot: readonly WorkItemTypeSummaryDto[] | undefined
): WorkItemTypeRelationshipIndex | undefined {
  return completeSnapshot
    ? WorkItemTypeRelationshipIndex.build(completeSnapshot)
    : undefined;
}

export function selectAllowedChildWorkItemTypes(
  index: WorkItemTypeRelationshipIndex | undefined,
  parentType: string
): readonly string[] | undefined {
  return index?.getAllowedChildWorkItemTypes(parentType);
}

export function selectAllowedParentEntityTypes(
  index: WorkItemTypeRelationshipIndex | undefined,
  childType: string
): readonly EntityType[] | undefined {
  return index?.getAllowedParentEntityTypes(childType);
}

export function selectCanParentEntityType(
  index: WorkItemTypeRelationshipIndex | undefined,
  parentEntityType: EntityType,
  childType: string
): boolean | undefined {
  return index?.canParentEntityType(parentEntityType, childType);
}

export function selectTrackingTargetTaskTypes(
  index: WorkItemTypeRelationshipIndex | undefined,
  sourceType: string
): readonly string[] | undefined {
  return index?.getTrackingTargetTaskTypes(sourceType);
}

export function selectIsTrackingSourceAllowed(
  index: WorkItemTypeRelationshipIndex | undefined,
  targetType: string,
  sourceEntityType: EntityType,
  sourceTaskType?: string
): boolean | undefined {
  return index?.isTrackingSourceAllowed(
    targetType,
    sourceEntityType,
    sourceTaskType
  );
}
