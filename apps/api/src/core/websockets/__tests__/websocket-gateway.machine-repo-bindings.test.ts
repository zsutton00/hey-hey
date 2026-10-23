import { Socket } from 'socket.io';
import { UserAccessTokenValidatorService } from '../../../auth/services/user-access-token-validator.service';
import {
  MachineRepoBindingsInboundPayload,
  ServiceRepoBinding,
  WebSocketMachineRepoBindingsEvent,
} from '../../../generated';
import { ConversationId, UserId } from '../../../types';
import { PendingTriggerService } from '../../../services/workflows/pending-trigger.service';
import { AgentSessionService } from '../../../services/agent-session.service';
import { TriggerEmitter } from '../trigger-emitter.service';
import {
  MachineChallengeService,
  MachineLookup,
} from '../machine-challenge.service';
import { WebsocketConnectionManager } from '../websocket-connection-manager.service';
import { WebsocketGateway } from '../websocket.gateway';
import { MachinePresenceService } from '../machine-presence.service';

function makeHarness(
  options: {
    socketId?: string;
    machineId?: string | null;
    organizationIds?: string[];
    conversationIds?: string[];
    getConversationConnectionsResult?: Array<{
      machineId?: string;
      userId: string;
      organizationIds: string[];
    }>;
    getBindingsResult?: {
      bindings: ServiceRepoBinding[];
      organizationId: string;
      sourcingSocketId: string;
    } | null;
  } = {},
) {
  const socketId = options.socketId ?? 'socket-1';
  // null explicitly means no machineId; undefined means default (machineId present)
  const machineId =
    options.machineId === undefined ? 'machine-1' : options.machineId;
  const organizationIds = options.organizationIds ?? ['org-1'];
  const conversationIds = options.conversationIds ?? ['conv-1'];

  const mockEmitTo = jest.fn();
  const mockTo = jest.fn().mockReturnValue({ emit: mockEmitTo });
  const mockServer = { to: mockTo } as unknown as any;

  const connectionManager = {
    serializeRoomOperation: jest.fn(
      (_id: string, operation: () => Promise<unknown>) => operation(),
    ),
    addConnection: jest.fn(),
    removeConnection: jest.fn(),
    updateActivity: jest.fn(),
    addConversationSubscription: jest.fn(),
    getConnection: jest.fn().mockReturnValue(
      machineId !== null
        ? { machineId, userId: 'user-1', organizationIds, conversationIds }
        : {
            machineId: undefined,
            userId: 'user-1',
            organizationIds: ['org-1'],
            conversationIds: [],
          },
    ),
    getConversationConnections: jest
      .fn()
      .mockReturnValue(
        options.getConversationConnectionsResult ??
          (machineId !== null
            ? [{ machineId, userId: 'user-1', organizationIds }]
            : []),
      ),
  } as unknown as jest.Mocked<WebsocketConnectionManager>;

  const userAccessTokenValidator = {
    verifyAndValidate: jest.fn().mockResolvedValue({
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
    }),
  } as unknown as jest.Mocked<UserAccessTokenValidatorService>;

  const pendingTriggerService = {
    resolveOpenTriggersForUser: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<PendingTriggerService>;

  const triggerEmitter = {
    emitConversationTriggerForMessage: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<TriggerEmitter>;

  const machineChallengeService = {
    lookupMachine: jest.fn().mockResolvedValue({
      publicKey: 'pem',
      userId: 'user-1' as UserId,
      revokedAt: null,
    } as MachineLookup),
    verifyChallengeSignature: jest.fn().mockReturnValue(true),
    recordLastSeen: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MachineChallengeService>;

  const agentSessionService = {
    update: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<AgentSessionService>;

  const machinePresenceService = {
    setBindings: jest.fn().mockResolvedValue(undefined),
    getBindings: jest
      .fn()
      .mockResolvedValue(
        options.getBindingsResult !== undefined
          ? options.getBindingsResult
          : null,
      ),
    removeBindings: jest.fn().mockResolvedValue(undefined),
    refreshBindingsTtl: jest.fn().mockResolvedValue(undefined),
    setPresence: jest.fn().mockResolvedValue(undefined),
    removePresence: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<MachinePresenceService>;

  const websocketAuthorizationService = {
    authorize: jest.fn().mockResolvedValue({ authorized: true }),
  } as never;

  const gateway = new WebsocketGateway(
    { registerRevalidation: jest.fn() } as never,
    connectionManager,
    userAccessTokenValidator,
    pendingTriggerService,
    triggerEmitter,
    machineChallengeService,
    agentSessionService,
    machinePresenceService,
    websocketAuthorizationService,
    {
      register: jest.fn().mockReturnValue(true),
      unregister: jest.fn(),
    } as never,
  );

  // Inject mock server (normally injected by NestJS @WebSocketServer decorator)
  (gateway as any).server = mockServer;

  const clientEmit = jest.fn();
  const client = {
    id: socketId,
    handshake: { headers: { cookie: 'accessToken=fake-token' } },
    emit: clientEmit,
    disconnect: jest.fn(),
    join: jest.fn(),
  } as unknown as Socket;

  return {
    gateway,
    connectionManager,
    machinePresenceService,
    mockServer,
    mockTo,
    mockEmitTo,
    client,
    clientEmit,
  };
}

const SAMPLE_BINDINGS: ServiceRepoBinding[] = [
  {
    serviceId: 'service-1',
    repositoryPath: '/home/user/project',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

describe('WebsocketGateway — machine.repo_bindings', () => {
  it('(a) valid inbound event from machine socket persists to Redis and emits to all conversation rooms', async () => {
    const { gateway, machinePresenceService, mockTo, mockEmitTo, client } =
      makeHarness({
        conversationIds: ['conv-1', 'conv-2'],
      });

    const payload: MachineRepoBindingsInboundPayload = {
      bindings: SAMPLE_BINDINGS,
    };

    await gateway.handleMachineRepoBindingsUpdated(client, payload);

    expect(machinePresenceService.setBindings).toHaveBeenCalledWith(
      'machine-1',
      SAMPLE_BINDINGS,
      'org-1',
      'socket-1',
    );

    expect(mockTo).toHaveBeenCalledWith('conversation:conv-1');
    expect(mockTo).toHaveBeenCalledWith('conversation:conv-2');
    expect(mockEmitTo).toHaveBeenCalledTimes(2);
    expect(mockEmitTo).toHaveBeenCalledWith(
      'machine.repo_bindings',
      expect.objectContaining({
        type: WebSocketMachineRepoBindingsEvent.TypeEnum.MachineRepoBindings,
        organizationId: 'org-1',
        machineId: 'machine-1',
        bindings: SAMPLE_BINDINGS,
      }),
    );
    expect(mockEmitTo.mock.calls[0][1]).toHaveProperty('timestamp');
  });

  it('(b) non-machine socket is rejected — no Redis write, no fan-out', async () => {
    const { gateway, machinePresenceService, mockTo, mockEmitTo, client } =
      makeHarness({
        machineId: null,
      });

    const payload: MachineRepoBindingsInboundPayload = {
      bindings: SAMPLE_BINDINGS,
    };

    await gateway.handleMachineRepoBindingsUpdated(client, payload);

    expect(mockTo).not.toHaveBeenCalled();
    expect(mockEmitTo).not.toHaveBeenCalled();
    expect(machinePresenceService.setBindings).not.toHaveBeenCalled();
  });

  it('(c) machine socket with no organizationId is rejected — no Redis write, no fan-out', async () => {
    const { gateway, machinePresenceService, mockTo, mockEmitTo, client } =
      makeHarness({
        organizationIds: [],
      });

    const payload: MachineRepoBindingsInboundPayload = {
      bindings: SAMPLE_BINDINGS,
    };

    await gateway.handleMachineRepoBindingsUpdated(client, payload);

    expect(mockTo).not.toHaveBeenCalled();
    expect(mockEmitTo).not.toHaveBeenCalled();
    expect(machinePresenceService.setBindings).not.toHaveBeenCalled();
  });

  it('(d) handleJoinRoom triggers replay to the joining socket when Redis has bindings', async () => {
    const { gateway, connectionManager, client, clientEmit } = makeHarness({
      getConversationConnectionsResult: [
        {
          machineId: 'machine-1',
          userId: 'user-1',
          organizationIds: ['org-1'],
        },
      ],
      getBindingsResult: {
        bindings: SAMPLE_BINDINGS,
        organizationId: 'org-1',
        sourcingSocketId: 'other-socket',
      },
    });

    await gateway.handleJoinRoom(client, { conversationId: 'conv-2' });

    expect(connectionManager.addConversationSubscription).toHaveBeenCalledWith(
      'socket-1',
      'conv-2' as ConversationId,
    );

    // The joining socket receives the cached bindings immediately
    expect(clientEmit).toHaveBeenCalledWith(
      'machine.repo_bindings',
      expect.objectContaining({
        type: WebSocketMachineRepoBindingsEvent.TypeEnum.MachineRepoBindings,
        organizationId: 'org-1',
        machineId: 'machine-1',
        bindings: SAMPLE_BINDINGS,
      }),
    );
  });

  it('(e2) handleDisconnect does NOT emit or evict when a different socket now owns the Redis entry (reconnect race)', async () => {
    const { gateway, machinePresenceService, mockTo, client } = makeHarness({
      conversationIds: ['conv-3'],
      getBindingsResult: {
        bindings: SAMPLE_BINDINGS,
        organizationId: 'org-1',
        sourcingSocketId: 'socket-new', // NOT the disconnecting socket
      },
    });

    await gateway.handleDisconnect(client);

    // The disconnect must not emit empty bindings — the new socket is live
    expect(mockTo).not.toHaveBeenCalledWith('conversation:conv-3');
    // And must not delete the Redis entry owned by the new socket
    expect(machinePresenceService.removeBindings).not.toHaveBeenCalled();
  });

  it('(e) handleDisconnect emits empty bindings to conversation rooms and evicts Redis entry', async () => {
    const { gateway, machinePresenceService, mockTo, mockEmitTo, client } =
      makeHarness({
        conversationIds: ['conv-3'],
        getBindingsResult: {
          bindings: SAMPLE_BINDINGS,
          organizationId: 'org-1',
          sourcingSocketId: 'socket-1', // matches the disconnecting socket
        },
      });

    await gateway.handleDisconnect(client);

    expect(mockTo).toHaveBeenCalledWith('conversation:conv-3');
    expect(mockEmitTo).toHaveBeenCalledWith(
      'machine.repo_bindings',
      expect.objectContaining({
        type: WebSocketMachineRepoBindingsEvent.TypeEnum.MachineRepoBindings,
        organizationId: 'org-1',
        machineId: 'machine-1',
        bindings: [],
      }),
    );
    expect(machinePresenceService.removeBindings).toHaveBeenCalledWith(
      'machine-1',
    );
    expect(machinePresenceService.removePresence).toHaveBeenCalledWith(
      'machine-1',
      'user-1',
    );
  });

  it('(f) handleAuthRevoked evicts bindings and presence then disconnects', async () => {
    const { gateway, machinePresenceService, mockTo, mockEmitTo, client } =
      makeHarness({
        conversationIds: ['conv-1'],
        getBindingsResult: {
          bindings: SAMPLE_BINDINGS,
          organizationId: 'org-1',
          sourcingSocketId: 'socket-1',
        },
      });

    await gateway.handleAuthRevoked(client);

    expect(mockTo).toHaveBeenCalledWith('conversation:conv-1');
    expect(mockEmitTo).toHaveBeenCalledWith(
      'machine.repo_bindings',
      expect.objectContaining({
        type: WebSocketMachineRepoBindingsEvent.TypeEnum.MachineRepoBindings,
        organizationId: 'org-1',
        machineId: 'machine-1',
        bindings: [],
      }),
    );
    expect(machinePresenceService.removeBindings).toHaveBeenCalledWith(
      'machine-1',
    );
    expect(machinePresenceService.removePresence).toHaveBeenCalledWith(
      'machine-1',
      'user-1',
    );
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('(g) handleAuthRevoked with no bound machine is a no-op', async () => {
    const { gateway, machinePresenceService, mockTo, client } = makeHarness({
      machineId: null,
    });

    await gateway.handleAuthRevoked(client);

    expect(mockTo).not.toHaveBeenCalled();
    expect(machinePresenceService.removeBindings).not.toHaveBeenCalled();
    expect(machinePresenceService.removePresence).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it("(i) handleDisconnect cleans up presence when machine auth'd but never sent bindings", async () => {
    const { gateway, machinePresenceService, mockTo, client } = makeHarness({
      conversationIds: ['conv-4'],
      getBindingsResult: null, // machine never sent repo bindings
    });

    await gateway.handleDisconnect(client);

    // No fan-out — nothing to clear for subscribers
    expect(mockTo).not.toHaveBeenCalledWith('conversation:conv-4');
    // Bindings key didn't exist, so no remove needed
    expect(machinePresenceService.removeBindings).not.toHaveBeenCalled();
    // But presence set entry must still be cleaned up
    expect(machinePresenceService.removePresence).toHaveBeenCalledWith(
      'machine-1',
      'user-1',
    );
  });

  it('(h) maybeReplayMachineRepoBindings resolves without emitting when getBindings returns null', async () => {
    const { gateway, client, clientEmit } = makeHarness({
      getConversationConnectionsResult: [
        {
          machineId: 'machine-1',
          userId: 'user-1',
          organizationIds: ['org-1'],
        },
      ],
      getBindingsResult: null,
    });

    await gateway.handleJoinRoom(client, { conversationId: 'conv-2' });

    expect(clientEmit).not.toHaveBeenCalledWith(
      'machine.repo_bindings',
      expect.anything(),
    );
  });
});
