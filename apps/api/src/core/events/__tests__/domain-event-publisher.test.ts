import { Test } from '@nestjs/testing';
import { DomainEventPublisher } from '../domain-event-publisher';
import { OUTBOX_STORE_TOKEN } from '../tokens';
import { ServiceEvent } from '../types/domain-events';

const mockOutbox = {
  storeEvent: jest.fn().mockResolvedValue('outbox-id-1'),
  storeEventInTransaction: jest.fn().mockResolvedValue('outbox-id-2'),
};

describe('DomainEventPublisher', () => {
  it('persists event via outbox and returns id', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DomainEventPublisher,
        { provide: OUTBOX_STORE_TOKEN, useValue: mockOutbox },
      ],
    }).compile();

    const publisher = moduleRef.get<DomainEventPublisher>(DomainEventPublisher);

    const evt: ServiceEvent = {
      type: 'message.created',
      aggregateId: 'msg123',
      payload: { payloadType: 'message.created', content: 'hello' },
    } as any;

    const id = await publisher.publish(evt);
    expect(id).toBe('outbox-id-1');
    expect(mockOutbox.storeEvent).toHaveBeenCalled();
  });

  it('persists a transaction event as scheduled when activation is deferred', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DomainEventPublisher,
        { provide: OUTBOX_STORE_TOKEN, useValue: mockOutbox },
      ],
    }).compile();
    const publisher = moduleRef.get<DomainEventPublisher>(DomainEventPublisher);
    const scheduledFor = new Date('9999-12-31T23:59:59.999Z');
    const event: ServiceEvent = {
      type: 'message.created',
      aggregateId: 'msg123',
      payload: { payloadType: 'message.created', content: 'hello' },
    } as any;

    await publisher.publishInTransaction(
      {} as never,
      event,
      {},
      {
        scheduledFor,
      },
    );

    expect(mockOutbox.storeEventInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scheduledFor }),
    );
  });

  it('rethrows the original outbox persistence error', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DomainEventPublisher,
        { provide: OUTBOX_STORE_TOKEN, useValue: mockOutbox },
      ],
    }).compile();
    const publisher = moduleRef.get<DomainEventPublisher>(DomainEventPublisher);
    const error = new Error('outbox unavailable');
    mockOutbox.storeEvent.mockRejectedValueOnce(error);
    const event: ServiceEvent = {
      type: 'message.created',
      aggregateId: 'msg123',
      payload: { payloadType: 'message.created', content: 'hello' },
    } as any;

    await expect(publisher.publish(event)).rejects.toBe(error);
  });
});
