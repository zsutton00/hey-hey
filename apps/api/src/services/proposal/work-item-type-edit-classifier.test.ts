import { AgentEdgeType } from '../../generated/model/agentEdgeType';
import { EntityType } from '../../generated/model/entityType';
import { ReportType } from '../../generated/model/reportType';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import { WorkItemTypeEffectiveSource } from '../../generated/model/workItemTypeEffectiveSource';
import { WorkItemTypeLifecycleStatus } from '../../generated/model/workItemTypeLifecycleStatus';
import { WorkItemTypeScalarField } from '../../generated/model/workItemTypeScalarField';
import type { WorkItemTypeSummaryDto } from '../../generated/model/workItemTypeSummaryDto';
import { WorkStatus } from '../../generated/model/workStatus';
import type { ProjectId } from '../../types';
import {
  assertWorkItemTypeEditSupported,
  classifyWorkItemTypeEdit,
} from './work-item-type-edit-classifier';

const baseDefinition: WorkItemTypeDefinitionDto = {
  key: 'MARKETING',
  name: 'Marketing',
  role: 'work-item',
  description: 'Marketing work',
  sections: [
    {
      key: 'audience',
      label: 'Audience',
      kind: 'json',
      schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
    },
    { key: 'brief', label: 'Brief' },
  ],
  requiredScalars: [WorkItemTypeScalarField.DueDate],
  forbiddenScalars: [WorkItemTypeScalarField.Tag],
  allowedStatuses: [WorkStatus.Backlog, WorkStatus.Active],
  allowedParentTypes: ['FEATURE'],
  allowedParentEntityTypes: [EntityType.DesignDoc],
  edgeTargets: [
    {
      edgeType: AgentEdgeType.DependsOn,
      targetTypeKeys: ['STANDARD'],
    },
  ],
  tracking: {
    allowedSourceEntityTypes: [EntityType.Task],
    allowedSourceTaskTypes: ['FEATURE', 'STANDARD', 'BUG'],
  },
  agentSettableStatuses: [WorkStatus.Backlog],
  anchorableReportTypes: [ReportType.Implement],
  writingStandards: { create: 'Create well.', edit: 'Edit well.' },
  capabilities: { rendersInline: true },
};

function summary(
  definition: WorkItemTypeDefinitionDto = baseDefinition,
): WorkItemTypeSummaryDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    definition,
    status: WorkItemTypeLifecycleStatus.Active,
    projectId: 'project-1' as ProjectId,
    effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
  };
}

describe('classifyWorkItemTypeEdit', () => {
  it('returns unchanged only for a presence-faithful definition', () => {
    expect(classifyWorkItemTypeEdit(summary(), baseDefinition)).toEqual({
      kind: 'unchanged',
      removedSectionKeys: [],
      revokedTrackingSourceTypeKeys: [],
      unsupportedReasonCodes: [],
      unsupportedReasons: [],
    });
  });

  it('treats every non-protected semantic axis as authorable', () => {
    const proposed: WorkItemTypeDefinitionDto = {
      ...baseDefinition,
      name: 'Campaign',
      description: 'Campaign work',
      sections: [
        { ...baseDefinition.sections[0]!, label: 'Target audience' },
        baseDefinition.sections[1]!,
      ],
      requiredScalars: [],
      forbiddenScalars: [],
      allowedStatuses: [WorkStatus.Completed, WorkStatus.Active],
      allowedParentTypes: ['GOAL'],
      allowedParentEntityTypes: [],
      edgeTargets: [{ edgeType: AgentEdgeType.RelatedTo, targetTypeKeys: [] }],
      tracking: {
        allowedSourceEntityTypes: [EntityType.DesignDoc],
        allowedSourceTaskTypes: [
          ...baseDefinition.tracking!.allowedSourceTaskTypes,
          'PLAN',
        ],
      },
      agentSettableStatuses: [WorkStatus.Active],
      anchorableReportTypes: [],
      writingStandards: { create: 'Plan well.', edit: 'Revise well.' },
      capabilities: { rendersInline: false },
    };

    expect(classifyWorkItemTypeEdit(summary(), proposed)).toMatchObject({
      kind: 'authorable',
      removedSectionKeys: [],
      revokedTrackingSourceTypeKeys: [],
      unsupportedReasonCodes: [],
    });
  });

  it('keeps section removal and tracking-source revocation destructive', () => {
    const proposed: WorkItemTypeDefinitionDto = {
      ...baseDefinition,
      sections: [baseDefinition.sections[0]!],
      tracking: {
        ...baseDefinition.tracking!,
        allowedSourceTaskTypes: ['FEATURE'],
      },
    };

    expect(classifyWorkItemTypeEdit(summary(), proposed)).toMatchObject({
      kind: 'supported_destructive',
      removedSectionKeys: ['brief'],
      revokedTrackingSourceTypeKeys: ['BUG', 'STANDARD'],
      unsupportedReasonCodes: [],
    });
  });

  it('refuses stable identity changes', () => {
    expect(
      classifyWorkItemTypeEdit(summary(), {
        ...baseDefinition,
        key: 'CAMPAIGN',
      }),
    ).toMatchObject({
      kind: 'unsupported',
      unsupportedReasonCodes: ['IDENTITY_KEY_CHANGED'],
    });
  });
});

describe('custom-only color authoring', () => {
  it.each(['CANONICAL', 'CANONICAL_OVERRIDE'] as const)(
    'rejects authored color for %s but admits a glyph edit',
    (effectiveSource) => {
      const existing = { ...summary(), effectiveSource };
      expect(() =>
        assertWorkItemTypeEditSupported(existing, {
          ...baseDefinition,
          colorKey: 'primary',
        }),
      ).toThrow('Only project-custom');
      expect(() =>
        assertWorkItemTypeEditSupported(existing, {
          ...baseDefinition,
          iconKey: 'star',
        }),
      ).not.toThrow();
    },
  );
  it('admits custom color and clearing complete definitions', () => {
    expect(
      assertWorkItemTypeEditSupported(summary(), {
        ...baseDefinition,
        colorKey: 'primary',
      }).kind,
    ).toBe('authorable');
    expect(
      assertWorkItemTypeEditSupported(
        summary({ ...baseDefinition, colorKey: 'primary' }),
        baseDefinition,
      ).kind,
    ).toBe('authorable');
  });
});
