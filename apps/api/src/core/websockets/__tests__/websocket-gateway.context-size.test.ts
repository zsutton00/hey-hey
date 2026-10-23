import { Socket } from 'socket.io';
import {
  AgentSessionContextSizeObservation,
  WebSocketAgentSessionContextSizeChangedEvent,
  WebSocketSubscriptionRequest,
} from '../../../generated';
import { AgentSessionService } from '../../../services/agent-session.service';
import { PendingTriggerService } from '../../../services/workflows/pending-trigger.service';
import { UserAccessTokenValidatorService } from '../../../auth/services/user-access-token-validator.service';
import { MachineChallengeService } from '../machine-challenge.service';
import { MachinePresenceService } from '../machine-presence.service';
import { WebsocketAuthorizationService } from '../websocket-authorization.service';
import { WebsocketConnectionManager } from '../websocket-connection-manager.service';
import { WebsocketGateway } from '../websocket.gateway';
import { TriggerEmitter } from '../trigger-emitter.service';

function makeHarness() {
  const mockEmitTo = jest.fn();
  const mockTo = jest.fn().mockReturnValue({ emit: mockEmitTo });
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
  const getConnection = jest.fn().mockReturnValue(connection);
  const observeContextSize = jest.fn().mockResolvedValue({
    outcome: 'applied',
    organizationId: 'org-1',
    projectId: 'project-1',
    userId: 'user-1',
    conversationId: 'conversation-1',
    contextSize: {
      totalTokens: 151_000,
      runId: 'run-1',
      providerSessionId: 'provider-1',
      observedAt: '2026-10-04T00:00:00.000Z',
    },
  });
  const gateway = new WebsocketGateway(
    { registerRevalidation: jest.fn() } as never,
    { getConnection } as unknown as WebsocketConnectionManager,
    {} as UserAccessTokenValidatorService,
    {} as PendingTriggerService,
    {} as TriggerEmitter,
    {} as MachineChallengeService,
    { observeContextSize } as unknown as AgentSessionService,
    {} as MachinePresenceService,
    {} as WebsocketAuthorizationService,
    { register: jest.fn(), unregister: jest.fn() } as never,
  );
  Object.assign(gateway, { server: { to: mockTo } });
  const client = { id: 'socket-1' } as unknown as Socket;
  return {
    gateway,
    client,
    getConnection,
    observeContextSize,
    mockTo,
    mockEmitTo,
  };
}

const observation: AgentSessionContextSizeObservation = {
  agentSessionId: 'session-1',
  runId: 'run-1',
  providerSessionId: 'provider-1',
  totalTokens: 151_000,
  observedAt: '2026-10-04T00:00:00.000Z',
};

describe('WebsocketGateway — Agent Session context size', () => {
  it('passes only authenticated socket context to the Agent Session owner', async () => {
    const { gateway, client, observeContextSize } = makeHarness();

    await gateway.handleAgentSessionContextSizeObserved(client, observation);

    expect(observeContextSize).toHaveBeenCalledWith(
      {
        connectionId: 'socket-1',
        userId: 'user-1',
        machineId: 'machine-1',
        organizationIds: ['org-1'],
        projectIds: ['project-1'],
      },
      observation,
    );
  });

  it('relays an applied reading to the project room', async () => {
    const { gateway, client, mockTo, mockEmitTo } = makeHarness();

    await gateway.handleAgentSessionContextSizeObserved(client, observation);

    expect(mockTo).toHaveBeenCalledWith('project:project-1');
    expect(mockEmitTo).toHaveBeenCalledWith(
      WebSocketSubscriptionRequest.EventTypesEnum
        .AgentSessionContextSizeChanged,
      expect.objectContaining({
        type: WebSocketAgentSessionContextSizeChangedEvent.TypeEnum
          .AgentSessionContextSizeChanged,
        organizationId: 'org-1',
        projectId: 'project-1',
        agentSessionId: 'session-1',
        contextSize: {
          totalTokens: 151_000,
          runId: 'run-1',
          providerSessionId: 'provider-1',
          observedAt: '2026-10-04T00:00:00.000Z',
        },
      }),
    );
  });

  it('does not relay a stale reading', async () => {
    const { gateway, client, observeContextSize, mockEmitTo } = makeHarness();
    observeContextSize.mockResolvedValue({
      outcome: 'stale',
    });

    await gateway.handleAgentSessionContextSizeObserved(client, observation);

    expect(mockEmitTo).not.toHaveBeenCalled();
  });

  it('rejects observations from non-CLI sockets without consulting the owner', async () => {
    const { gateway, client, getConnection, observeContextSize, mockEmitTo } =
      makeHarness();
    getConnection.mockReturnValue({
      id: 'socket-1',
      userId: 'user-1',
      organizationIds: ['org-1'],
      projectIds: ['project-1'],
      clientType: 'browser',
    });

    await gateway.handleAgentSessionContextSizeObserved(client, observation);

    expect(observeContextSize).not.toHaveBeenCalled();
    expect(mockEmitTo).not.toHaveBeenCalled();
  });

  it('swallows an authorization rejection without relaying', async () => {
    const { gateway, client, observeContextSize, mockEmitTo } = makeHarness();
    observeContextSize.mockRejectedValue(
      new Error('Agent Session runtime observation denied'),
    );

    await expect(
      gateway.handleAgentSessionContextSizeObserved(client, observation),
    ).resolves.toBeUndefined();
    expect(mockEmitTo).not.toHaveBeenCalled();
  });
});
