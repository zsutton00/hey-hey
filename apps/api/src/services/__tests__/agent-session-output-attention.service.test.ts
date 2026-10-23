import { NotFoundException } from '@nestjs/common';
import { AgentSessionOutputAttentionState } from 'src/generated';
import { AgentSessionOutputAttentionService } from '../agent-session-output-attention.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';

describe('AgentSessionOutputAttentionService', () => {
  const session = {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId:
      '22222222-2222-4222-8222-222222222222' as OrganizationId,
    projectId: '33333333-3333-4333-8333-333333333333' as ProjectId,
    userId: '44444444-4444-4444-8444-444444444444' as UserId,
    updatedAt: new Date('2026-08-12T00:00:00.000Z'),
  };

  const makeSubject = () => {
    const prisma = {
      db: {
        agentSession: {
          findMany: jest.fn().mockResolvedValue([session]),
          findFirst: jest.fn().mockResolvedValue(session),
        },
      },
    };
    const projection = {
      readMany: jest.fn().mockResolvedValue(new Map()),
      transition: jest.fn().mockImplementation(async ({ state }) => {
        const entry = {
          ...session,
          schemaVersion: 1,
          agentSessionId: session.id,
          state,
          revision: state === AgentSessionOutputAttentionState.None ? 0 : 1,
          changedAt: '2026-08-12T00:01:00.000Z',
        };
        return state === AgentSessionOutputAttentionState.None
          ? { outcome: 'duplicate', entry }
          : { outcome: 'transition', transition: { entry } };
      }),
      toItem: jest.fn((entry) => ({
        agentSessionId: entry.agentSessionId,
        state: entry.state,
        revision: entry.revision,
        changedAt: entry.changedAt,
      })),
    };
    return {
      service: new AgentSessionOutputAttentionService(
        prisma as never,
        projection as never,
      ),
      prisma,
      projection,
    };
  };

  it('returns a side-effect-free NONE baseline for an absent projection', async () => {
    const { service, projection } = makeSubject();
    await expect(
      service.readAuthorized(
        session.organizationId,
        session.projectId,
        session.userId,
        [session.id],
      ),
    ).resolves.toEqual([
      {
        agentSessionId: session.id,
        state: AgentSessionOutputAttentionState.None,
        revision: 0,
        changedAt: session.updatedAt.toISOString(),
      },
    ]);
    expect(projection.transition).not.toHaveBeenCalled();
  });

  it('sets MESSAGE_READY only for the owning authenticated user', async () => {
    const { service, prisma, projection } = makeSubject();
    await service.setReady(
      session.organizationId,
      session.projectId,
      session.userId,
      session.id,
    );
    expect(prisma.db.agentSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: session.userId }),
      }),
    );
    expect(projection.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: session.userId,
        state: AgentSessionOutputAttentionState.MessageReady,
      }),
    );
  });

  it('acknowledges an absent projection through the atomic idempotent transition', async () => {
    const { service, projection } = makeSubject();
    await expect(
      service.acknowledge(
        session.organizationId,
        session.projectId,
        session.userId,
        session.id,
      ),
    ).resolves.toMatchObject({
      state: AgentSessionOutputAttentionState.None,
      revision: 0,
    });
    expect(projection.transition).toHaveBeenCalledWith(
      expect.objectContaining({ state: AgentSessionOutputAttentionState.None }),
    );
  });

  it('does not disclose a session outside the authenticated user scope', async () => {
    const { service, prisma } = makeSubject();
    prisma.db.agentSession.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.setReady(
        session.organizationId,
        session.projectId,
        '55555555-5555-4555-8555-555555555555' as UserId,
        session.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
