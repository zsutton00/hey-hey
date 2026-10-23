import { WebsocketGateway } from '../websocket.gateway';

const machineId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const agentSessionId = '55555555-5555-4555-8555-555555555555';
const requestId = '66666666-6666-4666-8666-666666666666';

const authorization = {
  kind: 'bounded_grant' as const,
  grantId: '77777777-7777-4777-8777-777777777777',
  target: {
    kind: 'AGENT_SESSION' as const,
    id: agentSessionId,
    revision: null,
  },
  agentSessionId,
  authorizedTurnId: '88888888-8888-4888-8888-888888888888',
  taskMonitorId: null,
};

const cliReadFrame = (currentRequestId: string = requestId) =>
  ({
    type: 'cli.read.request',
    timestamp: new Date().toISOString(),
    organizationId: '99999999-9999-4999-8999-999999999999',
    projectId,
    conversationId,
    userId,
    envelope: {
      machineId,
      userId,
      nonce: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      timestampMs: Date.now(),
      signature: 'signature',
      protocolVersion: 2,
      authorization,
      event: {
        requestId: currentRequestId,
        agentSessionId,
        operation: 'run.context_usage.get',
        runId: agentSessionId,
        providerSessionId: 'provider-session-id',
      },
    },
  }) as never;

function makeGateway() {
  let recipientCount = 1;
  const allSockets = jest.fn(async () =>
    recipientCount > 0 ? new Set(['socket-1']) : new Set<string>(),
  );
  const emitWithAck = jest.fn();
  const timeout = jest.fn(() => ({ emitWithAck }));
  const to = jest.fn(() => ({ timeout }));
  const inRoom = jest.fn(() => ({ allSockets }));
  const gateway = new WebsocketGateway(
    { registerRevalidation: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (gateway as unknown as { server: unknown }).server = {
    in: inRoom,
    to,
  };

  return {
    gateway,
    allSockets,
    emitWithAck,
    inRoom,
    setRecipientCount: (count: number) => {
      recipientCount = count;
    },
    timeout,
    to,
  };
}

describe('WebsocketGateway CLI-read delivery', () => {
  it('delivers a live acknowledgement without buffering the payload', async () => {
    const { gateway, emitWithAck, inRoom, timeout, to } = makeGateway();
    const acknowledgement = {
      requestId,
      operation: 'run.context_usage.get',
      status: 'success',
      result: { contextData: { privateTelemetry: 'live-only' } },
    };
    emitWithAck.mockResolvedValue([acknowledgement]);

    await expect(
      gateway.emitCliReadWithAck(cliReadFrame(), 30_000),
    ).resolves.toEqual({ kind: 'ack', value: [acknowledgement] });

    expect(inRoom).toHaveBeenCalledWith(`machine:${machineId}`);
    expect(to).toHaveBeenCalledWith(`machine:${machineId}`);
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(emitWithAck).toHaveBeenCalledWith(
      'cli.read.request',
      expect.objectContaining({ type: 'cli.read.request' }),
    );
    expect(
      (gateway as unknown as { pendingEmits: unknown[] }).pendingEmits,
    ).toHaveLength(0);
  });

  it('does not replay a read that had no recipient after reconnect', async () => {
    const { gateway, emitWithAck, setRecipientCount } = makeGateway();
    emitWithAck.mockResolvedValue([{ requestId, status: 'success' }]);
    setRecipientCount(0);

    await expect(
      gateway.emitCliReadWithAck(cliReadFrame(), 5_000),
    ).resolves.toEqual({ kind: 'no_recipient' });
    expect(emitWithAck).not.toHaveBeenCalled();

    setRecipientCount(1);
    await expect(
      gateway.emitCliReadWithAck(
        cliReadFrame('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        5_000,
      ),
    ).resolves.toEqual({
      kind: 'ack',
      value: [{ requestId, status: 'success' }],
    });
    expect(emitWithAck).toHaveBeenCalledTimes(1);
  });

  it('returns a failed delivery as transient and permits an explicit retry', async () => {
    const { gateway, emitWithAck } = makeGateway();
    emitWithAck
      .mockRejectedValueOnce(new Error('socket timeout'))
      .mockResolvedValueOnce([{ requestId, status: 'success' }]);

    await expect(
      gateway.emitCliReadWithAck(cliReadFrame(), 5_000),
    ).resolves.toEqual({ kind: 'timeout' });
    await expect(
      gateway.emitCliReadWithAck(
        cliReadFrame('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        5_000,
      ),
    ).resolves.toEqual({
      kind: 'ack',
      value: [{ requestId, status: 'success' }],
    });
    expect(emitWithAck).toHaveBeenCalledTimes(2);
  });
});
