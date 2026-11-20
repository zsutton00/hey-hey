import { createMockPrismaService } from 'src/utils/testUtils';
import { OutboxStore } from '../outbox-store.service';

describe('OutboxStore', () => {
  it.each([0, 1])(
    'only merges into an unchanged, unclaimed event (updated rows: %s)',
    async (count) => {
      const prisma = createMockPrismaService().db;
      const payload = {
        update: { title: 'Revised title', description: 'Existing description' },
        changes: [
          {
            field: 'title',
            oldValue: 'Original title',
            newValue: 'Revised title',
            dataType: 'string',
          },
          {
            field: 'description',
            oldValue: '',
            newValue: 'Existing description',
            dataType: 'string',
          },
        ],
        totalFieldsChanged: 2,
        changedBy: {
          userId: 'user-1',
          email: 'user@example.test',
          name: 'User',
        },
      };
      prisma.outboxEvent.findFirst.mockResolvedValue({
        id: 'recent-event',
        payload,
        headers: {},
        correlationId: 'earlier-correlation',
        createdAt: new Date(),
      });
      const tx = {
        ...prisma,
        outboxEvent: {
          ...prisma.outboxEvent,
          updateMany: jest.fn().mockResolvedValue({ count }),
        },
      };
      const service = new OutboxStore(prisma as never);

      const result = await service['tryMergeWithRecentEvent'](
        tx as never,
        {
          eventType: 'initiative.updated',
          aggregateId: 'initiative-1',
          payload: {
            ...payload,
            update: { title: 'Latest title' },
            changes: [
              {
                field: 'title',
                oldValue: 'Revised title',
                newValue: 'Latest title',
                dataType: 'string',
              },
            ],
          },
        } as never,
        {
          correlationId: 'latest-correlation',
          userId: 'user-1',
          organizationId: 'org-1',
        } as never,
      );

      expect(result).toBe(count === 1 ? 'recent-event' : null);
      expect(tx.outboxEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'recent-event',
            status: { in: ['PENDING', 'SCHEDULED'] },
            payload: { equals: payload },
          }),
          data: expect.objectContaining({
            payload: expect.objectContaining({
              totalFieldsChanged: 2,
              changes: expect.arrayContaining([
                expect.objectContaining({
                  field: 'title',
                  oldValue: 'Original title',
                  newValue: 'Latest title',
                }),
                expect.objectContaining({
                  field: 'description',
                  newValue: 'Existing description',
                }),
              ]),
            }),
          }),
        }),
      );
    },
  );

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
