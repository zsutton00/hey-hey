import { EntityType } from '../../../generated/model/entityType';
import { WorkItemParentageValidator } from '../work-item-parentage-validator.service';
import type { WorkItemTypeRegistryService } from '../work-item-type-registry.service';

describe('WorkItemParentageValidator', () => {
  const projectId = '123e4567-e89b-42d3-a456-426614174001';
  let registry: jest.Mocked<
    Pick<
      WorkItemTypeRegistryService,
      | 'assertTypeActive'
      | 'isParentRequired'
      | 'canParentEntityType'
      | 'canParentChildType'
    >
  >;
  let validator: WorkItemParentageValidator;

  beforeEach(() => {
    registry = {
      assertTypeActive: jest.fn(),
      isParentRequired: jest.fn().mockReturnValue(false),
      canParentEntityType: jest.fn().mockReturnValue(true),
      canParentChildType: jest.fn().mockReturnValue(true),
    };
    validator = new WorkItemParentageValidator(
      registry as unknown as WorkItemTypeRegistryService,
    );
  });

  it('rejects removing a required parent', () => {
    registry.isParentRequired.mockReturnValue(true);

    expect(() =>
      validator.assertValid({
        childType: 'CONTRACT',
        parentEntityType: null,
        parentType: null,
        projectId,
      }),
    ).toThrow(
      'CONTRACT items require a structural parent under the configured work-item type definition.',
    );
    expect(registry.canParentEntityType).not.toHaveBeenCalled();
    expect(registry.canParentChildType).not.toHaveBeenCalled();
  });

  it('accepts removing an optional parent', () => {
    expect(
      validator.evaluate({
        childType: 'STANDARD',
        parentEntityType: null,
        parentType: null,
        projectId,
      }),
    ).toBeNull();
    expect(registry.canParentEntityType).not.toHaveBeenCalled();
    expect(registry.canParentChildType).not.toHaveBeenCalled();
  });

  it('applies required FEATURE ownership to MODE through the generic boundary', () => {
    registry.isParentRequired.mockImplementation(
      (childType) => childType === 'MODE',
    );

    expect(() =>
      validator.assertValid({
        childType: 'MODE',
        parentEntityType: null,
        parentType: null,
        projectId,
      }),
    ).toThrow('MODE items require a structural parent');

    expect(
      validator.evaluate({
        childType: 'MODE',
        parentEntityType: EntityType.Task,
        parentType: 'FEATURE',
        projectId,
      }),
    ).toBeNull();

    registry.canParentChildType.mockReturnValue(false);
    expect(
      validator.evaluate({
        childType: 'MODE',
        parentEntityType: EntityType.Task,
        parentType: 'STANDARD',
        projectId,
      }),
    ).toMatchObject({ code: 'parent_type_incompatible' });
    expect(registry.canParentChildType).toHaveBeenCalledWith(
      'STANDARD',
      'MODE',
      projectId,
    );
  });

  it('uses the child-owned registry pair decision', () => {
    registry.canParentChildType.mockReturnValue(true);

    expect(
      validator.evaluate({
        childType: 'CONTRACT',
        parentEntityType: EntityType.Task,
        parentType: 'FEATURE',
        projectId,
      }),
    ).toBeNull();
    expect(registry.canParentChildType).toHaveBeenCalledWith(
      'FEATURE',
      'CONTRACT',
      projectId,
    );
    expect(registry.canParentEntityType).toHaveBeenCalledWith(
      'CONTRACT',
      EntityType.Task,
      projectId,
    );
  });

  it('accepts FEATURE-to-TASK_MONITOR from the child-owned registry projection', () => {
    expect(
      validator.evaluate({
        childType: 'TASK_MONITOR',
        parentEntityType: EntityType.Task,
        parentType: 'FEATURE',
        projectId,
      }),
    ).toBeNull();
    expect(registry.canParentChildType).toHaveBeenCalledWith(
      'FEATURE',
      'TASK_MONITOR',
      projectId,
    );
  });

  it('returns one structural refusal for an incompatible pair', () => {
    registry.canParentChildType.mockReturnValue(false);

    expect(
      validator.evaluate({
        childType: 'CONTRACT',
        parentEntityType: EntityType.Task,
        parentType: 'workflow',
        projectId,
      }),
    ).toEqual({
      code: 'parent_type_incompatible',
      reason:
        'A workflow item cannot parent a CONTRACT item under the configured work-item type definitions.',
    });
  });

  it('rejects the EntityType axis before evaluating the Task subtype pair', () => {
    registry.canParentEntityType.mockReturnValue(false);

    expect(
      validator.evaluate({
        childType: 'CONTRACT',
        parentEntityType: EntityType.DesignDoc,
        parentType: null,
        projectId,
      }),
    ).toEqual({
      code: 'parent_entity_type_incompatible',
      reason:
        'A DESIGN_DOC entity cannot parent a CONTRACT item under the configured work-item type definitions.',
    });
    expect(registry.canParentChildType).not.toHaveBeenCalled();
  });

  it('skips the Task subtype axis for an allowed non-Task parent', () => {
    expect(
      validator.evaluate({
        childType: 'CONTRACT',
        parentEntityType: EntityType.DesignDoc,
        parentType: null,
        projectId,
      }),
    ).toBeNull();
    expect(registry.canParentChildType).not.toHaveBeenCalled();
  });
});
