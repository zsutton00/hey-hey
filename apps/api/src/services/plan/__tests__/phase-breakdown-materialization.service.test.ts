import { Logger } from '@nestjs/common';
import { buildProductionLogEnvelope } from 'src/common/logger/production-log-envelope';
import { PhaseBreakdownStepType } from 'src/generated/local';
import type { PrismaService } from 'src/prisma/prisma.service';
import type {
  ConversationId,
  OrganizationId,
  PlanId,
  ProjectId,
  UserId,
} from 'src/types';
import type { ProposalApprovalService } from '../../proposal/proposal-approval.service';
import { PlanSubmissionAdmissionService } from '../plan-submission-admission.service';
import { PhaseBreakdownMaterializationService } from '../phase-breakdown-materialization.service';

describe('PhaseBreakdownMaterializationService', () => {
  const PLAN_ID = '11111111-1111-4111-8111-111111111111' as PlanId;
  const STAGE_ID = '22222222-2222-4222-8222-222222222222';
  const DESIGN_DOC_ID = '33333333-3333-4333-8333-333333333333';
  const SERVICE_ID = '44444444-4444-4444-8444-444444444444';
  const FIRST_HANDLE = '55555555-5555-4555-8555-555555555555';
  const SECOND_HANDLE = '66666666-6666-4666-8666-666666666666';

  const baseParams = {
    planId: PLAN_ID,
    designDocId: DESIGN_DOC_ID,
    conversationId: '77777777-7777-4777-8777-777777777777' as ConversationId,
    organizationId: '88888888-8888-4888-8888-888888888888' as OrganizationId,
    projectId: '99999999-9999-4999-8999-999999999999' as ProjectId,
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UserId,
  };

  const step = (id: string, sequenceOrder: number) => ({
    id,
    stageId: STAGE_ID,
    title: `Task ${sequenceOrder}`,
    description: `Description ${sequenceOrder}`,
    implementation: `Edit src/task-${sequenceOrder}.ts`,
    acceptanceCriteria: `- task ${sequenceOrder} passes`,
    type: PhaseBreakdownStepType.TASK,
    sequenceOrder,
    serviceIds: [SERVICE_ID],
    designDocMotivation: `Motivation ${sequenceOrder}`,
  });

  let service: PhaseBreakdownMaterializationService;
  let taskFindMany: jest.Mock;
  let proposalFindFirst: jest.Mock;
  let proposalCreate: jest.Mock;
  let queueGenericWorkItemChangeSetInTransaction: jest.Mock;
  let materializeGenericWorkItemChangeSet: jest.Mock;
  let materializationFindUnique: jest.Mock;
  let prepareAccumulated: jest.Mock;
  let transaction: jest.Mock;
  let projectGenericPreparation: jest.Mock;

  beforeEach(() => {
    taskFindMany = jest.fn().mockResolvedValue([{ id: STAGE_ID }]);
    proposalFindFirst = jest.fn().mockResolvedValue(null);
    proposalCreate = jest.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'proposal-1',
        ...data,
      }),
    );
    const tx = {
      proposal: {
        findFirst: proposalFindFirst,
        create: proposalCreate,
      },
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          workflowAboutType: 'plan',
          workflowAboutId: PLAN_ID,
        }),
      },
    };
    queueGenericWorkItemChangeSetInTransaction = jest.fn().mockResolvedValue({
      proposal: { id: 'proposal-1' },
      rootWorkItemId: PLAN_ID,
    });
    materializeGenericWorkItemChangeSet = jest.fn().mockResolvedValue({
      proposal: { id: 'proposal-1', status: 'APPROVED' },
      enacted: true,
      rootWorkItemId: PLAN_ID,
    });
    materializationFindUnique = jest.fn().mockResolvedValue({
      status: 'PUBLISHED',
      workItemIdMappings: {
        [`temporary:journey-task:${FIRST_HANDLE}`]: 'task-1',
        [`temporary:journey-task:${SECOND_HANDLE}`]: 'task-2',
      },
    });
    transaction = jest.fn(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );
    projectGenericPreparation = jest.fn(
      async (
        _organizationId: string,
        _projectId: string,
        request: unknown,
      ) => ({
        operationSet: request,
      }),
    );
    const prisma = {
      db: {
        $transaction: transaction,
        task: { findMany: taskFindMany },
        workItemChangeSetMaterialization: {
          findUnique: materializationFindUnique,
        },
      },
    } as unknown as PrismaService;
    const approval = {
      projectGenericPreparation,
      queueGenericWorkItemChangeSetInTransaction,
      materializeGenericWorkItemChangeSet,
    } as unknown as ProposalApprovalService;
    prepareAccumulated = jest
      .fn()
      .mockImplementation(({ accumulatedPhases }) => ({
        changeSet: new PlanSubmissionAdmissionService(
          prisma,
          {} as never,
        ).buildChangeSet(PLAN_ID, accumulatedPhases),
        advisories: [],
      }));
    service = new PhaseBreakdownMaterializationService(prisma, approval, {
      prepareAccumulated,
    } as never);
  });

  it('projects the change set once, before the transaction opens', async () => {
    await service.materializeAccumulatedPhases({
      ...baseParams,
      accumulatedPhases: { 0: { 0: { steps: [step(FIRST_HANDLE, 0)] } } },
    });

    expect(projectGenericPreparation).toHaveBeenCalledTimes(1);
    expect(projectGenericPreparation.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0]!,
    );
    expect(queueGenericWorkItemChangeSetInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      baseParams.organizationId,
      baseParams.projectId,
      await projectGenericPreparation.mock.results[0]!.value,
    );
  });

  it('persists explicit prerequisites with stable relationship references', async () => {
    await service.materializeAccumulatedPhases({
      ...baseParams,
      accumulatedPhases: {
        0: {
          0: {
            steps: [
              step(FIRST_HANDLE, 0),
              { ...step(SECOND_HANDLE, 1), dependsOnStepIds: [FIRST_HANDLE] },
            ],
          },
        },
      },
    });
    expect(
      proposalCreate.mock.calls[0][0].data.updates.operations,
    ).toContainEqual({
      op: 'relationship.create',
      ref: {
        refType: 'temporary',
        tempId: `journey-dependency:${SECOND_HANDLE}:${FIRST_HANDLE}:0`,
      },
      source: { refType: 'temporary', tempId: `journey-task:${SECOND_HANDLE}` },
      target: { refType: 'temporary', tempId: `journey-task:${FIRST_HANDLE}` },
      edgeType: 'DEPENDS_ON',
      category: 'meta',
    });
    expect(materializeGenericWorkItemChangeSet).toHaveBeenCalledTimes(1);
  });

  it('materializes direct STANDARD Tasks without inferring dependencies from journey order', async () => {
    const result = await service.materializeAccumulatedPhases({
      ...baseParams,
      accumulatedPhases: {
        0: {
          0: {
            steps: [step(SECOND_HANDLE, 1), step(FIRST_HANDLE, 0)],
          },
        },
      },
    });

    expect(result.materializedStepIds).toEqual(['task-1', 'task-2']);
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    const data = proposalCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: PLAN_ID,
      status: 'DRAFT',
    });
    const operations = data.updates.operations as Array<
      Record<string, unknown>
    >;
    expect(
      operations.filter((operation) => operation.op === 'workItem.create'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Task 0',
          type: 'STANDARD',
          parent: { refType: 'existing', id: STAGE_ID },
          serviceIds: [SERVICE_ID],
        }),
        expect.objectContaining({
          name: 'Task 1',
          type: 'STANDARD',
          parent: { refType: 'existing', id: STAGE_ID },
          serviceIds: [SERVICE_ID],
        }),
      ]),
    );
    expect(
      operations.some((operation) => operation.op === 'relationship.create'),
    ).toBe(false);
    expect(queueGenericWorkItemChangeSetInTransaction).toHaveBeenCalledTimes(1);
    expect(materializeGenericWorkItemChangeSet).toHaveBeenCalledWith({
      proposalId: 'proposal-1',
      organizationId: baseParams.organizationId,
      projectId: baseParams.projectId,
    });
  });

  it('resumes an approved matching proposal left by an interrupted attempt', async () => {
    proposalFindFirst.mockResolvedValue({
      id: 'orphaned-proposal',
      organizationId: baseParams.organizationId,
      projectId: baseParams.projectId,
      conversationId: baseParams.conversationId,
      type: 'BATCH',
      action: 'UPDATE',
      targetEntityId: PLAN_ID,
      targetEntityType: 'TASK',
      status: 'APPROVED',
      updates: {},
    });
    materializationFindUnique.mockResolvedValue({
      status: 'PUBLISHED',
      workItemIdMappings: {
        [`temporary:journey-task:${FIRST_HANDLE}`]: 'task-1',
      },
    });

    const result = await service.materializeAccumulatedPhases({
      ...baseParams,
      accumulatedPhases: {
        0: { 0: { steps: [step(FIRST_HANDLE, 0)] } },
      },
    });

    expect(result.materializedStepIds).toEqual(['task-1']);
    expect(proposalCreate).not.toHaveBeenCalled();
    expect(queueGenericWorkItemChangeSetInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'orphaned-proposal' }),
      baseParams.organizationId,
      baseParams.projectId,
      expect.objectContaining({
        operationSet: expect.objectContaining({
          operations: expect.any(Array),
        }),
      }),
    );
    expect(materializeGenericWorkItemChangeSet).toHaveBeenCalledWith({
      proposalId: 'orphaned-proposal',
      organizationId: baseParams.organizationId,
      projectId: baseParams.projectId,
    });
  });

  it('persists the normalized JSON array and logs Service coverage advisories', async () => {
    const repeatedIds = [SERVICE_ID, SERVICE_ID];
    const changeSet = {
      root: { refType: 'existing', id: PLAN_ID },
      operations: [
        {
          op: 'workItem.create',
          ref: {
            refType: 'temporary',
            tempId: `journey-task:${FIRST_HANDLE}`,
          },
          name: 'Task 0',
          type: 'STANDARD',
          parent: { refType: 'existing', id: STAGE_ID },
          serviceIds: repeatedIds,
        },
      ],
    };
    prepareAccumulated.mockResolvedValueOnce({
      changeSet,
      advisories: [
        {
          field: '/submission/plan/steps/0/serviceIds',
          code: 'duplicate_service_reference',
          reason: 'Repeated Service IDs are assigned once.',
        },
      ],
    });
    materializationFindUnique.mockResolvedValue({
      status: 'PUBLISHED',
      workItemIdMappings: {
        [`temporary:journey-task:${FIRST_HANDLE}`]: 'task-1',
      },
    });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    try {
      await service.materializeAccumulatedPhases({
        ...baseParams,
        accumulatedPhases: {
          0: {
            0: {
              steps: [{ ...step(FIRST_HANDLE, 0), serviceIds: repeatedIds }],
            },
          },
        },
      });

      expect(proposalCreate.mock.calls[0]![0].data.updates).toEqual(changeSet);
      expect(
        queueGenericWorkItemChangeSetInTransaction.mock.calls[0]![4]
          .operationSet,
      ).toEqual(changeSet);
      expect(warn).toHaveBeenCalledWith(
        'Plan Service coverage advisory',
        expect.objectContaining({
          advisoryCode: 'duplicate_service_reference',
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('fails before proposal creation when a Task names a Stage outside the Plan', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    taskFindMany.mockResolvedValue([]);

    await expect(
      service.materializeAccumulatedPhases({
        ...baseParams,
        accumulatedPhases: {
          0: { 0: { steps: [step(FIRST_HANDLE, 0)] } },
        },
      }),
    ).rejects.toThrow(/outside canonical Plan/);

    expect(proposalCreate).not.toHaveBeenCalled();
    const failure = log.mock.calls.find(
      ([message]) => message === 'Plan materialization failed',
    );
    const record = buildProductionLogEnvelope({
      level: 'error',
      message: failure?.[0],
      attributes: failure?.[1],
    });
    expect(record).toMatchObject({
      planId: PLAN_ID,
      checkpoint: 'load_stages',
      errorName: 'BadRequestException',
    });
    expect(record.errorMessage).toContain('outside canonical Plan');
    const rejection = log.mock.calls.find(
      ([message]) => message === 'Plan materialization stage rejected',
    );
    expect(
      buildProductionLogEnvelope({
        level: 'error',
        message: rejection?.[0],
        attributes: rejection?.[1],
      }),
    ).toMatchObject({
      stageId: STAGE_ID,
      reason: 'outside_canonical_plan',
      canonicalStageCount: 0,
    });
    log.mockRestore();
  });

  it('returns without a transaction when no phases accumulated', async () => {
    const result = await service.materializeAccumulatedPhases({
      ...baseParams,
      accumulatedPhases: {},
    });

    expect(result.materializedStepIds).toEqual([]);
    expect(taskFindMany).not.toHaveBeenCalled();
  });
});
