import { OutboxStore } from '../outbox-store.service';

describe('OutboxStore', () => {
  describe('getEventsForEntity', () => {
    it('serializes bigint sequence numbers for debug responses', async () => {
      const prisma = {
        outboxEvent: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'event-1',
              correlationId: 'corr-1',
              causationId: null,
              sagaId: null,
              eventType: 'message.updated',
              aggregateType: 'message',
              aggregateId: 'message-1',
              eventVersion: 1,
              payload: { body: 'updated' },
              headers: { traceId: 'corr-1' },
              status: 'PENDING',
              retryCount: 0,
              maxRetries: 3,
              createdAt: new Date('2026-03-10T18:00:00.000Z'),
              processedAt: null,
              nextRetryAt: null,
              scheduledFor: null,
              lastError: null,
              errorCount: 0,
              partitionKey: 'org-1',
              sequenceNumber: 42n,
              sourceService: 'api',
              sourceMethod: 'updateMessage',
              sourceVersion: null,
              userId: 'user-1',
              organizationId: 'org-1',
              projectId: 'project-1',
              conversationId: 'conversation-1',
              workflowId: null,
            },
          ]),
        },
      };

      const service = new OutboxStore(prisma as any);

      const result = await service.getEventsForEntity({
        entityType: 'message',
        entityId: 'message-1',
      });

      expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            aggregateType: 'message',
            aggregateId: 'message-1',
          },
          orderBy: [{ createdAt: 'desc' }, { sequenceNumber: 'desc' }],
          select: expect.objectContaining({
            sequenceNumber: true,
            payload: true,
            headers: true,
          }),
        }),
      );
      expect(result).toEqual([
        expect.objectContaining({
          id: 'event-1',
          aggregateType: 'message',
          aggregateId: 'message-1',
          sequenceNumber: '42',
        }),
      ]);
      const firstEvent = result[0];
      expect(firstEvent).toBeDefined();
      expect(typeof firstEvent!.sequenceNumber).toBe('string');
    });
  });
});
