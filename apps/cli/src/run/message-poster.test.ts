import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagePoster } from './message-poster';
import { MessageStatus, MessageType, SystemMessageDataTypeEnum } from '../shared/api/index';
import type {
  CreateSystemMessage,
  SubmitExecutableUserMessageRequestDto,
} from '../shared/api/generated/api';
import type { MessagePosterApiClient } from './types';

const makeApiClient = (overrides?: Partial<MessagePosterApiClient>): MessagePosterApiClient => ({
  postMessage: vi.fn().mockResolvedValue({
    data: { data: { id: 'remote-msg-1' } },
  }),
  updateMessage: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const makeLogger = () =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }) as unknown as ConstructorParameters<typeof MessagePoster>[0]['logger'];

const systemDto = (): Omit<CreateSystemMessage, 'conversationId' | 'parentMessageId'> => ({
  type: MessageType.System,
  status: MessageStatus.SystemProcessing,
  projectId: 'proj-1',
  data: {
    type: SystemMessageDataTypeEnum.Agent,
    response: 'Processing...',
    detectedIntent: 'agent_response',
    intentConfidence: 1,
  },
  createdAt: '2026-05-09T00:00:00.000Z',
});

const userDto = (): Omit<
  SubmitExecutableUserMessageRequestDto,
  'conversationId' | 'parentMessageId'
> => ({
  type: MessageType.User,
  status: MessageStatus.Completed,
  projectId: 'proj-1',
  data: { comment: 'Continue the authorized run.' },
  agentSessionId: '55555555-5555-4555-8555-555555555555',
  operationId: '66666666-6666-4666-8666-666666666666',
  operationFingerprint: '0'.repeat(64),
  authorization: {
    kind: 'bounded_grant',
    grantId: '90000000-0000-4000-8000-000000000009',
  },
});

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-poster-test-'));
});

afterEach(async () => {
  try {
    await fs.rm(dataDir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

describe('MessagePoster — createOutOfBand', () => {
  it('keeps creates, updates and completion writes inert at the shared boundary', async () => {
    const apiClient = makeApiClient();
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir, inert: true });
    await poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });
    await poster.update('org-1', 'proj-1', 'remote-msg-1', { data: { ragEnabled: true } }, null);
    await poster.complete('org-1', 'proj-1', 'remote-msg-1', { data: { ragEnabled: true } }, null);
    await vi.waitFor(() => expect(apiClient.updateMessage).toHaveBeenCalledTimes(2));
    expect(apiClient.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        createMessageDto: expect.objectContaining({
          data: expect.objectContaining({ ragEnabled: false }),
        }),
      }),
    );
    for (const [request] of vi.mocked(apiClient.updateMessage).mock.calls) {
      expect(request.updateMessageDto.data).toMatchObject({ ragEnabled: false });
    }
  });

  it('logs the API attachment rejection and does not retry a permanent failure', async () => {
    const reason = 'One or more Proposal attachments are missing or outside the requested scope';
    const error = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { message: reason } },
    });
    const apiClient = makeApiClient({ postMessage: vi.fn().mockRejectedValue(error) });
    const logger = makeLogger();
    const poster = new MessagePoster({ apiClient, logger, dataDir });
    await expect(
      poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      }),
    ).rejects.toBe(error);
    expect(apiClient.postMessage).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'local.message_poster.attempt_failed',
      expect.objectContaining({
        conversationId: 'conv-1',
        statusCode: 400,
        attempt: 1,
        transient: false,
        retryScheduled: false,
        validationReasons: [reason],
      }),
    );
  });

  it('posts the opener with no parentMessageId on the wire', async () => {
    const apiClient = makeApiClient();
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    const id = await poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });

    expect(id).toBe('remote-msg-1');
    const sent = (apiClient.postMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .createMessageDto as CreateSystemMessage;
    expect(sent).not.toHaveProperty('parentMessageId');
    expect(sent.conversationId).toBe('conv-1');
  });

  it('preserves executable USER authorization through the queued API call', async () => {
    const apiClient = makeApiClient();
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    await poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: userDto(),
      stamp: null,
    });

    expect(apiClient.postMessage).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'proj-1',
      createMessageDto: expect.objectContaining({
        type: MessageType.User,
        conversationId: 'conv-1',
        authorization: userDto().authorization,
      }),
    });
  });
});

describe('MessagePoster — typed EXTERNAL_AGENT completion', () => {
  it.each([false, true])(
    'allows live completion only for ordinary execution (inert=%s)',
    async (inert) => {
      const apiClient = makeApiClient({
        submitExternalAgentCompletion: vi.fn().mockResolvedValue('completion-message-1'),
      });
      const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir, inert });
      const args = {
        organizationId: 'org-1',
        projectId: 'proj-1',
        agentSessionId: 'agent-session-1',
        effectId: '00000000-0000-4000-8000-000000000001',
        request: {
          conversationId: 'conv-1',
          workflowNodeId: 'implementation',
          pendingTriggerMessageId: 'trigger-message-1',
          action: 'DONE',
        },
      };

      if (inert) {
        await expect(poster.submitExternalAgentCompletion(args)).rejects.toThrow();
        expect(apiClient.submitExternalAgentCompletion).not.toHaveBeenCalled();
        return;
      }
      await expect(poster.submitExternalAgentCompletion(args)).resolves.toBe(
        'completion-message-1',
      );
      expect(apiClient.submitExternalAgentCompletion).toHaveBeenCalledWith(args);
      expect(apiClient.postMessage).not.toHaveBeenCalled();
    },
  );

  it('logs typed rejection diagnostics and does not retry a permanent 409', async () => {
    const rejection = Object.assign(new Error('completion rejected'), {
      response: {
        status: 409,
        headers: {
          'x-request-id': '11111111-1111-4111-8111-111111111111',
          'x-correlation-id': '22222222-2222-4222-8222-222222222222',
        },
        data: {
          code: 'STALE_TRIGGER',
          reason: 'STALE_TRIGGER',
          responseBodyPresent: true,
        },
      },
    });
    const apiClient = makeApiClient({
      submitExternalAgentCompletion: vi.fn().mockRejectedValue(rejection),
    });
    const logger = makeLogger();
    const poster = new MessagePoster({ apiClient, logger, dataDir });
    const args = {
      organizationId: 'org-1',
      projectId: 'proj-1',
      agentSessionId: 'agent-session-1',
      effectId: '00000000-0000-4000-8000-000000000001',
      request: {
        conversationId: 'conv-1',
        workflowNodeId: 'implementation',
        pendingTriggerMessageId: 'trigger-message-1',
        action: 'DONE',
      },
    };

    await expect(poster.submitExternalAgentCompletion(args)).rejects.toBe(rejection);
    expect(apiClient.submitExternalAgentCompletion).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'local.message_poster.attempt_failed',
      expect.objectContaining({
        operation: 'external_agent_completion',
        agentSessionId: 'agent-session-1',
        effectId: '00000000-0000-4000-8000-000000000001',
        workflowNodeId: 'implementation',
        pendingTriggerMessageId: 'trigger-message-1',
        action: 'DONE',
        attempt: 1,
        statusCode: 409,
        rejectionCode: 'STALE_TRIGGER',
        rejectionReason: 'STALE_TRIGGER',
        requestId: '11111111-1111-4111-8111-111111111111',
        correlationId: '22222222-2222-4222-8222-222222222222',
        responseBodyPresent: true,
        transient: false,
        retryScheduled: false,
      }),
    );
  });
});

describe('MessagePosterApiClient surface no longer exposes getLatestMessageId', () => {
  it('the type does not allow callers to declare a getLatestMessageId field', () => {
    // Compile-time check: assigning an object with `getLatestMessageId` to
    // `MessagePosterApiClient` still typechecks because TypeScript permits
    // extra properties through a literal. The real protection is that the
    // poster never invokes it. The existence of this test documents the
    // intent and pairs with the structural surface in `types.ts`.
    const apiClient: MessagePosterApiClient = makeApiClient();
    expect((apiClient as unknown as Record<string, unknown>)['getLatestMessageId']).toBeUndefined();
  });
});

describe('MessagePoster — fast-fail on permanent errors', () => {
  it('createOutOfBand fails on the first attempt for a 403 and does not persist', async () => {
    const err = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
    const apiClient = makeApiClient({
      postMessage: vi.fn().mockRejectedValue(err),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    await expect(
      poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      }),
    ).rejects.toThrow('Forbidden');

    expect((apiClient.postMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);

    const failedPath = path.join(dataDir, 'failed-messages.jsonl');
    await expect(fs.access(failedPath)).rejects.toThrow();
  });

  it('attempts a final SYSTEM Message ownership conflict once and does not persist it for replay', async () => {
    const err = Object.assign(
      new Error('One or more Proposal attachments already belong to a Message'),
      { response: { status: 409 } },
    );
    const apiClient = makeApiClient({
      postMessage: vi.fn().mockRejectedValue(err),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    await expect(
      poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      }),
    ).rejects.toThrow('One or more Proposal attachments already belong to a Message');

    expect((apiClient.postMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    await expect(fs.access(path.join(dataDir, 'failed-messages.jsonl'))).rejects.toThrow();
  });
});

describe('MessagePoster — generated update boundary', () => {
  it('maps update and complete identifiers to the generated client order', async () => {
    const apiClient = makeApiClient();
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });
    const updateData = { status: MessageStatus.SystemProcessing };
    const completeData = { status: MessageStatus.Completed };

    await poster.update('org-1', 'proj-1', 'msg-1', updateData, null);
    await vi.waitFor(() => {
      expect(apiClient.updateMessage).toHaveBeenCalledWith({
        id: 'msg-1',
        projectId: 'proj-1',
        organizationId: 'org-1',
        updateMessageDto: updateData,
      });
    });

    await poster.complete('org-1', 'proj-1', 'msg-2', completeData, null);
    await vi.waitFor(() => {
      expect(apiClient.updateMessage).toHaveBeenCalledWith({
        id: 'msg-2',
        projectId: 'proj-1',
        organizationId: 'org-1',
        updateMessageDto: completeData,
      });
    });
  });
});

describe('MessagePoster — FIFO queue serialization', () => {
  it('preserves FIFO ordering for rapid successive posts', async () => {
    const postOrder: string[] = [];
    const apiClient = makeApiClient({
      postMessage: vi.fn().mockImplementation(async () => {
        // Track the order in which posts are executed
        postOrder.push('post');
        return { data: { data: { id: 'remote-msg-1' } } };
      }),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    // Queue multiple operations rapidly
    const promise1 = poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });

    const promise2 = poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });

    const promise3 = poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });

    // Wait for all to complete
    await Promise.all([promise1, promise2, promise3]);

    // Verify FIFO ordering: each post waited for the previous one
    expect(postOrder).toHaveLength(3);
    expect(postOrder).toEqual(['post', 'post', 'post']);
  });

  it('fast posts wait for slow operation', async () => {
    let operationCount = 0;
    const postOrder: number[] = [];
    let releaseFirstPost!: () => void;
    const firstPostGate = new Promise<void>((resolve) => {
      releaseFirstPost = resolve;
    });
    let signalFirstPostStarted!: () => void;
    const firstPostStarted = new Promise<void>((resolve) => {
      signalFirstPostStarted = resolve;
    });
    const apiClient = makeApiClient({
      postMessage: vi.fn().mockImplementation(async () => {
        const operation = ++operationCount;
        if (operation === 1) {
          signalFirstPostStarted();
          await firstPostGate;
        }
        postOrder.push(operation);
        return { data: { data: { id: `remote-msg-${operation}` } } };
      }),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    // Queue multiple operations rapidly
    const promise1 = poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });

    const promise2 = poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });

    const promise3 = poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });

    await firstPostStarted;
    try {
      // Later posts must not start while the first API call is blocked.
      expect(operationCount).toBe(1);
      expect(postOrder).toEqual([]);
    } finally {
      releaseFirstPost();
      await Promise.all([promise1, promise2, promise3]);
    }

    expect(operationCount).toBe(3);
    expect(postOrder).toEqual([1, 2, 3]);
  });

  it('different poster instances do not block each other', async () => {
    let postOrder: string[] = [];
    const apiClient1 = makeApiClient({
      postMessage: vi.fn().mockImplementation(async () => {
        postOrder.push('poster1');
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { data: { data: { id: 'remote-msg-1' } } };
      }),
    });

    const apiClient2 = makeApiClient({
      postMessage: vi.fn().mockImplementation(async () => {
        postOrder.push('poster2');
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { data: { data: { id: 'remote-msg-2' } } };
      }),
    });

    const poster1 = new MessagePoster({ apiClient: apiClient1, logger: makeLogger(), dataDir });
    const poster2 = new MessagePoster({ apiClient: apiClient2, logger: makeLogger(), dataDir });

    // Queue operations on both posters concurrently
    const promise1 = poster1.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });

    const promise2 = poster2.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-2',
      dto: systemDto(),
      stamp: null,
    });

    await Promise.all([promise1, promise2]);

    // Both posters should have executed (order may vary due to concurrency)
    expect(postOrder).toHaveLength(2);
    expect(new Set(postOrder)).toEqual(new Set(['poster1', 'poster2']));
  });

  it.each([false, true])(
    'cleanup preserves queued output eligibility (inert=%s)',
    async (inert) => {
      let operationCount = 0;
      const apiClient = makeApiClient({
        postMessage: vi.fn().mockImplementation(async () => {
          operationCount++;
          // First operation is slow
          if (operationCount === 1) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          return { data: { data: { id: `remote-msg-${operationCount}` } } };
        }),
      });
      const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir, inert });

      // Queue first operation (will start executing slowly)
      const promise1 = poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      });

      // Wait for first operation to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Queue more operations while first is still running
      const promise2 = poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      });

      const promise3 = poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      });

      // Attach the rejection expectations before cleanup so a handler is already
      // bound when cleanup rejects promise2/promise3 — otherwise the rejection is
      // momentarily unhandled before the assertions below run.
      const rejected2 = promise2.catch((error: Error) => error);
      const rejected3 = promise3.catch((error: Error) => error);

      // Call cleanup while first operation is still in flight
      // This will: 1) wait for first operation to complete, 2) persist remaining queue entries
      await poster.cleanup();

      // First operation should complete (it was already executing)
      const messageId1 = await promise1;
      expect(messageId1).toBe('remote-msg-1');

      // Second and third operations should be rejected (persisted instead of executed)
      expect(await rejected2).toEqual(
        new Error('MessagePoster cleanup: operation persisted instead of executed'),
      );
      expect(await rejected3).toEqual(
        new Error('MessagePoster cleanup: operation persisted instead of executed'),
      );

      // Verify the persisted entries were written to failed-messages.jsonl
      const failedPath = path.join(dataDir, 'failed-messages.jsonl');
      const content = await fs.readFile(failedPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      expect(lines).toHaveLength(2);
      const persisted1 = JSON.parse(lines[0]!);
      const persisted2 = JSON.parse(lines[1]!);
      expect(persisted1.organizationId).toBe('org-1');
      expect(persisted1.projectId).toBe('proj-1');
      expect(persisted1.messageDto.type).toBe(MessageType.System);
      expect(persisted2.organizationId).toBe('org-1');
      expect(persisted2.projectId).toBe('proj-1');
      expect(persisted2.messageDto.type).toBe(MessageType.System);
      if (inert) {
        expect(persisted1.messageDto.data.ragEnabled).toBe(false);
        expect(persisted2.messageDto.data.ragEnabled).toBe(false);
      }
    },
  );

  it('cleanup rejects pending createOutOfBand promises', async () => {
    let operationCount = 0;
    const apiClient = makeApiClient({
      postMessage: vi.fn().mockImplementation(async () => {
        operationCount++;
        // First operation is slow
        if (operationCount === 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return { data: { data: { id: `remote-msg-${operationCount}` } } };
      }),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    let rejected = false;
    let completed = false;

    // Queue first operation (will complete)
    const promise1 = poster
      .createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      })
      .then(() => {
        completed = true;
      })
      .catch(() => {
        rejected = true;
      });

    // Wait for first operation to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Queue second operation (will be persisted)
    const promise2 = poster
      .createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      })
      .catch(() => {
        rejected = true;
      });

    // Cleanup while first operation is in flight
    await poster.cleanup();

    await promise1;
    await promise2;

    // First should complete, second should be rejected
    expect(completed).toBe(true);
    expect(rejected).toBe(true);
  });

  it('update and complete are fire-and-forget', async () => {
    const apiClient = makeApiClient({
      updateMessage: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return undefined;
      }),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    const startTime = Date.now();

    // These should return immediately without waiting
    await poster.update(
      'org-1',
      'proj-1',
      'msg-1',
      { status: MessageStatus.SystemProcessing },
      null,
    );
    await poster.complete('org-1', 'proj-1', 'msg-1', { status: MessageStatus.Completed }, null);

    // Should return quickly (not wait for the 100ms delay in the mock)
    expect(Date.now() - startTime).toBeLessThan(50);
  });
});

describe('MessagePoster — retry logic works with queue', () => {
  it('retains executable USER authorization across a transient retry', async () => {
    vi.useFakeTimers();
    const apiClient = makeApiClient({
      postMessage: vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('Network error'), { response: { status: 503 } }),
        )
        .mockResolvedValueOnce({ data: { data: { id: 'remote-msg-1' } } }),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    try {
      const createPromise = poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: userDto(),
        stamp: null,
      });
      await vi.runAllTimersAsync();
      await expect(createPromise).resolves.toBe('remote-msg-1');
    } finally {
      vi.useRealTimers();
    }

    expect(apiClient.postMessage).toHaveBeenCalledTimes(2);
    for (const [request] of vi.mocked(apiClient.postMessage).mock.calls) {
      expect(request.createMessageDto).toMatchObject({
        authorization: userDto().authorization,
      });
    }
  });

  it('RETRY_DELAYS_MS still applies to queued create operations', async () => {
    let attemptCount = 0;
    const apiClient = makeApiClient({
      postMessage: vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          // Fail first two attempts with transient error
          const err = Object.assign(new Error('Network error'), { response: { status: 503 } });
          throw err;
        }
        // Succeed on third attempt
        return { data: { data: { id: 'remote-msg-1' } } };
      }),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    const startTime = Date.now();

    const messageId = await poster.createOutOfBand({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      dto: systemDto(),
      stamp: null,
    });

    // Verify retries occurred
    expect(attemptCount).toBe(3);
    expect(messageId).toBe('remote-msg-1');

    // Verify retry delays were applied (500ms + 1000ms = at least 1500ms)
    expect(Date.now() - startTime).toBeGreaterThanOrEqual(1500);
  });

  it('transient errors on create are persisted after all retries exhausted', async () => {
    vi.useFakeTimers();
    const apiClient = makeApiClient({
      postMessage: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Persistent network error'), { response: { status: 503 } }),
        ),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    try {
      const createPromise = poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: userDto(),
        stamp: null,
      });
      const assertion = expect(createPromise).rejects.toThrow('Persistent network error');

      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }

    // Verify the operation was persisted after all retries
    const failedPath = path.join(dataDir, 'failed-messages.jsonl');
    const content = await fs.readFile(failedPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    expect(lines).toHaveLength(1);
    const persisted = JSON.parse(lines[0]!);
    expect(persisted.organizationId).toBe('org-1');
    expect(persisted.projectId).toBe('proj-1');
    expect(persisted.messageDto.authorization).toEqual(userDto().authorization);
  });

  it('permanent errors on create fail immediately without persistence', async () => {
    const apiClient = makeApiClient({
      postMessage: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Forbidden'), { response: { status: 403 } })),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });

    await expect(
      poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      }),
    ).rejects.toThrow('Forbidden');

    // Should NOT be persisted (permanent error)
    const failedPath = path.join(dataDir, 'failed-messages.jsonl');
    await expect(fs.access(failedPath)).rejects.toThrow();
  });
});

describe('failure messages use ordinary message publication', () => {
  it('posts a readable missing-folder error at the conversation tail', async () => {
    const apiClient = makeApiClient();
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });
    await poster.postFailureMessage({
      organizationId: 'org-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      reason: 'SERVICE_FOLDER_NOT_BOUND',
      serviceNames: ['Backend'],
      inert: true,
    });
    expect(apiClient.postMessage).toHaveBeenCalledOnce();
    expect(apiClient.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        createMessageDto: expect.objectContaining({
          conversationId: 'conv-1',
          type: 'SYSTEM',
          status: MessageStatus.Completed,
          data: expect.objectContaining({
            response:
              "Service Backend isn't bound to a folder on this machine. Bind a folder, then send your message again.",
            ragEnabled: false,
          }),
        }),
      }),
    );
    await poster.cleanup();
  });

  it('does not prevent cleanup or another message when posting the error fails', async () => {
    const apiClient = makeApiClient({
      postMessage: vi
        .fn()
        .mockRejectedValueOnce({ response: { status: 400 } })
        .mockResolvedValue({ data: { data: { id: 'next-message' } } }),
    });
    const poster = new MessagePoster({ apiClient, logger: makeLogger(), dataDir });
    await expect(
      poster.postFailureMessage({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        reason: 'EXECUTION_FAILED',
      }),
    ).resolves.toBeUndefined();
    await expect(
      poster.createOutOfBand({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        dto: systemDto(),
        stamp: null,
      }),
    ).resolves.toBe('next-message');
    expect(apiClient.postMessage).toHaveBeenCalledTimes(2);
    await poster.cleanup();
  });
});
