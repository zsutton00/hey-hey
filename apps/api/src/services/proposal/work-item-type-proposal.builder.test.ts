import { BadRequestException } from '@nestjs/common';
import { EntityType } from '../../generated/model/entityType';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import type { RequestorContext } from '../../mcp/tools/requestor-context';
import {
  buildWorkItemTypeCreateProposal,
  buildWorkItemTypeEditProposal,
  buildWorkItemTypeRestoreProposal,
  normalizeWorkItemTypeParentage,
} from './work-item-type-proposal.builder';

const requestorContext = {
  source: 'agent',
  userId: 'user-1',
  organizationId: 'organization-1',
  toolName: 'create_work_item_type',
  timestamp: '2026-08-10T00:00:00.000Z',
} as RequestorContext;

const definition: WorkItemTypeDefinitionDto = {
  key: 'RESEARCH',
  name: 'Research',
  role: 'project-info',
  sections: [],
  allowedStatuses: [],
  allowedParentTypes: ['STANDARD'],
};

describe('work-item type proposal parentage normalization', () => {
  it('immutably infers TASK when task parent types are declared without an entity-type list', () => {
    const normalized = normalizeWorkItemTypeParentage(definition);

    expect(normalized).not.toBe(definition);
    expect(normalized.allowedParentEntityTypes).toEqual([EntityType.Task]);
    expect(definition.allowedParentEntityTypes).toBeUndefined();
  });

  it('normalizes ordinary create and edit proposals', () => {
    const create = buildWorkItemTypeCreateProposal({
      definition,
      requestorContext,
    });
    const edit = buildWorkItemTypeEditProposal({
      typeKey: definition.key,
      definition,
      requestorContext,
    });

    expect(create.updates).toMatchObject({
      allowedParentEntityTypes: [EntityType.Task],
    });
    expect(edit.updates).toMatchObject({
      definition: {
        allowedParentEntityTypes: [EntityType.Task],
      },
    });
  });

  it('preserves explicit canonical customization acknowledgement on edits', () => {
    const edit = buildWorkItemTypeEditProposal({
      typeKey: definition.key,
      definition,
      requestorContext,
      acknowledgeCanonicalCustomization: true,
    });

    expect(edit.updates).toMatchObject({
      acknowledgeCanonicalCustomization: true,
    });
  });

  it('leaves already coherent and top-level definitions unchanged', () => {
    const coherent = {
      ...definition,
      allowedParentEntityTypes: [EntityType.Task],
    };
    const topLevel = {
      ...definition,
      allowedParentTypes: [],
      allowedParentEntityTypes: [],
    };

    expect(normalizeWorkItemTypeParentage(coherent)).toBe(coherent);
    expect(normalizeWorkItemTypeParentage(topLevel)).toBe(topLevel);
  });

  it('rejects explicit entity-type lists that contradict task parent types', () => {
    for (const allowedParentEntityTypes of [[], [EntityType.Project]]) {
      expect(() =>
        normalizeWorkItemTypeParentage({
          ...definition,
          allowedParentEntityTypes,
        }),
      ).toThrow(BadRequestException);
    }
  });

  it('preserves an archived definition exactly on the restore path', () => {
    const restore = buildWorkItemTypeRestoreProposal({
      typeKey: definition.key,
      definition,
      requestorContext,
    });

    expect(restore.updates).toBe(definition);
    expect(restore.updates).toEqual(definition);
  });
});
