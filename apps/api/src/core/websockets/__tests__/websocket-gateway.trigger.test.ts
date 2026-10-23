import { Logger } from '@nestjs/common';
import {
  WebSocketConversationTriggerEvent,
  WebSocketMonitorCommandEvent,
} from '../../../generated';
import { UserId } from '../../../types';
import { WebsocketGateway } from '../websocket.gateway';

describe('WebsocketGateway trigger-frame routing', () => {
  // emitConversationTrigger now resolves recipient presence via an async
  // `in(room).allSockets()` call and emits/logs after awaiting it, so tests
  // must let the fire-and-forget microtask chain drain before asserting.
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  function makeGateway(
    options: {
      roomMemberCount?: number;
      roomMemberCounts?: Record<string, number>;
    } = {},
  ) {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
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
    // `this.server` is the `/events` Namespace, so recipient presence is
    // read through the namespace-scoped `in(room).allSockets()` API (async,
    // resolving to the Set of socket ids in the room) — the same call the
    // production code uses.
    const inFn = jest.fn((room: string) => {
      const roomMemberCount =
        options.roomMemberCounts?.[room] ?? options.roomMemberCount ?? 1;
      const socketIds = new Set(
        Array.from(
          { length: roomMemberCount },
          (_, i) => `${room}-socket-${i}`,
        ),
      );
      return { allSockets: jest.fn().mockResolvedValue(socketIds) };
    });
    (gateway as unknown as { server: unknown }).server = {
      to,
      in: inFn,
    };
    return { gateway, to, emit };
  }

  const authorization = {
    kind: 'bounded_grant' as const,
    grantId: 'grant-1',
    target: { kind: 'AGENT_SESSION' as const, id: 'session-1', revision: null },
    agentSessionId: 'session-1',
    authorizedTurnId: 'msg-trigger',
    taskMonitorId: null,
  };

  const conversationFrame: WebSocketConversationTriggerEvent = {
    type: 'trigger.conversation',
    timestamp: new Date().toISOString(),
    organizationId: 'org-1',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    envelope: {
      machineId: 'machine-1',
      userId: 'user-1' as UserId,
      nonce: 'nonce-1',
      timestampMs: Date.now(),
      signature: 'sig',
      protocolVersion: 2,
      authorization,
      event: {
        promptType: 'implement',
        triggerMessageId: 'msg-trigger',
      } as never,
    },
  };

  const monitorCommandFrame: WebSocketMonitorCommandEvent = {
    type: 'trigger.monitor_command',
    timestamp: new Date().toISOString(),
    organizationId: 'org-1',
    projectId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    envelope: {
      machineId: 'machine-1',
      userId: 'user-1' as UserId,
      nonce: '22222222-2222-4222-8222-222222222222',
      timestampMs: Date.now(),
      signature: 'sig',
      event: {
        version: 2,
        kind: 'task_monitor_command',
        commandId: '33333333-3333-4333-8333-333333333333',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        organizationId: '44444444-4444-4444-8444-444444444444',
        projectId: '11111111-1111-4111-8111-111111111111',
        target: {
          workItemType: 'TASK_MONITOR',
          workItemId: '55555555-5555-4555-8555-555555555555',
        },
        command: { cause: 'START', launchConfig: {} as never },
      },
      protocolVersion: 2,
      authorization,
    },
  };

  const neutralMonitorCommandFrame: WebSocketMonitorCommandEvent = {
    ...monitorCommandFrame,
    envelope: {
      machineId: 'machine-1',
      userId: 'user-1' as UserId,
      nonce: '77777777-7777-4777-8777-777777777777',
      timestampMs: Date.now(),
      signature: 'sig',
      protocolVersion: 2,
      event: {
        ...monitorCommandFrame.envelope.event,
        kind: 'task_monitor_authority_neutral',
        command: {
          cause: 'GUIDANCE_CHANGED',
          guidance: 'Prioritize the safety checks.',
        },
      },
    },
  };

  it('routes trigger.conversation only to the recipient machine room', async () => {
    const { gateway, to, emit } = makeGateway();

    gateway.emitConversationTrigger(conversationFrame);
    await flush();

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('machine:machine-1');
    expect(emit).toHaveBeenCalledWith(
      'trigger.conversation',
      conversationFrame,
    );
  });

  it('never routes trigger.conversation to user, project, or conversation rooms', async () => {
    const { gateway, to } = makeGateway();

    gateway.emitConversationTrigger(conversationFrame);
    await flush();

    const targetedRooms = to.mock.calls.map((call) => call[0] as string);
    // The whole point of machine-scoped gating: UI/browser connections in the
    // shared user room must NOT receive trigger envelopes.
    expect(targetedRooms.some((room) => room.startsWith('user:'))).toBe(false);
    expect(targetedRooms.some((room) => room.startsWith('conversation:'))).toBe(
      false,
    );
    expect(targetedRooms.some((room) => room.startsWith('project:'))).toBe(
      false,
    );
  });

  it('does not reroute a bound trigger when its machine is disconnected and another machine is active', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { gateway, to, emit } = makeGateway({
      roomMemberCounts: {
        'machine:machine-1': 0,
        'machine:machine-2': 1,
      },
    });

    gateway.emitConversationTrigger(conversationFrame);
    await flush();

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('machine:machine-1');
    expect(to).not.toHaveBeenCalledWith('machine:machine-2');
    expect(emit).toHaveBeenCalledWith(
      'trigger.conversation',
      conversationFrame,
    );
    warnSpy.mockRestore();
  });

  it('logs a structured warn when no recipient is in the user room (recipientCount=0)', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const { gateway } = makeGateway({ roomMemberCount: 0 });

    gateway.emitConversationTrigger(conversationFrame);
    await flush();

    expect(warnSpy).toHaveBeenCalledWith(
      '[trigger-emit] no recipient for trigger.conversation',
      expect.objectContaining({
        room: 'machine:machine-1',
        conversationId: 'conv-1',
        userId: 'user-1',
        machineId: 'machine-1',
        triggerMessageId: 'msg-trigger',
      }),
    );
    // The healthy-path info log must NOT fire when recipientCount=0.
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[trigger-emit] gateway emit'),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('keeps the info-level log on the healthy path (recipientCount>0) without warning', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const { gateway } = makeGateway({ roomMemberCount: 2 });

    gateway.emitConversationTrigger(conversationFrame);
    await flush();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[trigger-emit] gateway emit room=machine:machine-1 recipientCount=2',
      ),
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      '[trigger-emit] no recipient for trigger.conversation',
      expect.anything(),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('emitConversationTriggerWithAck', () => {
    function makeGatewayWithAck(
      options: {
        roomMemberCount?: number;
        emitWithAckResult?: 'resolve' | 'timeout';
        acknowledgement?: unknown;
      } = {},
    ) {
      const roomMemberCount = options.roomMemberCount ?? 1;
      const socketIds = new Set(
        Array.from({ length: roomMemberCount }, (_, i) => `socket-${i}`),
      );
      const allSockets = jest.fn().mockResolvedValue(socketIds);
      const inFn = jest.fn().mockReturnValue({ allSockets });

      const emitWithAck =
        options.emitWithAckResult === 'timeout'
          ? jest.fn().mockRejectedValue(new Error('operation has timed out'))
          : jest.fn().mockResolvedValue([
              options.acknowledgement ?? {
                status: 'ACCEPTED',
                operationId: '11111111-1111-4111-8111-111111111111',
                operationFingerprint: 'a'.repeat(64),
                replayed: false,
                inputDisposition: 'IMMEDIATE',
              },
            ]);

      const timeoutFn = jest.fn().mockReturnValue({ emitWithAck });
      const toFn = jest.fn().mockReturnValue({ timeout: timeoutFn });

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
        to: toFn,
        in: inFn,
      };
      return { gateway, toFn, timeoutFn, emitWithAck, inFn };
    }

    it('resolves { acknowledged: true } when room has a recipient and emitWithAck resolves', async () => {
      const { gateway, toFn, timeoutFn, emitWithAck } = makeGatewayWithAck({
        roomMemberCount: 1,
        emitWithAckResult: 'resolve',
      });

      const result = await gateway.emitConversationTriggerWithAck(
        conversationFrame,
        4000,
      );

      expect(result).toEqual({
        acknowledged: true,
        acknowledgement: {
          status: 'ACCEPTED',
          operationId: '11111111-1111-4111-8111-111111111111',
          operationFingerprint: 'a'.repeat(64),
          replayed: false,
          inputDisposition: 'IMMEDIATE',
        },
      });
      expect(toFn).toHaveBeenCalledWith('machine:machine-1');
      expect(timeoutFn).toHaveBeenCalledWith(4000);
      expect(emitWithAck).toHaveBeenCalledWith(
        'trigger.conversation',
        conversationFrame,
      );
    });

    it('resolves { acknowledged: false, reason: "no_recipient" } without calling emitWithAck when room is empty', async () => {
      const { gateway, emitWithAck } = makeGatewayWithAck({
        roomMemberCount: 0,
      });

      const result = await gateway.emitConversationTriggerWithAck(
        conversationFrame,
        4000,
      );

      expect(result).toEqual({ acknowledged: false, reason: 'no_recipient' });
      expect(emitWithAck).not.toHaveBeenCalled();
    });

    it('resolves { acknowledged: false, reason: "timeout" } when emitWithAck rejects', async () => {
      const { gateway } = makeGatewayWithAck({
        roomMemberCount: 1,
        emitWithAckResult: 'timeout',
      });

      const result = await gateway.emitConversationTriggerWithAck(
        conversationFrame,
        4000,
      );

      expect(result).toEqual({ acknowledged: false, reason: 'timeout' });
    });

    it.each([
      ['missing', undefined],
      ['unknown', 'STARTED'],
    ])(
      'treats an acceptance with a %s input disposition as invalid',
      async (_label, inputDisposition) => {
        const { gateway } = makeGatewayWithAck({
          acknowledgement: {
            status: 'ACCEPTED',
            operationId: '11111111-1111-4111-8111-111111111111',
            operationFingerprint: 'a'.repeat(64),
            replayed: false,
            ...(inputDisposition ? { inputDisposition } : {}),
          },
        });

        await expect(
          gateway.emitConversationTriggerWithAck(conversationFrame, 4000),
        ).resolves.toEqual({
          acknowledged: false,
          reason: 'invalid_acknowledgement',
        });
      },
    );

    it('returns a typed CLI rejection instead of treating callback receipt as acceptance', async () => {
      const rejection = {
        status: 'REJECTED',
        stage: 'ADMISSION',
        reason: 'AUTHORIZATION_REJECTED',
      };
      const { gateway } = makeGatewayWithAck({ acknowledgement: rejection });

      await expect(
        gateway.emitConversationTriggerWithAck(conversationFrame, 4000),
      ).resolves.toEqual({
        acknowledged: false,
        reason: 'cli_rejected',
        acknowledgement: rejection,
      });
    });
  });

  describe('emitMonitorCommandWithAck', () => {
    const makeMonitorGateway = (
      roomMemberCount: number,
      acknowledgement: unknown,
    ) => {
      const socketIds = new Set(
        Array.from({ length: roomMemberCount }, (_, i) => `socket-${i}`),
      );
      const allSockets = jest.fn().mockResolvedValue(socketIds);
      const inFn = jest.fn().mockReturnValue({ allSockets });
      const emitWithAck = jest.fn().mockResolvedValue([acknowledgement]);
      const timeout = jest.fn().mockReturnValue({ emitWithAck });
      const to = jest.fn().mockReturnValue({ timeout });
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
      (gateway as unknown as { server: unknown }).server = { in: inFn, to };
      return { gateway, to };
    };

    it('targets exactly one verified socket when a machine room has overlapping connections', async () => {
      const { gateway, to } = makeMonitorGateway(2, {
        status: 'ADMITTED',
        commandId: monitorCommandFrame.envelope.event.commandId,
        replayed: false,
      });

      await expect(
        gateway.emitMonitorCommandWithAck(monitorCommandFrame, 4000),
      ).resolves.toMatchObject({ status: 'ADMITTED' });
      expect(to).toHaveBeenCalledWith('socket-0');
      expect(to).not.toHaveBeenCalledWith('machine:machine-1');
    });

    it('treats malformed acknowledgements as undelivered', async () => {
      const { gateway } = makeMonitorGateway(1, {
        status: 'ADMITTED',
        commandId: '66666666-6666-4666-8666-666666666666',
        replayed: false,
      });

      await expect(
        gateway.emitMonitorCommandWithAck(monitorCommandFrame, 4000),
      ).resolves.toBeNull();
    });

    it('accepts a durable guidance-required rejection from the CLI', async () => {
      const acknowledgement = {
        status: 'REJECTED',
        commandId: monitorCommandFrame.envelope.event.commandId,
        stage: 'ADMISSION',
        reason: 'GUIDANCE_REQUIRED',
      };
      const { gateway } = makeMonitorGateway(1, acknowledgement);

      await expect(
        gateway.emitMonitorCommandWithAck(monitorCommandFrame, 4000),
      ).resolves.toEqual(acknowledgement);
    });

    it('delivers a signed authority-neutral command without controller authorization', async () => {
      const acknowledgement = {
        status: 'ADMITTED',
        commandId: neutralMonitorCommandFrame.envelope.event.commandId,
        replayed: false,
      };
      const { gateway, to } = makeMonitorGateway(1, acknowledgement);

      await expect(
        gateway.emitMonitorCommandWithAck(neutralMonitorCommandFrame, 4000),
      ).resolves.toEqual(acknowledgement);
      expect(to).toHaveBeenCalledWith('socket-0');
    });
  });
});
