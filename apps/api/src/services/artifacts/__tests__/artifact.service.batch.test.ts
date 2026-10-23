import { BadRequestException } from '@nestjs/common';
import { ArtifactService } from '../artifact.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateArtifactDto, QAPairData } from 'src/generated';
import { ProjectId, OrganizationId, MessageId } from 'src/types';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { TagService } from '../../tag.service';
import { ArtifactDataService } from '../artifact-data.service';
import { ArtifactDataValidators } from '../artifact-data.validators';
import { ArtifactGraphService } from '../artifact-graph.service';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { InfluenceService } from '../../influence/influence.service';
import { EntityRegistryService } from '../../entity-registry/entity-registry.service';

describe('ArtifactService - Batch Operations', () => {
  let service: ArtifactService;

  const mockPrismaService = {
    $transaction: jest.fn(),
    db: {
      artifact: {
        findMany: jest.fn(),
        createMany: jest.fn(),
      },
    },
  };

  const mockEventPublisher = {
    publish: jest.fn(),
    publishInTransaction: jest.fn(),
  };

  const mockTagService = {
    assignTagsToEntity: jest.fn(),
    createTag: jest.fn(),
    findTagsByEntity: jest.fn(),
    addTagsToArtifact: jest.fn(),
    syncArtifactTags: jest.fn(),
  };

  const mockDataService = {
    sanitizeArtifactData: jest.fn(),
    generateContentFromData: jest.fn(),
  };

  const mockValidators = {
    validateArtifactData: jest.fn(),
    hasReferentialData: jest.fn(),
    extractReferenceIds: jest.fn(),
  };

  const mockReferenceService = {
    resolveAllReferences: jest.fn(),
  };

  const mockInfluenceService = {
    createMany: jest.fn(),
    getInfluencesOn: jest.fn(),
    getInfluencesBy: jest.fn(),
    deleteInfluencesForEntity: jest.fn(),
  };

  const mockEntityRegistryService = {
    registerEntity: jest.fn(),
    lookupEntityTypes: jest.fn(),
    registerEntities: jest.fn(),
  };

  beforeEach(async () => {
    mockValidators.validateArtifactData.mockReturnValue(undefined);
    mockValidators.hasReferentialData.mockReturnValue(false);
    mockValidators.extractReferenceIds.mockReturnValue([]);
    mockDataService.sanitizeArtifactData.mockImplementation((data) => data);
    mockDataService.generateContentFromData.mockReturnValue(
      'Generated content',
    );

    const setup = await createServiceTestingModule({
      providers: [
        ArtifactService,
        PrismaService,
        TagService,
        ArtifactDataService,
        ArtifactDataValidators,
        ArtifactGraphService,
        InfluenceService,
        EntityRegistryService,
      ],
      overrides: [
        [PrismaService, mockPrismaService],
        [DOMAIN_EVENT_PUBLISHER_TOKEN, mockEventPublisher],
        [TagService, mockTagService],
        [ArtifactDataService, mockDataService],
        [ArtifactDataValidators, mockValidators],
        [ArtifactGraphService, mockReferenceService],
        [InfluenceService, mockInfluenceService],
        [EntityRegistryService, mockEntityRegistryService],
      ],
    });

    service = setup.module.get<ArtifactService>(ArtifactService);

    jest.clearAllMocks();
  });

  describe('createMany', () => {
    const mockCreateDtos: CreateArtifactDto[] = [
      {
        projectId: 'proj-123' as ProjectId,
        organizationId: 'org-456' as OrganizationId,
        type: 'QA_PAIR' as const,
        title: 'Project Concept',
        data: {
          type: 'QA_PAIR',
          question: 'What is your project concept?',
          answer: 'AI-powered project management tool',
          questionField: 'concept',
        } as QAPairData,
        sourceType: 'user_response' as any,
        sourceId: 'msg-789' as MessageId,
        generateEmbedding: true,
        tags: ['round-1', 'user-response'],
        category: 'user_input',
      },
      {
        projectId: 'proj-123' as ProjectId,
        organizationId: 'org-456' as OrganizationId,
        type: 'QA_PAIR' as const,
        title: 'Requirements',
        data: {
          type: 'QA_PAIR',
          question: 'What are your requirements?',
          answer: 'User authentication and task management',
          questionField: 'requirements',
        } as QAPairData,
        sourceType: 'user_response' as any,
        sourceId: 'msg-789' as MessageId,
        generateEmbedding: true,
        tags: ['round-1', 'user-response'],
        category: 'user_input',
      },
    ];

    it('should return 0 for empty input', async () => {
      const result = await service.createMany([]);
      expect(result).toBe(0);
    });

    it('should create multiple artifacts in batch', async () => {
      // Mock no parent artifacts found
      mockPrismaService.db.artifact.findMany.mockResolvedValue([]);

      // Mock the transaction to return createMany result
      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<{ count: number }>) => {
          const mockTx = {
            artifact: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await service.createMany(mockCreateDtos);

      expect(result).toBe(2);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(2);
    });

    it('should handle artifacts without embeddings', async () => {
      const dtosWithoutEmbeddings = mockCreateDtos.map((dto) => ({
        ...dto,
        generateEmbedding: false,
      }));

      // Mock no parent artifacts found
      mockPrismaService.db.artifact.findMany.mockResolvedValue([]);

      // Mock the transaction to return createMany result
      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<{ count: number }>) => {
          const mockTx = {
            artifact: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await service.createMany(dtosWithoutEmbeddings);

      expect(result).toBe(2);
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(2);
    });

    it('should handle creation with parent artifacts', async () => {
      const [firstDto] = mockCreateDtos;
      if (!firstDto) {
        throw new Error('Expected create artifact DTO');
      }
      const dtosWithParent = [
        {
          ...firstDto,
          parentId: 'parent-123',
        },
      ];

      // Mock parent artifact found with rootId
      mockPrismaService.db.artifact.findMany.mockResolvedValue([
        {
          id: 'parent-123',
          rootId: 'root-123',
        },
      ]);

      // Mock the transaction to return createMany result
      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<{ count: number }>) => {
          const mockTx = {
            artifact: {
              createMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await service.createMany(dtosWithParent);

      expect(result).toBe(1);
      expect(mockPrismaService.db.artifact.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['parent-123'] }, organizationId: 'org-456' },
        select: { id: true, rootId: true },
      });
    });

    it('should throw BadRequestException on database failure', async () => {
      mockPrismaService.$transaction.mockRejectedValue(
        new Error('Database connection failed'),
      );

      await expect(service.createMany(mockCreateDtos)).rejects.toThrow(
        BadRequestException,
      );

      expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });

    it('should handle artifacts with different parent artifacts', async () => {
      const [firstDto, secondDto] = mockCreateDtos;
      if (!firstDto || !secondDto) {
        throw new Error('Expected create artifact DTOs');
      }
      const dtosWithDifferentParents = [
        {
          ...firstDto,
          parentId: 'parent-123',
        },
        {
          ...secondDto,
          parentId: 'parent-456',
        },
      ];

      // Mock parent artifacts found with different rootIds
      mockPrismaService.db.artifact.findMany.mockResolvedValue([
        {
          id: 'parent-123',
          rootId: 'root-123',
        },
        {
          id: 'parent-456',
          rootId: 'root-456',
        },
      ]);

      // Mock the transaction to return createMany result
      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<{ count: number }>) => {
          const mockTx = {
            artifact: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
          };
          return callback(mockTx);
        },
      );

      const result = await service.createMany(dtosWithDifferentParents);

      expect(result).toBe(2);
      expect(mockPrismaService.db.artifact.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['parent-123', 'parent-456'] },
          organizationId: 'org-456',
        },
        select: { id: true, rootId: true },
      });
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(2);
    });
  });
});
