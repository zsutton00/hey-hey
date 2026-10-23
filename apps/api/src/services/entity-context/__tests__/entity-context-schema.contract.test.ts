import type { ContextRelatedEntityDto } from 'src/generated/model/contextRelatedEntityDto';
import type { EntityContextDto } from 'src/generated/model/entityContextDto';
import type { ContextProposalSummaryDto } from 'src/generated/model/contextProposalSummaryDto';
import type { ProposalResponseDto } from 'src/generated/model/proposalResponseDto';
import type { OrganizationId, ProjectId, ProposalId } from 'src/types';

// Wire-shape contract: taskType is optional on ContextRelatedEntityDto and
// a custom key value round-trips as a plain string without validation error.

describe('ContextRelatedEntityDto contract: taskType field', () => {
  const base: ContextRelatedEntityDto = {
    entityId: 'aaaaaaaa-0000-0000-0000-000000000001',
    entityType: 'TASK',
    displayName: 'Some task',
    relationship: 'related-to',
  };

  it('is valid without taskType (field is optional)', () => {
    expect(base).not.toHaveProperty('taskType');
  });

  it('round-trips a custom taskType value without error', () => {
    const dto: ContextRelatedEntityDto = { ...base, taskType: 'MARKETING' };
    expect(dto.taskType).toBe('MARKETING');
  });

  it('round-trips standard taskType values', () => {
    for (const type of ['STANDARD', 'BUG', 'FEATURE', 'GOAL']) {
      const dto: ContextRelatedEntityDto = { ...base, taskType: type };
      expect(dto.taskType).toBe(type);
    }
  });

  it('is absent on non-TASK entries', () => {
    const planEntry: ContextRelatedEntityDto = {
      ...base,
      entityType: 'TASK',
    };
    expect(planEntry.taskType).toBeUndefined();
  });
});

describe('EntityContextDto contract: root taskType field', () => {
  const base: EntityContextDto = {
    entityId: 'aaaaaaaa-0000-0000-0000-000000000001',
    entityType: 'TASK',
    displayName: 'Some task',
    createdAt: '2026-08-16T00:00:00.000Z',
  };

  it('accepts resolved Goal and Standard subtypes', () => {
    expect({ ...base, taskType: 'GOAL' }.taskType).toBe('GOAL');
    expect({ ...base, taskType: 'STANDARD' }.taskType).toBe('STANDARD');
  });

  it('keeps taskType optional for non-TASK seeds', () => {
    const planContext: EntityContextDto = {
      ...base,
      entityType: 'TASK',
    };
    expect(planContext.taskType).toBeUndefined();
  });
});

describe('EntityContextDto contract: proposal detail modes', () => {
  const base = {
    entityId: 'aaaaaaaa-0000-0000-0000-000000000001',
    entityType: 'TASK' as const,
    displayName: 'Some task',
    createdAt: '2026-08-16T00:00:00.000Z',
  };

  it('accepts bounded summaries with omission disclosure', () => {
    const summary = {
      id: 'aaaaaaaa-0000-0000-0000-000000000002',
      organizationId: 'aaaaaaaa-0000-0000-0000-000000000003' as OrganizationId,
      projectId: 'aaaaaaaa-0000-0000-0000-000000000004' as ProjectId,
      type: 'SINGLE',
      action: 'UPDATE',
      status: 'APPROVED',
      targetEntityId: base.entityId,
      targetEntityType: 'TASK',
      requestorId: 'aaaaaaaa-0000-0000-0000-000000000005',
      requiredApprovals: 1,
      approvals: [],
      changes: [
        {
          path: 'sections.description.content',
          type: 'markdown',
          diff: '@@ -1,1 +1,1 @@\n-Old copy\n+New copy',
          diffTruncated: false,
          diffOmittedCharacters: 0,
        },
      ],
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
    } satisfies ContextProposalSummaryDto;
    const dto = {
      ...base,
      proposalDetail: 'summary',
      olderProposalsOmitted: true,
      proposals: [summary],
    } satisfies EntityContextDto;

    expect(dto.proposals[0]!.changes[0]!.path).toBe(
      'sections.description.content',
    );
  });

  it('accepts authoritative full proposal payloads', () => {
    const full = {
      id: 'aaaaaaaa-0000-0000-0000-000000000002' as ProposalId,
      organizationId: 'aaaaaaaa-0000-0000-0000-000000000003' as OrganizationId,
      projectId: 'aaaaaaaa-0000-0000-0000-000000000004' as ProjectId,
      type: 'SINGLE',
      action: 'UPDATE',
      status: 'APPROVED',
      outOfDateStatus: 'CURRENT',
      targetEntityId: base.entityId,
      targetEntityType: 'TASK',
      updates: { name: 'Updated task' },
      reviewedFuture: null,
      requestorId: 'aaaaaaaa-0000-0000-0000-000000000005',
      requiredApprovals: 1,
      approvals: [],
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
    } satisfies ProposalResponseDto;
    const dto = {
      ...base,
      proposalDetail: 'full',
      olderProposalsOmitted: false,
      proposals: [full],
    } satisfies EntityContextDto;

    expect(dto.proposals[0]!.updates).toEqual({ name: 'Updated task' });
  });
});
