import { ProposalToolsProvider } from '../tools/proposal-tools.provider';
import { AUTHORING_ROOT_PROOF } from '../tools/authoring-guidance';
import { guidanceTokenForType } from '../tools/work-item-guidance-token';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const GROUP_ID = '00000000-0000-4000-8000-000000000003';
const MEMBER_ID = '00000000-0000-4000-8000-000000000004';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000005';
const RESERVED_ENTITY_ID = '00000000-0000-4000-8000-000000000006';
const PARENT_ID = '00000000-0000-4000-8000-000000000008';

const makeRequest = () =>
  ({
    headers: {
      authorization: 'Bearer token',
      'x-project-id': PROJECT_ID,
      'x-message-id': '00000000-0000-4000-8000-000000000099',
    },
    user: {
      userId: '00000000-0000-4000-8000-000000000007',
      email: 'agent@example.com',
      name: 'Agent',
      currentOrgId: ORGANIZATION_ID,
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
    },
    cookies: {},
  }) as any;

const makeSnapshot = () =>
  ({
    groupId: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    lifecycle: 'BUILDING',
    currentRevision: 1,
    members: [
      {
        memberId: MEMBER_ID,
        memberOrder: 0,
        proposal: {
          type: 'SINGLE',
          action: 'CREATE',
          targetEntityId: RESERVED_ENTITY_ID,
          targetEntityType: 'TASK',
          title: 'Grouped task',
          updates: { name: 'Grouped task', type: 'STANDARD' },
        },
        reservedEntityId: RESERVED_ENTITY_ID,
        prerequisiteMemberIds: [],
      },
    ],
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:01:00.000Z',
  }) as any;

describe('ProposalToolsProvider grouped routing', () => {
  it('routes grouped CREATE through authoring and returns the reserved entity identity', async () => {
    const proposalCreate = jest.fn();
    const authoring = {
      addMember: jest.fn().mockResolvedValue(makeSnapshot()),
    };
    const prisma = {
      db: {
        task: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        designDoc: { findMany: jest.fn().mockResolvedValue([]) },
        proposalGroupMember: {
          findFirst: jest.fn().mockResolvedValue({
            proposal: {
              id: PROPOSAL_ID,
              status: 'DRAFT',
              action: 'CREATE',
              targetEntityType: 'TASK',
              targetEntityId: RESERVED_ENTITY_ID,
              updates: { name: 'Grouped task', type: 'STANDARD' },
              createdAt: new Date('2026-07-24T00:01:00.000Z'),
              updatedAt: new Date('2026-07-24T00:01:00.000Z'),
            },
          }),
        },
      },
    };
    const provider = new ProposalToolsProvider(
      { create: proposalCreate } as any,
      {} as any,
      {
        markNeedsRevision: jest.fn(),
        consumeRecovery: jest.fn().mockResolvedValue(false),
      } as any,
      await createWarmWorkItemTypeRegistry(),
      prisma as any,
      undefined,
      authoring as any,
    );

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        groupContext: { groupId: GROUP_ID, expectedRevision: 0 },
        type: 'STANDARD',
        name: 'Grouped task',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'A concise task.' },
          { key: 'acceptanceCriteria', content: '- The task is complete.' },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );
    if ((result as any).isError) {
      throw new Error(JSON.stringify(result));
    }

    expect(proposalCreate).not.toHaveBeenCalled();
    expect(authoring.addMember).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      makeRequest().user.userId,
      expect.objectContaining({ expectedRevision: 0 }),
    );
    expect(authoring.addMember.mock.calls[0][4].proposal).not.toHaveProperty(
      'messageId',
    );
    expect(result).toMatchObject({
      status: 'proposed',
      proposalId: PROPOSAL_ID,
      targetEntityId: RESERVED_ENTITY_ID,
      groupedAuthoring: {
        groupId: GROUP_ID,
        currentRevision: 1,
        member: {
          memberId: MEMBER_ID,
          reservedEntityId: RESERVED_ENTITY_ID,
        },
      },
    });
  });

  it('keeps the ungrouped response and persistence path unchanged', async () => {
    const proposalCreate = jest.fn().mockResolvedValue({
      id: PROPOSAL_ID,
      status: 'DRAFT',
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: '00000000-0000-0000-0000-000000000000',
      createdAt: '2026-07-24T00:01:00.000Z',
    });
    const authoring = { addMember: jest.fn() };
    const provider = new ProposalToolsProvider(
      { create: proposalCreate } as any,
      {} as any,
      {
        markNeedsRevision: jest.fn(),
        consumeRecovery: jest.fn().mockResolvedValue(false),
      } as any,
      await createWarmWorkItemTypeRegistry(),
      {
        db: {
          task: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          designDoc: { findMany: jest.fn().mockResolvedValue([]) },
        },
      } as any,
      undefined,
      authoring as any,
    );

    const result = await provider.createWorkItem(
      {
        eli5: 'Explains the proposed change.',
        type: 'STANDARD',
        name: 'Ungrouped task',
        parentTaskId: PARENT_ID,
        authoringRootProof: AUTHORING_ROOT_PROOF,
        sections: [
          { key: 'description', content: 'A concise task.' },
          { key: 'acceptanceCriteria', content: '- The task is complete.' },
        ],
        guidanceToken: guidanceTokenForType('STANDARD', PROJECT_ID),
      },
      {} as any,
      makeRequest(),
    );
    if ((result as any).isError) {
      throw new Error(JSON.stringify(result));
    }

    expect(proposalCreate).toHaveBeenCalledTimes(1);
    expect(proposalCreate.mock.calls[0][3]).not.toHaveProperty('messageId');
    expect(authoring.addMember).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('groupedAuthoring');
  });

  it('revises a grouped proposal through its explicit member and revision', async () => {
    const proposalUpdate = jest.fn();
    const updateMember = jest.fn().mockResolvedValue(makeSnapshot());
    const prisma = {
      db: {
        proposalGroupMember: {
          findFirst: jest.fn().mockResolvedValue({
            id: MEMBER_ID,
            proposal: {
              id: PROPOSAL_ID,
              type: 'SINGLE',
              action: 'CREATE',
              status: 'DRAFT',
              targetEntityId: RESERVED_ENTITY_ID,
              targetEntityType: 'TASK',
              title: 'Grouped task',
              updates: { name: 'Grouped task', type: 'STANDARD' },
              requestorContext: { source: 'agent' },
              influences: [],
              generatedWithVersion: null,
              validationSessionId: null,
              conversationId: null,
              messageId: '00000000-0000-4000-8000-000000000099',
              edges: [],
            },
          }),
        },
      },
    };
    const provider = new ProposalToolsProvider(
      { update: proposalUpdate } as any,
      {} as any,
      {
        markNeedsRevision: jest.fn(),
        consumeRecovery: jest.fn().mockResolvedValue(false),
      } as any,
      await createWarmWorkItemTypeRegistry(),
      prisma as any,
      undefined,
      { updateMember } as any,
    );

    const result = await provider.updateProposal(
      {
        groupContext: { groupId: GROUP_ID, expectedRevision: 0 },
        authoringRootProof: AUTHORING_ROOT_PROOF,
        proposalId: PROPOSAL_ID,
        updates: { name: 'Revised grouped task' },
      },
      {} as any,
      makeRequest(),
    );

    expect(proposalUpdate).not.toHaveBeenCalled();
    expect(updateMember).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      GROUP_ID,
      MEMBER_ID,
      makeRequest().user.userId,
      expect.objectContaining({
        expectedRevision: 0,
        proposal: expect.objectContaining({
          targetEntityId: RESERVED_ENTITY_ID,
          updates: { name: 'Revised grouped task' },
        }),
      }),
    );
    expect(updateMember.mock.calls[0][5].proposal).not.toHaveProperty(
      'messageId',
    );
    expect(result).toMatchObject({
      id: PROPOSAL_ID,
      groupedAuthoring: {
        groupId: GROUP_ID,
        member: { memberId: MEMBER_ID },
      },
    });
  });
});
