import { Socket } from 'socket.io';
import {
  WebSocketAuthRequest,
  WebSocketJoinRoomRequest,
  WebSocketSubscriptionRequest,
} from '../../../generated';
import { WebsocketGateway } from '../websocket.gateway';

function makeHarness(
  options: {
    authorized?: boolean;
    connection?: Record<string, unknown> | undefined;
  } = {},
) {
  const connectionManager = {
    serializeRoomOperation: jest.fn(
      (_id: string, operation: () => Promise<unknown>) => operation(),
    ),
    leaveRoom: jest.fn().mockResolvedValue(undefined),
    addConnection: jest.fn(),
    removeConnection: jest.fn(),
    resetAuthorizationState: jest.fn().mockResolvedValue(undefined),
    updateActivity: jest.fn(),
    subscribe: jest.fn(),
    addProjectSubscription: jest.fn(),
    addConversationSubscription: jest.fn(),
    addInitiativeSubscription: jest.fn(),
    addDesignDocSubscription: jest.fn(),
    addOpenItemsSubscription: jest.fn(),
    getConnection: jest.fn().mockReturnValue(
      options.connection === undefined
        ? {
            id: 'socket-1',
            userId: 'user-1',
            organizationIds: ['org-1'],
            projectIds: [],
            conversationIds: [],
            initiativeIds: [],
            designDocIds: [],
            clientType: 'browser',
          }
        : options.connection,
    ),
    getConversationConnections: jest.fn().mockReturnValue([]),
  };

  const websocketAuthorizationService = {
    authorize: jest
      .fn()
      .mockResolvedValue({ authorized: options.authorized ?? true }),
    authorizeMachine: jest.fn().mockImplementation((request) => ({
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
  const userAccessTokenValidator = {
    verifyAndValidate: jest.fn().mockResolvedValue({
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
    }),
  };

  const gateway = new WebsocketGateway(
    { registerRevalidation: jest.fn() } as never,
    connectionManager as never,
    userAccessTokenValidator as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    websocketAuthorizationService as never,
    {
      hasRegistration: jest.fn().mockReturnValue(true),
      register: jest.fn().mockReturnValue(true),
      unregister: jest.fn(),
    } as never,
  );

  const emit = jest.fn();
  const client = {
    id: 'socket-1',
    handshake: { headers: { cookie: 'accessToken=fake-token' } },
    emit,
    disconnect: jest.fn(),
    join: jest.fn(),
  } as unknown as Socket;

  return {
    gateway,
    connectionManager,
    websocketAuthorizationService,
    client,
    emit,
  };
}

const browserAuthPayload: WebSocketAuthRequest = {
  organizationId: 'org-1',
  projectIds: ['project-1'],
  conversationIds: ['conversation-1'],
  initiativeIds: ['initiative-1'],
  designDocIds: ['design-doc-1'],
};

describe('WebsocketGateway browser room authorization', () => {
  it('authorizes private Open Items joins against the authenticated user and project', async () => {
    const {
      gateway,
      connectionManager,
      websocketAuthorizationService,
      client,
    } = makeHarness();
    const result = await gateway.handleJoinRoom(client, {
      openItemsProjectId: 'project-1',
    });
    expect(websocketAuthorizationService.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', projectIds: ['project-1'] }),
    );
    expect(connectionManager.addOpenItemsSubscription).toHaveBeenCalledWith(
      'socket-1',
      'project-1',
    );
    expect(result).toMatchObject({
      status: 'success',
      openItemsProjectId: 'project-1',
    });
  });

  it('denies an unauthorized Open Items project before joining', async () => {
    const { gateway, connectionManager, client } = makeHarness({
      authorized: false,
    });
    expect(
      await gateway.handleJoinRoom(client, { openItemsProjectId: 'private' }),
    ).toMatchObject({ status: 'error' });
    expect(connectionManager.addOpenItemsSubscription).not.toHaveBeenCalled();
  });

  it('denies initial authentication atomically when any requested room is unauthorized', async () => {
    const {
      gateway,
      connectionManager,
      websocketAuthorizationService,
      client,
      emit,
    } = makeHarness({ authorized: false });

    await gateway.handleAuthenticate(client, browserAuthPayload);

    expect(websocketAuthorizationService.authorize).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationIds: ['org-1'],
      projectIds: ['project-1'],
      conversationIds: ['conversation-1'],
      initiativeIds: ['initiative-1'],
      designDocIds: ['design-doc-1'],
    });
    expect(connectionManager.resetAuthorizationState).toHaveBeenCalledWith(
      'socket-1',
    );
    expect(connectionManager.addConnection).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('authenticated', {
      status: 'error',
      reason: 'access_denied',
      message: 'Access denied',
    });
  });

  it('denies subscribe before any manager mutation when the browser batch is mixed', async () => {
    const {
      gateway,
      connectionManager,
      websocketAuthorizationService,
      client,
      emit,
    } = makeHarness({ authorized: false });
    const payload: WebSocketSubscriptionRequest = {
      eventTypes: [WebSocketSubscriptionRequest.EventTypesEnum.MessageCreated],
      projectIds: ['project-1'],
      conversationIds: ['conversation-1'],
      initiativeIds: ['initiative-1'],
      designDocIds: ['design-doc-1'],
    };

    await gateway.handleSubscribe(client, payload);

    expect(websocketAuthorizationService.authorize).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationIds: ['org-1'],
      projectIds: ['project-1'],
      conversationIds: ['conversation-1'],
      initiativeIds: ['initiative-1'],
      designDocIds: ['design-doc-1'],
    });
    expect(connectionManager.subscribe).not.toHaveBeenCalled();
    expect(connectionManager.updateActivity).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('subscribed', {
      status: 'error',
      reason: 'access_denied',
      message: 'Access denied',
    });
  });

  it('denies join atomically before any requested room is joined', async () => {
    const {
      gateway,
      connectionManager,
      websocketAuthorizationService,
      client,
      emit,
    } = makeHarness({ authorized: false });
    const payload: WebSocketJoinRoomRequest = {
      projectId: 'project-1',
      conversationId: 'conversation-1',
      initiativeId: 'initiative-1',
      designDocId: 'design-doc-1',
    };

    await gateway.handleJoinRoom(client, payload);

    expect(websocketAuthorizationService.authorize).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationIds: ['org-1'],
      projectIds: ['project-1'],
      conversationIds: ['conversation-1'],
      initiativeIds: ['initiative-1'],
      designDocIds: ['design-doc-1'],
    });
    expect(connectionManager.addProjectSubscription).not.toHaveBeenCalled();
    expect(
      connectionManager.addConversationSubscription,
    ).not.toHaveBeenCalled();
    expect(connectionManager.addInitiativeSubscription).not.toHaveBeenCalled();
    expect(connectionManager.addDesignDocSubscription).not.toHaveBeenCalled();
    expect(connectionManager.updateActivity).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('joined', {
      status: 'error',
      reason: 'access_denied',
      message: 'Access denied',
    });
  });

  it.each([
    ['project', { projectId: 'project-1' }, 'addProjectSubscription'],
    [
      'conversation',
      { conversationId: 'conversation-1' },
      'addConversationSubscription',
    ],
    [
      'initiative',
      { initiativeId: 'initiative-1' },
      'addInitiativeSubscription',
    ],
    [
      'design document',
      { designDocId: 'design-doc-1' },
      'addDesignDocSubscription',
    ],
  ] as const)(
    'denies an unauthorized %s room without invoking its join method',
    async (_label, payload, method) => {
      const { gateway, connectionManager, client, emit } = makeHarness({
        authorized: false,
      });

      await gateway.handleJoinRoom(client, payload);

      expect(connectionManager[method]).not.toHaveBeenCalled();
      expect(connectionManager.updateActivity).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith('joined', {
        status: 'error',
        reason: 'access_denied',
        message: 'Access denied',
      });
    },
  );

  it('rejects subscribe from a socket without an authenticated browser connection', async () => {
    const {
      gateway,
      connectionManager,
      websocketAuthorizationService,
      client,
      emit,
    } = makeHarness({ connection: undefined });
    connectionManager.getConnection.mockReturnValue(undefined);

    await gateway.handleSubscribe(client, {
      eventTypes: [WebSocketSubscriptionRequest.EventTypesEnum.MessageCreated],
      projectIds: ['project-1'],
    });

    expect(websocketAuthorizationService.authorize).not.toHaveBeenCalled();
    expect(connectionManager.subscribe).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('subscribed', {
      status: 'error',
      reason: 'access_denied',
      message: 'Access denied',
    });
  });

  it('rejects join from a socket without an authenticated browser connection', async () => {
    const {
      gateway,
      connectionManager,
      websocketAuthorizationService,
      client,
      emit,
    } = makeHarness({ connection: undefined });
    connectionManager.getConnection.mockReturnValue(undefined);

    await gateway.handleJoinRoom(client, { projectId: 'project-1' });

    expect(websocketAuthorizationService.authorize).not.toHaveBeenCalled();
    expect(connectionManager.addProjectSubscription).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('joined', {
      status: 'error',
      reason: 'access_denied',
      message: 'Access denied',
    });
  });

  it('authorizes verified machine room expansion against persisted machine scope', async () => {
    const {
      gateway,
      connectionManager,
      websocketAuthorizationService,
      client,
      emit,
    } = makeHarness({
      connection: {
        id: 'socket-1',
        userId: 'machine-owner',
        organizationIds: [],
        projectIds: [],
        conversationIds: [],
        initiativeIds: [],
        designDocIds: [],
        clientType: 'cli',
        machineId: 'machine-1',
        verifiedMachine: true,
        authorizationProtocolVersion: 2,
      },
    });

    await gateway.handleJoinRoom(client, { projectId: 'project-1' });

    expect(websocketAuthorizationService.authorize).not.toHaveBeenCalled();
    expect(websocketAuthorizationService.authorizeMachine).toHaveBeenCalled();
    expect(connectionManager.addProjectSubscription).toHaveBeenCalledWith(
      'socket-1',
      'project-1',
    );
    expect(emit).toHaveBeenCalledWith('joined', {
      status: 'success',
      projectId: 'project-1',
      conversationId: undefined,
      initiativeId: undefined,
      designDocId: undefined,
    });
  });

  it('subscribes an idle verified machine without executable recipient bindings', async () => {
    const {
      gateway,
      connectionManager,
      websocketAuthorizationService,
      client,
      emit,
    } = makeHarness({
      connection: {
        id: 'socket-1',
        userId: 'machine-owner',
        organizationIds: ['org-1'],
        projectIds: [],
        conversationIds: [],
        initiativeIds: [],
        designDocIds: [],
        clientType: 'cli',
        machineId: 'machine-1',
        verifiedMachine: true,
        authorizationProtocolVersion: 2,
        agentSessionIds: [],
        taskMonitorIds: [],
      },
    });

    const payload: WebSocketSubscriptionRequest = {
      eventTypes: [WebSocketSubscriptionRequest.EventTypesEnum.MessageCreated],
      projectIds: ['project-1'],
      conversationIds: ['conversation-1'],
    };
    await gateway.handleSubscribe(client, payload);

    expect(websocketAuthorizationService.authorizeMachine).toHaveBeenCalledWith(
      {
        machineId: 'machine-1',
        userId: 'machine-owner',
        organizationIds: ['org-1'],
        projectIds: ['project-1'],
        conversationIds: ['conversation-1'],
        initiativeIds: [],
        designDocIds: [],
      },
    );
    expect(connectionManager.subscribe).toHaveBeenCalledWith(
      'socket-1',
      payload.eventTypes,
      ['project-1'],
      ['conversation-1'],
      [],
      [],
    );
    expect(emit).toHaveBeenCalledWith(
      'subscribed',
      expect.objectContaining({ status: 'success' }),
    );
  });
});

describe('browser room departure acknowledgement', () => {
  it('waits for departure before confirming scope', async () => {
    const { gateway, client, connectionManager } = makeHarness();
    let finish!: () => void;
    connectionManager.leaveRoom.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const settled = jest.fn();
    const result = gateway
      .handleLeaveRoom(client, { roomType: 'design_doc', roomId: 'doc-1' })
      .then((value) => {
        settled(value);
        return value;
      });
    expect(settled).not.toHaveBeenCalled();
    expect(connectionManager.leaveRoom).toHaveBeenCalledWith(client.id, {
      roomType: 'design_doc',
      roomId: 'doc-1',
    });
    finish();
    expect(await result).toEqual({
      status: 'success',
      roomType: 'design_doc',
      roomId: 'doc-1',
    });
  });

  it.each([
    null,
    {},
    { roomType: 'organization', roomId: 'private' },
    { roomType: 'project', roomId: '' },
    { roomType: 'project', roomId: 'private', extra: true },
  ])('rejects malformed departures generically', async (payload) => {
    const { gateway, client, connectionManager } = makeHarness();
    const response = await gateway.handleLeaveRoom(client, payload as never);
    expect(response).toEqual({
      status: 'error',
      reason: 'access_denied',
      message: 'Access denied',
    });
    expect(connectionManager.leaveRoom).not.toHaveBeenCalled();
  });

  it.each(['cli', undefined])(
    'does not admit non-browser departures',
    async (clientType) => {
      const { gateway, client, connectionManager } = makeHarness({
        connection: { userId: 'user', clientType },
      });
      expect(
        await gateway.handleLeaveRoom(client, {
          roomType: 'project',
          roomId: 'private',
        }),
      ).toEqual({
        status: 'error',
        reason: 'access_denied',
        message: 'Access denied',
      });
      expect(connectionManager.leaveRoom).not.toHaveBeenCalled();
    },
  );
});

it('closes a browser socket when adapter failure leaves join membership uncertain', async () => {
  const { gateway, client, connectionManager } = makeHarness();
  connectionManager.addProjectSubscription.mockRejectedValue(
    new Error('adapter failed'),
  );
  const response = await gateway.handleJoinRoom(client, {
    projectId: 'private',
  });
  expect(response).toEqual({
    status: 'error',
    reason: 'access_denied',
    message: 'Access denied',
  });
  expect(client.disconnect).toHaveBeenCalledWith(true);
});
