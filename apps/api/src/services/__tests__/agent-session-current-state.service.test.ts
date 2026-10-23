import {
  AgentSessionCurrentState,
  AgentSessionCurrentStateObservation,
} from '../../generated';
import { AgentSessionService } from '../agent-session.service';

describe('AgentSessionService current-state boundary', () => {
  const session = {
    id: 'session-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    userId: 'user-1',
    machineId: 'machine-1',
    conversationId: 'conversation-1',
  };

  function makeHarness() {
    const prisma = {
      db: {
        agentSession: {
          findFirst: jest.fn().mockResolvedValue(session),
          findMany: jest.fn().mockResolvedValue([{ id: session.id }]),
        },
      },
    };
    const projection = {
      observe: jest.fn().mockResolvedValue({ outcome: 'duplicate' }),
      read: jest.fn(),
      readMany: jest.fn(),
      disconnect: jest.fn().mockResolvedValue(1),
    };
    const service = new AgentSessionService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      projection as any,
    );
    return { service, prisma, projection };
  }

  it('rejects an observation when any authenticated binding differs', async () => {
    const { service, projection } = makeHarness();
    const observation: AgentSessionCurrentStateObservation = {
      agentSessionId: session.id,
      currentState: AgentSessionCurrentState.Thinking,
      observedAt: '2026-08-07T12:00:00.000Z',
    };

    await expect(
      service.observeCurrentState(
        {
          connectionId: 'socket-1',
          userId: session.userId,
          machineId: 'different-machine',
          organizationIds: [session.organizationId],
          projectIds: [session.projectId],
        },
        observation,
      ),
    ).rejects.toThrow('runtime observation denied');
    expect(projection.observe).not.toHaveBeenCalled();
  });

  it('passes durable scope and the authenticated socket owner to the projection', async () => {
    const { service, projection } = makeHarness();
    const observation: AgentSessionCurrentStateObservation = {
      agentSessionId: session.id,
      currentState: AgentSessionCurrentState.Writing,
      observedAt: '2026-08-07T12:00:00.000Z',
    };

    await service.observeCurrentState(
      {
        connectionId: 'socket-1',
        userId: session.userId,
        machineId: session.machineId,
        organizationIds: [session.organizationId],
        projectIds: [session.projectId],
      },
      observation,
    );

    expect(projection.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: session.id,
        organizationId: session.organizationId,
        projectId: session.projectId,
        userId: session.userId,
        machineId: session.machineId,
        connectionId: 'socket-1',
        conversationId: session.conversationId,
      }),
      observation.currentState,
      observation.observedAt,
    );
  });

  it('returns only projected values for authorized sessions and preserves cache absence', async () => {
    const { service, projection } = makeHarness();
    projection.readMany.mockResolvedValue(
      new Map([
        [
          session.id,
          {
            schemaVersion: 1,
            agentSessionId: session.id,
            organizationId: session.organizationId,
            projectId: session.projectId,
            userId: session.userId,
            machineId: session.machineId,
            currentState: AgentSessionCurrentState.PlanReady,
            revision: 3,
            transitionedAt: '2026-08-07T12:00:00.000Z',
            observedAt: '2026-08-07T12:00:00.000Z',
            observedAtMs: 1780000000000,
          },
        ],
      ]),
    );

    const result = await service.readCurrentStateBatch(
      session.organizationId as any,
      session.projectId as any,
      [session.id, 'missing-session'],
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        agentSessionId: session.id,
        currentState: AgentSessionCurrentState.PlanReady,
        revision: 3,
      }),
    ]);
    expect(projection.readMany).toHaveBeenCalledWith([session.id]);
  });
});
