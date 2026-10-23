import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DebugController } from '../debug.controller';

describe('DebugController', () => {
  describe('getEntityOutboxEvents', () => {
    it('normalizes the entity type to lowercase before querying the outbox store', async () => {
      const outboxStore = {
        getEventsForEntity: jest.fn().mockResolvedValue([
          {
            id: 'event-1',
            correlationId: 'corr-1',
            causationId: null,
            sagaId: null,
            eventType: 'task.updated',
            aggregateType: 'task',
            aggregateId: 'task-1',
            eventVersion: 1,
            payload: {},
            headers: {},
            status: 'PENDING',
            retryCount: 0,
            maxRetries: 3,
            createdAt: new Date('2026-03-12T12:00:00.000Z'),
            processedAt: null,
            nextRetryAt: null,
            scheduledFor: null,
            lastError: null,
            errorCount: 0,
            partitionKey: 'org-1',
            sequenceNumber: '1',
            sourceService: 'api',
            sourceMethod: 'test',
            sourceVersion: null,
            userId: 'user-1',
            organizationId: 'org-1',
            projectId: 'project-1',
            conversationId: null,
            workflowId: null,
          },
        ]),
      };

      const controller = new DebugController({} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
outboxStore as any,
{} as any,
{} as any,
{} as any,
{} as any
      );

      const result = await controller.getEntityOutboxEvents(
        { userId: 'user-1' } as any,
        'TASK',
        'task-1',
      );

      expect(outboxStore.getEventsForEntity).toHaveBeenCalledWith({
        entityType: 'task',
        entityId: 'task-1',
      });
      expect(result).toEqual({
        entityType: 'task',
        entityId: 'task-1',
        count: 1,
        events: expect.arrayContaining([
          expect.objectContaining({
            id: 'event-1',
            aggregateType: 'task',
            aggregateId: 'task-1',
          }),
        ]),
      });
    });
  });

  it('delegates replay requests with the authenticated organization and user', async () => {
    const eventReplayRepairService = {
      execute: jest.fn().mockResolvedValue({
        total: 0,
        truncated: false,
        results: [],
      }),
    };
    const controller = new DebugController({} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
{} as any,
eventReplayRepairService as any,
{} as any
    );
    const request = { mode: 'VALIDATE_ONLY', limit: 25 } as any;

    await controller.replayDebugEvents(
      { userId: 'user-1', currentOrgId: 'org-1' } as any,
      request,
    );

    expect(eventReplayRepairService.execute).toHaveBeenCalledWith(request, {
      userId: 'user-1',
      organizationId: 'org-1',
    });
  });

  describe('getDebugEntity', () => {
    const owner = { userId: 'user-1' } as any;

    function buildController(
      projectAccess: { assertProjectRole: jest.Mock },
      embeddingsClient: { getDebugEntity: jest.Mock },
    ) {
      return new DebugController(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        embeddingsClient as any,
        {} as any,
        projectAccess as any,
      );
    }

    it('returns only the embeddings that belong to the requested project', async () => {
      const projectAccess = {
        assertProjectRole: jest.fn().mockResolvedValue('OWNER'),
      };
      const embeddingsClient = {
        getDebugEntity: jest.fn().mockResolvedValue({
          found: true,
          type: 'task',
          id: 'task-1',
          count: 2,
          documents: [
            { id: 'doc-own', metadata: { projectId: 'project-1' } },
            { id: 'doc-other', metadata: { projectId: 'project-2' } },
          ],
        }),
      };
      const controller = buildController(projectAccess, embeddingsClient);

      const result = await controller.getDebugEntity(
        owner,
        'task',
        'task-1',
        'project-1' as any,
      );

      expect(projectAccess.assertProjectRole).toHaveBeenCalledWith(
        'project-1',
        'user-1',
        'viewProjectEmbeddings',
      );
      expect(result.count).toBe(1);
      expect(result.found).toBe(true);
      expect(result.documents.map((document) => document.id)).toEqual([
        'doc-own',
      ]);
    });

    it("never returns another project's embeddings", async () => {
      const projectAccess = {
        assertProjectRole: jest.fn().mockResolvedValue('OWNER'),
      };
      const embeddingsClient = {
        getDebugEntity: jest.fn().mockResolvedValue({
          found: true,
          type: 'task',
          id: 'task-1',
          count: 1,
          documents: [{ id: 'doc-other', metadata: { projectId: 'project-2' } }],
        }),
      };
      const controller = buildController(projectAccess, embeddingsClient);

      const result = await controller.getDebugEntity(
        owner,
        'task',
        'task-1',
        'project-1' as any,
      );

      expect(result).toEqual(
        expect.objectContaining({ found: false, count: 0, documents: [] }),
      );
    });

    it('refuses callers who are not Owners of the project', async () => {
      const projectAccess = {
        assertProjectRole: jest
          .fn()
          .mockRejectedValue(new ForbiddenException('Insufficient permissions')),
      };
      const embeddingsClient = { getDebugEntity: jest.fn() };
      const controller = buildController(projectAccess, embeddingsClient);

      await expect(
        controller.getDebugEntity(owner, 'task', 'task-1', 'project-1' as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(embeddingsClient.getDebugEntity).not.toHaveBeenCalled();
    });

    it('requires a projectId', async () => {
      const controller = buildController(
        { assertProjectRole: jest.fn() },
        { getDebugEntity: jest.fn() },
      );

      await expect(
        controller.getDebugEntity(owner, 'task', 'task-1', '' as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
