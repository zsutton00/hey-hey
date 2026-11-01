import { ConflictException } from '@nestjs/common';
import type { ConversationStartRunRequestDto } from 'src/generated';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProposalAgentFixService } from '../proposal-agent-fix.service';

const organizationId = '00000000-0000-4000-8000-000000000001' as OrganizationId;
const projectId = '00000000-0000-4000-8000-000000000002' as ProjectId;
const userId = '00000000-0000-4000-8000-000000000003' as UserId;
const proposalId = '00000000-0000-4000-8000-000000000004';
const proposal = {
  id: proposalId,
  organizationId,
  projectId,
  action: 'UPDATE',
  status: 'PENDING',
  targetEntityId: '00000000-0000-4000-8000-000000000005',
  targetEntityType: 'TASK',
  title: 'Mark task complete',
  updates: { status: 'COMPLETED' },
};

function setup(status = 'RECONCILIATION_REQUIRED') {
  const prisma = {
    db: {
      proposal: { findFirst: jest.fn().mockResolvedValue(proposal) },
      agentSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
      },
    },
  };
  const proposals = {
    currentReconciliationProposal: jest.fn(
      async (value: typeof proposal) => value,
    ),
    reconciliationState: jest.fn().mockResolvedValue({ status }),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue({ id: 'session-1' }),
    createConversationForSession: jest
      .fn()
      .mockResolvedValue({ conversation: { id: 'conversation-1' } }),
    startRun: jest.fn(),
  };
  const service = new ProposalAgentFixService(
    prisma as never,
    proposals as never,
    sessions as never,
  );
  return { service, prisma, proposals, sessions };
}

describe('ProposalAgentFixService.record', () => {
  it('records a proposal-refiner session and conversation without starting anything', async () => {
    const { service, sessions } = setup();
    const request = await service.record(
      organizationId,
      projectId,
      userId,
      proposalId,
    );
    expect(sessions.create).toHaveBeenCalledWith(
      organizationId,
      projectId,
      userId,
      expect.objectContaining({
        type: 'PROPOSAL_REFINING',
        entityType: 'PROPOSAL',
        entityId: proposalId,
      }),
    );
    expect(request).toMatchObject({
      agentSessionId: 'session-1',
      conversationId: 'conversation-1',
      payload: {
        promptType: 'proposal_refiner',
        entity: { entityType: 'PROPOSAL', entityId: proposalId },
        proposal: { id: proposalId, updates: { status: 'COMPLETED' } },
      },
    });
    expect(sessions.startRun).not.toHaveBeenCalled();
    expect(request.payload).not.toHaveProperty('machineId');
  });

  it('records latest reviewed content while retaining the originating proposal launch identity', async () => {
    const { service, proposals } = setup();
    proposals.currentReconciliationProposal.mockResolvedValue({
      ...proposal,
      id: 'latest-review',
      updates: { status: 'ACTIVE' },
    });
    const request = await service.record(
      organizationId,
      projectId,
      userId,
      proposalId,
    );
    expect(request.proposalId).toBe(proposalId);
    expect(request.payload.entity.entityId).toBe(proposalId);
    expect(request.payload.proposal.updates).toEqual({ status: 'ACTIVE' });
  });
  it('rejects a proposal that needs no reconciliation', async () => {
    const { service, sessions } = setup('CURRENT');
    await expect(
      service.record(organizationId, projectId, userId, proposalId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('reuses the caller’s still-unstarted session on repeat requests', async () => {
    const { service, prisma, sessions } = setup('AGENT_FIX_REQUIRED');
    prisma.db.agentSession.findFirst.mockResolvedValue({
      id: 'session-0',
      conversationId: 'conversation-0',
      createdAt: new Date('2026-10-23T00:00:00.000Z'),
    });
    const request = await service.record(
      organizationId,
      projectId,
      userId,
      proposalId,
    );
    expect(sessions.create).not.toHaveBeenCalled();
    expect(request).toMatchObject({
      agentSessionId: 'session-0',
      conversationId: 'conversation-0',
      createdAt: '2026-10-23T00:00:00.000Z',
    });
  });
});

describe('ProposalAgentFixService.assertStartRun', () => {
  const session = {
    type: 'PROPOSAL_REFINING',
    userId,
    organizationId,
    projectId,
    entityType: 'PROPOSAL',
    entityId: proposalId,
    conversationId: 'conversation-1',
  };

  async function startWith(overrides: Partial<ConversationStartRunRequestDto>) {
    const { service, prisma } = setup();
    prisma.db.agentSession.findUnique.mockResolvedValue(session);
    const recorded = await service.record(
      organizationId,
      projectId,
      userId,
      proposalId,
    );
    return service.assertStartRun({
      organizationId,
      projectId,
      userId,
      conversationId: 'conversation-1',
      requestDto: {
        agentSessionId: 'session-1',
        handlerPromptType: 'proposal_refiner',
        payload: recorded.payload,
        contextMetadata: {
          agentSessionId: 'session-1',
          organizationId,
          projectId,
        },
        ...overrides,
      } as ConversationStartRunRequestDto,
    });
  }

  it('admits a start carrying exactly the recorded input', async () => {
    await expect(startWith({})).resolves.toBe(true);
  });

  it('rejects a start with different input or a repository scope', async () => {
    await expect(
      startWith({ payload: { promptType: 'proposal_refiner' } as never }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      startWith({ serviceIds: ['00000000-0000-4000-8000-000000000009'] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ignores sessions that are not Agent fix sessions', async () => {
    const { service, prisma } = setup();
    prisma.db.agentSession.findUnique.mockResolvedValue({
      ...session,
      type: 'CODING',
    });
    await expect(
      service.assertStartRun({
        organizationId,
        projectId,
        userId,
        conversationId: 'conversation-1',
        requestDto: { agentSessionId: 'x' } as ConversationStartRunRequestDto,
      }),
    ).resolves.toBe(false);
  });
});
