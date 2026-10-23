import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityType } from 'src/generated/model/entityType';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { NIL_UUID } from '../work-item-type-proposal.builder';
import { ProposalGroupAuthoringService } from '../proposal-group-authoring.service';
import { mockProposalAdmission } from './mock-proposal-admission';

const ORGANIZATION_ID =
  '30000000-0000-4000-8000-000000000001' as OrganizationId;
const PROJECT_ID = '30000000-0000-4000-8000-000000000002' as ProjectId;
const GROUP_ID = '30000000-0000-4000-8000-000000000003';
const USER_ID = '30000000-0000-4000-8000-000000000004' as UserId;

const proposal = {
  type: 'SINGLE' as const,
  action: 'CREATE' as const,
  targetEntityId: 'caller-placeholder',
  targetEntityType: 'DESIGN_DOC' as const,
  title: 'Draft design',
  eli5: 'Creates a design doc for review.',
  updates: { name: 'Draft design' },
  requestorContext: {
    source: 'user' as const,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    toolName: 'POST /proposal-groups/:groupId/members',
    timestamp: '2026-07-24T00:00:00.000Z',
  },
};

function createFixture(groupSeed: {
  status: 'BUILDING' | 'REVIEWABLE';
  revision: number;
}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    proposalGroup: {
      findFirst: jest.fn().mockResolvedValue({
        id: GROUP_ID,
        ...groupSeed,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
    },
    proposalGroupMember: {
      aggregate: jest.fn().mockResolvedValue({ _max: { memberOrder: null } }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({
        id: '30000000-0000-4000-8000-000000000005',
      }),
      update: jest.fn(),
    },
    proposal: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => ({
        ...data,
        id: '30000000-0000-4000-8000-000000000006',
        status: 'DRAFT',
      })),
      update: jest.fn(),
    },
    entityRegistry: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    task: { findMany: jest.fn().mockResolvedValue([]) },
    designDoc: { findMany: jest.fn().mockResolvedValue([]) },
    conversation: { findUnique: jest.fn().mockResolvedValue(null) },
    message: { create: jest.fn() },
  };
  const prisma = {
    db: {
      $transaction: jest.fn(async (callback) => callback(tx)),
    },
  };
  const authoringSnapshot = {
    groupId: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    lifecycle: 'BUILDING',
    currentRevision: groupSeed.revision + 1,
    members: [],
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  };
  const groupService = {
    findOneInDb: jest.fn().mockResolvedValue(authoringSnapshot),
  };
  const validationEngine = {
    assertTrackingAttachmentValid: jest.fn(),
    assertAuthoringCandidatesValid: jest.fn(),
  };
  const service = new ProposalGroupAuthoringService(
    prisma as never,
    validationEngine as never,
    groupService as never,
    { assertProjectRole: jest.fn() } as never,
    { captureAuthoring: jest.fn() } as never,
  );
  return { service, tx, authoringSnapshot, validationEngine };
}

describe('ProposalGroupAuthoringService', () => {
  it('persists durable proposal identity links in grouped authoring', async () => {
    const { service, tx, validationEngine } = createFixture({
      status: 'BUILDING',
      revision: 1,
    });
    validationEngine.assertAuthoringCandidatesValid.mockImplementation(
      mockProposalAdmission,
    );
    const targetId = '30000000-0000-4000-8000-000000000022';
    tx.proposal.findMany.mockResolvedValue([
      { id: targetId, title: 'Rejected proposal', status: 'REJECTED' },
    ]);
    const edge = {
      endpointMode: 'PROPOSAL' as const,
      targetEntityType: 'PROPOSAL' as const,
      targetEntityId: targetId,
      edgeType: 'DEPENDS_ON' as const,
    };
    await service.addMembers(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      USER_ID,
      1,
      [{ ...proposal, edges: [edge] }],
    );
    expect(tx.proposal.create.mock.calls[0][0].data.edges).toEqual([
      { ...edge, targetEntityTitle: 'Rejected proposal' },
    ]);
    expect(tx.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [targetId] },
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
        },
      }),
    );
  });
  it('accepts an edge to an unmaterialized group reservation with shared evidence', async () => {
    const { service, tx, validationEngine } = createFixture({
      status: 'BUILDING',
      revision: 1,
    });
    validationEngine.assertAuthoringCandidatesValid.mockImplementation(
      mockProposalAdmission,
    );
    const reservedId = '30000000-0000-4000-8000-000000000012';
    tx.proposalGroupMember.findMany.mockResolvedValue([
      {
        reservedTargetEntityId: reservedId,
        proposal: { targetEntityType: 'TASK', updates: { type: 'FEATURE' } },
      },
    ]);
    tx.proposalGroupMember.aggregate.mockResolvedValue({
      _max: { memberOrder: 3 },
    });
    await service.addMembers(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      USER_ID,
      1,
      [
        {
          ...proposal,
          edges: [
            {
              targetEntityId: reservedId,
              targetEntityType: 'TASK',
              edgeType: 'RELATED_TO',
              targetEntityTitle: 'Reserved feature',
            },
          ],
        },
      ],
    );
    expect(tx.proposal.create.mock.calls[0][0].data.edges).toEqual([
      {
        targetEntityId: reservedId,
        targetEntityType: 'TASK',
        edgeType: 'RELATED_TO',
        targetEntityTitle: 'Reserved feature',
      },
    ]);
    expect(
      tx.proposalGroupMember.create.mock.calls[0][0].data.memberOrder,
    ).toBe(4);
  });

  it('shares origin and reference reads across the batch, preserving reservations and order', async () => {
    const { service, tx, validationEngine } = createFixture({
      status: 'BUILDING',
      revision: 1,
    });
    validationEngine.assertAuthoringCandidatesValid.mockImplementation(
      mockProposalAdmission,
    );
    const referenceId = '30000000-0000-4000-8000-000000000010';
    const conversationId = '30000000-0000-4000-8000-000000000011';
    tx.conversation.findUnique.mockResolvedValue({
      workflowAboutId: referenceId,
      workflowAboutType: 'task',
    });
    tx.task.findMany.mockResolvedValue([
      {
        id: referenceId,
        name: 'Shared feature',
        type: 'FEATURE',
        projectId: PROJECT_ID,
      },
    ]);
    tx.entityRegistry.findMany.mockResolvedValue([
      {
        entityId: referenceId,
        entityType: 'TASK',
        entityName: 'Shared feature',
      },
    ]);
    const members = Array.from({ length: 5 }, (_, index) => ({
      ...proposal,
      title: `Draft ${index}`,
      conversationId,
      influences: [
        {
          entityId: referenceId,
          entityType: EntityType.Task,
          reasoning: 'Evidence',
          reasonType: 'derived' as const,
        },
      ],
      edges: [
        {
          targetEntityId: referenceId,
          targetEntityType: 'TASK' as const,
          edgeType: 'RELATED_TO' as const,
        },
      ],
    }));
    await service.addMembers(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      USER_ID,
      1,
      members,
    );
    expect(tx.conversation.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.task.findMany).toHaveBeenCalledTimes(1);
    expect(
      validationEngine.assertAuthoringCandidatesValid,
    ).toHaveBeenCalledTimes(1);
    const admission =
      validationEngine.assertAuthoringCandidatesValid.mock.calls[0][0];
    expect(
      new Set(
        admission.context.group.reservedEntities.map(
          (entity: { entityId: string }) => entity.entityId,
        ),
      ).size,
    ).toBe(5);
    for (let index = 0; index < members.length; index++) {
      const persisted = tx.proposal.create.mock.calls[index][0].data;
      expect(persisted.title).toBe(`Draft ${index}`);
      expect(persisted.targetEntityId).toBe(
        admission.proposals[index].targetEntityId,
      );
      expect(persisted.influences).toEqual([
        expect.objectContaining({
          entityTitle: 'Shared feature',
          taskType: 'FEATURE',
          reasonType: 'derived',
        }),
        expect.objectContaining({
          entityTitle: 'Shared feature',
          taskType: 'FEATURE',
          reasonType: 'origin',
        }),
      ]);
      expect(
        tx.proposalGroupMember.create.mock.calls[index][0].data,
      ).toMatchObject({
        memberOrder: index,
        reservedTargetEntityId: persisted.targetEntityId,
        executionState: 'PENDING_APPROVAL',
      });
    }
    expect(tx.proposalGroup.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.message.create).not.toHaveBeenCalled();
    // Evidence belongs only to this operation, including null origins.
    tx.conversation.findUnique.mockResolvedValue(null);
    await service.addMembers(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      USER_ID,
      1,
      members,
    );
    expect(tx.conversation.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.task.findMany).toHaveBeenCalledTimes(2);
    expect(tx.proposal.create.mock.calls[5][0].data.influences).toHaveLength(1);
  });

  it('starts at the persisted initial revision and returns its canonical snapshot', async () => {
    const snapshot = {
      groupId: GROUP_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      lifecycle: 'BUILDING',
      currentRevision: 1,
      members: [],
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
    };
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: PROJECT_ID }) },
      proposalGroup: {
        create: jest.fn().mockResolvedValue({ id: GROUP_ID }),
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(async (callback) => callback(tx)),
      },
    };
    const groupService = {
      findOneInDb: jest.fn().mockResolvedValue(snapshot),
    };
    const service = new ProposalGroupAuthoringService(
      prisma as never,
      {} as never,
      groupService as never,
      { assertProjectRole: jest.fn() } as never,
      { captureAuthoring: jest.fn() } as never,
    );

    await expect(
      service.start(ORGANIZATION_ID, PROJECT_ID, {
        originatingMessageId: '30000000-0000-4000-8000-000000000099',
      } as any),
    ).resolves.toEqual(snapshot);

    expect(tx.proposalGroup.create).toHaveBeenCalledWith({
      data: {
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        conversationId: null,
        messageId: null,
        status: 'BUILDING',
        revision: 1,
      },
      select: { id: true },
    });
    expect(groupService.findOneInDb).toHaveBeenCalledWith(
      tx,
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
    );
  });

  it('rejects a stale revision before any member data is written', async () => {
    const { service, tx } = createFixture({
      status: 'BUILDING',
      revision: 2,
    });

    await expect(
      service.addMember(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, {
        expectedRevision: 1,
        proposal,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.proposal.create).not.toHaveBeenCalled();
    expect(tx.proposalGroupMember.create).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });

  it('rejects member writes after the group leaves BUILDING', async () => {
    const { service, tx } = createFixture({
      status: 'REVIEWABLE',
      revision: 2,
    });

    await expect(
      service.addMember(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, {
        expectedRevision: 2,
        proposal,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.proposal.create).not.toHaveBeenCalled();
    expect(tx.proposalGroupMember.create).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });

  it('preflights every batch member with all CREATE reservations before writing', async () => {
    const { service, tx, validationEngine } = createFixture({
      status: 'BUILDING',
      revision: 1,
    });
    const errors = [
      {
        field: 'proposals[0].updates.name',
        code: 'required',
        reason: 'name is required',
        layer: 'structural',
      },
      {
        field: 'proposals[1].title',
        code: 'required',
        reason: 'title is required',
        layer: 'structural',
      },
    ];
    validationEngine.assertAuthoringCandidatesValid.mockRejectedValueOnce(
      new BadRequestException({
        message: 'Proposal authoring validation failed',
        errors,
      }),
    );

    await expect(
      service.addMembers(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, 1, [
        proposal,
        { ...proposal, title: 'Second draft' },
      ]),
    ).rejects.toMatchObject({ response: { errors } });

    expect(
      validationEngine.assertAuthoringCandidatesValid,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        proposals: expect.arrayContaining([
          expect.objectContaining({ targetEntityType: 'DESIGN_DOC' }),
          expect.objectContaining({ targetEntityType: 'DESIGN_DOC' }),
        ]),
        context: expect.objectContaining({
          group: expect.objectContaining({
            reservedEntities: expect.arrayContaining([
              expect.objectContaining({ entityType: 'DESIGN_DOC' }),
              expect.objectContaining({ entityType: 'DESIGN_DOC' }),
            ]),
          }),
        }),
      }),
    );
    expect(tx.proposal.create).not.toHaveBeenCalled();
    expect(tx.proposalGroupMember.create).not.toHaveBeenCalled();
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it('rejects a VERSIONED_UPDATE field error before persisting a group member or carrier message', async () => {
    const { service, tx, validationEngine } = createFixture({
      status: 'BUILDING',
      revision: 1,
    });
    validationEngine.assertAuthoringCandidatesValid.mockRejectedValueOnce(
      new BadRequestException({
        message: 'Proposal authoring validation failed',
        errors: [
          {
            field: 'proposals[0].updates',
            code: 'invalid_future_revision',
            reason: 'Future revisions cannot change status.',
            layer: 'referential',
          },
        ],
      }),
    );
    const targetEntityId = '30000000-0000-4000-8000-000000000007';
    const versionedUpdate = {
      ...proposal,
      action: 'VERSIONED_UPDATE',
      targetEntityId,
      targetEntityType: 'TASK',
      updates: {
        operation: 'REVISE',
        futureId: '30000000-0000-4000-8000-000000000008',
        expectedRevision: 0,
        baseline: {
          kind: 'LIVE',
          revision: 'live-revision-1',
          content: {
            id: targetEntityId,
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            name: 'Current task',
            type: 'FEATURE',
            status: 'BACKLOG',
            source: 'user',
            sections: [],
          },
        },
        result: {
          id: targetEntityId,
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          name: 'Future task',
          type: 'FEATURE',
          status: 'ACTIVE',
          source: 'user',
          sections: [],
        },
        dependencies: [],
      },
    };

    await expect(
      service.addMembers(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, 1, [
        versionedUpdate as never,
      ]),
    ).rejects.toMatchObject({
      response: {
        errors: [
          expect.objectContaining({
            reason: expect.stringContaining('status'),
          }),
        ],
      },
    });

    expect(
      validationEngine.assertAuthoringCandidatesValid,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        proposals: [
          expect.objectContaining({
            action: 'VERSIONED_UPDATE',
            targetEntityType: 'TASK',
            updates: expect.objectContaining({
              result: expect.objectContaining({ status: 'ACTIVE' }),
            }),
          }),
        ],
      }),
    );
    expect(tx.proposal.create).not.toHaveBeenCalled();
    expect(tx.proposalGroupMember.create).not.toHaveBeenCalled();
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });

  it('rejects malformed graph operations before persisting a group member', async () => {
    const { service, tx } = createFixture({
      status: 'BUILDING',
      revision: 1,
    });
    const malformedGraphProposal = {
      ...proposal,
      action: 'UPDATE' as const,
      targetEntityId: '30000000-0000-4000-8000-000000000010',
      targetEntityType: 'TASK' as const,
      updates: {
        root: {
          refType: 'existing' as const,
          id: '30000000-0000-4000-8000-000000000010',
        },
        operations: [
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'branch' },
            source: {
              refType: 'existing',
              id: '30000000-0000-4000-8000-000000000011',
            },
            target: {
              refType: 'existing',
              id: '30000000-0000-4000-8000-000000000012',
            },
            edgeType: 'CONDITIONAL',
            category: 'flow',
            direction: 'forward',
          },
        ],
      },
    };

    await expect(
      service.addMember(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, {
        expectedRevision: 1,
        proposal: malformedGraphProposal as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.proposal.create).not.toHaveBeenCalled();
    expect(tx.proposalGroupMember.create).not.toHaveBeenCalled();
  });

  it('rejects an unresolved edge even when its title was supplied before persisting a group member', async () => {
    const { service, tx } = createFixture({
      status: 'BUILDING',
      revision: 1,
    });
    const invalidEdgeProposal = {
      ...proposal,
      edges: [
        {
          targetEntityId: '30000000-0000-4000-8000-000000000010',
          targetEntityType: 'TASK' as const,
          targetEntityTitle: 'Caller-supplied but unverified',
          edgeType: 'RELATED_TO' as const,
        },
      ],
    };

    await expect(
      service.addMember(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, {
        expectedRevision: 1,
        proposal: invalidEdgeProposal as never,
      }),
    ).rejects.toMatchObject({
      response: {
        errors: [
          expect.objectContaining({
            field: 'edges[0].targetEntityId',
            code: 'unresolved_reference',
          }),
        ],
      },
    });

    expect(tx.proposal.create).not.toHaveBeenCalled();
    expect(tx.proposalGroupMember.create).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });

  it('rejects moving a Message-owned grouped Proposal to another Conversation', async () => {
    const { service, tx } = createFixture({
      status: 'BUILDING',
      revision: 2,
    });
    tx.proposalGroupMember.findFirst = jest.fn().mockResolvedValue({
      id: '30000000-0000-4000-8000-000000000005',
      proposalId: '30000000-0000-4000-8000-000000000006',
      reservedTargetEntityId: null,
      proposal: {
        ...proposal,
        id: '30000000-0000-4000-8000-000000000006',
        conversationId: '30000000-0000-4000-8000-000000000007',
        messageId: '30000000-0000-4000-8000-000000000008',
      },
    });
    await expect(
      service.updateMember(
        ORGANIZATION_ID,
        PROJECT_ID,
        GROUP_ID,
        '30000000-0000-4000-8000-000000000005',
        USER_ID,
        {
          expectedRevision: 2,
          proposal: {
            ...proposal,
            conversationId: '30000000-0000-4000-8000-000000000009',
          },
        },
      ),
    ).rejects.toThrow(
      'A Message-owned Proposal cannot be moved to another Conversation',
    );

    expect(tx.proposal.update).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });

  it('persists an inert CREATE proposal, reservation, membership, and revision atomically', async () => {
    const { service, tx, authoringSnapshot } = createFixture({
      status: 'BUILDING',
      revision: 1,
    });

    await expect(
      service.addMember(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, {
        expectedRevision: 1,
        proposal: { ...proposal, eli5: 'Explains the grouped change.' },
      }),
    ).resolves.toEqual(authoringSnapshot);

    const proposalData = tx.proposal.create.mock.calls[0]![0].data;
    expect(proposalData.eli5).toBe('Explains the grouped change.');
    expect(proposalData.status).toBeUndefined();
    expect(proposalData.targetEntityId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(tx.proposalGroupMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        groupId: GROUP_ID,
        memberOrder: 0,
        reservedTargetEntityId: proposalData.targetEntityId,
        executionState: 'PENDING_APPROVAL',
      }),
    });
    expect(tx.proposalGroup.updateMany).toHaveBeenCalledWith({
      where: { id: GROUP_ID, status: 'BUILDING', revision: 1 },
      data: { revision: { increment: 1 } },
    });
    expect('proposalApprovalRecord' in tx).toBe(false);
    expect('pendingProposalEdge' in tx).toBe(false);
  });

  it('uses the persisted reservation as the target of a grouped work-item-type CREATE', async () => {
    const { service, tx, authoringSnapshot } = createFixture({
      status: 'BUILDING',
      revision: 1,
    });

    await expect(
      service.addMember(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, USER_ID, {
        expectedRevision: 1,
        proposal: {
          ...proposal,
          targetEntityId: NIL_UUID,
          targetEntityType: 'WORK_ITEM_TYPE',
          title: 'Research',
          updates: {
            key: 'RESEARCH',
            name: 'Research',
            role: 'project-info',
            sections: [],
            allowedStatuses: ['ACTIVE'],
            allowedParentTypes: ['FEATURE'],
          },
        },
      }),
    ).resolves.toEqual(authoringSnapshot);

    const proposalData = tx.proposal.create.mock.calls[0]![0].data;
    const membershipData = tx.proposalGroupMember.create.mock.calls[0]![0].data;
    expect(proposalData.targetEntityId).toBe(
      membershipData.reservedTargetEntityId,
    );
    expect(proposalData.targetEntityId).not.toBe(NIL_UUID);
    expect(proposalData.updates).toMatchObject({
      allowedParentEntityTypes: [EntityType.Task],
    });
  });

  it('rejects starting a group outside the organization/project scope', async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(async (callback) => callback(tx)),
      },
    };
    const service = new ProposalGroupAuthoringService(
      prisma as never,
      {} as never,
      {} as never,
      { assertProjectRole: jest.fn() } as never,
      { captureAuthoring: jest.fn() } as never,
    );

    await expect(
      service.start(ORGANIZATION_ID, PROJECT_ID, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
