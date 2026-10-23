import { ConflictException } from '@nestjs/common';
import type { ProposalGroupDependency } from '@prisma/client';
import type { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProposalGroupFinalizationService } from '../proposal-group-finalization.service';
import {
  createDefaultProjectApprovalPolicy,
  ProjectApprovalPolicyService,
  type ProjectApprovalPolicy,
} from '../project-approval-policy.service';

const ORGANIZATION_ID =
  '20000000-0000-4000-8000-000000000001' as OrganizationId;
const PROJECT_ID = '20000000-0000-4000-8000-000000000002' as ProjectId;
const GROUP_ID = '20000000-0000-4000-8000-000000000003';
const MEMBER_ID = '20000000-0000-4000-8000-000000000004';
const PROPOSAL_ID = '20000000-0000-4000-8000-000000000005';
const RESERVED_ID = '20000000-0000-4000-8000-000000000006';
const USER_ID = '20000000-0000-4000-8000-000000000007' as UserId;
const SECOND_MEMBER_ID = '20000000-0000-4000-8000-000000000008';
const SECOND_PROPOSAL_ID = '20000000-0000-4000-8000-000000000009';
const SECOND_RESERVED_ID = '20000000-0000-4000-8000-000000000010';
const CONVERSATION_ID = '20000000-0000-4000-8000-000000000011';
const EXPLICIT_MESSAGE_ID = '20000000-0000-4000-8000-000000000012';
const TRACKING_SOURCE_ID = '20000000-0000-4000-8000-000000000013';
const FOREIGN_GROUP_ID = '20000000-0000-4000-8000-000000000014';
const UNKNOWN_SOURCE_ID = '20000000-0000-4000-8000-000000000015';

const requestor = {
  userId: USER_ID,
  email: 'author@example.com',
  name: 'Author',
  currentOrgId: ORGANIZATION_ID,
  orgMemberships: [{ orgId: ORGANIZATION_ID, role: 'MEMBER' }],
  isDevAdmin: false,
  devAdminMode: false,
} as AuthenticatedUser;

function buildingGroup(options?: {
  conversationId?: string | null;
  messageId?: string | null;
  memberConversationId?: string | null;
}) {
  const now = new Date('2026-07-24T00:00:00.000Z');
  return {
    id: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: options?.conversationId ?? null,
    messageId: options?.messageId ?? null,
    status: 'BUILDING',
    revision: 3,
    frozenRevision: null,
    frozenAt: null,
    settledAt: null,
    createdAt: now,
    updatedAt: now,
    dependencies: [] as ProposalGroupDependency[],
    members: [
      {
        id: MEMBER_ID,
        groupId: GROUP_ID,
        proposalId: PROPOSAL_ID,
        memberOrder: 0,
        reservedTargetEntityId: RESERVED_ID,
        requiredApprovals: null,
        approvalPolicyRevision: null,
        approvalSatisfiedAt: null,
        executionState: 'PENDING_APPROVAL',
        attemptCount: 0,
        attemptId: null,
        claimToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        startedAt: null,
        completedAt: null,
        lastAttemptedAt: null,
        appliedAt: null,
        rejectedAt: null,
        invalidatedAt: null,
        failedAt: null,
        lastError: null,
        terminalReason: null,
        publicationPayload: null,
        publishedEdgeCount: 0,
        publishedPostCommitCount: 0,
        publicationCompletedAt: null,
        createdAt: now,
        updatedAt: now,
        proposal: {
          id: PROPOSAL_ID,
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          type: 'SINGLE',
          action: 'CREATE',
          status: 'DRAFT',
          targetEntityId: RESERVED_ID,
          targetEntityType: 'DESIGN_DOC',
          updates: { name: 'Draft design' },
          title: 'Draft design',
          requestorId: USER_ID,
          requestorContext: {
            source: 'user',
            toolName: 'POST /proposal-groups/:groupId/members',
          },
          influences: null,
          edges: null,
          generatedWithVersion: null,
          validationSessionId: null,
          conversationId: options?.memberConversationId ?? null,
          messageId: null,
          createdAt: now,
          updatedAt: now,
          approvalRecords: [],
        },
      },
    ],
  };
}

function createFixture(options?: {
  status?: 'BUILDING' | 'REVIEWABLE';
  proposalProjectId?: ProjectId;
  conversationId?: string | null;
  messageId?: string | null;
  memberConversationId?: string | null;
  referenceIssues?: Array<{
    code: 'MEMBER_INVALID';
    location: string;
    memberId: string;
    message: string;
  }>;
  frozenMembers?: Array<{ memberId: string; executionState: string }>;
  moduleRef?: { get: jest.Mock };
  projectApprovalPolicyService?: { resolve: jest.Mock };
  workItemTypeRegistry?: unknown;
  workItemChangeSetProjector?: unknown;
}) {
  const group = buildingGroup(options);
  group.members[0]!.proposal.projectId =
    options?.proposalProjectId ?? PROJECT_ID;
  const seed = {
    id: GROUP_ID,
    status: options?.status ?? 'BUILDING',
    revision: 3,
  };
  const tx = {
    proposalReconciliationReplacement: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    proposalGroup: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(seed)
        .mockResolvedValueOnce(group),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    proposal: {
      updateMany: jest
        .fn()
        .mockImplementation((args: { where: { id: { in: string[] } } }) =>
          Promise.resolve({ count: args.where.id.in.length }),
        ),
    },
    proposalGroupMember: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    entityRegistry: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    task: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([{ userId: USER_ID }]),
    },
    conversation: {
      findFirst: jest.fn().mockResolvedValue({ id: CONVERSATION_ID }),
    },
    message: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    db: {
      $transaction: jest.fn(async (callback) => callback(tx)),
    },
  };
  const validationEngine = {
    validate: jest.fn().mockResolvedValue({
      valid: true,
      proposals: [{ index: 0, valid: true, errors: [], warnings: [] }],
    }),
  };
  const referenceValidation = {
    validate: jest.fn().mockReturnValue({
      issues: options?.referenceIssues ?? [],
      referencesByMemberId: new Map(),
    }),
  };
  const authoringSnapshot = {
    groupId: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    lifecycle: 'BUILDING',
    currentRevision: 3,
    members: [],
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  };
  const frozenSnapshot = {
    groupId: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    lifecycle: 'REVIEWABLE',
    currentRevision: 3,
    frozenRevision: 3,
    frozenAt: '2026-07-24T00:00:00.000Z',
    settledAt: null,
    members: options?.frozenMembers ?? [],
    dependencies: [],
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  };
  const groupService = {
    toAuthoringSnapshot: jest.fn().mockReturnValue(authoringSnapshot),
    findOneInDb: jest.fn().mockResolvedValue(frozenSnapshot),
  };
  const moduleRef = options?.moduleRef ?? { get: jest.fn() };
  const projectApprovalPolicyService =
    options?.projectApprovalPolicyService ?? new ProjectApprovalPolicyService();
  const service = new ProposalGroupFinalizationService(
    prisma as never,
    validationEngine as never,
    referenceValidation as never,
    groupService as never,
    moduleRef as never,
    projectApprovalPolicyService as never,
    undefined,
    options?.workItemTypeRegistry as never,
    options?.workItemChangeSetProjector as never,
  );
  return {
    service,
    group,
    tx,
    validationEngine,
    referenceValidation,
    authoringSnapshot,
    projectApprovalPolicyService,
  };
}

function configureTrackedTask(
  fixture: ReturnType<typeof createFixture>,
  sourceEntityId: string,
) {
  fixture.group.members[0]!.proposal.targetEntityType = 'TASK';
  fixture.group.members[0]!.proposal.action = 'CREATE';
  fixture.group.members[0]!.proposal.updates = {
    name: 'Tracked task',
    type: 'STANDARD',
  } as any;
  fixture.group.members[0]!.proposal.edges = [
    {
      targetEntityId: sourceEntityId,
      targetEntityType: 'TASK',
      edgeType: 'TRACKS',
      description: 'Tracks the newly created work item',
    },
  ] as any;
  fixture.referenceValidation.validate.mockReturnValue({
    issues: [],
    referencesByMemberId: new Map([
      [
        MEMBER_ID,
        [
          {
            entityId: sourceEntityId,
            entityType: 'TASK',
            location: '/members/0/proposal/edges/0/targetEntityId',
          },
        ],
      ],
    ]),
  });
}

describe('ProposalGroupFinalizationService', () => {
  it('requires fresh review for a replacement even when ordinary policy permits automatic application', async () => {
    const { service, tx } = createFixture();
    tx.proposalReconciliationReplacement.findFirst.mockResolvedValue({
      groupId: FOREIGN_GROUP_ID,
      sourceState: [],
    } as never);
    const result = await service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );
    expect(result.outcome).toBe('FINALIZED');
    expect(tx.proposalGroupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requiredApprovals: 1,
          executionState: 'PENDING_APPROVAL',
          approvalSatisfiedAt: null,
        }),
      }),
    );
    expect(tx.proposalGroupMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          groupId: FOREIGN_GROUP_ID,
          executionState: { not: 'APPLIED' },
        },
        data: expect.objectContaining({ executionState: 'INVALIDATED' }),
      }),
    );
  });

  it('projects grouped graph changes with reserved CREATE identities and excludes prerequisites', async () => {
    const projector = { projectTopology: jest.fn() };
    const semantics = {
      isFeature: (node: any) => node.type === 'FEATURE',
      isWorkflow: (node: any) => node.type === 'workflow',
      isWorkflowStep: (node: any) => node.type === 'workflow_step',
      isContract: (node: any) => node.type === 'CONTRACT',
      isFulfillment: (edge: any) => edge.edgeType === 'FULFILLED_BY',
      isContractDependency: (edge: any) => edge.edgeType === 'DEPENDS_ON',
      isFlow: (edge: any) => edge.category === 'flow',
    };
    const registry = {
      getProjectedTopologySemantics: jest.fn().mockReturnValue(semantics),
    };
    const { service, group } = createFixture({
      workItemTypeRegistry: registry,
      workItemChangeSetProjector: projector,
    });
    group.members[0]!.proposal.targetEntityType = 'TASK';
    group.members[0]!.proposal.action = 'CREATE';
    group.members[0]!.proposal.updates = {
      type: 'CONTRACT',
      name: 'Reserved Contract',
    } as any;
    const graphMember = structuredClone(group.members[0]!);
    graphMember.id = SECOND_MEMBER_ID;
    graphMember.proposal.id = SECOND_PROPOSAL_ID;
    graphMember.proposal.action = 'UPDATE';
    graphMember.proposal.edges = [
      {
        endpointMode: 'PROPOSAL',
        targetEntityType: 'PROPOSAL',
        targetEntityId: PROPOSAL_ID,
        edgeType: 'DEPENDS_ON',
      },
    ] as any;
    graphMember.proposal.targetEntityId = SECOND_RESERVED_ID;
    graphMember.proposal.updates = {
      root: { refType: 'existing', id: SECOND_RESERVED_ID },
      operations: [],
    } as any;
    group.members.push(graphMember);
    projector.projectTopology.mockImplementation(async (input: any) => {
      const contract = input.overlayNodes.find(
        (node: any) => node.identity.id === RESERVED_ID,
      );
      expect(contract).toMatchObject({ type: 'CONTRACT' });
      const workflow = {
        identity: { refType: 'existing', id: SECOND_RESERVED_ID },
        label: 'Workflow',
        name: 'Workflow',
        type: 'workflow',
        sections: [],
        deleted: false,
      };
      return {
        projection: {
          valid: true,
          projectedRoot: workflow,
          children: [],
          sections: [],
          incidentRelationships: [],
          identityLabels: {},
          issues: [],
        },
        nodes: [workflow, contract],
        relationships: [],
        featureContractCitations: new Map(),
        participatingFeatureByWorkflowNode: new Map(),
      };
    });

    await expect(
      (service as any).lintProjectedGroupTopology({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        members: group.members,
      }),
    ).resolves.toEqual([]);
    expect(projector.projectTopology).toHaveBeenCalledTimes(1);
  });

  it('captures threshold zero without a synthetic vote and initializes READY', async () => {
    const dispatchReadyMembers = jest.fn().mockResolvedValue(undefined);
    const { service, tx } = createFixture({
      frozenMembers: [{ memberId: MEMBER_ID, executionState: 'READY' }],
      moduleRef: { get: jest.fn().mockReturnValue({ dispatchReadyMembers }) },
    });

    const result = await service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result.outcome).toBe('FINALIZED');
    expect(tx.proposalGroupMember.update).toHaveBeenCalledWith({
      where: { id: MEMBER_ID },
      data: {
        requiredApprovals: 0,
        approvalPolicyRevision: null,
        approvalSatisfiedAt: expect.any(Date),
        executionState: 'READY',
      },
    });
    expect(tx.proposalGroup.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: GROUP_ID,
          status: 'BUILDING',
          revision: 3,
        }),
        data: expect.objectContaining({
          status: 'REVIEWABLE',
          frozenRevision: 3,
        }),
      }),
    );
    expect('proposalApprovalRecord' in tx).toBe(false);
    expect(tx.proposal.updateMany).not.toHaveBeenCalled();
    expect(dispatchReadyMembers).toHaveBeenCalledWith({
      memberIds: [MEMBER_ID],
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
    });
  });

  it('resolves the project policy once and captures it for every member', async () => {
    const projectPolicy: ProjectApprovalPolicy =
      createDefaultProjectApprovalPolicy(3);
    const projectApprovalPolicyService = {
      resolve: jest.fn().mockResolvedValue(projectPolicy),
    };
    const fixture = createFixture({ projectApprovalPolicyService });
    fixture.tx.projectMember.findMany.mockResolvedValue([
      { userId: USER_ID },
      { userId: '20000000-0000-4000-8000-000000000016' },
    ]);
    fixture.group.members[0]!.proposal.requestorContext = {
      source: 'agent',
      toolName: 'mcp.create_design_doc',
    };
    const secondMember = structuredClone(fixture.group.members[0]!);
    secondMember.id = SECOND_MEMBER_ID;
    secondMember.proposalId = SECOND_PROPOSAL_ID;
    secondMember.memberOrder = 1;
    secondMember.reservedTargetEntityId = SECOND_RESERVED_ID;
    secondMember.proposal.id = SECOND_PROPOSAL_ID;
    secondMember.proposal.targetEntityId = SECOND_RESERVED_ID;
    fixture.group.members.push(secondMember);

    const result = await fixture.service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result.outcome).toBe('FINALIZED');
    expect(projectApprovalPolicyService.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.tx.proposalGroupMember.update).toHaveBeenCalledTimes(2);
    expect(
      fixture.tx.proposalGroupMember.update.mock.calls.map(
        ([call]: [{ data: { requiredApprovals: number } }]) =>
          call.data.requiredApprovals,
      ),
    ).toEqual([3, 3]);
  });

  it('freezes every member without minting or assigning a carrier', async () => {
    const { service, tx, group } = createFixture({
      conversationId: CONVERSATION_ID,
    });
    const firstMember = group.members[0]!;
    group.members.push({
      ...firstMember,
      id: SECOND_MEMBER_ID,
      proposalId: SECOND_PROPOSAL_ID,
      memberOrder: 1,
      reservedTargetEntityId: SECOND_RESERVED_ID,
      proposal: {
        ...firstMember.proposal,
        id: SECOND_PROPOSAL_ID,
        targetEntityId: SECOND_RESERVED_ID,
      },
    });

    const result = await service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result.outcome).toBe('FINALIZED');
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(tx.proposal.updateMany).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REVIEWABLE',
        }),
      }),
    );
    const freezeData = tx.proposalGroup.updateMany.mock.calls[0]![0].data;
    expect(freezeData).not.toHaveProperty('messageId');
    expect(freezeData).not.toHaveProperty('conversationId');

    const memberStateOrder =
      tx.proposalGroupMember.update.mock.invocationCallOrder[0]!;
    const freezeOrder =
      tx.proposalGroup.updateMany.mock.invocationCallOrder[0]!;
    expect(memberStateOrder).toBeLessThan(freezeOrder);
  });

  it('does not derive a carrier conversation from member provenance', async () => {
    const { service, tx } = createFixture({
      memberConversationId: CONVERSATION_ID,
    });

    const result = await service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result.outcome).toBe('FINALIZED');
    expect(tx.conversation.findFirst).not.toHaveBeenCalled();
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(tx.proposal.updateMany).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REVIEWABLE',
        }),
      }),
    );
    const freezeData = tx.proposalGroup.updateMany.mock.calls[0]![0].data;
    expect(freezeData).not.toHaveProperty('messageId');
    expect(freezeData).not.toHaveProperty('conversationId');
  });

  it('reuses an explicit group message without creating another message', async () => {
    const { service, tx } = createFixture({
      conversationId: CONVERSATION_ID,
      messageId: EXPLICIT_MESSAGE_ID,
    });

    const result = await service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result.outcome).toBe('FINALIZED');
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(tx.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [PROPOSAL_ID] } },
      data: { messageId: EXPLICIT_MESSAGE_ID },
    });
    expect(tx.proposalGroup.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageId: EXPLICIT_MESSAGE_ID,
        }),
      }),
    );
  });

  it('initializes a threshold-zero dependent as waiting until its prerequisite is APPLIED', async () => {
    const { service, group, tx } = createFixture();
    const prerequisiteMemberId = '20000000-0000-4000-8000-000000000008';
    const prerequisiteProposalId = '20000000-0000-4000-8000-000000000009';
    const prerequisiteReservedId = '20000000-0000-4000-8000-000000000010';
    group.members.push({
      ...group.members[0]!,
      id: prerequisiteMemberId,
      proposalId: prerequisiteProposalId,
      memberOrder: 1,
      reservedTargetEntityId: prerequisiteReservedId,
      proposal: {
        ...group.members[0]!.proposal,
        id: prerequisiteProposalId,
        targetEntityId: prerequisiteReservedId,
      },
    });
    group.dependencies.push({
      id: '20000000-0000-4000-8000-000000000011',
      groupId: GROUP_ID,
      dependentMemberId: MEMBER_ID,
      prerequisiteMemberId,
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
    });

    await service.finalize(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, requestor, {
      expectedRevision: 3,
    });

    expect(tx.proposalGroupMember.update).toHaveBeenCalledWith({
      where: { id: MEMBER_ID },
      data: {
        requiredApprovals: 0,
        approvalPolicyRevision: null,
        approvalSatisfiedAt: expect.any(Date),
        executionState: 'WAITING_ON_DEPENDENCIES',
      },
    });
  });

  it('rejects a proposal outside the group project without freezing', async () => {
    const { service, tx } = createFixture({
      proposalProjectId: '20000000-0000-4000-8000-000000000008' as ProjectId,
      conversationId: CONVERSATION_ID,
    });

    const result = await service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'VALIDATION_FAILED',
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'MEMBER_INVALID',
            location: '/members/0/proposal',
            memberId: MEMBER_ID,
          }),
        ]),
      }),
    );
    expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
    expect(tx.proposalGroupMember.update).not.toHaveBeenCalled();
    expect(tx.proposal.updateMany).not.toHaveBeenCalled();
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it('returns all validation issues without freezing or initializing members', async () => {
    const issue = {
      code: 'MEMBER_INVALID' as const,
      location: '/members/0/prerequisiteMemberIds',
      memberId: MEMBER_ID,
      message: 'Missing prerequisite.',
    };
    const { service, tx, authoringSnapshot } = createFixture({
      referenceIssues: [issue],
    });

    const result = await service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result).toEqual({
      outcome: 'VALIDATION_FAILED',
      authoringSnapshot,
      issues: [issue],
    });
    expect(tx.proposalGroupMember.update).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a group BUILDING when a TASK CREATE member omits its type', async () => {
    const { service, group, tx, validationEngine, authoringSnapshot } =
      createFixture();
    group.members[0]!.proposal.targetEntityType = 'TASK';
    group.members[0]!.proposal.action = 'CREATE';
    group.members[0]!.proposal.updates = { name: 'Untyped task' } as any;
    validationEngine.validate.mockResolvedValue({
      valid: false,
      proposals: [
        {
          index: 0,
          valid: false,
          errors: [
            {
              field: 'proposals[0].updates.type',
              code: 'required',
              reason: 'Required',
              layer: 'structural',
            },
          ],
          warnings: [],
        },
      ],
    });

    const result = await service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result).toEqual({
      outcome: 'VALIDATION_FAILED',
      authoringSnapshot,
      issues: [
        expect.objectContaining({
          code: 'MEMBER_INVALID',
          location: '/members/0/proposal/updates/type',
          memberId: MEMBER_ID,
        }),
      ],
    });
    expect(tx.proposalGroupMember.update).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
    expect(tx.proposal.updateMany).not.toHaveBeenCalled();
  });

  it('finalizes TRACKS to a materialized goal reserved by an earlier group', async () => {
    const registry = {
      isTrackingSourceAllowed: jest.fn().mockReturnValue(true),
    };
    const fixture = createFixture({ workItemTypeRegistry: registry });
    configureTrackedTask(fixture, TRACKING_SOURCE_ID);
    fixture.tx.entityRegistry.findMany.mockImplementation(
      (args: { where: { entityId: { in: string[] } } }) =>
        Promise.resolve(
          args.where.entityId.in.includes(TRACKING_SOURCE_ID)
            ? [{ entityId: TRACKING_SOURCE_ID }]
            : [],
        ),
    );
    fixture.tx.proposalGroupMember.findMany.mockResolvedValue([
      {
        reservedTargetEntityId: TRACKING_SOURCE_ID,
        groupId: FOREIGN_GROUP_ID,
      },
    ]);
    fixture.tx.task.findFirst.mockResolvedValue({
      id: TRACKING_SOURCE_ID,
      type: 'GOAL',
    });

    const result = await fixture.service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result.outcome).toBe('FINALIZED');
    expect(registry.isTrackingSourceAllowed).toHaveBeenCalledWith(
      'STANDARD',
      'TASK',
      'GOAL',
      PROJECT_ID,
    );
    expect(fixture.tx.proposalGroup.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REVIEWABLE' }),
      }),
    );
  });

  it('keeps a group BUILDING for an unmaterialized foreign reservation', async () => {
    const registry = {
      isTrackingSourceAllowed: jest.fn(),
    };
    const fixture = createFixture({ workItemTypeRegistry: registry });
    configureTrackedTask(fixture, TRACKING_SOURCE_ID);
    fixture.tx.proposalGroupMember.findMany.mockResolvedValue([
      {
        reservedTargetEntityId: TRACKING_SOURCE_ID,
        groupId: FOREIGN_GROUP_ID,
      },
    ]);

    const result = await fixture.service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'VALIDATION_FAILED',
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'MEMBER_REFERENCE_UNRESOLVED',
            location: '/members/0/proposal/edges/0/targetEntityId',
            message:
              'Reserved identities are private to their owning proposal group.',
          }),
        ]),
      }),
    );
    expect(fixture.tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a group BUILDING for an unknown TRACKS source', async () => {
    const registry = {
      isTrackingSourceAllowed: jest.fn(),
    };
    const fixture = createFixture({ workItemTypeRegistry: registry });
    configureTrackedTask(fixture, UNKNOWN_SOURCE_ID);

    const result = await fixture.service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'VALIDATION_FAILED',
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'MEMBER_REFERENCE_UNRESOLVED',
            location: '/members/0/proposal/edges',
            message: expect.stringContaining('was not found in this project'),
          }),
        ]),
      }),
    );
    expect(fixture.tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a group BUILDING when a live TRACKS source is policy-ineligible', async () => {
    const registry = {
      isTrackingSourceAllowed: jest.fn().mockReturnValue(false),
    };
    const fixture = createFixture({ workItemTypeRegistry: registry });
    configureTrackedTask(fixture, TRACKING_SOURCE_ID);
    fixture.tx.entityRegistry.findMany.mockImplementation(
      (args: { where: { entityId: { in: string[] } } }) =>
        Promise.resolve(
          args.where.entityId.in.includes(TRACKING_SOURCE_ID)
            ? [{ entityId: TRACKING_SOURCE_ID }]
            : [],
        ),
    );
    fixture.tx.proposalGroupMember.findMany.mockResolvedValue([
      {
        reservedTargetEntityId: TRACKING_SOURCE_ID,
        groupId: FOREIGN_GROUP_ID,
      },
    ]);
    fixture.tx.task.findFirst.mockResolvedValue({
      id: TRACKING_SOURCE_ID,
      type: 'GOAL',
    });

    const result = await fixture.service.finalize(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      requestor,
      { expectedRevision: 3 },
    );

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'VALIDATION_FAILED',
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'MEMBER_INVALID',
            location: '/members/0/proposal/edges',
            message: expect.stringContaining(
              'does not allow tracking source type GOAL',
            ),
          }),
        ]),
      }),
    );
    expect(fixture.tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a concurrent finalizer after the first freeze wins', async () => {
    const { service, tx } = createFixture({ status: 'REVIEWABLE' });

    await expect(
      service.finalize(ORGANIZATION_ID, PROJECT_ID, GROUP_ID, requestor, {
        expectedRevision: 3,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.proposalGroupMember.update).not.toHaveBeenCalled();
    expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
  });
});
