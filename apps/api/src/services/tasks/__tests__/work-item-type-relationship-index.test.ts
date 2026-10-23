import { EntityType } from '../../../generated/model/entityType';
import { WorkItemTypeRelationshipIndex } from '../work-item-type-relationship-index';

describe('WorkItemTypeRelationshipIndex', () => {
  const index = WorkItemTypeRelationshipIndex.build([
    {
      typeKey: 'FEATURE',
      allowedParentTaskTypes: [],
      allowedParentEntityTypes: [],
      tracking: {
        allowedSourceEntityTypes: [],
        allowedSourceTaskTypes: [],
      },
    },
    {
      typeKey: 'TASK_MONITOR',
      allowedParentTaskTypes: ['FEATURE', 'ARCHIVED_PARENT'],
      allowedParentEntityTypes: [EntityType.Task],
      tracking: {
        allowedSourceEntityTypes: [],
        allowedSourceTaskTypes: [],
      },
    },
    {
      typeKey: 'GOAL',
      allowedParentTaskTypes: [],
      allowedParentEntityTypes: [EntityType.DesignDoc],
      tracking: {
        allowedSourceEntityTypes: [],
        allowedSourceTaskTypes: [],
      },
    },
    {
      typeKey: 'CUSTOM_DELIVERABLE',
      allowedParentTaskTypes: ['FEATURE'],
      allowedParentEntityTypes: [EntityType.Task, EntityType.User],
      tracking: {
        allowedSourceEntityTypes: [EntityType.Task, EntityType.User],
        allowedSourceTaskTypes: ['GOAL', 'ARCHIVED_TRACKER'],
      },
    },
  ]);

  it('derives child-owned parentage in both directions for open keys', () => {
    expect(index.canParentChildType('FEATURE', 'TASK_MONITOR')).toBe(true);
    expect(index.canParentChildType('FEATURE', 'CUSTOM_DELIVERABLE')).toBe(
      true,
    );
    expect(index.getAllowedParentTypes('CUSTOM_DELIVERABLE')).toEqual([
      'FEATURE',
    ]);
    expect(index.getAllowedChildTypes('FEATURE')).toEqual([
      'CUSTOM_DELIVERABLE',
      'TASK_MONITOR',
    ]);
  });

  it('fails closed for missing or inactive relationship endpoints', () => {
    expect(index.canParentChildType('ARCHIVED_PARENT', 'TASK_MONITOR')).toBe(
      false,
    );
    expect(index.canParentChildType('FEATURE', 'MISSING')).toBe(false);
    expect(index.getAllowedParentTypes('MISSING')).toEqual([]);
    expect(index.getAllowedChildTypes('ARCHIVED_PARENT')).toEqual([]);
  });

  it('applies child-owned EntityType parentage as a literal allow-list', () => {
    expect(index.canParentEntityType('FEATURE', EntityType.Task)).toBe(false);
    expect(index.canParentEntityType('FEATURE', EntityType.DesignDoc)).toBe(false);
    expect(index.canParentEntityType('TASK_MONITOR', EntityType.Task)).toBe(
      true,
    );
    expect(index.canParentEntityType('TASK_MONITOR', EntityType.DesignDoc)).toBe(
      false,
    );
    expect(index.canParentEntityType('MISSING', EntityType.Task)).toBe(false);
  });

  it('derives tracker-to-trackable answers from active target declarations', () => {
    expect(index.getTrackingSourceTypes()).toEqual(['GOAL']);
    expect(index.getTrackingTargetTaskTypes('GOAL')).toEqual([
      'CUSTOM_DELIVERABLE',
    ]);
    expect(
      index.isTrackingSourceAllowed(
        'CUSTOM_DELIVERABLE',
        EntityType.Task,
        'GOAL',
      ),
    ).toBe(true);
    expect(
      index.isTrackingSourceAllowed('CUSTOM_DELIVERABLE', EntityType.User),
    ).toBe(true);
  });

  it('rejects inactive task sources and targets without widening entity rules', () => {
    expect(
      index.isTrackingSourceAllowed(
        'CUSTOM_DELIVERABLE',
        EntityType.Task,
        'ARCHIVED_TRACKER',
      ),
    ).toBe(false);
    expect(index.isTrackingSourceAllowed('MISSING', EntityType.User)).toBe(
      false,
    );
    expect(index.getTrackingTargetTaskTypes('ARCHIVED_TRACKER')).toEqual([]);
  });
});
