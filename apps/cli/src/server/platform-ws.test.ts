import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { NOOP_LOGGER } from './logger';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { createTestOAuthClient } from './__tests__/helpers/test-oauth-client';
import { MachineChallengeSigner } from './machine-challenge';
import { PlatformWebSocketManager } from './platform-ws';
import type { CliReadResponseDto } from '../shared/agent-bridge-contract/generated/api';
import type { CliReadHandler } from './cli-read-handler';
import type { ServerLogger } from './logger';
import { MAX_CLI_READ_ACK_BYTES } from './cli-read-response-size-guard';
import {
  authResponseRevokedReasonSchema,
  conversationUpdatedFrameSchema,
} from './platform-ws-schemas';

type EmitArgs = { event: string; payload: unknown };

interface MockSocket extends EventEmitter {
  emit: (event: string, ...args: unknown[]) => boolean;
  onAny: (listener: (event: string, ...args: unknown[]) => void) => void;
  disconnect: () => void;
  connected: boolean;
  id: string;
  _emits: EmitArgs[];
}

const ioFactory = vi.fn<(url: string, opts: unknown) => MockSocket>();

vi.mock('socket.io-client', () => ({
  io: (url: string, opts: unknown) => ioFactory(url, opts),
}));

const encodeTokenWithOrg = (orgId: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ organizationId: orgId })).toString('base64url');
  return `${header}.${payload}.sig`;
};

const createMockSocket = (): MockSocket => {
  const emitter = new EventEmitter() as MockSocket;
  emitter._emits = [];
  emitter.connected = false;
  emitter.id = 'socket-test-id';
  const realEmit = emitter.emit.bind(emitter);
  emitter.emit = (event: string, ...args: unknown[]): boolean => {
    emitter._emits.push({ event, payload: args[0] });
    return realEmit(event, ...args);
  };
  emitter.disconnect = vi.fn(() => {
    emitter.connected = false;
    realEmit('disconnect', 'manual');
  });
  emitter.onAny = (_listener: (event: string, ...args: unknown[]) => void): void => {
    // The real socket.io client routes every event through onAny for
    // diagnostics. The platform-ws code only logs there, so the mock
    // accepts and ignores the listener.
  };
  return emitter;
};

const fakeOAuthClient = (orgId: string) =>
  createTestOAuthClient({
    getAccessToken: async () => ({ success: true, data: encodeTokenWithOrg(orgId) }),
  });

interface TestKeyPairStoreOptions {
  machineId?: string | null;
  credential?: string | null;
  privateKey?: string | null;
  deleteMachineCredential?: (machineId: string) => Promise<void>;
}

const createPlatformKeyPairStore = ({
  machineId = null,
  credential = null,
  privateKey = null,
  deleteMachineCredential = async () => {},
}: TestKeyPairStoreOptions = {}) => {
  const keyPairStore = createTestKeyPairStore();
  vi.spyOn(keyPairStore, 'loadCurrentMachineId').mockResolvedValue(machineId);
  vi.spyOn(keyPairStore, 'loadMachineCredential').mockResolvedValue(credential);
  vi.spyOn(keyPairStore, 'loadPrivateKey').mockResolvedValue(privateKey);
  vi.spyOn(keyPairStore, 'deleteMachineCredential').mockImplementation(deleteMachineCredential);
  return keyPairStore;
};

describe('conversationUpdatedFrameSchema', () => {
  const baseFrame = {
    type: 'conversation.updated',
    timestamp: '2026-08-25T20:15:42.780Z',
    organizationId: 'org-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    previousVersion: 1,
    newVersion: 2,
  } as const;

  it.each(['message_prepended', 'message_deleted'] as const)(
    'accepts the generated %s change type',
    (changeType) => {
      expect(conversationUpdatedFrameSchema.safeParse({ ...baseFrame, changeType }).success).toBe(
        true,
      );
    },
  );

  it('rejects a change type outside the generated contract', () => {
    expect(
      conversationUpdatedFrameSchema.safeParse({
        ...baseFrame,
        changeType: 'message_reordered',
      }).success,
    ).toBe(false);
  });
});

describe('PlatformWebSocketManager (per Agent Session)', () => {
  let currentSocket: MockSocket;

  beforeEach(() => {
    currentSocket = createMockSocket();
    ioFactory.mockReset();
    ioFactory.mockImplementation(() => currentSocket);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(MachineChallengeSigner.prototype, 'sign').mockResolvedValue(null);
  });

  afterEach(() => {
    ioFactory.mockReset();
    vi.restoreAllMocks();
  });

  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  it('keeps public callback methods bound to the manager instance', async () => {
    const manager = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });
    const subscribe = manager.subscribe;
    const getCurrentUserId = manager.getCurrentUserId;

    subscribe('conv-bound');
    await flush();

    expect(ioFactory).toHaveBeenCalledTimes(1);
    expect(getCurrentUserId()).toBeNull();
    manager.disconnect();
  });

  it('sends a subscribe payload with the full conversationIds set after authentication', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribe('conv-1');
    client.subscribe('conv-2');
    await flush();

    // Simulate socket connecting + authentication round-trip.
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', {
      status: 'success',
      projectIds: [],
      conversationIds: ['conv-1', 'conv-2'],
    });
    await flush();

    const subscribeEmits = currentSocket._emits.filter((e) => e.event === 'subscribe');
    expect(subscribeEmits.length).toBeGreaterThan(0);
    const lastSubscribe = subscribeEmits.at(-1)!;
    const payload = lastSubscribe.payload as { conversationIds: string[] };
    expect(payload.conversationIds.sort()).toEqual(['conv-1', 'conv-2']);
  });

  it('emits unsubscribe for a removed conversation and re-sends subscribe with the remaining set', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribe('conv-1');
    client.subscribe('conv-2');
    await flush();

    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', {
      status: 'success',
      projectIds: [],
      conversationIds: ['conv-1', 'conv-2'],
    });
    await flush();

    currentSocket._emits.length = 0;
    client.unsubscribe('conv-1');

    const unsubscribeEmits = currentSocket._emits.filter((e) => e.event === 'unsubscribe');
    expect(unsubscribeEmits.length).toBe(1);
    expect((unsubscribeEmits[0]!.payload as { conversationIds: string[] }).conversationIds).toEqual(
      ['conv-1'],
    );

    const subscribeEmits = currentSocket._emits.filter((e) => e.event === 'subscribe');
    expect(subscribeEmits.length).toBe(1);
    expect((subscribeEmits[0]!.payload as { conversationIds: string[] }).conversationIds).toEqual([
      'conv-2',
    ]);
  });

  it('re-emits subscribe with current set when a new conversation is added while connected', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribe('conv-1');
    await flush();

    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', { status: 'success' });
    await flush();

    currentSocket._emits.length = 0;
    client.subscribe('conv-2');

    const subscribeEmits = currentSocket._emits.filter((e) => e.event === 'subscribe');
    expect(subscribeEmits.length).toBe(1);
    expect(
      (subscribeEmits[0]!.payload as { conversationIds: string[] }).conversationIds.sort(),
    ).toEqual(['conv-1', 'conv-2']);
  });

  it('invokes onReconnect listeners after authentication completes', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    const reconnects: number[] = [];
    client.onReconnect(() => reconnects.push(Date.now()));

    client.subscribe('conv-1');
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', { status: 'success' });
    await flush();

    expect(reconnects.length).toBe(1);

    // A second authentication round (simulated reconnect path) should notify
    // listeners again so they can re-run any state projections.
    currentSocket.emit('authenticated', { status: 'success' });
    await flush();

    expect(reconnects.length).toBe(2);
  });

  it('emits a generated Agent Session current-state observation after authentication', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    await flush();
    client.subscribe('conv-1');
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', { status: 'success' });
    await flush();

    currentSocket._emits.length = 0;
    client.emitAgentSessionCurrentStateObservation({
      agentSessionId: '00000000-0000-4000-8000-000000000001',
      currentState: 'STARTING',
      observedAt: '2026-07-01T00:00:00.000Z',
    });
    await flush();

    expect(currentSocket._emits).toContainEqual({
      event: 'agent_session.current_state_observed',
      payload: {
        agentSessionId: '00000000-0000-4000-8000-000000000001',
        currentState: 'STARTING',
        observedAt: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(currentSocket._emits.some(({ event }) => event === 'conversation.phase')).toBe(false);
  });

  it('includes projectIds in the subscribe payload after subscribeProject', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribe('conv-1');
    client.subscribeProject('proj-1');
    await flush();

    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', {
      status: 'success',
      projectIds: ['proj-1'],
      conversationIds: ['conv-1'],
    });
    await flush();

    const subscribeEmits = currentSocket._emits.filter((e) => e.event === 'subscribe');
    expect(subscribeEmits.length).toBeGreaterThan(0);
    const lastSubscribe = subscribeEmits.at(-1)!;
    const payload = lastSubscribe.payload as {
      conversationIds: string[];
      projectIds: string[];
    };
    expect(payload.conversationIds).toEqual(['conv-1']);
    expect(payload.projectIds).toEqual(['proj-1']);
  });

  it('rejects an oversized complete changed-file detail without disrupting the authenticated socket', async () => {
    const sizeGuardLogs: Array<{
      event: string;
      fields: Record<string, unknown> | undefined;
    }> = [];
    const logger: ServerLogger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: (event, fields) => {
        if (event === 'cli-read.response.size_guard') {
          sizeGuardLogs.push({ event, fields });
        }
      },
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    };
    const response = {
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'run.changed_files.detail',
      status: 'success',
      result: {
        runId: '22222222-2222-4222-8222-222222222222',
        file: {
          serviceId: '66666666-6666-4666-8666-666666666666',
          repoPath: '/tmp/repository',
          filePath: 'src/example.ts',
          status: 'modify',
          diff: 'd'.repeat(400_000),
          preContent: 'p'.repeat(400_000),
          postContent: 'q'.repeat(400_000),
        },
      },
    } satisfies CliReadResponseDto;
    const handle = vi
      .fn<(rawFrame: unknown) => Promise<CliReadResponseDto | null>>()
      .mockResolvedValue(response);
    const handler = { handle } as unknown as CliReadHandler;
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribe('conv-1');
    client.subscribeProject('project-1');
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', { status: 'success', userId: 'user-1' });
    await flush();
    client.setCliReadHandler(handler);

    const acknowledgements: unknown[] = [];
    currentSocket.emit(
      'cli.read.request',
      { type: 'cli.read.request' },
      (acknowledgement: unknown) => acknowledgements.push(acknowledgement),
    );
    await flush();

    expect(handle).toHaveBeenCalledOnce();
    expect(response.result.file.diff.length).toBeLessThanOrEqual(1_048_576);
    expect(response.result.file.preContent?.length).toBeLessThanOrEqual(1_048_576);
    expect(response.result.file.postContent?.length).toBeLessThanOrEqual(1_048_576);
    expect(Buffer.byteLength(JSON.stringify({ file: response.result.file }), 'utf8')).toBeLessThan(
      3_200_000,
    );
    expect(acknowledgements).toEqual([
      {
        requestId: response.requestId,
        operation: 'run.changed_files.detail',
        status: 'error',
        error: {
          code: 'RESULT_TOO_LARGE',
          message: 'The CLI read response exceeds the WebSocket acknowledgement size limit.',
        },
      },
    ]);
    expect(JSON.stringify(acknowledgements[0])).not.toContain('pre-image');
    expect(JSON.stringify(acknowledgements[0])).not.toContain('post-image');
    expect(JSON.stringify(acknowledgements[0])).not.toContain('dddd');
    expect(currentSocket.connected).toBe(true);
    expect(client.getCurrentUserId()).toBe('user-1');
    expect(sizeGuardLogs).toHaveLength(1);
    expect(sizeGuardLogs[0]?.fields).toMatchObject({
      requestId: response.requestId,
      operation: response.operation,
      acknowledgementBudgetBytes: MAX_CLI_READ_ACK_BYTES,
      replaced: true,
    });
    expect(sizeGuardLogs[0]?.fields?.['serializedBytes']).toBeGreaterThan(MAX_CLI_READ_ACK_BYTES);

    client.subscribe('conv-2');
    client.subscribeProject('project-2');
    const subscribeEmits = currentSocket._emits.filter((entry) => entry.event === 'subscribe');
    const lastSubscribe = subscribeEmits.at(-1)!;
    expect(lastSubscribe.payload).toEqual({
      eventTypes: expect.any(Array),
      conversationIds: ['conv-1', 'conv-2'],
      projectIds: ['project-1', 'project-2'],
    });
    expect(currentSocket.connected).toBe(true);

    client.disconnect();
  });

  it('submits persisted desired scope even when authentication returns no rooms', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribeProject('persisted-project');
    await flush();

    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', {
      status: 'success',
      projectIds: [],
      conversationIds: [],
    });
    await flush();

    const subscribeEmits = currentSocket._emits.filter((e) => e.event === 'subscribe');
    expect(subscribeEmits).toHaveLength(1);
    expect(subscribeEmits[0]!.payload).toMatchObject({
      conversationIds: [],
      projectIds: ['persisted-project'],
    });
  });

  it('subscribeProject is idempotent on duplicate project ids', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribeProject('proj-1');
    client.subscribeProject('proj-1');
    await flush();

    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', {
      status: 'success',
      projectIds: ['proj-1'],
      conversationIds: [],
    });
    await flush();

    const subscribeEmits = currentSocket._emits.filter((e) => e.event === 'subscribe');
    expect(subscribeEmits.length).toBe(1);
    const payload = subscribeEmits[0]!.payload as { projectIds: string[] };
    expect(payload.projectIds).toEqual(['proj-1']);
  });

  it('subscribeProject re-emits subscribe when added while already connected', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribe('conv-1');
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', { status: 'success' });
    await flush();

    currentSocket._emits.length = 0;
    client.subscribeProject('proj-1');

    const subscribeEmits = currentSocket._emits.filter((e) => e.event === 'subscribe');
    expect(subscribeEmits.length).toBe(1);
    const payload = subscribeEmits[0]!.payload as {
      conversationIds: string[];
      projectIds: string[];
    };
    expect(payload.conversationIds).toEqual(['conv-1']);
    expect(payload.projectIds).toEqual(['proj-1']);
  });

  it('exposes the userId extracted from the access token', async () => {
    const encodeTokenWithOrgAndUser = (orgId: string, userId: string): string => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ organizationId: orgId, userId })).toString(
        'base64url',
      );
      return `${header}.${payload}.sig`;
    };
    const oauth = createTestOAuthClient({
      getAccessToken: async () => ({
        success: true,
        data: encodeTokenWithOrgAndUser('org-1', 'user-42'),
      }),
    });

    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: oauth,
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    expect(client.getCurrentUserId()).toBeNull();

    client.subscribeProject('proj-1');
    await flush();

    expect(client.getCurrentUserId()).toBe('user-42');
  });

  it('reconnects upstream after a disconnect and carries newly-attached conversations', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const firstSocket = createMockSocket();
      const secondSocket = createMockSocket();
      let callCount = 0;
      ioFactory.mockImplementation(() => {
        callCount += 1;
        return callCount === 1 ? firstSocket : secondSocket;
      });

      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
      });

      client.subscribe('conv-1');
      await flush();
      firstSocket.connected = true;
      firstSocket.emit('connect');
      await flush();
      firstSocket.emit('authenticated', {
        status: 'success',
        projectIds: [],
        conversationIds: ['conv-1'],
      });
      await flush();

      // Simulate the upstream socket dropping (e.g. platform restart). The
      // scheduled reconnect rebuilds the socket on its own — even though a
      // new attach arrives before the timer fires.
      firstSocket.connected = false;
      firstSocket.emit('disconnect', 'transport close');
      client.subscribe('conv-2');
      await flush();

      await vi.advanceTimersByTimeAsync(1_000);
      await flush();
      secondSocket.connected = true;
      secondSocket.emit('connect');
      await flush();
      secondSocket.emit('authenticated', {
        status: 'success',
        projectIds: [],
        conversationIds: ['conv-1', 'conv-2'],
      });
      await flush();

      expect(ioFactory).toHaveBeenCalledTimes(2);
      const subscribeEmits = secondSocket._emits.filter((e) => e.event === 'subscribe');
      expect(subscribeEmits.length).toBeGreaterThan(0);
      const lastSubscribe = subscribeEmits.at(-1)!;
      expect(
        (lastSubscribe.payload as { conversationIds: string[] }).conversationIds.sort(),
      ).toEqual(['conv-1', 'conv-2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends clientType=cli and machineId in the authenticate payload', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore({
        machineId: 'machine-abc',
        credential: 'cred-abc',
      }),
    });

    client.subscribe('conv-1');
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();

    const authEmit = currentSocket._emits.find((e) => e.event === 'authenticate');
    expect(authEmit).toBeDefined();
    expect(authEmit!.payload).toMatchObject({
      organizationId: 'org-1',
      clientType: 'cli',
      machineId: 'machine-abc',
    });
  });

  it('connect() opens the upstream socket and authenticates with no subscriptions present', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore({
        machineId: 'machine-abc',
        credential: 'cred-abc',
      }),
    });

    client.connect();
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();

    const authEmit = currentSocket._emits.find((e) => e.event === 'authenticate');
    expect(authEmit).toBeDefined();
    expect(authEmit!.payload).toMatchObject({
      organizationId: 'org-1',
      clientType: 'cli',
      machineId: 'machine-abc',
    });
  });

  it('omits machineId from the authenticate payload when the CLI is unpaired', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribe('conv-1');
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();

    const authEmit = currentSocket._emits.find((e) => e.event === 'authenticate');
    expect(authEmit).toBeDefined();
    const payload = authEmit!.payload as Record<string, unknown>;
    expect(payload['clientType']).toBe('cli');
    expect(payload).not.toHaveProperty('machineId');
  });

  it('auto-reconnects ~1s after an involuntary disconnect', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const firstSocket = createMockSocket();
      const secondSocket = createMockSocket();
      let callCount = 0;
      ioFactory.mockImplementation(() => {
        callCount += 1;
        return callCount === 1 ? firstSocket : secondSocket;
      });

      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
      });

      client.connect();
      await flush();
      firstSocket.connected = true;
      firstSocket.emit('connect');
      await flush();
      firstSocket.emit('authenticated', {
        status: 'success',
        projectIds: ['proj-1'],
        conversationIds: ['conv-1', 'conv-2'],
      });
      await flush();

      expect(ioFactory).toHaveBeenCalledTimes(1);

      // Involuntary drop (e.g. platform restart): the dead socket emits
      // 'disconnect' with a transport reason and the client must schedule a
      // reconnect on its own — no caller-driven subscribe arrives.
      firstSocket.connected = false;
      firstSocket.emit('disconnect', 'transport close');

      // Before the timer fires, no new socket has opened.
      expect(ioFactory).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      await flush();

      expect(ioFactory).toHaveBeenCalledTimes(2);

      secondSocket.connected = true;
      secondSocket.emit('connect');
      await flush();
      secondSocket.emit('authenticated', {
        status: 'success',
        projectIds: [],
        conversationIds: [],
      });
      await flush();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up consecutive connect_error-only failures and keeps one jittered retry timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const sockets = Array.from({ length: 9 }, () => createMockSocket());
      let callCount = 0;
      ioFactory.mockImplementation(() => {
        const sock = sockets[callCount];
        callCount += 1;
        if (!sock) throw new Error('ran out of mock sockets');
        return sock;
      });

      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
        random: () => 0.5,
      });

      client.connect();
      await flush();

      // Socket.IO can report only connect_error while the API is unavailable.
      // The manager must release each failed socket and own exactly one retry
      // timer without relying on a second disconnect event from the transport.
      const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000];
      for (let i = 0; i < expectedDelays.length; i += 1) {
        sockets[i]!.emit('connect_error', new Error('boom'));
        await flush();

        expect(sockets[i]!.disconnect).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);

        const delay = expectedDelays[i]!;
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(ioFactory).toHaveBeenCalledTimes(i + 1);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        expect(ioFactory).toHaveBeenCalledTimes(i + 2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps jitter within bounds and caps the exponential delay at 30s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const sockets = Array.from({ length: 9 }, () => createMockSocket());
      let callCount = 0;
      ioFactory.mockImplementation(() => {
        const sock = sockets[callCount];
        callCount += 1;
        if (!sock) throw new Error('ran out of mock sockets');
        return sock;
      });
      const randomValues = [0, 0.999, 0, 0.999, 0, 0.999, 0, 0.999];
      let randomIndex = 0;

      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
        random: () => randomValues[randomIndex++] ?? 0.5,
      });

      client.connect();
      await flush();

      const baseDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000];
      for (let i = 0; i < baseDelays.length; i += 1) {
        sockets[i]!.emit('connect_error', new Error('boom'));
        await flush();

        const baseDelay = baseDelays[i]!;
        const lowerBound = Math.round(baseDelay * 0.8);
        const upperBound = Math.min(30_000, Math.round(baseDelay * 1.2));
        await vi.advanceTimersByTimeAsync(lowerBound - 1);
        expect(ioFactory).toHaveBeenCalledTimes(i + 1);
        await vi.advanceTimersByTimeAsync(upperBound - lowerBound + 1);
        await flush();
        expect(ioFactory).toHaveBeenCalledTimes(i + 2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets reconnect backoff only after authenticated recovery', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const sockets = Array.from({ length: 4 }, () => createMockSocket());
      let callCount = 0;
      ioFactory.mockImplementation(() => {
        const sock = sockets[callCount];
        callCount += 1;
        if (!sock) throw new Error('ran out of mock sockets');
        return sock;
      });

      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
        random: () => 0.5,
      });

      client.connect();
      await flush();

      sockets[0]!.emit('connect_error', new Error('boom'));
      await vi.advanceTimersByTimeAsync(1_000);
      await flush();
      sockets[1]!.emit('connect_error', new Error('boom'));
      await vi.advanceTimersByTimeAsync(1_999);
      expect(ioFactory).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await flush();

      // Authentication is the only point that resets the failure count.
      sockets[2]!.connected = true;
      sockets[2]!.emit('connect');
      await flush();
      sockets[2]!.emit('authenticated', { status: 'success' });
      await flush();

      sockets[2]!.connected = false;
      sockets[2]!.emit('disconnect', 'transport close');
      await flush();
      await vi.advanceTimersByTimeAsync(999);
      expect(ioFactory).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(ioFactory).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-emits subscribe with all attached conversations and projects after reconnect', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const firstSocket = createMockSocket();
      const secondSocket = createMockSocket();
      let callCount = 0;
      ioFactory.mockImplementation(() => {
        callCount += 1;
        return callCount === 1 ? firstSocket : secondSocket;
      });

      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
      });

      client.subscribe('conv-1');
      client.subscribe('conv-2');
      client.subscribeProject('proj-1');
      await flush();

      firstSocket.connected = true;
      firstSocket.emit('connect');
      await flush();
      firstSocket.emit('authenticated', {
        status: 'success',
        projectIds: ['proj-1'],
        conversationIds: ['conv-1', 'conv-2'],
      });
      await flush();

      firstSocket.connected = false;
      firstSocket.emit('disconnect', 'transport close');

      await vi.advanceTimersByTimeAsync(1_000);
      await flush();

      secondSocket.connected = true;
      secondSocket.emit('connect');
      await flush();
      secondSocket.emit('authenticated', {
        status: 'success',
        projectIds: ['proj-1'],
        conversationIds: ['conv-1', 'conv-2'],
      });
      await flush();

      const subscribeEmits = secondSocket._emits.filter((e) => e.event === 'subscribe');
      expect(subscribeEmits.length).toBeGreaterThan(0);
      const payload = subscribeEmits.at(-1)!.payload as {
        conversationIds: string[];
        projectIds: string[];
      };
      expect(payload.conversationIds.sort()).toEqual(['conv-1', 'conv-2']);
      expect(payload.projectIds).toEqual(['proj-1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires onReconnect exactly once after a post-reconnect authenticated ack', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const firstSocket = createMockSocket();
      const secondSocket = createMockSocket();
      let callCount = 0;
      ioFactory.mockImplementation(() => {
        callCount += 1;
        return callCount === 1 ? firstSocket : secondSocket;
      });

      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
      });

      const reconnectCalls: number[] = [];
      client.onReconnect(() => reconnectCalls.push(Date.now()));

      client.subscribe('conv-1');
      await flush();
      firstSocket.connected = true;
      firstSocket.emit('connect');
      await flush();
      firstSocket.emit('authenticated', { status: 'success' });
      await flush();

      // Initial connect also produces an onReconnect notify in the existing
      // contract — clear the counter so we measure only the post-reconnect
      // fire.
      reconnectCalls.length = 0;

      firstSocket.connected = false;
      firstSocket.emit('disconnect', 'transport close');

      await vi.advanceTimersByTimeAsync(1_000);
      await flush();

      secondSocket.connected = true;
      secondSocket.emit('connect');
      await flush();
      // Pre-auth, no listener fire.
      expect(reconnectCalls.length).toBe(0);
      secondSocket.emit('authenticated', { status: 'success' });
      await flush();

      expect(reconnectCalls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-reconnect after a voluntary disconnect()', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
      });

      client.subscribe('conv-1');
      await flush();
      currentSocket.connected = true;
      currentSocket.emit('connect');
      await flush();
      currentSocket.emit('authenticated', { status: 'success' });
      await flush();

      expect(ioFactory).toHaveBeenCalledTimes(1);

      client.disconnect();
      // disconnect() on the mock synchronously emits 'disconnect' with reason
      // 'manual' — re-emit explicitly in case the order of operations means
      // socket has already been nulled inside the handler.
      currentSocket.emit('disconnect', 'manual');
      await flush();

      // Advance well past any possible backoff window.
      await vi.advanceTimersByTimeAsync(60_000);
      await flush();

      expect(ioFactory).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // End-to-end smoke (manual): kill and restart the platform API while the
  // CLI is connected. Expected: the CLI logs a reconnect attempt within ~1s,
  // re-authenticates, and re-emits `subscribe` for every attached
  // conversation + project. Verified by tailing the CLI log for the
  // `conversation-updated.subscription.upstream.*` event chain.

  it('subscribe is idempotent on duplicate conversation ids', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribe('conv-1');
    client.subscribe('conv-1');
    await flush();

    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', {
      status: 'success',
      projectIds: [],
      conversationIds: ['conv-1'],
    });
    await flush();

    const subscribeEmits = currentSocket._emits.filter((e) => e.event === 'subscribe');
    // Only the post-auth emission should fire once; no extra emit for the
    // duplicate attach.
    expect(subscribeEmits.length).toBe(1);
    expect((subscribeEmits[0]!.payload as { conversationIds: string[] }).conversationIds).toEqual([
      'conv-1',
    ]);
  });

  it('presents the credential, signs the challenge, then subscribes after authentication', async () => {
    const signed: { challenge: Buffer | null } = { challenge: null };
    vi.spyOn(MachineChallengeSigner.prototype, 'sign').mockImplementation(async (challenge) => {
      signed.challenge = challenge;
      return 'signed-response-b64';
    });
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore({
        machineId: 'machine-abc',
        credential: 'cred-abc',
      }),
    });

    client.subscribe('conv-1');
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();

    // The machine credential rides on the authenticate payload.
    const authEmit = currentSocket._emits.find((e) => e.event === 'authenticate');
    expect(authEmit!.payload).toMatchObject({
      machineId: 'machine-abc',
      machineCredential: 'cred-abc',
    });

    // Server issues a challenge; the CLI signs the raw bytes and responds.
    currentSocket.emit('machine_challenge', {
      challenge: Buffer.from('random-bytes').toString('base64'),
    });
    await flush();

    expect(signed.challenge?.toString()).toBe('random-bytes');
    const responseEmit = currentSocket._emits.find((e) => e.event === 'machine_challenge_response');
    expect(responseEmit).toBeDefined();
    expect(responseEmit!.payload).toMatchObject({
      machineId: 'machine-abc',
      signature: 'signed-response-b64',
    });

    // No subscribe until the server acks a successful authentication.
    expect(currentSocket._emits.some((e) => e.event === 'subscribe')).toBe(false);

    currentSocket.emit('authenticated', {
      status: 'success',
      projectIds: [],
      conversationIds: ['conv-1'],
    });
    await flush();

    const subscribeEmits = currentSocket._emits.filter((e) => e.event === 'subscribe');
    expect(subscribeEmits.length).toBe(1);
    expect((subscribeEmits[0]!.payload as { conversationIds: string[] }).conversationIds).toEqual([
      'conv-1',
    ]);
  });

  it('repeats the full challenge-response from scratch on reconnect', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const firstSocket = createMockSocket();
      const secondSocket = createMockSocket();
      let callCount = 0;
      ioFactory.mockImplementation(() => {
        callCount += 1;
        return callCount === 1 ? firstSocket : secondSocket;
      });

      let signCalls = 0;
      vi.spyOn(MachineChallengeSigner.prototype, 'sign').mockImplementation(async () => {
        signCalls += 1;
        return `sig-${signCalls}`;
      });
      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore({
          machineId: 'machine-abc',
          credential: 'cred-abc',
        }),
      });

      client.subscribe('conv-1');
      await flush();
      firstSocket.connected = true;
      firstSocket.emit('connect');
      await flush();
      firstSocket.emit('machine_challenge', { challenge: Buffer.from('c1').toString('base64') });
      await flush();
      firstSocket.emit('authenticated', { status: 'success' });
      await flush();

      expect(signCalls).toBe(1);

      // Drop the upstream socket; the scheduled reconnect rebuilds it.
      firstSocket.connected = false;
      firstSocket.emit('disconnect', 'transport close');
      await vi.advanceTimersByTimeAsync(1_000);
      await flush();

      secondSocket.connected = true;
      secondSocket.emit('connect');
      await flush();

      // The reconnected socket presents the credential again and signs a fresh
      // challenge — nothing carries over from the prior connection.
      const authEmit = secondSocket._emits.find((e) => e.event === 'authenticate');
      expect(authEmit!.payload).toMatchObject({ machineCredential: 'cred-abc' });

      secondSocket.emit('machine_challenge', { challenge: Buffer.from('c2').toString('base64') });
      await flush();

      expect(signCalls).toBe(2);
      const responseEmit = secondSocket._emits.find(
        (e) => e.event === 'machine_challenge_response',
      );
      expect((responseEmit!.payload as { signature: string }).signature).toBe('sig-2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not emit a forged response and disconnects when it cannot sign the challenge', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });

    client.subscribe('conv-1');
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();

    let disconnectReason: string | null = null;
    currentSocket.on('disconnect', (reason: string) => {
      disconnectReason = reason;
    });

    currentSocket.emit('machine_challenge', { challenge: Buffer.from('c').toString('base64') });
    await flush();

    // No response is forged for a machine we cannot sign for...
    expect(currentSocket._emits.some((e) => e.event === 'machine_challenge_response')).toBe(false);
    // ...and the connection is dropped rather than left half-authenticated.
    expect(disconnectReason).toBe('manual');

    client.disconnect();
  });

  it('acks monitor commands only after the domain handler reaches admission', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });
    let releaseAdmission = (): void => {
      throw new Error('Monitor command admission handler was not invoked.');
    };
    client.onMonitorCommand(
      () =>
        new Promise((resolve) => {
          releaseAdmission = () =>
            resolve({
              status: 'ADMITTED',
              commandId: '10000000-0000-4000-8000-000000000001',
              replayed: false,
            });
        }),
    );

    client.connect();
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', { status: 'success' });
    await flush();

    const acknowledgement = vi.fn();
    currentSocket.emit(
      'trigger.monitor_command',
      {
        type: 'trigger.monitor_command',
        timestamp: '2026-07-19T00:00:00.000Z',
        organizationId: 'org-1',
      },
      acknowledgement,
    );
    await flush();
    expect(acknowledgement).not.toHaveBeenCalled();

    releaseAdmission();
    await flush();

    expect(acknowledgement).toHaveBeenCalledWith({
      status: 'ADMITTED',
      commandId: '10000000-0000-4000-8000-000000000001',
      replayed: false,
    });
    client.disconnect();
  });

  it('acks authority reductions only after durable application completes', async () => {
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: NOOP_LOGGER,
      keyPairStore: createPlatformKeyPairStore(),
    });
    let releasePersistence = (): void => {
      throw new Error('Authority reduction handler was not invoked.');
    };
    client.onAuthorityReduction(
      () =>
        new Promise((resolve) => {
          releasePersistence = () =>
            resolve({
              status: 'APPLIED',
              nonce: '10000000-0000-4000-8000-000000000001',
            });
        }),
    );

    client.connect();
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', { status: 'success' });
    await flush();

    const acknowledgement = vi.fn();
    currentSocket.emit(
      'trigger.authority_reduction',
      {
        type: 'trigger.authority_reduction',
        timestamp: '2026-07-19T00:00:00.000Z',
        organizationId: 'org-1',
      },
      acknowledgement,
    );
    await flush();
    expect(acknowledgement).not.toHaveBeenCalled();

    releasePersistence();
    await flush();

    expect(acknowledgement).toHaveBeenCalledWith({
      status: 'APPLIED',
      nonce: '10000000-0000-4000-8000-000000000001',
    });
    client.disconnect();
  });

  it.each([false, true])(
    'returns the typed acknowledgement only after durable acceptance (replayed: %s)',
    async (replayed) => {
      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
      });
      const accepted = {
        status: 'ACCEPTED' as const,
        operationId: '10000000-0000-4000-8000-000000000001',
        operationFingerprint: 'a'.repeat(64),
        replayed,
        inputDisposition: 'QUEUED' as const,
      };
      let accept!: () => void;
      const admission = new Promise<void>((resolve) => {
        accept = resolve;
      });
      client.onEvent(async () => {
        await admission;
        return accepted;
      });

      client.connect();
      await flush();
      currentSocket.connected = true;
      currentSocket.emit('connect');
      await flush();
      currentSocket.emit('authenticated', { status: 'success' });
      await flush();

      const acknowledgement = vi.fn();
      currentSocket.emit(
        'trigger.conversation',
        {
          type: 'trigger.conversation',
          timestamp: '2026-07-19T00:00:00.000Z',
          organizationId: 'org-1',
        },
        acknowledgement,
      );
      await flush();

      expect(acknowledgement).not.toHaveBeenCalled();
      accept();
      await flush();
      expect(acknowledgement).toHaveBeenCalledWith(accepted);
      client.disconnect();
    },
  );

  it('processes every reduction without INFO receipt noise and forwards transport acknowledgement availability', async () => {
    const info = vi.fn();
    const client = new PlatformWebSocketManager({
      serverUrl: 'http://test',
      oauthClient: fakeOAuthClient('org-1'),
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info,
        warn: vi.fn(),
        error: vi.fn(),
        child: () => NOOP_LOGGER,
      },
      keyPairStore: createPlatformKeyPairStore(),
    });
    const listener = vi.fn();
    client.onEvent(listener);
    client.connect();
    await flush();
    currentSocket.connected = true;
    currentSocket.emit('connect');
    await flush();
    currentSocket.emit('authenticated', { status: 'success' });
    await flush();
    const frame = {
      type: 'trigger.control_reduction',
      timestamp: '2026-10-13T08:00:00Z',
      organizationId: 'org-1',
    };
    const ack = vi.fn();
    currentSocket.emit('trigger.control_reduction', frame);
    currentSocket.emit('trigger.control_reduction', frame, ack);
    await flush();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, frame, { transportAckAvailable: false });
    expect(listener).toHaveBeenNthCalledWith(2, frame, { transportAckAvailable: true });
    expect(ack).toHaveBeenCalledWith({ received: true });
    expect(info.mock.calls.some(([event]) => event === 'platform-ws.host_trigger.received')).toBe(
      false,
    );
    client.disconnect();
  });

  describe('machine.ping reachability probe', () => {
    const authenticate = async (): Promise<void> => {
      currentSocket.connected = true;
      currentSocket.emit('connect');
      await flush();
      currentSocket.emit('authenticated', { status: 'success' });
      await flush();
    };

    it('acks with { received: true } and does not dispatch to event listeners', async () => {
      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
      });

      const events: unknown[] = [];
      client.onEvent((event) => {
        events.push(event);
      });

      client.subscribe('conv-1');
      await flush();
      await authenticate();

      const ack = vi.fn();
      currentSocket.emit('machine.ping', { machineId: 'machine-abc' }, ack);
      await flush();

      // The probe is acknowledged on receipt...
      expect(ack).toHaveBeenCalledOnce();
      expect(ack).toHaveBeenCalledWith({ received: true });
      // ...and never falls through to conversation/trigger dispatch.
      expect(events).toEqual([]);
    });

    it('is a no-op when the ack callback is absent', async () => {
      const client = new PlatformWebSocketManager({
        serverUrl: 'http://test',
        oauthClient: fakeOAuthClient('org-1'),
        logger: NOOP_LOGGER,
        keyPairStore: createPlatformKeyPairStore(),
      });

      const events: unknown[] = [];
      client.onEvent((event) => {
        events.push(event);
      });

      client.subscribe('conv-1');
      await flush();
      await authenticate();

      // No ack callback supplied (fire-and-forget): the handler must not throw
      // and must not dispatch.
      expect(() => currentSocket.emit('machine.ping', { machineId: 'machine-abc' })).not.toThrow();
      await flush();
      expect(events).toEqual([]);
    });

    it('registers the responder on every reconnect', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const firstSocket = createMockSocket();
        const secondSocket = createMockSocket();
        let callCount = 0;
        ioFactory.mockImplementation(() => {
          callCount += 1;
          return callCount === 1 ? firstSocket : secondSocket;
        });

        const client = new PlatformWebSocketManager({
          serverUrl: 'http://test',
          oauthClient: fakeOAuthClient('org-1'),
          logger: NOOP_LOGGER,
          keyPairStore: createPlatformKeyPairStore(),
        });

        client.subscribe('conv-1');
        await flush();
        firstSocket.connected = true;
        firstSocket.emit('connect');
        await flush();
        firstSocket.emit('authenticated', { status: 'success' });
        await flush();

        firstSocket.connected = false;
        firstSocket.emit('disconnect', 'transport close');
        await vi.advanceTimersByTimeAsync(1_000);
        await flush();
        secondSocket.connected = true;
        secondSocket.emit('connect');
        await flush();
        secondSocket.emit('authenticated', {
          status: 'success',
          projectIds: [],
          conversationIds: ['conv-1'],
        });
        await flush();

        // The reconnected socket acks the probe just like the first one.
        const ack = vi.fn();
        secondSocket.emit('machine.ping', { machineId: 'machine-abc' }, ack);
        await flush();
        expect(ack).toHaveBeenCalledWith({ received: true });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('heartbeat and wake-reconnect', () => {
    it('emits heartbeat frames on the authenticated socket at the interval and stops after disconnect', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      try {
        const client = new PlatformWebSocketManager({
          serverUrl: 'http://test',
          oauthClient: fakeOAuthClient('org-1'),
          logger: NOOP_LOGGER,
          keyPairStore: createPlatformKeyPairStore({
            machineId: 'machine-abc',
            credential: 'cred-abc',
          }),
          heartbeatIntervalMs: 1_000,
          wakeCheckIntervalMs: 10_000,
          suspendThresholdMs: 60_000,
          // Fixed clock: the wake monitor never sees drift, so it never
          // interferes with the heartbeat assertions.
          now: () => 0,
        });

        client.connect();
        await flush();
        currentSocket.connected = true;
        currentSocket.emit('connect');
        await flush();
        currentSocket.emit('authenticated', { status: 'success' });
        await flush();

        // No heartbeat yet — the interval hasn't elapsed.
        expect(currentSocket._emits.filter((e) => e.event === 'heartbeat').length).toBe(0);

        await vi.advanceTimersByTimeAsync(3_000);
        const heartbeats = currentSocket._emits.filter((e) => e.event === 'heartbeat');
        expect(heartbeats.length).toBe(3);
        expect(heartbeats[0]!.payload).toMatchObject({
          type: 'heartbeat',
          organizationId: 'org-1',
          clientType: 'cli',
          machineId: 'machine-abc',
        });

        // After the socket drops, the heartbeat timer is cleared and nothing
        // more is emitted on the dead socket.
        currentSocket.connected = false;
        currentSocket.emit('disconnect', 'transport close');
        await flush();
        currentSocket._emits.length = 0;

        await vi.advanceTimersByTimeAsync(5_000);
        expect(currentSocket._emits.filter((e) => e.event === 'heartbeat').length).toBe(0);

        client.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('forces a teardown and fresh re-authenticate when a wall-clock gap exceeds the suspend threshold', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      try {
        const firstSocket = createMockSocket();
        const secondSocket = createMockSocket();
        let callCount = 0;
        ioFactory.mockImplementation(() => {
          callCount += 1;
          return callCount === 1 ? firstSocket : secondSocket;
        });

        // Mutable wall-clock the test advances to simulate the machine sleeping.
        let nowMs = 0;
        const client = new PlatformWebSocketManager({
          serverUrl: 'http://test',
          oauthClient: fakeOAuthClient('org-1'),
          logger: NOOP_LOGGER,
          keyPairStore: createPlatformKeyPairStore(),
          heartbeatIntervalMs: 60_000,
          wakeCheckIntervalMs: 10_000,
          suspendThresholdMs: 60_000,
          now: () => nowMs,
        });

        client.subscribe('conv-1');
        await flush();
        firstSocket.connected = true;
        firstSocket.emit('connect');
        await flush();
        firstSocket.emit('authenticated', { status: 'success' });
        await flush();

        expect(ioFactory).toHaveBeenCalledTimes(1);

        // Simulate the machine sleeping past the suspend threshold, then fire
        // the wake-monitor tick. The large drift tears down the (possibly
        // half-open) socket.
        nowMs = 10_000 + 60_001;
        firstSocket.connected = false; // half-open: client still thought it was up
        await vi.advanceTimersByTimeAsync(10_000);
        await flush();

        // The forced teardown routes through scheduleReconnect (~1s backoff).
        await vi.advanceTimersByTimeAsync(1_000);
        await flush();

        expect(ioFactory).toHaveBeenCalledTimes(2);
        secondSocket.connected = true;
        secondSocket.emit('connect');
        await flush();
        secondSocket.emit('authenticated', {
          status: 'success',
          projectIds: [],
          conversationIds: ['conv-1'],
        });
        await flush();

        // Presence is re-announced: the fresh socket authenticates and
        // re-emits the attached subscription set.
        expect(secondSocket._emits.some((e) => e.event === 'authenticate')).toBe(true);
        const subscribeEmits = secondSocket._emits.filter((e) => e.event === 'subscribe');
        expect(subscribeEmits.length).toBeGreaterThan(0);
        expect(
          (subscribeEmits.at(-1)!.payload as { conversationIds: string[] }).conversationIds,
        ).toEqual(['conv-1']);

        client.disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears liveness timers on voluntary disconnect() so no heartbeat lands afterward', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      try {
        const client = new PlatformWebSocketManager({
          serverUrl: 'http://test',
          oauthClient: fakeOAuthClient('org-1'),
          logger: NOOP_LOGGER,
          keyPairStore: createPlatformKeyPairStore(),
          heartbeatIntervalMs: 1_000,
          wakeCheckIntervalMs: 10_000,
          suspendThresholdMs: 60_000,
          now: () => 0,
        });

        client.connect();
        await flush();
        currentSocket.connected = true;
        currentSocket.emit('connect');
        await flush();
        currentSocket.emit('authenticated', { status: 'success' });
        await flush();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(currentSocket._emits.filter((e) => e.event === 'heartbeat').length).toBe(1);

        client.disconnect();
        currentSocket._emits.length = 0;

        await vi.advanceTimersByTimeAsync(10_000);
        expect(currentSocket._emits.filter((e) => e.event === 'heartbeat').length).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('starts no liveness timers on the revoked terminal path', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      try {
        const client = new PlatformWebSocketManager({
          serverUrl: 'http://test',
          oauthClient: fakeOAuthClient('org-1'),
          logger: NOOP_LOGGER,
          keyPairStore: createPlatformKeyPairStore({
            machineId: 'machine-abc',
            credential: 'cred-abc',
          }),
          heartbeatIntervalMs: 1_000,
          wakeCheckIntervalMs: 10_000,
          suspendThresholdMs: 60_000,
          now: () => 0,
        });

        client.subscribe('conv-1');
        await flush();
        currentSocket.connected = true;
        currentSocket.emit('connect');
        await flush();
        currentSocket.emit('authenticated', {
          status: 'error',
          reason: 'machine_revoked',
          message: 'machine revoked',
        });
        await flush();
        currentSocket._emits.length = 0;

        // No heartbeat timer ever started (revocation precedes liveness start),
        // and no reconnect re-opens the socket.
        await vi.advanceTimersByTimeAsync(60_000);
        await flush();
        expect(currentSocket._emits.filter((e) => e.event === 'heartbeat').length).toBe(0);
        expect(ioFactory).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('machine credential revocation', () => {
    it('treats a machine_revoked auth failure as terminal: clears the credential, surfaces re-pair, and never reconnects', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const clearMachineCredential = vi.fn(async () => {});
        const onMachineRevoked = vi.fn();
        const client = new PlatformWebSocketManager({
          serverUrl: 'http://test',
          oauthClient: fakeOAuthClient('org-1'),
          logger: NOOP_LOGGER,
          keyPairStore: createPlatformKeyPairStore({
            machineId: 'machine-abc',
            credential: 'cred-abc',
            deleteMachineCredential: clearMachineCredential,
          }),
        });
        client.onMachineRevoked(onMachineRevoked);

        client.subscribe('conv-1');
        client.subscribe('conv-2');
        await flush();
        currentSocket.connected = true;
        currentSocket.emit('connect');
        await flush();

        expect(ioFactory).toHaveBeenCalledTimes(1);

        currentSocket.emit('authenticated', {
          status: 'error',
          reason: 'machine_revoked',
          message: 'machine revoked',
        });
        await flush();

        // Credential cleared so a restart connects unpaired instead of looping.
        expect(clearMachineCredential).toHaveBeenCalledOnce();
        // Re-pair notice surfaced once, scoped to the conversations we served.
        expect(onMachineRevoked).toHaveBeenCalledOnce();
        const context = onMachineRevoked.mock.calls[0]![0] as {
          organizationId: string | null;
          conversationIds: string[];
        };
        expect(context.organizationId).toBe('org-1');
        expect(context.conversationIds.sort()).toEqual(['conv-1', 'conv-2']);

        // No reconnect is ever scheduled — advancing well past the backoff
        // window opens no new socket.
        await vi.advanceTimersByTimeAsync(60_000);
        await flush();
        expect(ioFactory).toHaveBeenCalledTimes(1);

        // Even an explicit subscribe after revocation does not re-open.
        client.subscribe('conv-3');
        await flush();
        expect(ioFactory).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      ['machine revocation', 'machine_revocation_reduction', true],
      ['controller revocation', 'controller_revocation_reduction', false],
    ])(
      'after an applied %s reduction frame: terminal=%s',
      async (_label, kind, terminal) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
          const onMachineRevoked = vi.fn();
          const client = new PlatformWebSocketManager({
            serverUrl: 'http://test',
            oauthClient: fakeOAuthClient('org-1'),
            logger: NOOP_LOGGER,
            keyPairStore: createPlatformKeyPairStore({
              machineId: 'machine-abc',
              credential: 'cred-abc',
            }),
          });
          client.onMachineRevoked(onMachineRevoked);
          client.onAuthorityReduction(async () => ({
            status: 'APPLIED',
            nonce: '10000000-0000-4000-8000-000000000001',
          }));

          client.subscribe('conv-1');
          await flush();
          currentSocket.connected = true;
          currentSocket.emit('connect');
          await flush();
          currentSocket.emit('authenticated', { status: 'success' });
          await flush();

          const acknowledgement = vi.fn();
          const droppedSocket = currentSocket;
          droppedSocket.emit(
            'trigger.authority_reduction',
            {
              type: 'trigger.authority_reduction',
              timestamp: '2026-07-19T00:00:00.000Z',
              organizationId: 'org-1',
              envelope: { event: { kind } },
            },
            acknowledgement,
          );
          await flush();

          expect(acknowledgement).toHaveBeenCalledWith({
            status: 'APPLIED',
            nonce: '10000000-0000-4000-8000-000000000001',
          });
          expect(onMachineRevoked).toHaveBeenCalledTimes(terminal ? 1 : 0);
          expect(client.getConnectionState()).toBe(terminal ? 'revoked' : 'connected');

          // The platform force-closes the socket after the frame. A revoked
          // machine must not reconnect and retry without its credential.
          droppedSocket.connected = false;
          droppedSocket.emit('disconnect', 'io server disconnect');
          await vi.advanceTimersByTimeAsync(60_000);
          await flush();
          expect(ioFactory).toHaveBeenCalledTimes(terminal ? 1 : 2);
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it('treats a reasonless auth failure as transient: keeps the credential and reconnects on drop', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const firstSocket = createMockSocket();
        const secondSocket = createMockSocket();
        let callCount = 0;
        ioFactory.mockImplementation(() => {
          callCount += 1;
          return callCount === 1 ? firstSocket : secondSocket;
        });

        const clearMachineCredential = vi.fn(async () => {});
        const onMachineRevoked = vi.fn();
        const client = new PlatformWebSocketManager({
          serverUrl: 'http://test',
          oauthClient: fakeOAuthClient('org-1'),
          logger: NOOP_LOGGER,
          keyPairStore: createPlatformKeyPairStore({
            machineId: 'machine-abc',
            credential: 'cred-abc',
            deleteMachineCredential: clearMachineCredential,
          }),
        });
        client.onMachineRevoked(onMachineRevoked);

        client.subscribe('conv-1');
        await flush();
        firstSocket.connected = true;
        firstSocket.emit('connect');
        await flush();

        // A non-revocation failure omits `reason` entirely.
        firstSocket.emit('authenticated', { status: 'error', message: 'temporary glitch' });
        await flush();

        expect(clearMachineCredential).not.toHaveBeenCalled();
        expect(onMachineRevoked).not.toHaveBeenCalled();

        // The socket drops and the client reconnects normally.
        firstSocket.connected = false;
        firstSocket.emit('disconnect', 'transport close');
        await vi.advanceTimersByTimeAsync(1_000);
        await flush();

        expect(ioFactory).toHaveBeenCalledTimes(2);
        secondSocket.connected = true;
        secondSocket.emit('connect');
        await flush();
        expect(secondSocket._emits.some((e) => e.event === 'authenticate')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('authResponseRevokedReasonSchema', () => {
  it('accepts the machine_revoked terminal reason', () => {
    expect(authResponseRevokedReasonSchema.safeParse('machine_revoked').success).toBe(true);
  });

  it('rejects an absent or unknown reason so it stays non-terminal', () => {
    expect(authResponseRevokedReasonSchema.safeParse(undefined).success).toBe(false);
    expect(authResponseRevokedReasonSchema.safeParse('server_error').success).toBe(false);
    expect(authResponseRevokedReasonSchema.safeParse('').success).toBe(false);
  });
});
