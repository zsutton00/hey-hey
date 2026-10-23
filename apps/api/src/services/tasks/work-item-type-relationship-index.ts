import { EntityType } from '../../generated/model/entityType';

export interface WorkItemTypeRelationshipDefinition {
  readonly typeKey: string;
  readonly allowedParentTaskTypes: readonly string[];
  readonly allowedParentEntityTypes: readonly EntityType[];
  readonly tracking: TrackingRules;
}

export interface TrackingRules {
  readonly allowedSourceEntityTypes: readonly EntityType[];
  readonly allowedSourceTaskTypes: readonly string[];
}

export interface TrackingEligibilityIndex {
  readonly allowedSourcesByTargetTaskType: ReadonlyMap<string, TrackingRules>;
  readonly allowedSourceTaskTypesBySourceTaskType: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
}

/**
 * Deterministic relationship projection over one project's active registry
 * snapshot. It retains open string keys and derives inverse lookups without
 * becoming a second authored or persisted policy surface.
 */
export class WorkItemTypeRelationshipIndex {
  private readonly activeTypes: ReadonlySet<string>;
  private readonly parentTypesByChildType = new Map<
    string,
    ReadonlySet<string>
  >();
  private readonly childTypesByParentType = new Map<string, Set<string>>();
  private readonly parentEntityTypesByChildType = new Map<
    string,
    ReadonlySet<EntityType>
  >();
  private readonly trackingRulesByTargetType = new Map<string, TrackingRules>();
  private readonly targetTypesByTrackingSourceType = new Map<
    string,
    Set<string>
  >();

  private constructor(
    activeDefinitions: readonly WorkItemTypeRelationshipDefinition[],
  ) {
    this.activeTypes = new Set(
      activeDefinitions.map((definition) => definition.typeKey),
    );

    for (const definition of activeDefinitions) {
      this.parentEntityTypesByChildType.set(
        definition.typeKey,
        new Set(definition.allowedParentEntityTypes),
      );
      const parentTypes = new Set(
        definition.allowedParentTaskTypes.filter((parentType) =>
          this.activeTypes.has(parentType),
        ),
      );
      this.parentTypesByChildType.set(definition.typeKey, parentTypes);
      for (const parentType of parentTypes) {
        const childTypes =
          this.childTypesByParentType.get(parentType) ?? new Set<string>();
        childTypes.add(definition.typeKey);
        this.childTypesByParentType.set(parentType, childTypes);
      }

      const allowedSourceEntityTypes = new Set(
        definition.tracking.allowedSourceEntityTypes,
      );
      const allowedSourceTaskTypes = new Set(
        definition.tracking.allowedSourceTaskTypes.filter((sourceType) =>
          this.activeTypes.has(sourceType),
        ),
      );
      this.trackingRulesByTargetType.set(definition.typeKey, {
        allowedSourceEntityTypes: [...allowedSourceEntityTypes],
        allowedSourceTaskTypes: [...allowedSourceTaskTypes],
      });

      if (!allowedSourceEntityTypes.has(EntityType.Task)) continue;
      for (const sourceType of allowedSourceTaskTypes) {
        const targetTypes =
          this.targetTypesByTrackingSourceType.get(sourceType) ??
          new Set<string>();
        targetTypes.add(definition.typeKey);
        this.targetTypesByTrackingSourceType.set(sourceType, targetTypes);
      }
    }
  }

  static build(
    activeDefinitions: readonly WorkItemTypeRelationshipDefinition[],
  ): WorkItemTypeRelationshipIndex {
    return new WorkItemTypeRelationshipIndex(activeDefinitions);
  }

  canParentChildType(parentType: string, childType: string): boolean {
    return (
      this.activeTypes.has(parentType) &&
      this.activeTypes.has(childType) &&
      (this.parentTypesByChildType.get(childType)?.has(parentType) ?? false)
    );
  }

  canParentEntityType(
    childType: string,
    parentEntityType: EntityType,
  ): boolean {
    if (!this.activeTypes.has(childType)) return false;
    return (
      this.parentEntityTypesByChildType.get(childType)?.has(parentEntityType) ??
      false
    );
  }

  getAllowedParentTypes(childType: string): readonly string[] {
    if (!this.activeTypes.has(childType)) return [];
    return [...(this.parentTypesByChildType.get(childType) ?? [])].sort();
  }

  getAllowedChildTypes(parentType: string): readonly string[] {
    if (!this.activeTypes.has(parentType)) return [];
    return [...(this.childTypesByParentType.get(parentType) ?? [])].sort();
  }

  isTrackingSourceAllowed(
    targetType: string,
    sourceEntityType: EntityType,
    sourceTaskType?: string,
  ): boolean {
    if (!this.activeTypes.has(targetType)) return false;
    const rules = this.trackingRulesByTargetType.get(targetType);
    if (!rules?.allowedSourceEntityTypes.includes(sourceEntityType)) {
      return false;
    }
    if (sourceEntityType !== EntityType.Task) return true;
    return (
      typeof sourceTaskType === 'string' &&
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
      allowedSourceTaskTypesBySourceTaskType:
        this.targetTypesByTrackingSourceType,
    };
  }
}
