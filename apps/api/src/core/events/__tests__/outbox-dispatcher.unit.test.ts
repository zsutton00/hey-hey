import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { createMockPrismaService } from 'src/utils/testUtils';
import { MessageBus } from '../../events/message-bus.interface';
import { OutboxPublisher } from '../../events/outbox-publisher.service';

// The service under test marks rows as PUBLISHED via Prisma – mock the parts we need

describe('OutboxPublisher', () => {
  let service: OutboxPublisher;
  const publishMock = jest.fn().mockResolvedValue(undefined);

  const prismaMock = {
    outboxEvent: {
      ...createMockPrismaService().db.outboxEvent,
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    eventLog: {
      create: jest.fn(),
    },
  };

  const messageBusMock: MessageBus = {
    publish: publishMock,
    subscribe: jest.fn(),
  } as MessageBus;

  const configServiceMock: ConfigService = {
    get: jest.fn(),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.outboxEvent.findFirst.mockResolvedValue(null);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 });
    service = new OutboxPublisher(
      prismaMock as unknown as PrismaService,
      messageBusMock,
      configServiceMock,
      {
        recordOutboxProcessed: jest.fn(),
        recordOutboxFailed: jest.fn(),
        setOutboxLagSeconds: jest.fn(),
      } as never,
    );
  });

  it.each([false, true])(
    'publishes once even if recording the event fails (%s)',
    async (logFails) => {
      const fakeEvent = {
        id: 'evt-1',
        eventType: 'system.notification',
        aggregateType: 'system',
        aggregateId: 'system',
        payload: { message: 'hello', severity: 'info' },
        correlationId: 'corr-1',
        causationId: null as string | null,
        sagaId: null as string | null,
        partitionKey: 'pk',
        sequenceNumber: 1,
        status: 'PENDING',
        retryCount: 0,
        errorCount: 0,
        organizationId: 'org-1',
        projectId: null as string | null,
        conversationId: null as string | null,
        workflowId: null as string | null,
        scheduledFor: null as Date | null,
        processedAt: null as Date | null,
        maxRetries: 3,
        sourceService: 'unit-test',
        sourceMethod: 'spec',
        sourceVersion: '1',
      };

      prismaMock.outboxEvent.findMany.mockResolvedValue([fakeEvent]);
      prismaMock.outboxEvent.update.mockResolvedValue({});
      prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.outboxEvent.findUniqueOrThrow.mockResolvedValue(fakeEvent);

      if (logFails) {
        prismaMock.eventLog.create.mockRejectedValueOnce(
          new Error('event log unavailable'),
        );
      }

      // Call the private method through bracket-notation (TS bypass)
      await service['processOutboxEvents']();

      // 1. MessageBus.publish invoked once with matching event type
      expect(publishMock).toHaveBeenCalledTimes(1);
      const publishedEnvelope = publishMock.mock.calls[0][0];
      expect(publishedEnvelope.event.type).toBe('system.notification');

      // 2. Row status went from PROCESSING -> PUBLISHED
      const updateArgs = prismaMock.outboxEvent.updateMany.mock.calls.map(
        (c) => c[0],
      );
      const statuses = updateArgs.map((arg) => arg.data.status);
      expect(prismaMock.outboxEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PROCESSING',
            claimToken: expect.any(String),
            claimExpiresAt: expect.any(Date),
          }),
        }),
      );
      expect(statuses).toEqual(['PROCESSING', 'PUBLISHED']);
    },
  );

  it('does not publish when another publisher already claimed the candidate', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([
      { id: 'contended-event' },
    ]);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 0 });

    await service['processOutboxEvents']();

    expect(publishMock).not.toHaveBeenCalled();
    expect(prismaMock.outboxEvent.update).not.toHaveBeenCalled();
  });

  it('clears the retry schedule when retries are exhausted', async () => {
    await service['handleEventError'](
      {
        id: 'exhausted-event',
        retryCount: 2,
        maxRetries: 3,
        errorCount: 2,
      } as never,
      new Error('bus unavailable'),
      'claim-token',
    );

    expect(prismaMock.outboxEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          retryCount: 3,
          nextRetryAt: null,
        }),
      }),
    );
  });

  it('recovers expired claims and fences completion with the new token', async () => {
    const event = {
      id: 'abandoned-event',
      status: 'PROCESSING',
      claimToken: 'dead-publisher',
      claimExpiresAt: new Date(0),
      retryCount: 0,
      errorCount: 0,
      payload: {},
      headers: {},
    };
    prismaMock.outboxEvent.findMany.mockResolvedValue([event]);
    prismaMock.outboxEvent.findUniqueOrThrow.mockResolvedValue(event);

    await service['processOutboxEvents']();

    const selection = prismaMock.outboxEvent.findMany.mock.calls[0][0].where;
    expect(selection.OR).toContainEqual({
      status: 'PROCESSING',
      claimExpiresAt: { lte: expect.any(Date) },
    });
    const [claim, completion] =
      prismaMock.outboxEvent.updateMany.mock.calls.map(([args]) => args);
    expect(claim.where).toEqual(expect.objectContaining(selection));
    expect(claim.data.claimToken).not.toBe('dead-publisher');
    expect(completion.where).toEqual({
      id: event.id,
      status: 'PROCESSING',
      claimToken: claim.data.claimToken,
    });
    expect(completion.data).toEqual(
      expect.objectContaining({
        status: 'PUBLISHED',
        claimToken: null,
        claimExpiresAt: null,
      }),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it('does not record success when the claim was replaced during publication', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([
      { id: 'expired', payload: {} },
    ]);
    prismaMock.outboxEvent.findUniqueOrThrow.mockResolvedValue({
      id: 'expired',
      payload: {},
      headers: {},
    });
    prismaMock.outboxEvent.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await service['processOutboxEvents']();

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.eventLog.create).not.toHaveBeenCalled();
  });

  it('does not retry or count a failure from an obsolete claim', async () => {
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 0 });
    await service['handleEventError'](
      { id: 'expired', retryCount: 2, maxRetries: 3, errorCount: 2 } as never,
      new Error('late failure'),
      'obsolete-token',
    );
    expect(prismaMock.outboxEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'expired',
          status: 'PROCESSING',
          claimToken: 'obsolete-token',
        },
      }),
    );
    expect(service['metrics'].recordOutboxFailed).not.toHaveBeenCalled();
  });

  it('waits for a poll to finish before scheduling the next and stops cleanly', async () => {
    jest.useFakeTimers();
    let finishPoll!: () => void;
    prismaMock.outboxEvent.findMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPoll = () => resolve([]);
        }),
    );
    try {
      service.startPublisher();
      await jest.advanceTimersByTimeAsync(1000);
      expect(prismaMock.outboxEvent.findMany).toHaveBeenCalledTimes(1);
      service.stopPublisher();
      finishPoll();
      await jest.advanceTimersByTimeAsync(1000);
      expect(prismaMock.outboxEvent.findMany).toHaveBeenCalledTimes(1);
    } finally {
      service.stopPublisher();
      jest.useRealTimers();
    }
  });
});
