import { AgentSessionContextSizeObservation } from '../../generated';
import { AgentSessionService } from '../agent-session.service';

describe('AgentSessionService context-size boundary', () => {
  const session = {
    id: 'session-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    userId: 'user-1',
    machineId: 'machine-1',
    conversationId: 'conversation-1',
  };
  const connection = {
    connectionId: 'socket-1',
    userId: session.userId,
    machineId: session.machineId,
    organizationIds: [session.organizationId],
    projectIds: [session.projectId],
  };
  const observation: AgentSessionContextSizeObservation = {
    agentSessionId: session.id,
    runId: 'run-1',
    providerSessionId: 'provider-1',
    totalTokens: 512_000,
    observedAt: '2026-10-04T00:00:00.000Z',
  };

  function makeHarness(updatedRows = 1) {
    const prisma = {
      db: {
        agentSession: {
          findFirst: jest.fn().mockResolvedValue(session),
        },
        $executeRaw: jest.fn().mockResolvedValue(updatedRows),
      },
    };
    const service = new AgentSessionService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  }

  it.each([
    ['user', { userId: 'other-user' }],
    ['machine', { machineId: 'other-machine' }],
    ['organization', { organizationIds: ['other-org'] }],
    ['project', { projectIds: ['other-project'] }],
  ])(
    'rejects a reading when the %s binding differs',
    async (_label, override) => {
      const { service, prisma } = makeHarness();

      await expect(
        service.observeContextSize({ ...connection, ...override }, observation),
      ).rejects.toThrow('runtime observation denied');
      expect(prisma.db.$executeRaw).not.toHaveBeenCalled();
    },
  );

  it('persists an authorized reading and returns the relay payload', async () => {
    const { service, prisma } = makeHarness(1);

    const result = await service.observeContextSize(connection, observation);

    expect(prisma.db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      outcome: 'applied',
      organizationId: session.organizationId,
      projectId: session.projectId,
      userId: session.userId,
      conversationId: session.conversationId,
      contextSize: {
        totalTokens: 512_000,
        runId: 'run-1',
        providerSessionId: 'provider-1',
        observedAt: '2026-10-04T00:00:00.000Z',
        maxTokens: null,
      },
    });
  });

  it('persists and relays the model context window when reported', async () => {
    const { service } = makeHarness(1);

    const result = await service.observeContextSize(connection, {
      ...observation,
      maxTokens: 258_000,
    });

    expect(result).toMatchObject({
      outcome: 'applied',
      contextSize: { totalTokens: 512_000, maxTokens: 258_000 },
    });
  });

  it('rejects a non-positive context window before writing', async () => {
    const { service, prisma } = makeHarness();

    await expect(
      service.observeContextSize(connection, { ...observation, maxTokens: 0 }),
    ).rejects.toThrow('positive integer');
    expect(prisma.db.$executeRaw).not.toHaveBeenCalled();
  });

  it('drops a reading that is not newer than the stored one', async () => {
    const { service } = makeHarness(0);

    await expect(
      service.observeContextSize(connection, observation),
    ).resolves.toEqual({ outcome: 'stale' });
  });

  it('rejects a non-integer token count before writing', async () => {
    const { service, prisma } = makeHarness();

    await expect(
      service.observeContextSize(connection, {
        ...observation,
        totalTokens: 1.5,
      }),
    ).rejects.toThrow('non-negative integer');
    expect(prisma.db.$executeRaw).not.toHaveBeenCalled();
  });

  it('maps stored columns onto AgentSessionDto.contextSize', () => {
    const { service } = makeHarness();
    const toContextSize = (
      service as unknown as {
        toContextSize: (row: Record<string, unknown>) => unknown;
      }
    ).toContextSize.bind(service);

    expect(
      toContextSize({
        contextSizeTokens: BigInt(149_999),
        contextSizeRunId: 'run-1',
        contextSizeProviderSessionId: 'provider-1',
        contextSizeObservedAt: new Date('2026-10-04T00:00:00.000Z'),
        contextSizeMaxTokens: BigInt(1_000_000),
      }),
    ).toEqual({
      totalTokens: 149_999,
      runId: 'run-1',
      providerSessionId: 'provider-1',
      observedAt: '2026-10-04T00:00:00.000Z',
      maxTokens: 1_000_000,
    });
    expect(
      toContextSize({
        contextSizeTokens: BigInt(1),
        contextSizeRunId: 'run-1',
        contextSizeProviderSessionId: 'provider-1',
        contextSizeObservedAt: new Date('2026-10-04T00:00:00.000Z'),
        contextSizeMaxTokens: null,
      }),
    ).toMatchObject({ maxTokens: null });
    expect(
      toContextSize({
        contextSizeTokens: null,
        contextSizeRunId: null,
        contextSizeProviderSessionId: null,
        contextSizeObservedAt: null,
      }),
    ).toBeNull();
  });
});
