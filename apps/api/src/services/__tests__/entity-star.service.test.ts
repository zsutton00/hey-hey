import { ProjectResourceAccessService } from 'src/auth/services/project-resource-access.service';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EntityType } from '@prisma/client';
import { EntityStarService } from '../entity-star/entity-star.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

describe('EntityStarService', () => {
  let service: EntityStarService;
  let mockPrismaService: ReturnType<typeof TestUtils.createMockPrismaService>;
  let mockEntityRegistryService: { getEntitiesByIds: jest.Mock };

  const mockOrganizationId = testIds.organization;
  const mockUserId = testIds.user;
  const mockEntityId = testIds.task;

  beforeEach(async () => {
    mockPrismaService = TestUtils.createMockPrismaService();
    mockEntityRegistryService = {
      getEntitiesByIds: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectResourceAccessService,
          useValue: { assertResource: jest.fn() },
        },
        EntityStarService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EntityRegistryService,
          useValue: mockEntityRegistryService,
        },
      ],
    }).compile();

    service = module.get<EntityStarService>(EntityStarService);
    jest.clearAllMocks();
  });

  describe('createOrGetStar', () => {
    it('should upsert star and return dto with entity name', async () => {
      const createdAt = new Date('2024-01-01T00:00:00Z');
      const starRecord = {
        id: 'star-123',
        organizationId: mockOrganizationId,
        userId: mockUserId,
        entityType: EntityType.TASK,
        entityId: mockEntityId,
        createdAt,
      };

      mockEntityRegistryService.getEntitiesByIds.mockResolvedValue([
        {
          entityId: mockEntityId,
          entityType: EntityType.TASK,
          entityName: 'Task A',
        },
      ]);
      mockPrismaService.db.entityStar.upsert.mockResolvedValue(starRecord);

      const result = await service.createOrGetStar({
        organizationId: mockOrganizationId,
        userId: mockUserId,
        entityType: EntityType.TASK,
        entityId: mockEntityId,
      });

      expect(mockPrismaService.db.entityStar.upsert).toHaveBeenCalledWith({
        where: {
          organizationId_userId_entityType_entityId: {
            organizationId: mockOrganizationId,
            userId: mockUserId,
            entityType: EntityType.TASK,
            entityId: mockEntityId,
          },
        },
        create: {
          organizationId: mockOrganizationId,
          userId: mockUserId,
          entityType: EntityType.TASK,
          entityId: mockEntityId,
        },
        update: {},
      });

      expect(result).toEqual({
        id: 'star-123',
        organizationId: mockOrganizationId,
        userId: mockUserId,
        entityType: EntityType.TASK,
        entityId: mockEntityId,
        entityName: 'Task A',
        createdAt: createdAt.toISOString(),
      });
    });

    it('should throw when entity is missing from registry', async () => {
      mockEntityRegistryService.getEntitiesByIds.mockResolvedValue([]);

      await expect(
        service.createOrGetStar({
          organizationId: mockOrganizationId,
          userId: mockUserId,
          entityType: EntityType.TASK,
          entityId: mockEntityId,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listStars', () => {
    it('should filter out stars with missing registry entries', async () => {
      const createdAt = new Date('2024-01-01T00:00:00Z');
      const otherCreatedAt = new Date('2024-01-02T00:00:00Z');

      mockPrismaService.db.entityStar.findMany.mockResolvedValue([
        {
          id: 'star-1',
          organizationId: mockOrganizationId,
          userId: mockUserId,
          entityType: EntityType.TASK,
          entityId: mockEntityId,
          createdAt,
        },
        {
          id: 'star-2',
          organizationId: mockOrganizationId,
          userId: mockUserId,
          entityType: EntityType.INITIATIVE,
          entityId: testIds.initiative,
          createdAt: otherCreatedAt,
        },
      ]);

      mockEntityRegistryService.getEntitiesByIds.mockResolvedValue([
        {
          entityId: mockEntityId,
          entityType: EntityType.TASK,
          entityName: 'Task A',
        },
      ]);

      const result = await service.listStars({
        organizationId: mockOrganizationId,
        userId: mockUserId,
      });

      expect(result).toEqual([
        {
          id: 'star-1',
          organizationId: mockOrganizationId,
          userId: mockUserId,
          entityType: EntityType.TASK,
          entityId: mockEntityId,
          entityName: 'Task A',
          createdAt: createdAt.toISOString(),
        },
      ]);
    });
  });

  describe('removeStar', () => {
    it('should delete the star entry', async () => {
      await service.removeStar({
        organizationId: mockOrganizationId,
        userId: mockUserId,
        entityType: EntityType.TASK,
        entityId: mockEntityId,
      });

      expect(mockPrismaService.db.entityStar.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: mockOrganizationId,
          userId: mockUserId,
          entityType: EntityType.TASK,
          entityId: mockEntityId,
        },
      });
    });
  });
});
