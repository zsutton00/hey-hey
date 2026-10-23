import { BadRequestException } from '@nestjs/common';
import { WorkItemChangeSetMaterializationStatus } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from '../../../types';
import type { PlanId } from '../../../types';
import type { ConversationId } from '../../../types';
import { createWarmWorkItemTypeRegistry } from '../../../../test/setup/work-item-type-registry.fixture';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import type { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import { WorkItemChangeSetMaterializerService } from '../work-item-change-set-materializer.service';
import { ProposalApprovalService } from '../proposal-approval.service';
import { ProposalService } from '../proposal.service';
import { PhaseBreakdownMaterializationService } from '../../plan/phase-breakdown-materialization.service';
import * as permissionEvaluation from '../permission-evaluation';
import * as permissionEvaluationContext from '../permission-evaluation-context';

const organizationId = '11111111-1111-4111-8111-111111111111' as OrganizationId;
// A project the warm registry fixture seeds with the built-in types.
const projectId = '00000000-0000-4000-8000-000000000002' as ProjectId;
const userId = '33333333-3333-4333-8333-333333333333' as UserId;
const proposalId = '44444444-4444-4444-8444-444444444444';
const memberId = '55555555-5555-4555-8555-555555555555';
const planId = '66666666-6666-4666-8666-666666666666';
const stageId = '77777777-7777-4777-8777-777777777777';
const FEATURE = 'aaaaaaaa-0000-4000-8000-000000000001';
const CHILDREN = [2, 3, 4].map(
  (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`,
);

type Row = {
  id: string;
  name: string;
  type: string;
  parentTaskId: string | null;
  sections: { key: string; materializedMarkdown: string | null }[];
};

const ROWS: Row[] = [
  {
    id: FEATURE,
    name: 'Feature',
    type: 'FEATURE',
    parentTaskId: null,
    sections: [{ key: 'description', materializedMarkdown: 'Before' }],
  },
  ...CHILDREN.map((id) => ({
    id,
    name: id,
    type: 'FEATURE',
    parentTaskId: FEATURE,
    sections: [],
  })),
];

const toRecord = (task: Row) => ({
  organizationId,
  projectId,
  status: 'BACKLOG',
  priority: null,
  dueDate: null,
  assigneeId: null,
  tag: 'product',
  archivedAt: null,
  serviceRelations: [],
  parentTask: null,
  ...task,
});

function matches(task: Row, where: Record<string, unknown>): boolean {
  const id = where['id'];
  if (typeof id === 'string') return task.id === id;
  if (id && typeof id === 'object' && 'in' in id)
    return (id.in as string[]).includes(task.id);
  if ('parentTaskId' in where)
    return task.parentTaskId === where['parentTaskId'];
  return false;
}

// A section-only edit of a FEATURE that has children.
const descriptionUpdates = {
  sections: [{ key: 'description', content: 'After' }],
};

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: proposalId,
    organizationId,
    projectId,
    type: 'SINGLE',
    action: 'UPDATE',
    status: 'DRAFT',
    targetEntityType: 'TASK',
    targetEntityId: FEATURE,
    updates: descriptionUpdates,
    edges: null,
    requestorId: userId,
    requestorContext: { source: 'user' },
    influences: null,
    generatedWithVersion: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    groupMembership: null,
    createdAt: new Date('2026-10-13T00:00:00.000Z'),
    updatedAt: new Date('2026-10-13T00:00:00.000Z'),
    ...overrides,
  };
}

describe('approval projection transaction boundary', () => {
  let registry: WorkItemTypeRegistryService;

  beforeAll(async () => {
    registry = await createWarmWorkItemTypeRegistry();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setUp(proposal: Record<string, unknown> = proposalRow()) {
    let transactionOpen = false;
    const violations: string[] = [];
    const graphCalls: string[] = [];

    // Every Graph method records the call and whether a transaction was open.
    const agentEdgeClient = new Proxy(
      {},
      {
        get: (_target, method: string) =>
          jest.fn(async () => {
            graphCalls.push(method);
            if (transactionOpen) violations.push(`AgentEdgeClient.${method}`);
            return [];
          }),
      },
    );

    let storedIntent: Record<string, unknown> | null = null;
    const db = {
      $queryRaw: jest.fn(async () => [{ id: proposalId }]),
      task: {
        findMany: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            where.type === 'PLAN_STAGE'
              ? [{ id: stageId }]
              : ROWS.filter((task) => matches(task, where)).map(toRecord),
        ),
        findFirst: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            const found = ROWS.find((task) => matches(task, where));
            return found ? toRecord(found) : null;
          },
        ),
      },
      service: { findMany: jest.fn().mockResolvedValue([]) },
      proposal: {
        findFirst: jest.fn().mockResolvedValue(proposal),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            ...proposal,
            ...data,
          }),
        ),
      },
      proposalApprovalRecord: {
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
      proposalGroupMember: {
        findFirst: jest.fn(async () => ({
          id: memberId,
          groupId: 'group-1',
          proposalId,
          executionState: 'READY',
          reservedTargetEntityId: null,
          group: { status: 'REVIEWABLE' },
          proposal,
        })),
      },
      workItemChangeSetMaterialization: {
        findUnique: jest.fn(async ({ select }: { select?: object }) => {
          // Phase breakdown reloads the publication after materialization.
          if (select && 'workItemIdMappings' in select) {
            return {
              status: 'PUBLISHED',
              workItemIdMappings: { 'temporary:journey-task:step-1': FEATURE },
            };
          }
          return storedIntent;
        }),
        create: jest.fn(
          async ({
            data,
          }: {
            data: Record<string, unknown> & {
              checkpoints?: { create?: unknown };
            };
          }) => {
            storedIntent = {
              ...data,
              id: 'materialization-1',
              status: WorkItemChangeSetMaterializationStatus.PREPARED,
              checkpoints: data.checkpoints?.create ?? [],
            };
            return storedIntent;
          },
        ),
      },
      $transaction: jest.fn(
        async (callback: (tx: unknown) => unknown): Promise<unknown> => {
          transactionOpen = true;
          try {
            return await callback(db);
          } finally {
            transactionOpen = false;
          }
        },
      ),
    };
    const prisma = { db } as unknown as PrismaService;
    const tokenFactory = () => 'service-token';

    const projector = new WorkItemChangeSetProjectorService(
      prisma,
      registry,
      new WorkItemParentageValidator(registry),
      agentEdgeClient as never,
      tokenFactory,
    );
    const projections: string[] = [];
    for (const method of ['project', 'projectSnapshots'] as const) {
      const original = projector[method].bind(projector) as (
        ...args: unknown[]
      ) => unknown;
      jest.spyOn(projector, method).mockImplementation(((
        ...args: unknown[]
      ) => {
        projections.push(method);
        if (transactionOpen) violations.push(`projector.${method}`);
        return original(...args);
      }) as never);
    }

    const eventPublisher = {
      publish: jest.fn(),
      publishInTransaction: jest.fn(),
    };
    // Reconciliation guards are covered by their own tests; this suite only
    // checks where projection runs relative to the transaction.
    const reconciliation = {
      assertApplicable: jest.fn(),
      assertReviewedBasisCurrent: jest.fn(),
      guardTaskEffect: jest.fn(),
      publishTaskEffects: jest.fn(),
      recordEdgeEffect: jest.fn(),
      recordCreatedDelivery: jest.fn(),
    };
    const materializer = new WorkItemChangeSetMaterializerService(
      prisma,
      projector,
      {} as never,
      agentEdgeClient as never,
      eventPublisher as never,
      tokenFactory,
      reconciliation as never,
      registry,
      {} as never,
      {} as never,
    );
    // Publication runs after commit and is covered by the materializer tests.
    jest
      .spyOn(materializer, 'materializeApprovedChangeSet')
      .mockImplementation(async () => ({
        proposal: { ...proposal, status: 'APPROVED' } as never,
        rootWorkItemId: FEATURE,
        status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
        enacted: true,
      }));

    const approvalService = new ProposalApprovalService(
      prisma,
      eventPublisher as never,
      {} as never,
      registry,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        rollbackMaterializedEdges: jest.fn().mockResolvedValue(undefined),
      } as never,
      materializer,
      {} as never,
      { resolve: jest.fn().mockResolvedValue({}) } as never,
      { assertProjectRole: jest.fn() } as never,
      reconciliation as never,
    );
    jest
      .spyOn(
        approvalService as unknown as {
          toResponseDto: (row: unknown) => Promise<unknown>;
        },
        'toResponseDto',
      )
      .mockImplementation(async (row: unknown) => row);

    jest
      .spyOn(permissionEvaluationContext, 'resolvePermissionEvaluationContext')
      .mockResolvedValue({
        entity: {},
        proposal: { source: 'user', eligibleProjectMemberIds: [userId] },
      } as never);
    jest
      .spyOn(permissionEvaluation, 'evaluatePermissions')
      .mockReturnValue({ threshold: 1, allowsProposerApproval: true } as never);

    return {
      db,
      prisma,
      registry,
      projector,
      materializer,
      approvalService,
      violations,
      graphCalls,
      projections,
    };
  }

  function expectProjectedOnceOutsideTransactions(
    context: ReturnType<typeof setUp>,
  ) {
    expect(context.violations).toEqual([]);
    expect(context.projections).toEqual(['projectSnapshots']);
    // The section-only edit reads the root alone, with no Graph traffic.
    expect(context.graphCalls).toEqual([]);
    expect(context.db.$transaction).toHaveBeenCalled();
  }

  it('single approval', async () => {
    const context = setUp();

    await context.approvalService.approve(
      proposalId,
      organizationId,
      projectId,
      userId,
    );

    expectProjectedOnceOutsideTransactions(context);
  });

  it.each(['APPROVED', 'REJECTED'] as const)(
    'refuses an already %s proposal before building or projecting its change set',
    async (status) => {
      const context = setUp(proposalRow({ status }));
      const build = jest.spyOn(context.materializer, 'taskProposalChangeSet');

      await expect(
        context.approvalService.approve(
          proposalId,
          organizationId,
          projectId,
          userId,
        ),
      ).rejects.toEqual(
        new BadRequestException(
          `Cannot approve a proposal with status: ${status}`,
        ),
      );

      expect(build).not.toHaveBeenCalled();
      expect(context.projections).toEqual([]);
      expect(context.graphCalls).toEqual([]);
      expect(context.db.task.findFirst).not.toHaveBeenCalled();
      expect(context.db.task.findMany).not.toHaveBeenCalled();
      expect(context.db.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['APPROVED', 'REJECTED'] as const)(
    'refuses a proposal that becomes %s before the row lock',
    async (status) => {
      const context = setUp(proposalRow({ status }));
      context.db.proposal.findFirst.mockResolvedValueOnce(proposalRow());

      await expect(
        context.approvalService.approve(
          proposalId,
          organizationId,
          projectId,
          userId,
        ),
      ).rejects.toEqual(
        new BadRequestException(
          `Cannot approve a proposal with status: ${status}`,
        ),
      );

      expectProjectedOnceOutsideTransactions(context);
      expect(context.db.$queryRaw).toHaveBeenCalled();
      expect(context.db.proposalApprovalRecord.create).not.toHaveBeenCalled();
      expect(
        context.db.workItemChangeSetMaterialization.create,
      ).not.toHaveBeenCalled();
      expect(context.db.proposal.update).not.toHaveBeenCalled();
    },
  );

  it.each(['DRAFT', 'APPROVED'] as const)(
    'grouped %s member without a stored intent',
    async (status) => {
      const context = setUp(proposalRow({ status }));

      await context.approvalService.enactGroupedMember({
        memberId,
        organizationId,
        projectId,
      });

      expectProjectedOnceOutsideTransactions(context);
    },
  );

  it('apply-on-create', async () => {
    const context = setUp();
    const proposals = new ProposalService(
      context.prisma,
      {} as never,
      context.projector,
      context.approvalService,
      {} as never,
      {} as never,
      context.registry,
      { assertProjectRole: jest.fn() } as never,
      {} as never,
      {} as never,
    ) as unknown as {
      prepareApplyOnCreate: (...args: unknown[]) => Promise<unknown>;
      maybeApplyOnCreate: (...args: unknown[]) => Promise<unknown>;
    };
    const proposal = proposalRow();
    const dto = {
      action: proposal.action,
      targetEntityType: proposal.targetEntityType,
      targetEntityId: proposal.targetEntityId,
      updates: proposal.updates,
      requestorContext: proposal.requestorContext,
    };

    // create() decides and projects before its proposal.create transaction,
    // then applies inside it.
    const applyOnCreate = await proposals.prepareApplyOnCreate(
      organizationId,
      projectId,
      userId,
      dto,
      {},
    );
    await context.db.$transaction((tx: unknown) =>
      proposals.maybeApplyOnCreate(
        tx,
        proposal,
        organizationId,
        projectId,
        dto,
        {},
        applyOnCreate,
      ),
    );

    expectProjectedOnceOutsideTransactions(context);
  });

  it.each(['changed write', 'new eligibility'] as const)(
    'rejects apply-on-create after %s without projecting inside the transaction',
    async (scenario) => {
      const context = setUp();
      const proposals = new ProposalService(
        context.prisma,
        {} as never,
        context.projector,
        context.approvalService,
        {} as never,
        {} as never,
        context.registry,
        { assertProjectRole: jest.fn() } as never,
        {} as never,
        {} as never,
      ) as unknown as {
        prepareApplyOnCreate: (...args: unknown[]) => Promise<unknown>;
        maybeApplyOnCreate: (...args: unknown[]) => Promise<unknown>;
      };
      const proposal = proposalRow();
      const dto = {
        action: proposal.action,
        targetEntityType: proposal.targetEntityType,
        targetEntityId: proposal.targetEntityId,
        updates: proposal.updates,
        requestorContext: proposal.requestorContext,
      };
      if (scenario === 'new eligibility') {
        jest
          .mocked(permissionEvaluation.evaluatePermissions)
          .mockReturnValueOnce({
            requiresProposal: true,
            threshold: 2,
            allowsProposerApproval: true,
          });
      }
      const prepared = await proposals.prepareApplyOnCreate(
        organizationId,
        projectId,
        userId,
        dto,
        {},
      );
      if (scenario === 'changed write') {
        proposal.updates = {
          sections: [
            { key: 'description', content: 'Changed after projection' },
          ],
        };
        dto.updates = proposal.updates;
      }
      await expect(
        context.db.$transaction((tx: unknown) =>
          proposals.maybeApplyOnCreate(
            tx,
            proposal,
            organizationId,
            projectId,
            dto,
            {},
            prepared,
          ),
        ),
      ).rejects.toThrow(
        scenario === 'changed write'
          ? 'Proposal changed while it was being approved'
          : 'Proposal approval requirements changed while it was being created',
      );
      expect(context.violations).toEqual([]);
      expect(context.projections).toEqual(
        scenario === 'changed write' ? ['projectSnapshots'] : [],
      );
      expect(
        context.db.workItemChangeSetMaterialization.create,
      ).not.toHaveBeenCalled();
    },
  );

  it('phase-breakdown materialization', async () => {
    const context = setUp(proposalRow({ type: 'BATCH' }));
    const request = context.materializer.taskProposalChangeSet(
      proposalRow() as never,
    );
    const phaseBreakdown = new PhaseBreakdownMaterializationService(
      context.prisma,
      context.approvalService,
      {
        prepareAccumulated: jest
          .fn()
          .mockResolvedValue({ advisories: [], changeSet: request }),
      } as never,
    );

    await phaseBreakdown.materializeAccumulatedPhases({
      accumulatedPhases: {
        0: {
          0: {
            steps: [{ id: 'step-1', stageId, sequenceOrder: 0 }],
          } as never,
        },
      },
      planId: planId as PlanId,
      designDocId: 'design-doc-1',
      conversationId: 'conversation-1' as ConversationId,
      organizationId,
      projectId,
      userId,
    });

    expectProjectedOnceOutsideTransactions(context);
  });
});
