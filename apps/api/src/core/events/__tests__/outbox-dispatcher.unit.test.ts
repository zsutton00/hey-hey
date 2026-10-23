import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { MessageBus } from '../../events/message-bus.interface';
import { OutboxPublisher } from '../../events/outbox-publisher.service';

// The service under test marks rows as PUBLISHED via Prisma – mock the parts we need

describe('OutboxPublisher', () => {
  let service: OutboxPublisher;
  const publishMock = jest.fn().mockResolvedValue(undefined);

  const prismaMock = {
    outboxEvent: {
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
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

  it('publishes pending events and marks them as PUBLISHED', async () => {
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

    // Call the private method through bracket-notation (TS bypass)
    await service['processOutboxEvents']();

    // 1. MessageBus.publish invoked once with matching event type
    expect(publishMock).toHaveBeenCalledTimes(1);
    const publishedEnvelope = publishMock.mock.calls[0][0];
    expect(publishedEnvelope.event.type).toBe('system.notification');

    // 2. Row status went from PROCESSING -> PUBLISHED
    const updateArgs = prismaMock.outboxEvent.update.mock.calls.map(
      (c) => c[0],
    );
    const statuses = updateArgs.map((arg) => arg.data.status);
    expect(statuses).toContain('PROCESSING');
    expect(statuses).toContain('PUBLISHED');
  });
});
