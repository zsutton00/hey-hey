import { ConflictException, NotFoundException } from '@nestjs/common';
import type { OrganizationId, ProjectId } from 'src/types';
import { ProposalApprovalService } from '../proposal-approval.service';
import { ProposalService } from '../proposal.service';
import {
  createDefaultProjectApprovalPolicy,
  ProjectApprovalPolicyService,
} from '../project-approval-policy.service';

const ORGANIZATION_ID =
  '30000000-0000-4000-8000-000000000001' as OrganizationId;
const PROJECT_ID = '30000000-0000-4000-8000-000000000002' as ProjectId;
const PROPOSAL_ID = '30000000-0000-4000-8000-000000000003';

function createService() {
  const db = {
    $transaction: jest.fn(),
    proposal: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
  };
  db.$transaction.mockImplementation(async (callback) => callback(db));
  const approvalService = { approve: jest.fn() };
  const service = new ProposalService(
    { db } as never,
    {} as never,
    {} as never,
    approvalService as never,
    {} as never,
    new ProjectApprovalPolicyService(),
    {} as never,
    { assertProjectRole: jest.fn() } as never,
    { captureAuthoring: jest.fn() } as never,
    {} as never,
  );
  return { service, db, approvalService };
}

describe('Proposal group BUILDING visibility', () => {
  it('excludes BUILDING members from ordinary proposal lists', async () => {
    const { service, db } = createService();

    await service.findMany(ORGANIZATION_ID, PROJECT_ID, {});

    expect(db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: {
            groupMembership: {
              is: {
                group: {
                  is: { status: 'BUILDING' },
                },
              },
            },
          },
        }),
      }),
    );
    expect(db.proposal.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: expect.any(Object),
        }),
      }),
    );
  });

  it('hides a BUILDING member from the ordinary proposal detail route', async () => {
    const { service, db } = createService();
    db.proposal.findFirst.mockResolvedValue({
      id: PROPOSAL_ID,
      groupMembership: {
        group: {
          status: 'BUILDING',
          revision: 2,
          frozenRevision: null,
        },
      },
    });

    await expect(
      service.findOne(PROPOSAL_ID, ORGANIZATION_ID, PROJECT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('routes grouped approval through the review-capable approval service', async () => {
    const { service, db, approvalService } = createService();
    const approvedProposal = {
      id: PROPOSAL_ID,
      status: 'DRAFT',
      action: 'CREATE',
    };
    db.proposal.findFirst.mockResolvedValue({
      id: PROPOSAL_ID,
      status: 'DRAFT',
      action: 'CREATE',
      groupMembership: { groupId: 'group-1' },
    });
    approvalService.approve.mockResolvedValue({
      proposal: approvedProposal,
      resultingEntityId: null,
      enacted: false,
    });

    await expect(
      service.update(
        PROPOSAL_ID,
        ORGANIZATION_ID,
        PROJECT_ID,
        { status: 'APPROVED' },
        '30000000-0000-4000-8000-000000000004' as never,
      ),
    ).resolves.toBe(approvedProposal);
    expect(approvalService.approve).toHaveBeenCalledWith(
      PROPOSAL_ID,
      ORGANIZATION_ID,
      PROJECT_ID,
      '30000000-0000-4000-8000-000000000004',
      null,
      undefined,
      undefined,
    );
    expect(db.proposal.update).not.toHaveBeenCalled();
  });

  it('rejects ordinary payload edits of a BUILDING member', async () => {
    const { service, db } = createService();
    db.proposal.findFirst.mockResolvedValue({
      id: PROPOSAL_ID,
      status: 'DRAFT',
      action: 'CREATE',
      updates: { name: 'Original' },
      groupMembership: {
        group: { status: 'BUILDING' },
      },
    });

    await expect(
      service.update(
        PROPOSAL_ID,
        ORGANIZATION_ID,
        PROJECT_ID,
        { updates: { name: 'Bypassed revision' } },
        '30000000-0000-4000-8000-000000000004' as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.proposal.update).not.toHaveBeenCalled();
  });

  it('hides BUILDING members from ordinary persisted validation', async () => {
    const { service, db } = createService();
    db.proposal.findFirst.mockResolvedValue(null);

    await expect(
      service.validateProposal(
        PROPOSAL_ID,
        ORGANIZATION_ID,
        PROJECT_ID,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.proposal.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: PROPOSAL_ID,
        NOT: expect.any(Object),
      }),
    });
  });

  it('delegates grouped approval to proposal-group review', async () => {
    const proposal = {
      id: PROPOSAL_ID,
      status: 'DRAFT',
      action: 'CREATE',
    };
    const db = {
      proposal: {
        findFirst: jest.fn().mockResolvedValue({
          groupMembership: { groupId: 'group-1' },
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(proposal),
      },
    };
    const proposalGroupDecisionService = {
      approve: jest.fn().mockResolvedValue({
        recorded: true,
        result: {
          outcome: 'APPROVAL_RECORDED',
          executionState: 'READY',
        },
      }),
    };
    const approvalService = Object.create(
      ProposalApprovalService.prototype,
    ) as ProposalApprovalService;
    Object.assign(approvalService, {
      prisma: { db },
      proposalGroupDecisionService,
      projectApprovalPolicyService: new ProjectApprovalPolicyService(),
      toResponseDto: jest.fn().mockResolvedValue(proposal),
    });

    await expect(
      approvalService.approve(
        PROPOSAL_ID,
        ORGANIZATION_ID,
        PROJECT_ID,
        '30000000-0000-4000-8000-000000000004' as never,
      ),
    ).resolves.toEqual({
      proposal,
      resultingEntityId: null,
      enacted: false,
    });
    expect(proposalGroupDecisionService.approve).toHaveBeenCalledWith(
      {
        proposalId: PROPOSAL_ID,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        userId: '30000000-0000-4000-8000-000000000004',
      },
      createDefaultProjectApprovalPolicy(),
    );
  });

  it('fails closed when the grouped review dependency is unavailable', async () => {
    const grouped = {
      id: PROPOSAL_ID,
      status: 'DRAFT',
      groupMembership: { groupId: 'group-1' },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: PROPOSAL_ID }]),
      proposal: {
        findFirst: jest.fn().mockResolvedValue(grouped),
        update: jest.fn(),
      },
      proposalApprovalRecord: { create: jest.fn() },
    };
    const approvalService = Object.create(
      ProposalApprovalService.prototype,
    ) as ProposalApprovalService;
    Object.assign(approvalService, {
      prisma: {
        db: {
          proposal: { findFirst: jest.fn().mockResolvedValue(grouped) },
          $transaction: jest.fn(async (callback) => callback(tx)),
        },
      },
      workItemChangeSetMaterializer: {
        isWorkItemChangeSetValidationRequest: jest.fn().mockReturnValue(false),
        taskProposalChangeSet: jest.fn().mockReturnValue(null),
      },
      projectApprovalPolicyService: new ProjectApprovalPolicyService(),
      pendingEdgeService: {
        rollbackMaterializedEdges: jest.fn().mockResolvedValue(undefined),
      },
      logger: {
        error: jest.fn(),
      },
    });

    await expect(
      approvalService.approve(
        PROPOSAL_ID,
        ORGANIZATION_ID,
        PROJECT_ID,
        '30000000-0000-4000-8000-000000000004' as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      approvalService.reject(
        PROPOSAL_ID,
        ORGANIZATION_ID,
        PROJECT_ID,
        '30000000-0000-4000-8000-000000000004' as never,
        'No',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.proposalApprovalRecord.create).not.toHaveBeenCalled();
    expect(tx.proposal.update).not.toHaveBeenCalled();
  });
});

describe('ProposalService.findMany occurrence window', () => {
  const windowStart = '2026-09-13T20:00:00.000Z';
  const windowEnd = '2026-09-14T20:00:00.000Z';

  it.each(['CREATE', 'UPDATE'] as const)(
    'applies the same bounded %s filter to rows and total',
    async (action) => {
      const { service, db } = createService();
      db.proposal.count.mockResolvedValue(1);

      const result = await service.findMany(ORGANIZATION_ID, PROJECT_ID, {
        action,
        windowStart,
        windowEnd,
        limit: 10,
        offset: 20,
      });

      const expectedWhere = expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        action,
        createdAt: {
          gte: new Date(windowStart),
          lt: new Date(windowEnd),
        },
      });
      expect(db.proposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expectedWhere,
          skip: 20,
          take: 10,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(db.proposal.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(result).toEqual({
        data: [],
        total: 1,
        limit: 10,
        offset: 20,
        windowStart,
        windowEnd,
      });
    },
  );

  it('keeps legacy proposal listing unbounded', async () => {
    const { service, db } = createService();

    const result = await service.findMany(ORGANIZATION_ID, PROJECT_ID, {});

    const rowQuery = db.proposal.findMany.mock.calls[0]![0];
    const countQuery = db.proposal.count.mock.calls[0]![0];
    expect(rowQuery.where).not.toHaveProperty('createdAt');
    expect(countQuery.where).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('windowStart');
    expect(result).not.toHaveProperty('windowEnd');
  });
});
