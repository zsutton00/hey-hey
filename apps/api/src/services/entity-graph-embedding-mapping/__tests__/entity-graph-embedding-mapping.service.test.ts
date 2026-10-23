import { EntityType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import * as TestUtils from '../../../utils/testUtils';
import {
  EntityGraphEmbeddingMappingLookupError,
  EntityGraphEmbeddingMappingService,
} from '../entity-graph-embedding-mapping.service';

describe('EntityGraphEmbeddingMappingService', () => {
  let service: EntityGraphEmbeddingMappingService;
  let prismaService: ReturnType<typeof TestUtils.createMockPrismaService>;

  beforeEach(() => {
    prismaService = TestUtils.createMockPrismaService();
    (prismaService.db as any).entityGraphEmbeddingMapping = {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    };

    service = new EntityGraphEmbeddingMappingService(
      prismaService as unknown as PrismaService,
    );
  });

  it('rejects upsert without external ids', async () => {
    await expect(
      service.upsertMapping({
        organizationId: TestUtils.testIds.organization,
        entityType: EntityType.INITIATIVE,
        entityId: TestUtils.testIds.initiative,
      }),
    ).rejects.toThrow('graphNodeId or embeddingId is required');
  });

  it('upserts mapping with graph id', async () => {
    const expected = {
      id: 'mapping-1',
      organizationId: TestUtils.testIds.organization,
      entityType: EntityType.TASK,
      entityId: TestUtils.testIds.task,
      graphNodeId: 'graph-1',
      embeddingId: null,
      mappingVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (
      prismaService.db as any
    ).entityGraphEmbeddingMapping.upsert.mockResolvedValue(expected);

    const result = await service.upsertMapping({
      organizationId: TestUtils.testIds.organization,
      entityType: EntityType.TASK,
      entityId: TestUtils.testIds.task,
      graphNodeId: 'graph-1',
    });

    expect(result).toBe(expected);
    expect(
      (prismaService.db as any).entityGraphEmbeddingMapping.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          graphNodeId: 'graph-1',
          embeddingId: null,
        }),
        update: expect.objectContaining({
          graphNodeId: 'graph-1',
        }),
      }),
    );
  });

  it('registers embedding id', async () => {
    (
      prismaService.db as any
    ).entityGraphEmbeddingMapping.upsert.mockResolvedValue({ id: 'mapping-2' });

    await service.registerEmbeddingId({
      organizationId: TestUtils.testIds.organization,
      entityType: EntityType.MESSAGE,
      entityId: TestUtils.testIds.message,
      embeddingId: 'embed-1',
    });

    expect(
      (prismaService.db as any).entityGraphEmbeddingMapping.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          embeddingId: 'embed-1',
        }),
        update: expect.objectContaining({
          embeddingId: 'embed-1',
        }),
      }),
    );
  });

  it('throws on multiple graph id matches', async () => {
    (
      prismaService.db as any
    ).entityGraphEmbeddingMapping.findMany.mockResolvedValue([
      { id: 'mapping-1' },
      { id: 'mapping-2' },
    ]);

    await expect(service.getByGraphNodeId('graph-dup')).rejects.toThrow(
      EntityGraphEmbeddingMappingLookupError,
    );
  });

  it('returns null when no embedding id matches', async () => {
    (
      prismaService.db as any
    ).entityGraphEmbeddingMapping.findMany.mockResolvedValue([]);

    const result = await service.getByEmbeddingId('embed-missing');
    expect(result).toBeNull();
  });
});
