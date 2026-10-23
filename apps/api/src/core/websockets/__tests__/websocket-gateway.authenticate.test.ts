import { createServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { UserAccessTokenValidatorService } from '../../../auth/services/user-access-token-validator.service';
import { WebSocketAuthRequest } from '../../../generated';
import {
  ConversationId,
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import { PendingTriggerService } from '../../../services/workflows/pending-trigger.service';
import { TriggerEmitter } from '../trigger-emitter.service';
import {
  MachineChallengeService,
  MachineLookup,
} from '../machine-challenge.service';
import { WebsocketConnectionManager } from '../websocket-connection-manager.service';
import { WebsocketGateway } from '../websocket.gateway';
import { AgentSessionService } from '../../../services/agent-session.service';
import { WebsocketUserConnectionLifecycleService } from '../websocket-user-connection-lifecycle.service';
import { MachineRoomAuthorizationRequest } from '../websocket-authorization.service';

describe('WebsocketGateway.handleAuthenticate', () => {
  function makeHarness(
    userId: string | undefined,
    options: {
      openTriggers?: Awaited<
        ReturnType<PendingTriggerService['resolveOpenTriggersForUser']>
      >;
      machine?: MachineLookup | null;
      signatureValid?: boolean;
      accessContext?: Record<string, unknown>;
      realConnectionManager?: WebsocketConnectionManager;
    } = {},
  ) {
    const connectionManager = {
      serializeRoomOperation: jest.fn((_id, operation) => operation()),
      addConnection: jest.fn(),
      removeConnection: jest.fn(),
      resetAuthorizationState: jest.fn().mockResolvedValue(undefined),
      updateActivity: jest.fn(),
      getConnection: jest.fn(),
    } as unknown as jest.Mocked<WebsocketConnectionManager>;

    const userAccessTokenValidator = {
      verifyAndValidate: userId
        ? jest.fn().mockResolvedValue({
            userId,
            expiresAt: new Date(Date.now() + 60_000),
            ...(options.accessContext ?? {}),
          })
        : jest.fn().mockRejectedValue(new Error('Authentication failed')),
    } as unknown as jest.Mocked<UserAccessTokenValidatorService>;

    const pendingTriggerService = {
      resolveOpenTriggersForUser: jest
        .fn()
        .mockResolvedValue(options.openTriggers ?? []),
    } as unknown as jest.Mocked<PendingTriggerService>;

    const triggerEmitter = {
      emitConversationTriggerForMessage: jest.fn().mockResolvedValue(undefined),
      refanPendingMonitorCommandsForMachine: jest
        .fn()
        .mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TriggerEmitter>;

    const machineChallengeService = {
      lookupMachine: jest.fn().mockResolvedValue(
        options.machine === undefined
          ? ({
              publicKey: 'pem',
              tokenHash: 'digest',
              userId: 'machine-owner',
              organizationId: 'org-1',
              authorizationProtocolVersion: 2,
              authorizationState: 'READY',
              revokedAt: null,
            } as MachineLookup)
          : options.machine,
      ),
      verifyChallengeSignature: jest
        .fn()
        .mockReturnValue(options.signatureValid ?? true),
      verifyMachineCredentialHash: jest.fn().mockReturnValue(true),
      hashMachineCredential: jest.fn().mockReturnValue('digest'),
      verifyCredentialDigest: jest.fn().mockReturnValue(true),
      registerControllerProofChallenge: jest.fn(),
      recordLastSeen: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MachineChallengeService>;

    const agentSessionService = {
      update: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<AgentSessionService>;

    const machinePresenceService = {
      getBindings: jest.fn().mockResolvedValue(null),
      setBindings: jest.fn().mockResolvedValue(undefined),
      removeBindings: jest.fn().mockResolvedValue(undefined),
      refreshBindingsTtl: jest.fn().mockResolvedValue(undefined),
      setPresence: jest.fn().mockResolvedValue(undefined),
      removePresence: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<any>;

    const websocketAuthorizationService = {
      authorize: jest.fn().mockResolvedValue({ authorized: true }),
      authorizeMachine: jest
        .fn()
        .mockImplementation((request: MachineRoomAuthorizationRequest) => ({
          authorized: true,
          organizationIds: request.organizationIds,
          projectIds: request.projectIds,
          conversationIds: request.conversationIds,
          initiativeIds: request.initiativeIds,
          designDocIds: request.designDocIds,
          agentSessionIds: [],
          taskMonitorIds: [],
        })),
    };

    const websocketUserConnectionLifecycle = {
      register: jest.fn().mockReturnValue(true),
      unregister: jest.fn(),
    } as unknown as jest.Mocked<WebsocketUserConnectionLifecycleService>;

    const agentOperationDispatchService = {
      nudgeForMachine: jest.fn().mockResolvedValue(true),
    };
    const apiMetrics = { recordWake: jest.fn() };

    const gateway = new WebsocketGateway(
      { registerRevalidation: jest.fn() } as never,
      options.realConnectionManager ?? connectionManager,
      userAccessTokenValidator,
      pendingTriggerService,
      triggerEmitter,
      machineChallengeService,
      agentSessionService,
      machinePresenceService,
      websocketAuthorizationService as never,
      websocketUserConnectionLifecycle,
      undefined,
      undefined,
      agentOperationDispatchService as never,
      apiMetrics as never,
    );

    const emit = jest.fn();
    const disconnect = jest.fn();
    const client = {
      id: 'socket-1',
      handshake: {
        headers: {
          cookie: 'accessToken=fake-token',
        },
      },
      emit,
      disconnect,
    } as unknown as Socket;

    return {
      gateway,
      connectionManager,
      pendingTriggerService,
      triggerEmitter,
      machineChallengeService,
      machinePresenceService,
      userAccessTokenValidator,
      client,
      emit,
      disconnect,
      websocketUserConnectionLifecycle,
      websocketAuthorizationService,
      agentOperationDispatchService,
      apiMetrics,
    };
  }

  describe('with the real connection manager and room queue', () => {
    it('delivers a live room event over Socket.IO after authentication and subscription', async () => {
      const http = createServer();
      const server = new Server(http);
      const manager = new WebsocketConnectionManager();
      const { gateway } = makeHarness('user-1', {
        realConnectionManager: manager,
      });
      server.on('connection', (socket) => {
        socket.handshake.headers.cookie = 'accessToken=fake-token';
        const connected = gateway.handleConnection(socket);
        socket.on('authenticate', async () => {
          await connected;
          await gateway.handleAuthenticate(socket, {
            clientType: WebSocketAuthRequest.ClientTypeEnum.Browser,
          });
        });
        socket.on('subscribe', async () => {
          await gateway.handleSubscribe(socket, {
            eventTypes: ['agent_session.current_state_changed'],
            projectIds: ['project-live'],
          });
          server.to('project:project-live').emit('delivery-probe');
        });
      });
      await new Promise<void>((resolve) =>
        http.listen(0, '127.0.0.1', resolve),
      );
      const address = http.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing listening address');
      const client = new WebSocket(
        `ws://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=websocket`,
      );
      const received: string[] = [];
      try {
        await new Promise<void>((resolve, reject) => {
          client.addEventListener('error', () =>
            reject(new Error('Socket connection failed')),
          );
          client.addEventListener('message', (event) => {
            const packet = String(event.data);
            if (packet.startsWith('0')) client.send('40');
            else if (packet.startsWith('40')) client.send('42["authenticate"]');
            else if (packet.startsWith('42')) {
              const [name, response] = JSON.parse(packet.slice(2));
              received.push(name);
              if (name === 'authenticated' || name === 'subscribed') {
                if (response.status !== 'success') {
                  reject(new Error('Live access denied'));
                  return;
                }
                if (name === 'authenticated') client.send('42["subscribe"]');
              } else if (name === 'delivery-probe') resolve();
            }
          });
        });
        expect(received).toEqual([
          'authenticated',
          'subscribed',
          'delivery-probe',
        ]);
      } finally {
        client.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    async function connectedBrowser() {
      const manager = new WebsocketConnectionManager();
      const harness = makeHarness('user-1', { realConnectionManager: manager });
      const rooms = new Set([harness.client.id]);
      harness.client.join = jest.fn(async (room: string | string[]) => {
        for (const value of Array.isArray(room) ? room : [room])
          rooms.add(value);
      });
      harness.client.leave = jest.fn(async (room: string) => {
        rooms.delete(room);
      });
      await harness.gateway.handleConnection(harness.client);
      return { ...harness, manager, rooms };
    }

    let auth: WebSocketAuthRequest;
    beforeEach(() => {
      auth = {
        clientType: WebSocketAuthRequest.ClientTypeEnum.Browser,
        projectIds: ['project-old'],
      } satisfies WebSocketAuthRequest;
    });

    it('completes initial authentication and admits live-event subscriptions', async () => {
      const { gateway, client, manager, rooms, emit } =
        await connectedBrowser();
      await gateway.handleAuthenticate(client, auth);
      expect(emit).toHaveBeenCalledWith(
        'authenticated',
        expect.objectContaining({ status: 'success' }),
      );
      await gateway.handleSubscribe(client, {
        eventTypes: ['agent_session.current_state_changed'],
        projectIds: ['project-live'],
      });
      expect(emit).toHaveBeenCalledWith(
        'subscribed',
        expect.objectContaining({ status: 'success' }),
      );
      expect(rooms.has('project:project-live')).toBe(true);
      expect(manager.getSubscription(client.id)?.eventTypes).toEqual([
        'agent_session.current_state_changed',
      ]);
    });

    it('completes reauthentication after leaving old rooms and clearing subscriptions', async () => {
      const { gateway, client, manager, rooms } = await connectedBrowser();
      await gateway.handleAuthenticate(client, auth);
      await gateway.handleSubscribe(client, {
        eventTypes: ['task.updated'],
        projectIds: ['project-old'],
      });
      await gateway.handleAuthenticate(client, {
        ...auth,
        projectIds: ['project-new'],
      });
      expect(rooms).toEqual(
        new Set([client.id, 'user:user-1', 'project:project-new']),
      );
      expect(manager.getSubscription(client.id)).toBeUndefined();
      expect(manager.getConnection(client.id)?.projectIds).toEqual([
        'project-new',
      ]);
    });

    it.each(['invalid', 'denied'] as const)(
      'settles %s authentication and removes previous access',
      async (outcome) => {
        const {
          gateway,
          client,
          manager,
          rooms,
          emit,
          userAccessTokenValidator,
          websocketAuthorizationService,
        } = await connectedBrowser();
        await gateway.handleAuthenticate(client, auth);
        await gateway.handleSubscribe(client, {
          eventTypes: ['task.updated'],
          projectIds: ['project-old'],
        });
        if (outcome === 'invalid')
          userAccessTokenValidator.verifyAndValidate.mockRejectedValue(
            new Error('invalid token'),
          );
        else
          websocketAuthorizationService.authorize.mockResolvedValue({
            authorized: false,
          });
        emit.mockClear();
        await gateway.handleAuthenticate(client, auth);
        expect(emit).toHaveBeenCalledWith(
          'authenticated',
          outcome === 'invalid'
            ? {
                status: 'error',
                reason: 'authentication_required',
                message: 'Authentication required',
              }
            : {
                status: 'error',
                reason: 'access_denied',
                message: 'Access denied',
              },
        );
        expect(rooms).toEqual(new Set([client.id]));
        expect(manager.getConnection(client.id)).toBeUndefined();
        expect(manager.getSubscription(client.id)).toBeUndefined();
      },
    );

    it('ignores a browser-supplied machineId so machine-only frames are refused', async () => {
      const { gateway, client, manager, rooms, machinePresenceService } =
        await connectedBrowser();
      await gateway.handleAuthenticate(client, {
        ...auth,
        organizationId: 'org-1',
        machineId: 'victim-machine',
      });

      expect(manager.getConnection(client.id)?.machineId).toBeUndefined();
      expect(rooms.has('machine:victim-machine')).toBe(false);

      await gateway.handleMachineRepoBindingsUpdated(client, {
        bindings: [],
      } as never);
      await gateway.handleHeartbeat(client, {} as never);

      expect(machinePresenceService.setBindings).not.toHaveBeenCalled();
      expect(machinePresenceService.setPresence).not.toHaveBeenCalled();
    });

    it('evicts rooms when revocation queues behind an authentication reset', async () => {
      const { gateway, client, manager, rooms } = await connectedBrowser();
      await gateway.handleAuthenticate(client, auth);
      let releaseLeave!: () => void;
      let enteredLeave!: () => void;
      const entered = new Promise<void>((resolve) => {
        enteredLeave = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseLeave = resolve;
      });
      client.leave = jest.fn(async (room: string) => {
        enteredLeave();
        await released;
        rooms.delete(room);
      });
      const authentication = gateway.handleAuthenticate(client, auth);
      await entered;
      // Revocation must find the queued operation even while reset has
      // temporarily removed the connection, then inspect its replacement.
      expect(manager.getConnection(client.id)).toBeUndefined();
      const eviction = manager.revalidateRooms(async () => false, 'user-1');
      releaseLeave();
      await Promise.all([authentication, eviction]);
      expect(rooms.has('project:project-old')).toBe(false);
      expect(manager.getConnection(client.id)?.projectIds).toEqual([]);
    });
  });

  // Tiny helper: the re-fan is fire-and-forget (`void this.refan...`), so
  // the auth handler resolves before the projection / emit completes. Let
  // pending microtasks flush so the spy assertions see the calls.
  async function flushPendingPromises() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('issues a machine_challenge and defers addConnection when a CLI presents a machine credential', async () => {
    const {
      gateway,
      connectionManager,
      machineChallengeService,
      emit,
      client,
      websocketUserConnectionLifecycle,
    } = makeHarness('user-1');

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: ['proj-1'],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    };

    await gateway.handleAuthenticate(client, payload);

    // Challenge issued against the presented machine...
    expect(machineChallengeService.lookupMachine).toHaveBeenCalledWith(
      'machine-1',
    );
    const challengeCall = emit.mock.calls.find(
      ([event]) => event === 'machine_challenge',
    );
    expect(challengeCall).toBeDefined();
    expect(typeof (challengeCall![1] as { challenge: string }).challenge).toBe(
      'string',
    );
    // ...and the connection is NOT registered until the response verifies.
    expect(connectionManager.addConnection).not.toHaveBeenCalled();
    expect(websocketUserConnectionLifecycle.register).not.toHaveBeenCalled();
  });

  it('rejects a credential whose digest does not match the paired machine', async () => {
    const { gateway, machineChallengeService, emit, client } =
      makeHarness('user-1');
    (
      machineChallengeService.verifyMachineCredentialHash as jest.Mock
    ).mockReturnValue(false);

    await gateway.handleAuthenticate(client, {
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'wrong-credential',
    });

    expect(
      machineChallengeService.verifyMachineCredentialHash,
    ).toHaveBeenCalledWith('digest', 'wrong-credential');
    expect(emit).not.toHaveBeenCalledWith(
      'machine_challenge',
      expect.anything(),
    );
  });

  it('completes machine auth with the verified machine owner on a valid signature', async () => {
    const {
      gateway,
      connectionManager,
      triggerEmitter,
      machineChallengeService,
      emit,
      client,
      websocketUserConnectionLifecycle,
      websocketAuthorizationService,
      agentOperationDispatchService,
      apiMetrics,
    } = makeHarness('cookie-user', {
      machine: {
        publicKey: 'pem',
        tokenHash: 'digest',
        userId: 'machine-owner' as UserId,
        isDemoUser: false,
        organizationId: 'org-1',
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        revokedAt: null,
      },
      signatureValid: true,
    });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: ['proj-1'],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    };

    await gateway.handleAuthenticate(client, payload);
    await gateway.handleMachineChallengeResponse(client, {
      machineId: 'machine-1',
      signature: 'sig-b64',
    });

    expect(machineChallengeService.verifyChallengeSignature).toHaveBeenCalled();
    expect(connectionManager.addConnection).toHaveBeenCalledTimes(1);
    const args = connectionManager.addConnection.mock.calls[0]!;
    // Identity is bound from the verified machine owner, NOT the cookie
    // subject ('cookie-user').
    expect(args[1]).toBe('machine-owner' as UserId);
    expect(args[7]).toBe('cli');
    expect(args[8]).toBe('machine-1');
    expect(args[11]).toEqual([]);
    expect(args[12]).toEqual([]);
    expect(websocketAuthorizationService.authorizeMachine).toHaveBeenCalledWith(
      {
        machineId: 'machine-1',
        userId: 'machine-owner',
        organizationIds: ['org-1'],
        projectIds: ['proj-1'],
        conversationIds: [],
        initiativeIds: [],
        designDocIds: [],
      },
    );
    const successCall = emit.mock.calls.find(
      ([event]) => event === 'authenticated',
    );
    expect((successCall![1] as { status: string }).status).toBe('success');
    // Initial announce stamps the durable lastSeen for the verified machine so
    // presence is fresh immediately, not only after the first heartbeat.
    expect(machineChallengeService.recordLastSeen).toHaveBeenCalledWith(
      'machine-1',
    );
    expect(
      triggerEmitter.refanPendingMonitorCommandsForMachine,
    ).toHaveBeenCalledWith('machine-1');
    expect(agentOperationDispatchService.nudgeForMachine).toHaveBeenCalledWith(
      'machine-1',
    );
    await flushPendingPromises();
    expect(apiMetrics.recordWake).toHaveBeenCalledWith(
      'authentication',
      'claimed',
    );
    expect(websocketUserConnectionLifecycle.register).not.toHaveBeenCalled();
  });

  it('keeps legacy machine proof available for upgrade enrollment without publishing execution presence', async () => {
    const {
      gateway,
      connectionManager,
      machineChallengeService,
      machinePresenceService,
      triggerEmitter,
      agentOperationDispatchService,
      client,
    } = makeHarness('cookie-user', {
      machine: {
        publicKey: 'pem',
        tokenHash: 'digest',
        userId: 'machine-owner' as UserId,
        isDemoUser: false,
        organizationId: 'org-1',
        authorizationProtocolVersion: 1,
        authorizationState: 'CONTROLLER_ENROLLMENT_REQUIRED',
        revokedAt: null,
      },
      signatureValid: true,
    });

    await gateway.handleAuthenticate(client, {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    });
    await gateway.handleMachineChallengeResponse(client, {
      machineId: 'machine-1',
      signature: 'sig-b64',
    });

    expect(connectionManager.addConnection).toHaveBeenCalled();
    expect(machineChallengeService.recordLastSeen).not.toHaveBeenCalled();
    expect(machinePresenceService.setPresence).not.toHaveBeenCalled();
    expect(
      triggerEmitter.refanPendingMonitorCommandsForMachine,
    ).not.toHaveBeenCalled();
    expect(
      agentOperationDispatchService.nudgeForMachine,
    ).not.toHaveBeenCalled();
  });

  it('contains a durable-dispatch wake failure after machine authentication', async () => {
    const { gateway, agentOperationDispatchService, apiMetrics, client } =
      makeHarness('cookie-user', {
        machine: {
          publicKey: 'pem',
          tokenHash: 'digest',
          userId: 'machine-owner' as UserId,
          isDemoUser: false,
          organizationId: 'org-1',
          authorizationProtocolVersion: 2,
          authorizationState: 'READY',
          revokedAt: null,
        },
        signatureValid: true,
      });
    agentOperationDispatchService.nudgeForMachine.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const warn = jest
      .spyOn(
        (gateway as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await gateway.handleAuthenticate(client, {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    });
    await gateway.handleMachineChallengeResponse(client, {
      machineId: 'machine-1',
      signature: 'sig-b64',
    });
    await flushPendingPromises();

    expect(warn).toHaveBeenCalledWith(
      '[AgentOperationDispatchService] failed to wake pending machine dispatches',
      expect.objectContaining({
        machineId: 'machine-1',
        error: 'database unavailable',
      }),
    );
    expect(apiMetrics.recordWake).toHaveBeenCalledWith(
      'authentication',
      'failed',
    );
  });

  it('rejects and disconnects on an invalid signature', async () => {
    const { gateway, connectionManager, emit, disconnect, client } =
      makeHarness('user-1', { signatureValid: false });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    };

    await gateway.handleAuthenticate(client, payload);
    await gateway.handleMachineChallengeResponse(client, {
      machineId: 'machine-1',
      signature: 'bad-sig',
    });

    expect(connectionManager.addConnection).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    const errorCall = emit.mock.calls.find(
      ([event, body]) =>
        event === 'authenticated' &&
        (body as { status: string }).status === 'error',
    );
    expect(errorCall).toBeDefined();
  });

  it('rejects a revoked machine at challenge issue without emitting a challenge', async () => {
    const { gateway, connectionManager, emit, client } = makeHarness('user-1', {
      machine: {
        publicKey: 'pem',
        tokenHash: 'digest',
        userId: 'machine-owner' as UserId,
        isDemoUser: false,
        organizationId: 'org-1',
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        revokedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    };

    await gateway.handleAuthenticate(client, payload);

    expect(
      emit.mock.calls.some(([event]) => event === 'machine_challenge'),
    ).toBe(false);
    expect(connectionManager.addConnection).not.toHaveBeenCalled();
    const errorCall = emit.mock.calls.find(
      ([event, body]) =>
        event === 'authenticated' &&
        (body as { status: string }).status === 'error',
    );
    expect(errorCall).toBeDefined();
  });

  it('carries a typed machine_revoked reason when rejecting a revoked machine at challenge', async () => {
    const { gateway, emit, client } = makeHarness('user-1', {
      machine: {
        publicKey: 'pem',
        tokenHash: 'digest',
        userId: 'machine-owner' as UserId,
        isDemoUser: false,
        organizationId: 'org-1',
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        revokedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    };

    await gateway.handleAuthenticate(client, payload);

    const errorCall = emit.mock.calls.find(
      ([event, body]) =>
        event === 'authenticated' &&
        (body as { status: string }).status === 'error',
    );
    expect((errorCall![1] as { reason?: string }).reason).toBe(
      'machine_revoked',
    );
  });

  it('carries machine_revoked when the credential is revoked mid-handshake (response re-check)', async () => {
    const { gateway, machineChallengeService, emit, disconnect, client } =
      makeHarness('user-1', {
        machine: {
          publicKey: 'pem',
          tokenHash: 'digest',
          userId: 'machine-owner' as UserId,
          isDemoUser: false,
          organizationId: 'org-1',
          authorizationProtocolVersion: 2,
          authorizationState: 'READY',
          revokedAt: null,
        },
      });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    };

    // Non-revoked at challenge time...
    await gateway.handleAuthenticate(client, payload);
    // ...but revoked by the time the response arrives.
    (machineChallengeService.lookupMachine as jest.Mock).mockResolvedValue({
      publicKey: 'pem',
      tokenHash: 'digest',
      userId: 'machine-owner' as UserId,
      organizationId: 'org-1',
      authorizationProtocolVersion: 2,
      authorizationState: 'READY',
      revokedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await gateway.handleMachineChallengeResponse(client, {
      machineId: 'machine-1',
      signature: 'sig',
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    const errorCall = emit.mock.calls.find(
      ([event, body]) =>
        event === 'authenticated' &&
        (body as { status: string }).status === 'error',
    );
    expect((errorCall![1] as { reason?: string }).reason).toBe(
      'machine_revoked',
    );
  });

  it('omits the reason for an unknown machine so a later valid connect is not poisoned', async () => {
    const { gateway, emit, client } = makeHarness('user-1', { machine: null });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    };

    await gateway.handleAuthenticate(client, payload);

    const errorCall = emit.mock.calls.find(
      ([event, body]) =>
        event === 'authenticated' &&
        (body as { status: string }).status === 'error',
    );
    expect((errorCall![1] as { reason?: string }).reason).toBeUndefined();
  });

  it('omits the reason on a bad signature so a transient drop never carries machine_revoked', async () => {
    const { gateway, emit, client } = makeHarness('user-1', {
      signatureValid: false,
    });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    };

    await gateway.handleAuthenticate(client, payload);
    await gateway.handleMachineChallengeResponse(client, {
      machineId: 'machine-1',
      signature: 'bad-sig',
    });

    const errorCall = emit.mock.calls.find(
      ([event, body]) =>
        event === 'authenticated' &&
        (body as { status: string }).status === 'error',
    );
    expect((errorCall![1] as { reason?: string }).reason).toBeUndefined();
  });

  it('issues a fresh challenge on a second connect (no challenge state survives)', async () => {
    const { gateway, emit, client } = makeHarness('user-1');

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'cred-1',
    };

    await gateway.handleAuthenticate(client, payload);
    await gateway.handleAuthenticate(client, payload);

    const challenges = emit.mock.calls
      .filter(([event]) => event === 'machine_challenge')
      .map(([, body]) => (body as { challenge: string }).challenge);
    expect(challenges).toHaveLength(2);
    expect(challenges[0]).not.toEqual(challenges[1]);
  });

  it('disconnects a machine_challenge_response with no pending challenge', async () => {
    const { gateway, connectionManager, disconnect, emit, client } =
      makeHarness('user-1');

    await gateway.handleMachineChallengeResponse(client, {
      machineId: 'machine-1',
      signature: 'sig',
    });

    expect(connectionManager.addConnection).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(
      emit.mock.calls.some(
        ([event, body]) =>
          event === 'authenticated' &&
          (body as { status: string }).status === 'error',
      ),
    ).toBe(true);
  });

  it('passes undefined for clientType and machineId when the payload omits them (browser default)', async () => {
    const {
      gateway,
      connectionManager,
      client,
      websocketUserConnectionLifecycle,
    } = makeHarness('user-1', {
      accessContext: {
        sessionId: 'session-1',
        authorizationVersion: 4,
      },
    });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    };

    await gateway.handleAuthenticate(client, payload);

    const args = connectionManager.addConnection.mock.calls[0]!;
    expect(args[7]).toBe('browser');
    expect(args[8]).toBeUndefined();
    expect(websocketUserConnectionLifecycle.register).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        userId: 'user-1',
        expiresAt: expect.any(Date),
        sessionId: 'session-1',
        authorizationVersion: 4,
      }),
    );
  });

  it('does not register a browser socket after lifecycle enrollment is skipped', async () => {
    const {
      gateway,
      connectionManager,
      client,
      emit,
      websocketUserConnectionLifecycle,
    } = makeHarness('user-1');
    (client as unknown as { disconnected: boolean }).disconnected = true;
    websocketUserConnectionLifecycle.register.mockReturnValue(false);

    await gateway.handleAuthenticate(client, {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    });

    expect(connectionManager.addConnection).not.toHaveBeenCalled();
    expect(connectionManager.resetAuthorizationState).toHaveBeenCalledWith(
      'socket-1',
    );
    expect(websocketUserConnectionLifecycle.unregister).toHaveBeenCalledWith(
      'socket-1',
    );
    expect(emit).toHaveBeenCalledWith('authenticated', {
      status: 'error',
      reason: 'authentication_required',
      message: 'Authentication required',
    });
  });

  it('rejects a CLI browser-cookie fallback when machine credentials are missing', async () => {
    const {
      gateway,
      connectionManager,
      userAccessTokenValidator,
      emit,
      client,
    } = makeHarness('cookie-user');

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
    };

    await gateway.handleAuthenticate(client, payload);

    expect(userAccessTokenValidator.verifyAndValidate).not.toHaveBeenCalled();
    expect(connectionManager.addConnection).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'authenticated',
      expect.objectContaining({
        status: 'error',
      }),
    );
  });

  it('leaves the previous browser authorization state before installing a reauthentication', async () => {
    const {
      gateway,
      connectionManager,
      client,
      websocketUserConnectionLifecycle,
    } = makeHarness('user-1');
    connectionManager.getConnection.mockReturnValue({
      id: 'socket-1',
      userId: 'user-1' as UserId,
      organizationIds: ['old-org'] as OrganizationId[],
      projectIds: ['old-project'] as ProjectId[],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      agentSessionIds: [],
      taskMonitorIds: [],
      clientType: 'browser',
      connectedAt: new Date(),
      lastActivity: new Date(),
    });

    await gateway.handleAuthenticate(client, {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Browser,
    });

    expect(connectionManager.resetAuthorizationState).toHaveBeenCalledWith(
      'socket-1',
    );
    expect(websocketUserConnectionLifecycle.register).toHaveBeenCalled();
    expect(connectionManager.addConnection).toHaveBeenCalled();
    expect(
      connectionManager.resetAuthorizationState.mock.invocationCallOrder[0],
    ).toBeLessThan(
      connectionManager.addConnection.mock.invocationCallOrder[0]!,
    );
  });

  it('requires a fresh transport when a browser socket requests the machine profile', async () => {
    const {
      gateway,
      connectionManager,
      machineChallengeService,
      client,
      disconnect,
    } = makeHarness('user-1');
    connectionManager.getConnection.mockReturnValue({
      id: 'socket-1',
      userId: 'user-1' as UserId,
      organizationIds: [],
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      agentSessionIds: [],
      taskMonitorIds: [],
      clientType: 'browser',
      connectedAt: new Date(),
      lastActivity: new Date(),
    });

    await gateway.handleAuthenticate(client, {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Cli,
      machineId: 'machine-1',
      machineCredential: 'credential',
    });

    expect(machineChallengeService.lookupMachine).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('requires a fresh transport when a machine socket requests the browser profile', async () => {
    const {
      gateway,
      connectionManager,
      userAccessTokenValidator,
      client,
      disconnect,
    } = makeHarness('user-1');
    connectionManager.getConnection.mockReturnValue({
      id: 'socket-1',
      userId: 'machine-owner' as UserId,
      organizationIds: [],
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      agentSessionIds: [],
      taskMonitorIds: [],
      clientType: 'cli',
      machineId: 'machine-1' as MachineId,
      connectedAt: new Date(),
      lastActivity: new Date(),
    });

    await gateway.handleAuthenticate(client, {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      clientType: WebSocketAuthRequest.ClientTypeEnum.Browser,
    });

    expect(userAccessTokenValidator.verifyAndValidate).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledWith(true);
  });

  it('emits the typed generic terminal response without credential detail', async () => {
    const { gateway, emit, client } = makeHarness(undefined);

    await gateway.handleAuthenticate(client, {
      organizationId: 'org-1',
      projectIds: ['project-secret'],
      conversationIds: ['conversation-secret'],
      initiativeIds: [],
      designDocIds: [],
    });

    expect(emit).toHaveBeenCalledWith('authenticated', {
      status: 'error',
      reason: 'authentication_required',
      message: 'Authentication required',
    });
  });

  it('rejects a browser handshake with no access-token cookie', async () => {
    const { gateway, userAccessTokenValidator, emit, client } =
      makeHarness('user-1');
    client.handshake.headers.cookie = undefined;

    await gateway.handleAuthenticate(client, {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    });

    expect(userAccessTokenValidator.verifyAndValidate).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('authenticated', {
      status: 'error',
      reason: 'authentication_required',
      message: 'Authentication required',
    });
  });

  it('clears browser lifecycle state when the gateway observes disconnect', async () => {
    const { gateway, client, websocketUserConnectionLifecycle } =
      makeHarness('user-1');

    await gateway.handleDisconnect(client);

    expect(websocketUserConnectionLifecycle.unregister).toHaveBeenCalledWith(
      'socket-1',
    );
  });

  it('re-fans every open trigger the user owns on successful authenticate', async () => {
    const openTriggers = [
      {
        conversationId: 'conv-a' as ConversationId,
        messageId: 'msg-a' as MessageId,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'proj-1' as ProjectId,
      },
      {
        conversationId: 'conv-b' as ConversationId,
        messageId: 'msg-b' as MessageId,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'proj-1' as ProjectId,
      },
    ];
    const { gateway, pendingTriggerService, triggerEmitter, client } =
      makeHarness('user-1', { openTriggers });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    };

    await gateway.handleAuthenticate(client, payload);
    await flushPendingPromises();

    expect(
      pendingTriggerService.resolveOpenTriggersForUser,
    ).toHaveBeenCalledWith('user-1' as UserId);
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenCalledTimes(2);
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenNthCalledWith(1, openTriggers[0]);
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenNthCalledWith(2, openTriggers[1]);
  });

  it('does not invoke the re-fan when authentication fails to resolve a user', async () => {
    const { gateway, pendingTriggerService, triggerEmitter, client } =
      makeHarness(undefined);

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    };

    await gateway.handleAuthenticate(client, payload);
    await flushPendingPromises();

    expect(
      pendingTriggerService.resolveOpenTriggersForUser,
    ).not.toHaveBeenCalled();
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).not.toHaveBeenCalled();
  });

  it('continues re-fanning later triggers when one re-emit throws', async () => {
    const openTriggers = [
      {
        conversationId: 'conv-a' as ConversationId,
        messageId: 'msg-bad' as MessageId,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'proj-1' as ProjectId,
      },
      {
        conversationId: 'conv-b' as ConversationId,
        messageId: 'msg-good' as MessageId,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'proj-1' as ProjectId,
      },
    ];
    const { gateway, triggerEmitter, client } = makeHarness('user-1', {
      openTriggers,
    });

    (
      triggerEmitter.emitConversationTriggerForMessage as jest.Mock
    ).mockImplementationOnce(() => Promise.reject(new Error('boom')));

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    };

    await gateway.handleAuthenticate(client, payload);
    await flushPendingPromises();

    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenCalledTimes(2);
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenNthCalledWith(2, openTriggers[1]);
  });

  it('coalesces two near-concurrent authenticate calls into a single re-fan walk', async () => {
    const openTriggers = [
      {
        conversationId: 'conv-a' as ConversationId,
        messageId: 'msg-a' as MessageId,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'proj-1' as ProjectId,
      },
      {
        conversationId: 'conv-b' as ConversationId,
        messageId: 'msg-b' as MessageId,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'proj-1' as ProjectId,
      },
    ];
    const { gateway, triggerEmitter, client } = makeHarness('user-1', {
      openTriggers,
    });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    };

    // Fire both authenticates back-to-back without yielding between them, so
    // the second call observes the first walk's in-flight lock (the walk is
    // already suspended awaiting the projection). The guard is per-user, so
    // reusing the same client faithfully models two of the user's sockets.
    const first = gateway.handleAuthenticate(client, payload);
    const second = gateway.handleAuthenticate(client, payload);
    await Promise.all([first, second]);
    await flushPendingPromises();

    // Each open trigger is emitted exactly once across both authenticates —
    // not once per authenticating socket.
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenCalledTimes(openTriggers.length);
  });

  it('re-fans again on a later authenticate after the in-flight guard releases', async () => {
    const openTriggers = [
      {
        conversationId: 'conv-a' as ConversationId,
        messageId: 'msg-a' as MessageId,
        organizationId: 'org-1' as OrganizationId,
        projectId: 'proj-1' as ProjectId,
      },
    ];
    const { gateway, pendingTriggerService, triggerEmitter, client } =
      makeHarness('user-1', { openTriggers });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    };

    // First walk runs to completion (and releases the lock in its finally)...
    await gateway.handleAuthenticate(client, payload);
    await flushPendingPromises();

    // ...so a later authenticate is free to re-fan again.
    await gateway.handleAuthenticate(client, payload);
    await flushPendingPromises();

    expect(
      pendingTriggerService.resolveOpenTriggersForUser,
    ).toHaveBeenCalledTimes(2);
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenCalledTimes(2);
  });

  it('emits a trigger once even when the projection returns a duplicate entry', async () => {
    const entry = {
      conversationId: 'conv-a' as ConversationId,
      messageId: 'msg-dup' as MessageId,
      organizationId: 'org-1' as OrganizationId,
      projectId: 'proj-1' as ProjectId,
    };
    // Same messageId returned twice — the walk must still emit it once.
    const openTriggers = [entry, { ...entry }];
    const { gateway, triggerEmitter, client } = makeHarness('user-1', {
      openTriggers,
    });

    const payload: WebSocketAuthRequest = {
      organizationId: 'org-1',
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
    };

    await gateway.handleAuthenticate(client, payload);
    await flushPendingPromises();

    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenCalledTimes(1);
    expect(
      triggerEmitter.emitConversationTriggerForMessage,
    ).toHaveBeenCalledWith(entry);
  });

  describe('handleHeartbeat', () => {
    const heartbeatFrame = {
      type: 'heartbeat' as const,
      timestamp: '2026-06-14T00:00:00.000Z',
      organizationId: 'org-1',
      clientType: 'cli' as const,
      machineId: 'machine-1',
    };

    it('refreshes in-memory activity and stamps lastSeen for the bound machine', async () => {
      const { gateway, connectionManager, machineChallengeService, client } =
        makeHarness('user-1');
      connectionManager.getConnection.mockReturnValue({
        id: 'socket-1',
        userId: 'user-1' as UserId,
        machineId: 'machine-1',
      } as ReturnType<WebsocketConnectionManager['getConnection']>);

      await gateway.handleHeartbeat(client, heartbeatFrame);

      expect(connectionManager.updateActivity).toHaveBeenCalledWith('socket-1');
      // Keyed on the VERIFIED machineId bound to the connection, not the frame.
      expect(machineChallengeService.recordLastSeen).toHaveBeenCalledWith(
        'machine-1',
      );
    });

    it('keys lastSeen on the connection binding, never the frame body', async () => {
      const { gateway, connectionManager, machineChallengeService, client } =
        makeHarness('user-1');
      connectionManager.getConnection.mockReturnValue({
        id: 'socket-1',
        userId: 'user-1' as UserId,
        machineId: 'verified-machine',
      } as ReturnType<WebsocketConnectionManager['getConnection']>);

      // Frame claims a different machine than the one bound at auth.
      await gateway.handleHeartbeat(client, {
        ...heartbeatFrame,
        machineId: 'spoofed-machine',
      });

      expect(machineChallengeService.recordLastSeen).toHaveBeenCalledWith(
        'verified-machine',
      );
      expect(machineChallengeService.recordLastSeen).not.toHaveBeenCalledWith(
        'spoofed-machine',
      );
    });

    it('refreshes activity but persists nothing for a connection with no bound machine', async () => {
      const { gateway, connectionManager, machineChallengeService, client } =
        makeHarness('user-1');
      connectionManager.getConnection.mockReturnValue({
        id: 'socket-1',
        userId: 'user-1' as UserId,
        machineId: undefined,
      } as ReturnType<WebsocketConnectionManager['getConnection']>);

      await gateway.handleHeartbeat(client, {
        ...heartbeatFrame,
        machineId: undefined,
      });

      expect(connectionManager.updateActivity).toHaveBeenCalledWith('socket-1');
      expect(machineChallengeService.recordLastSeen).not.toHaveBeenCalled();
    });
  });
});
