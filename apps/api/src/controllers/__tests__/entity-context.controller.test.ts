import { BadRequestException } from '@nestjs/common';
import { EntityContextController } from '../entity-context.controller';
import { EntityContextService } from '../../services/entity-context/entity-context.service';
import { testIds } from '../../utils/testUtils';
import type { FullEntityContextDto } from '../../generated/model/fullEntityContextDto';

const entityId = '123e4567-e89b-42d3-a456-426614174099';

describe('EntityContextController', () => {
  let controller: EntityContextController;
  let entityContextService: jest.Mocked<EntityContextService>;

  beforeEach(() => {
    entityContextService = {
      getFullEntityContext: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<EntityContextService>;
    controller = new EntityContextController(entityContextService);
  });

  it('defaults relatedEntityDepth to one hop', async () => {
    await controller.getEntityContext(
      testIds.organization,
      testIds.project,
      'TASK',
      entityId,
      'test-token',
    );

    expect(entityContextService.getFullEntityContext).toHaveBeenCalledWith(
      testIds.organization,
      testIds.project,
      'TASK',
      entityId,
      'test-token',
      expect.objectContaining({ relatedEntityDepth: 1 }),
    );
  });

  it('returns the shared Context projection with relationship and session metadata', async () => {
    const projection: FullEntityContextDto = {
      entityId,
      entityType: 'TASK',
      displayName: 'Implementation',
      createdAt: '2026-10-13T00:00:00Z',
      relatedEntities: [{
        entityId: testIds.task,
        entityType: 'TASK',
        displayName: 'Linked dependency',
        taskType: 'BUG',
        relationship: 'depends-on',
        source: 'agent',
      }],
      agentSessions: [{
        entityId: '123e4567-e89b-42d3-a456-426614174084',
        entityType: 'AGENT_SESSION',
        displayName: 'Attached session',
        status: 'IN_PROGRESS',
      }],
    };
    entityContextService.getFullEntityContext.mockResolvedValue(projection);
    const result = await controller.getEntityContext(
      testIds.organization, testIds.project, 'TASK', entityId, 'test-token',
    );
    expect(result).toEqual(projection);
    expect(entityContextService.getFullEntityContext).toHaveBeenCalledWith(
      testIds.organization, testIds.project, 'TASK', entityId, 'test-token',
      expect.objectContaining({ relatedEntityDepth: 1 }),
    );
  });

  it.each([
    ['omitted', undefined, undefined],
    ['true', 'true', true],
    ['false', 'false', false],
  ])(
    'passes includePlan=%s to the service',
    async (_label, query, expected) => {
      await controller.getEntityContext(
        testIds.organization,
        testIds.project,
        'TASK',
        entityId,
        'test-token',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        query,
      );

      expect(entityContextService.getFullEntityContext).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        'TASK',
        entityId,
        'test-token',
        expect.objectContaining({ includePlan: expected }),
      );
    },
  );

  it('passes an explicit two-hop relatedEntityDepth', async () => {
    await controller.getEntityContext(
      testIds.organization,
      testIds.project,
      'TASK',
      entityId,
      'test-token',
      undefined,
      '2',
    );

    expect(entityContextService.getFullEntityContext).toHaveBeenCalledWith(
      testIds.organization,
      testIds.project,
      'TASK',
      entityId,
      'test-token',
      expect.objectContaining({ relatedEntityDepth: 2 }),
    );
  });

  it.each(['0', '3', '1.5', 'two'])(
    'rejects invalid relatedEntityDepth %s',
    async (relatedEntityDepth) => {
      await expect(
        controller.getEntityContext(
          testIds.organization,
          testIds.project,
          'TASK',
          entityId,
          'test-token',
          undefined,
          relatedEntityDepth,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(entityContextService.getFullEntityContext).not.toHaveBeenCalled();
    },
  );

  it('defaults proposal detail to summary and accepts full detail', async () => {
    await controller.getEntityContext(
      testIds.organization,
      testIds.project,
      'TASK',
      entityId,
      'test-token',
    );
    expect(entityContextService.getFullEntityContext).toHaveBeenLastCalledWith(
      testIds.organization,
      testIds.project,
      'TASK',
      entityId,
      'test-token',
      expect.objectContaining({ proposalDetail: 'summary' }),
    );

    await controller.getEntityContext(
      testIds.organization,
      testIds.project,
      'TASK',
      entityId,
      'test-token',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'full',
    );
    expect(entityContextService.getFullEntityContext).toHaveBeenLastCalledWith(
      testIds.organization,
      testIds.project,
      'TASK',
      entityId,
      'test-token',
      expect.objectContaining({ proposalDetail: 'full' }),
    );
  });

  it('rejects an invalid proposal detail', async () => {
    await expect(
      controller.getEntityContext(
        testIds.organization,
        testIds.project,
        'TASK',
        entityId,
        'test-token',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'everything',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
