import { ConversationId, UserId } from '../../../types';
import { TriggerRecipientResolver } from '../trigger-recipient-resolver.service';

describe('TriggerRecipientResolver', () => {
  const conversationId = 'conv-1' as ConversationId;

  function makeResolver() {
    const agentSessionFindFirst = jest.fn();
    const machineFindFirst = jest.fn();
    const machineFindUnique = jest.fn();
    const prisma = {
      db: {
        agentSession: { findFirst: agentSessionFindFirst },
        machine: {
          findFirst: machineFindFirst,
          findUnique: machineFindUnique,
        },
      },
    };
    return {
      resolver: new TriggerRecipientResolver(prisma as never),
      agentSessionFindFirst,
      machineFindFirst,
      machineFindUnique,
    };
  }

  it('routes a bound conversation to its persisted machine when another active machine is newer', async () => {
    const { resolver, agentSessionFindFirst, machineFindUnique } =
      makeResolver();
    agentSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      machineId: 'bound-machine',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
    const activeMachines = [
      { id: 'bound-machine', pairedAt: new Date('2026-01-01') },
      { id: 'newer-machine', pairedAt: new Date('2026-02-01') },
    ];
    machineFindUnique.mockResolvedValue({
      ...activeMachines[0],
      userId: 'user-1',
      organizationId: 'org-1',
      revokedAt: null,
      authorizationProtocolVersion: 2,
      authorizationState: 'READY',
      controllerCredentials: [{ id: 'credential-1' }],
    });

    const recipient =
      await resolver.resolveConversationRecipient(conversationId);

    expect(recipient).toEqual({
      machineId: 'bound-machine',
      userId: 'user-1',
      agentSessionId: 'session-1',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
    expect(agentSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId },
        select: {
          id: true,
          userId: true,
          machineId: true,
          projectId: true,
          organizationId: true,
        },
      }),
    );
    expect(machineFindUnique).toHaveBeenCalledWith({
      where: { id: 'bound-machine' },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        revokedAt: true,
        authorizationProtocolVersion: true,
        authorizationState: true,
        controllerCredentials: {
          where: { revokedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    });
  });

  it('does not fall back to another active machine when the bound machine is unavailable', async () => {
    const { resolver, agentSessionFindFirst, machineFindUnique } =
      makeResolver();
    agentSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      machineId: 'disconnected-machine',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
    machineFindUnique.mockResolvedValue(null);

    const recipient =
      await resolver.resolveConversationRecipient(conversationId);

    expect(recipient).toBeNull();
    expect(machineFindUnique).toHaveBeenCalledTimes(1);
    expect(machineFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'disconnected-machine' },
      }),
    );
  });

  it.each([
    ['exact_machine_missing', null],
    [
      'exact_machine_revoked',
      {
        userId: 'user-1',
        organizationId: 'org-1',
        revokedAt: new Date(),
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        controllerCredentials: [{ id: 'credential-1' }],
      },
    ],
    [
      'exact_machine_foreign',
      {
        userId: 'other-user',
        organizationId: 'org-1',
        revokedAt: null,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        controllerCredentials: [{ id: 'credential-1' }],
      },
    ],
    [
      'exact_machine_protocol_invalid',
      {
        userId: 'user-1',
        organizationId: 'org-1',
        revokedAt: null,
        authorizationProtocolVersion: 1,
        authorizationState: 'READY',
        controllerCredentials: [{ id: 'credential-1' }],
      },
    ],
    [
      'exact_machine_not_ready',
      {
        userId: 'user-1',
        organizationId: 'org-1',
        revokedAt: null,
        authorizationProtocolVersion: 2,
        authorizationState: 'CONTROLLER_ENROLLMENT_REQUIRED',
        controllerCredentials: [],
      },
    ],
    [
      'exact_machine_credential_unavailable',
      {
        userId: 'user-1',
        organizationId: 'org-1',
        revokedAt: null,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        controllerCredentials: [],
      },
    ],
  ])('preserves the %s exact-machine outcome', async (reason, machine) => {
    const { resolver, agentSessionFindFirst, machineFindUnique } =
      makeResolver();
    agentSessionFindFirst.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      machineId: 'machine-1',
      projectId: 'project-1',
      organizationId: 'org-1',
    });
    machineFindUnique.mockResolvedValue(machine);

    await expect(
      resolver.resolveExactConversationRecipient(
        conversationId,
        'machine-1' as never,
      ),
    ).resolves.toEqual({ resolved: false, reason });
  });

  it('resolves the persisted operation session instead of a newer conversation session', async () => {
    const { resolver, agentSessionFindFirst, machineFindUnique } =
      makeResolver();
    agentSessionFindFirst.mockImplementation(
      ({ where }: { where: { id?: string; conversationId: string } }) =>
        Promise.resolve(
          where.id === 'operation-session'
            ? {
                id: 'operation-session',
                userId: 'user-1',
                machineId: 'machine-1',
                projectId: 'project-1',
                organizationId: 'org-1',
              }
            : {
                id: 'newer-session',
                userId: 'user-1',
                machineId: 'machine-2',
                projectId: 'project-1',
                organizationId: 'org-1',
              },
        ),
    );
    machineFindUnique.mockResolvedValue({
      id: 'machine-1',
      userId: 'user-1',
      organizationId: 'org-1',
      revokedAt: null,
      authorizationProtocolVersion: 2,
      authorizationState: 'READY',
      controllerCredentials: [{ id: 'credential-1' }],
    });

    await expect(
      resolver.resolveExactConversationRecipient(
        conversationId,
        'machine-1' as never,
        'operation-session' as never,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        resolved: true,
        recipient: expect.objectContaining({
          agentSessionId: 'operation-session',
          machineId: 'machine-1',
        }),
      }),
    );
    expect(agentSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'operation-session', conversationId },
      }),
    );
  });

  it('falls back to the latest active machine only for an unbound session', async () => {
    const { resolver, agentSessionFindFirst, machineFindFirst } =
      makeResolver();
    agentSessionFindFirst.mockResolvedValue({
      userId: 'user-1',
      machineId: null,
    });
    machineFindFirst.mockResolvedValue({ id: 'latest-machine' });

    const recipient =
      await resolver.resolveConversationRecipient(conversationId);

    expect(recipient).toEqual({
      machineId: 'latest-machine',
      userId: 'user-1',
    });
    expect(machineFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        controllerCredentials: { some: { revokedAt: null } },
      },
      orderBy: { pairedAt: 'desc' },
      select: { id: true },
    });
  });

  it('returns null when no agent session resolves the conversation', async () => {
    const { resolver, agentSessionFindFirst, machineFindFirst } =
      makeResolver();
    agentSessionFindFirst.mockResolvedValue(null);

    const recipient =
      await resolver.resolveConversationRecipient(conversationId);

    expect(recipient).toBeNull();
    expect(machineFindFirst).not.toHaveBeenCalled();
  });

  it('returns null when the resolved user has no active paired machine', async () => {
    const { resolver, agentSessionFindFirst, machineFindFirst } =
      makeResolver();
    agentSessionFindFirst.mockResolvedValue({
      userId: 'user-1',
      machineId: null,
    });
    machineFindFirst.mockResolvedValue(null);

    const recipient =
      await resolver.resolveConversationRecipient(conversationId);

    expect(recipient).toBeNull();
  });

  it('resolves a machine for a user directly for platform-event triggers', async () => {
    const { resolver, machineFindFirst, agentSessionFindFirst } =
      makeResolver();
    machineFindFirst.mockResolvedValue({ id: 'machine-2' });

    const recipient = await resolver.resolveMachineForUser('user-2' as UserId);

    expect(recipient).toEqual({ machineId: 'machine-2', userId: 'user-2' });
    // Platform-event triggers do not join through an agent session.
    expect(agentSessionFindFirst).not.toHaveBeenCalled();
  });
});
