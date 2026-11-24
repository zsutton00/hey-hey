import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { legacyStatuses } from '../../../../test/setup/legacy-status.fixture';
import type { TaskResponseDto } from '@hey-hey/contracts/api/models';
import { Test, TestingModule } from '@nestjs/testing';
import type { CreateProposalDto } from '@hey-hey/contracts/api/models';
import { WorkStatus } from '@hey-hey/contracts/api/models';
import { PrismaService } from '../../../prisma/prisma.service';
import * as TestUtils from '../../../utils/testUtils';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import {
  BUILT_IN_WORK_ITEM_TYPE_KEYS,
  createWarmWorkItemTypeRegistry,
  createWarmWorkItemTypeRegistryWithCustomTypes,
} from '../../../../test/setup/work-item-type-registry.fixture';
import { ProposalValidationEngine } from '../proposal-validation.engine';

const { testIds } = TestUtils;

const context = () => ({
  organizationId: testIds.organization,
  projectId: testIds.project,
  requestor: TestUtils.createMockAuthenticatedUser(),
});

function updateStatusProposal(
  status: TaskResponseDto['status'],
): CreateProposalDto {
  return {
    type: 'SINGLE',
    action: 'UPDATE',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { status },
  };
}

async function buildEngine(registry: WorkItemTypeRegistryService): Promise<{
  engine: ProposalValidationEngine;
  prisma: ReturnType<typeof TestUtils.createMockPrismaService>;
}> {
  const prisma = TestUtils.createMockPrismaService();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProposalValidationEngine,
      {
        provide: ProposalReconciliationService,
        useValue: new ProposalReconciliationService(
          {} as never,
          {} as never,
          () => 'test',
        ),
      },
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
  status: TaskResponseDto['status'] = WorkStatus.Active,
) {
  prisma.db.project.findFirst.mockResolvedValue({ id: testIds.project });
  prisma.db.task.findFirst.mockResolvedValue({
    id: testIds.task,
    type,
    status,
  });
}

describe('proposal status validation', () => {
  it('accepts recipe creation with its own statuses and rejects unknown assignments', async () => {
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      {
        typeKey: 'recipe',
        projectId: testIds.project,
        statuses: [
          {
            name: 'Idea',
            meaning: { kind: 'CUSTOM' as const, text: 'Not started' },
          },
          { name: 'Testing', meaning: { kind: 'IN_PROGRESS' as const } },
          { name: 'Made', meaning: { kind: 'COMPLETED' as const } },
        ],
      },
    ]);
    const { engine, prisma } = await buildEngine(registry);
    projectAndTaskMocks(prisma, 'recipe');
    const proposal = (status?: string): CreateProposalDto => ({
      type: 'SINGLE',
      action: 'CREATE',
      targetEntityId: testIds.task,
      targetEntityType: 'TASK',
      updates: {
        name: 'Soup',
        type: 'recipe',
        ...(status === undefined ? {} : { status }),
      },
    });
    for (const status of [undefined, 'Idea', 'Testing']) {
      const result = await engine.validate({
        proposals: [proposal(status)],
        context: context(),
      });
      expect(result.proposals[0]?.errors).toEqual([]);
    }
    const invalid = await engine.validate({
      proposals: [proposal('Unknown')],
      context: context(),
    });
    expect(invalid.proposals[0]?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'status_not_allowed' }),
      ]),
    );
  });
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
        statuses: legacyStatuses([WorkStatus.Backlog, WorkStatus.Active]),
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
    projectAndTaskMocks(prisma, 'LIMITED', WorkStatus.Verifying);
    const reassignment = await engine.validate({
      proposals: [updateStatusProposal(WorkStatus.Verifying)],
      context: context(),
    });
    expect(reassignment.proposals[0]?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'status_not_allowed' }),
      ]),
    );
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

  describe('canonical types let agents propose every allowed status', () => {
    let registry: WorkItemTypeRegistryService;
    beforeAll(async () => {
      registry = await createWarmWorkItemTypeRegistry();
    });
    it.each(BUILT_IN_WORK_ITEM_TYPE_KEYS)(
      '%s agent-settable statuses include ordinary allowed statuses',
      async (typeKey) => {
        const rules = registry.getRulesForProject(typeKey, testIds.project);
        expect(rules?.agentSettableStatuses).toEqual(
          rules?.allowedStatuses.filter(
            (status) => status !== WorkStatus.Superseded,
          ),
        );
      },
    );

    it.each(BUILT_IN_WORK_ITEM_TYPE_KEYS)(
      'accepts every non-superseded allowed status on %s',
      async (typeKey) => {
        const { engine, prisma } = await buildEngine(registry);
        const allowed =
          registry.getRulesForProject(typeKey, testIds.project)
            ?.allowedStatuses ?? [];
        const targets = allowed.filter((s) => s !== WorkStatus.Superseded);
        expect(targets.length).toBeGreaterThan(0);
        for (const status of targets) {
          const current = allowed.find((s) => s !== status) ?? status;
          projectAndTaskMocks(prisma, typeKey, current);
          const result = await engine.validate({
            proposals: [updateStatusProposal(status)],
            context: context(),
          });
          expect({ status, errors: result.proposals[0]?.errors }).toEqual({
            status,
            errors: [],
          });
        }
      },
    );

    it('accepts CONTRACT ACTIVE, previously blocked by an empty agent-settable policy', async () => {
      const { engine, prisma } = await buildEngine(registry);
      projectAndTaskMocks(prisma, 'CONTRACT', WorkStatus.Superseded);

      const result = await engine.validate({
        proposals: [updateStatusProposal(WorkStatus.Active)],
        context: context(),
      });

      expect(result.proposals[0]?.errors).toEqual([]);
    });

    it('accepts an agent proposal to archive a CONTRACT', async () => {
      const { engine, prisma } = await buildEngine(registry);
      projectAndTaskMocks(prisma, 'CONTRACT', WorkStatus.Active);

      const result = await engine.validate({
        proposals: [updateStatusProposal(WorkStatus.Archived)],
        context: context(),
      });

      expect(result.valid).toBe(true);
      expect(result.proposals[0]?.errors).toEqual([]);
    });

    it('rejects a direct SUPERSEDED edit for a supersedable type', async () => {
      const { engine, prisma } = await buildEngine(registry);
      projectAndTaskMocks(prisma, 'CONTRACT');

      const result = await engine.validate({
        proposals: [updateStatusProposal(WorkStatus.Superseded)],
        context: context(),
      });

      expect(result.valid).toBe(false);
      expect(result.proposals[0]?.errors.length).toBeGreaterThan(0);
      expect(
        result.proposals[0]?.errors.some(
          (e) => e.code === 'status_not_allowed',
        ),
      ).toBe(false);
    });
  });
});
