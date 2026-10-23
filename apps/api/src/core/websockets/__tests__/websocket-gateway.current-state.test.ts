import { Socket } from 'socket.io';
import {
  AgentSessionCurrentState,
  AgentSessionCurrentStateObservation,
  ConversationPhaseObservation,
  WebSocketAgentSessionCurrentStateChangedEvent,
  WebSocketSubscriptionRequest,
} from '../../../generated';
import { AgentSessionService } from '../../../services/agent-session.service';
import { PendingTriggerService } from '../../../services/workflows/pending-trigger.service';
import { UserAccessTokenValidatorService } from '../../../auth/services/user-access-token-validator.service';
import {
  MachineChallengeService,
  MachineLookup,
} from '../machine-challenge.service';
import { MachinePresenceService } from '../machine-presence.service';
import { WebsocketAuthorizationService } from '../websocket-authorization.service';
import { WebsocketConnectionManager } from '../websocket-connection-manager.service';
import { WebsocketGateway } from '../websocket.gateway';
import { TriggerEmitter } from '../trigger-emitter.service';

function makeHarness(initialize = true) {
  const mockEmitTo = jest.fn();
  const mockTo = jest.fn().mockReturnValue({ emit: mockEmitTo });
  const mockServer = { to: mockTo } as unknown as any;
  const connection = {
    id: 'socket-1',
    userId: 'user-1',
    machineId: 'machine-1',
    organizationIds: ['org-1'],
    projectIds: ['project-1'],
    conversationIds: ['conversation-1'],
    initiativeIds: [],
    designDocIds: [],
    clientType: 'cli',
  };
  const connectionManager = {
    serializeRoomOperation: jest.fn((_id, operation) => operation()),
    addConnection: jest.fn(),
    removeConnection: jest.fn(),
    resetAuthorizationState: jest.fn().mockResolvedValue(undefined),
    updateActivity: jest.fn(),
    getConnection: jest.fn().mockReturnValue(connection),
    getConversationConnections: jest.fn().mockReturnValue([]),
  } as unknown as jest.Mocked<WebsocketConnectionManager>;
  const agentSessionService = {
    observeCurrentState: jest.fn().mockResolvedValue({
      outcome: 'transition',
      transition: {
        reason: 'observation',
        entry: {
          schemaVersion: 1,
          agentSessionId: 'session-1',
          organizationId: 'org-1',
          projectId: 'project-1',
          userId: 'user-1',
          machineId: 'machine-1',
          conversationId: null,
          currentState: AgentSessionCurrentState.Thinking,
          revision: 4,
          transitionedAt: '2026-08-07T12:00:00.000Z',
          observedAt: '2026-08-07T12:00:00.000Z',
          observedAtMs: 1780000000000,
        },
      },
    }),
    clearRuntimeCurrentState: jest.fn().mockResolvedValue(1),
  } as unknown as jest.Mocked<AgentSessionService>;
  const projection = {
    setTransitionSink: jest.fn(),
  } as any;
  const conversationPhaseProjection = {
    setTransitionSink: jest.fn(),
    observe: jest.fn().mockResolvedValue({ outcome: 'transition' }),
    disconnect: jest.fn().mockResolvedValue(0),
    read: jest.fn().mockResolvedValue(null),
  } as any;
  const prisma = {
    db: {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conversation-1',
          organizationId: 'org-1',
          projectId: 'project-1',
        }),
      },
    },
  } as any;
  const gateway = new WebsocketGateway(
    { registerRevalidation: jest.fn() } as never,
    connectionManager,
    {} as jest.Mocked<UserAccessTokenValidatorService>,
    {} as jest.Mocked<PendingTriggerService>,
    {} as jest.Mocked<TriggerEmitter>,
    {} as jest.Mocked<MachineChallengeService>,
    agentSessionService,
    {} as jest.Mocked<MachinePresenceService>,
    {} as jest.Mocked<WebsocketAuthorizationService>,
    { register: jest.fn(), unregister: jest.fn() } as any,
    projection,
    undefined,
    undefined,
    undefined,
    conversationPhaseProjection,
    prisma,
  );
  (gateway as any).server = mockServer;
  if (initialize) {
    gateway.afterInit();
  }
  const client = {
    id: 'socket-1',
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket;
  return {
    gateway,
    client,
    connectionManager,
    agentSessionService,
    projection,
    conversationPhaseProjection,
    prisma,
    mockTo,
    mockEmitTo,
  };
}

describe('WebsocketGateway — Agent Session current state', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('binds projection fan-out only after the websocket server initializes', () => {
    const { gateway, projection } = makeHarness(false);

    expect(projection.setTransitionSink).not.toHaveBeenCalled();

    gateway.afterInit();

    expect(projection.setTransitionSink).toHaveBeenCalledTimes(1);
  });

  it('passes only authenticated socket context to the Agent Session owner', async () => {
    const { gateway, client, agentSessionService } = makeHarness();
    const observation: AgentSessionCurrentStateObservation = {
      agentSessionId: 'session-1',
      currentState: AgentSessionCurrentState.Thinking,
      observedAt: '2026-08-07T12:00:00.000Z',
    };

    await gateway.handleAgentSessionCurrentStateObserved(client, observation);

    expect(agentSessionService.observeCurrentState).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'socket-1',
        userId: 'user-1',
        machineId: 'machine-1',
        organizationIds: ['org-1'],
        projectIds: ['project-1'],
      }),
      observation,
    );
  });

  it('emits one complete project-scoped generated event for an effective transition', () => {
    const { gateway, mockTo, mockEmitTo } = makeHarness();
    const sink = (gateway as any).currentStateProjection.setTransitionSink.mock
      .calls[0][0];
    sink({
      reason: 'observation',
      entry: {
        schemaVersion: 1,
        agentSessionId: 'session-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        userId: 'user-1',
        machineId: 'machine-1',
        currentState: AgentSessionCurrentState.Thinking,
        revision: 4,
        transitionedAt: '2026-08-07T12:00:00.000Z',
        observedAt: '2026-08-07T12:00:00.000Z',
        observedAtMs: 178,
      },
    });

    expect(mockTo).toHaveBeenCalledWith('project:project-1');
    expect(mockEmitTo).toHaveBeenCalledTimes(1);
    expect(mockEmitTo).toHaveBeenCalledWith(
      WebSocketSubscriptionRequest.EventTypesEnum
        .AgentSessionCurrentStateChanged,
      expect.objectContaining({
        type: WebSocketAgentSessionCurrentStateChangedEvent.TypeEnum
          .AgentSessionCurrentStateChanged,
        agentSessionId: 'session-1',
        currentState: 'THINKING',
        revision: 4,
        transitionedAt: '2026-08-07T12:00:00.000Z',
      }),
    );
  });

  it('rejects conversation phase observations outside the authenticated room scope', async () => {
    const { gateway, client, conversationPhaseProjection } = makeHarness();
    const observation: ConversationPhaseObservation = {
      conversationId: 'conversation-outside-scope',
      phase: 'reviewing',
      observedAt: '2026-08-25T00:00:00.000Z',
    };

    await gateway.handleConversationPhaseObserved(client, observation);

    expect(conversationPhaseProjection.observe).not.toHaveBeenCalled();
  });

  it('passes authorized conversation phase observations through the durable scope', async () => {
    const { gateway, client, conversationPhaseProjection } = makeHarness();
    const observation: ConversationPhaseObservation = {
      conversationId: 'conversation-1',
      phase: 'reviewing',
      observedAt: '2026-08-25T00:00:00.000Z',
    };

    await gateway.handleConversationPhaseObserved(client, observation);

    expect(conversationPhaseProjection.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'socket-1',
        userId: 'user-1',
        machineId: 'machine-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        conversationId: 'conversation-1',
      }),
      'reviewing',
      observation.observedAt,
    );
  });
});
