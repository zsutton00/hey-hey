import { Test, TestingModule } from '@nestjs/testing';
import type { CreateProposalDto } from '../../../generated';
import { WorkStatus } from '../../../generated/model/workStatus';
import { PrismaService } from '../../../prisma/prisma.service';
import * as TestUtils from '../../../utils/testUtils';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import {
  createWarmWorkItemTypeRegistry,
  createWarmWorkItemTypeRegistryWithCustomTypes,
} from '../../../../test/setup/work-item-type-registry.fixture';
import { ProposalValidationEngine } from '../proposal-validation.engine';

const { testIds } = TestUtils;

function updateStatusProposal(status: WorkStatus): CreateProposalDto {
  return {
    type: 'SINGLE',
    action: 'UPDATE',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { status },
  };
}

async function buildEngine(
  registry: WorkItemTypeRegistryService,
): Promise<{
  engine: ProposalValidationEngine;
  prisma: ReturnType<typeof TestUtils.createMockPrismaService>;
}> {
  const prisma = TestUtils.createMockPrismaService();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProposalValidationEngine,
      { provide: PrismaService, useValue: prisma },
      { provide: WorkItemTypeRegistryService, useValue: registry },
      WorkItemParentageValidator,
    ],
  }).compile();
  return {
    engine: module.get(ProposalValidationEngine),
    prisma,
  };
}

function projectAndTaskMocks(
  prisma: ReturnType<typeof TestUtils.createMockPrismaService>,
  type: string,
  status: WorkStatus = WorkStatus.Active,
) {
  prisma.db.project.findFirst.mockResolvedValue({ id: testIds.project });
  prisma.db.task.findFirst.mockResolvedValue({
    id: testIds.task,
    type,
    status,
  });
}

describe('proposal status validation', () => {
  it('accepts PLAN VERIFYING through generic validation', async () => {
    const registry = await createWarmWorkItemTypeRegistry();
    const { engine, prisma } = await buildEngine(registry);
    projectAndTaskMocks(prisma, 'PLAN');

    const result = await engine.validate({
      proposals: [updateStatusProposal(WorkStatus.Verifying)],
      context: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        requestor: TestUtils.createMockAuthenticatedUser(),
      },
    });

    expect(result.valid).toBe(true);
    expect(result.proposals[0]?.errors).toEqual([]);
  });

  it('rejects a status outside a custom type agent-settable policy before persistence', async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      {
        typeKey: 'LIMITED',
        projectId: testIds.project,
        initialStatus: WorkStatus.Backlog,
        allowedStatuses: [WorkStatus.Backlog, WorkStatus.Active],
      },
    ]);
    const { engine, prisma } = await buildEngine(registry);
    projectAndTaskMocks(prisma, 'LIMITED');

    const result = await engine.validate({
      proposals: [updateStatusProposal(WorkStatus.Verifying)],
      context: {
        organizationId: testIds.organization,
        projectId: testIds.project,
        requestor: TestUtils.createMockAuthenticatedUser(),
      },
    });

    expect(result.valid).toBe(false);
    expect(result.proposals[0]?.errors).toContainEqual(
      expect.objectContaining({
        field: 'proposals[0].updates.status',
        code: 'status_not_allowed',
        reason:
          'Status VERIFYING is not allowed for LIMITED (allowed: BACKLOG, ACTIVE).',
      }),
    );

    await expect(
      engine.assertTaskMutationAuthoringValid(
        updateStatusProposal(WorkStatus.Verifying),
        testIds.organization,
        testIds.project,
        prisma.db,
        { validatePlanStageTopology: false },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'proposals[0].updates.status',
            code: 'status_not_allowed',
          }),
        ]),
      }),
    });
  });
});
