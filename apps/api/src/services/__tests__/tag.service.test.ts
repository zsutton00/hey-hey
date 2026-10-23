import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TagService } from '../tag.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTagDto,
  TagSource,
  AssignTagDto,
  TagQueryDto,
} from '../../generated';
import { EntityType, TagSource as PrismaTagSource } from '@prisma/client';
import * as TestUtils from '../../utils/testUtils';
const { testIds } = TestUtils;

describe('TagService', () => {
  let service: TagService;
  let mockPrismaService: ReturnType<typeof TestUtils.createMockPrismaService>;

  const mockOrganizationId = testIds.organization;
  const mockArtifactId = testIds.artifactId;
  const mockProjectId = testIds.project;
  const mockInitiativeId = testIds.initiative;
  const mockTagId = 'tag-123';

  const mockTag = {
    id: mockTagId,
    organizationId: mockOrganizationId,
    entityType: EntityType.ARTIFACT,
    entityId: mockArtifactId,
    name: 'database',
    source: PrismaTagSource.USER,
    confidence: null as number | null,
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
  };

  beforeEach(async () => {
    mockPrismaService = TestUtils.createMockPrismaService();

    // Add createMany mock that's missing from the base service
    (mockPrismaService.db.tag as any).createMany = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<TagService>(TagService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createTagDto = {
      organizationId: mockOrganizationId,
      name: 'database',
      source: TagSource.User,
      entityType: EntityType.ARTIFACT,
      entityId: mockArtifactId,
      confidence: 0.9,
    };

    it('should create a tag successfully', async () => {
      mockPrismaService.db.tag.findFirst.mockResolvedValue(null);
      mockPrismaService.db.tag.create.mockResolvedValue(mockTag);

      const result = await service.create(createTagDto);

      expect(mockPrismaService.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: mockOrganizationId,
          entityType: EntityType.ARTIFACT,
          entityId: mockArtifactId,
          name: 'database',
        },
      });

      expect(mockPrismaService.db.tag.create).toHaveBeenCalledWith({
        data: {
          organizationId: mockOrganizationId,
          entityType: EntityType.ARTIFACT,
          entityId: mockArtifactId,
          name: 'database',
          source: PrismaTagSource.USER,
          confidence: 0.9,
        },
      });

      expect(result).toEqual({
        id: mockTagId,
        organizationId: mockOrganizationId,
        name: 'database',
        description: null,
        color: null,
        source: TagSource.User,
        createdAt: mockTag.createdAt.toISOString(),
        updatedAt: mockTag.updatedAt.toISOString(),
      });
    });

    it('should throw ConflictException if tag already exists for entity', async () => {
      mockPrismaService.db.tag.findFirst.mockResolvedValue(mockTag);

      await expect(service.create(createTagDto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrismaService.db.tag.create).not.toHaveBeenCalled();
    });

    it('should validate tag name and throw BadRequestException for empty name', async () => {
      const invalidDto = { ...createTagDto, name: '' };

      await expect(service.create(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.db.tag.findFirst).not.toHaveBeenCalled();
    });

    it('should validate tag name and throw BadRequestException for long name', async () => {
      const invalidDto = { ...createTagDto, name: 'a'.repeat(65) };

      await expect(service.create(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.db.tag.findFirst).not.toHaveBeenCalled();
    });

    it('should validate tag name and throw BadRequestException for invalid characters', async () => {
      const invalidDto = { ...createTagDto, name: 'tag@#$%' };

      await expect(service.create(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.db.tag.findFirst).not.toHaveBeenCalled();
    });

    it('should map TagSource.System to PrismaTagSource.SYSTEM_FAST', async () => {
      const systemTagDto = { ...createTagDto, source: TagSource.System };
      mockPrismaService.db.tag.findFirst.mockResolvedValue(null);
      mockPrismaService.db.tag.create.mockResolvedValue({
        ...mockTag,
        source: PrismaTagSource.SYSTEM_FAST,
      });

      await service.create(systemTagDto);

      expect(mockPrismaService.db.tag.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: PrismaTagSource.SYSTEM_FAST,
        }),
      });
    });

    it('should map TagSource.AiGenerated to PrismaTagSource.SYSTEM_DEEP', async () => {
      const aiTagDto = { ...createTagDto, source: TagSource.AiGenerated };
      mockPrismaService.db.tag.findFirst.mockResolvedValue(null);
      mockPrismaService.db.tag.create.mockResolvedValue({
        ...mockTag,
        source: PrismaTagSource.SYSTEM_DEEP,
      });

      await service.create(aiTagDto);

      expect(mockPrismaService.db.tag.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: PrismaTagSource.SYSTEM_DEEP,
        }),
      });
    });
  });

  describe('findMany', () => {
    const queryDto: TagQueryDto & {
      entityType?: EntityType;
      entityId?: string;
    } = {
      organizationId: mockOrganizationId,
      entityType: EntityType.ARTIFACT,
      entityId: mockArtifactId,
      search: 'data',
      limit: 10,
      offset: 0,
    };

    it('should return filtered tags', async () => {
      const tags = [mockTag];
      mockPrismaService.db.tag.findMany.mockResolvedValue(tags);

      const result = await service.findMany(queryDto);

      expect(mockPrismaService.db.tag.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: mockOrganizationId,
          entityType: EntityType.ARTIFACT,
          entityId: mockArtifactId,
          name: { contains: 'data', mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(result).toHaveLength(1);
      const [tag] = result;
      if (!tag) {
        throw new Error('Expected tag result');
      }
      expect(tag.name).toBe('database');
    });

    it('should handle empty query', async () => {
      const emptyQuery = { organizationId: mockOrganizationId };
      mockPrismaService.db.tag.findMany.mockResolvedValue([mockTag]);

      await service.findMany(emptyQuery);

      expect(mockPrismaService.db.tag.findMany).toHaveBeenCalledWith({
        where: { organizationId: mockOrganizationId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('should return tag if found', async () => {
      mockPrismaService.db.tag.findFirst.mockResolvedValue(mockTag);

      const result = await service.findOne(mockTagId, mockOrganizationId);

      expect(mockPrismaService.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockTagId,
          organizationId: mockOrganizationId,
        },
      });

      expect(result.id).toBe(mockTagId);
    });

    it('should throw NotFoundException if tag not found', async () => {
      mockPrismaService.db.tag.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('non-existent', mockOrganizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const updateDto = {
      name: 'updated-database',
      confidence: 0.95,
    };

    it('should update tag successfully', async () => {
      const updatedTag = { ...mockTag, ...updateDto };
      mockPrismaService.db.tag.findFirst
        .mockResolvedValueOnce(mockTag) // First call: find existing tag
        .mockResolvedValueOnce(null); // Second call: check name conflict
      mockPrismaService.db.tag.update.mockResolvedValue(updatedTag);

      const result = await service.update(
        mockTagId,
        updateDto,
        mockOrganizationId,
      );

      expect(mockPrismaService.db.tag.update).toHaveBeenCalledWith({
        where: { id: mockTagId },
        data: {
          name: updateDto.name,
          confidence: updateDto.confidence,
        },
      });

      expect(result.name).toBe('updated-database');
    });

    it('should throw NotFoundException if tag not found', async () => {
      mockPrismaService.db.tag.findFirst.mockResolvedValue(null);

      await expect(
        service.update('non-existent', updateDto, mockOrganizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException for name conflicts', async () => {
      const conflictingTag = {
        ...mockTag,
        id: 'other-tag',
        name: 'updated-database',
      };
      mockPrismaService.db.tag.findFirst
        .mockResolvedValueOnce(mockTag) // First call: find existing tag
        .mockResolvedValueOnce(conflictingTag); // Second call: name conflict found

      await expect(
        service.update(mockTagId, updateDto, mockOrganizationId),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('should delete tag successfully', async () => {
      mockPrismaService.db.tag.findFirst.mockResolvedValue(mockTag);
      mockPrismaService.db.tag.delete.mockResolvedValue(mockTag);
      mockPrismaService.db.tag.findMany.mockResolvedValue([]);
      mockPrismaService.db.artifact.update.mockResolvedValue({});

      await service.delete(mockTagId, mockOrganizationId);

      expect(mockPrismaService.db.tag.delete).toHaveBeenCalledWith({
        where: { id: mockTagId },
      });
    });

    it('should throw NotFoundException if tag not found', async () => {
      mockPrismaService.db.tag.findFirst.mockResolvedValue(null);

      await expect(
        service.delete('non-existent', mockOrganizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update denormalized tags for artifact', async () => {
      const artifactTag = { ...mockTag, entityType: EntityType.ARTIFACT };
      mockPrismaService.db.tag.findFirst.mockResolvedValue(artifactTag);
      mockPrismaService.db.tag.delete.mockResolvedValue(artifactTag);
      mockPrismaService.db.tag.findMany.mockResolvedValue([]);
      mockPrismaService.db.artifact.update.mockResolvedValue({});

      await service.delete(mockTagId, mockOrganizationId);

      expect(mockPrismaService.db.artifact.update).toHaveBeenCalledWith({
        where: { id: mockArtifactId },
        data: { tags: [] },
      });
    });

    it('should update denormalized tags for initiative', async () => {
      const initiativeTag = {
        ...mockTag,
        entityType: EntityType.INITIATIVE,
        entityId: mockInitiativeId,
      };
      mockPrismaService.db.tag.findFirst.mockResolvedValue(initiativeTag);
      mockPrismaService.db.tag.delete.mockResolvedValue(initiativeTag);
      mockPrismaService.db.tag.findMany.mockResolvedValue([]);
      mockPrismaService.db.initiative.update.mockResolvedValue({});

      await service.delete(mockTagId, mockOrganizationId);

      expect(mockPrismaService.db.initiative.update).toHaveBeenCalledWith({
        where: { id: mockInitiativeId },
        data: { tags: [] },
      });
    });
  });

  describe('assignToArtifact', () => {
    const assignDto: AssignTagDto = {
      tagId: mockTagId,
      confidence: 0.85,
    };

    it('should assign tag to artifact successfully', async () => {
      const artifact = {
        id: mockArtifactId,
        organizationId: mockOrganizationId,
      };
      const existingTag = {
        id: mockTagId,
        name: 'database',
        organizationId: mockOrganizationId,
      };

      mockPrismaService.db.artifact.findFirst.mockResolvedValue(artifact);
      mockPrismaService.db.tag.findFirst
        .mockResolvedValueOnce(existingTag) // Find existing tag
        .mockResolvedValueOnce(null); // Check for existing assignment
      mockPrismaService.db.tag.create.mockResolvedValue(mockTag);
      mockPrismaService.db.tag.findMany.mockResolvedValue([mockTag]);
      mockPrismaService.db.artifact.update.mockResolvedValue({});

      await service.assignToArtifact(
        mockArtifactId,
        assignDto,
        mockOrganizationId,
      );

      expect(mockPrismaService.db.tag.create).toHaveBeenCalledWith({
        data: {
          organizationId: mockOrganizationId,
          entityType: EntityType.ARTIFACT,
          entityId: mockArtifactId,
          name: 'database',
          source: PrismaTagSource.USER,
          confidence: 0.85,
        },
      });
    });

    it('should throw NotFoundException if artifact not found', async () => {
      mockPrismaService.db.artifact.findFirst.mockResolvedValue(null);

      await expect(
        service.assignToArtifact('non-existent', assignDto, mockOrganizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if tag not found', async () => {
      const artifact = {
        id: mockArtifactId,
        organizationId: mockOrganizationId,
      };
      mockPrismaService.db.artifact.findFirst.mockResolvedValue(artifact);
      mockPrismaService.db.tag.findFirst.mockResolvedValue(null);

      await expect(
        service.assignToArtifact(mockArtifactId, assignDto, mockOrganizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeFromArtifact', () => {
    it('should remove tag from artifact successfully', async () => {
      mockPrismaService.db.tag.findFirst.mockResolvedValue(mockTag);
      mockPrismaService.db.tag.delete.mockResolvedValue(mockTag);
      mockPrismaService.db.tag.findMany.mockResolvedValue([]);
      mockPrismaService.db.artifact.update.mockResolvedValue({});

      await service.removeFromArtifact(
        mockArtifactId,
        mockTagId,
        mockOrganizationId,
      );

      expect(mockPrismaService.db.tag.delete).toHaveBeenCalledWith({
        where: { id: mockTagId },
      });

      expect(mockPrismaService.db.artifact.update).toHaveBeenCalledWith({
        where: { id: mockArtifactId },
        data: { tags: [] },
      });
    });

    it('should throw NotFoundException if assignment not found', async () => {
      mockPrismaService.db.tag.findFirst.mockResolvedValue(null);

      await expect(
        service.removeFromArtifact(
          mockArtifactId,
          mockTagId,
          mockOrganizationId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignToProject', () => {
    const assignDto: AssignTagDto = {
      tagId: mockTagId,
      confidence: 0.85,
    };

    it('should assign tag to project successfully', async () => {
      const project = {
        id: mockProjectId,
        organizationId: mockOrganizationId,
        deletedAt: null as Date | null,
      };
      const existingTag = {
        id: mockTagId,
        name: 'database',
        organizationId: mockOrganizationId,
      };

      mockPrismaService.db.project.findFirst.mockResolvedValue(project);
      mockPrismaService.db.tag.findFirst
        .mockResolvedValueOnce(existingTag) // Find existing tag
        .mockResolvedValueOnce(null); // Check for existing assignment
      mockPrismaService.db.tag.create.mockResolvedValue({
        ...mockTag,
        entityType: EntityType.PROJECT,
        entityId: mockProjectId,
      });

      await service.assignToProject(
        mockProjectId,
        assignDto,
        mockOrganizationId,
      );

      expect(mockPrismaService.db.tag.create).toHaveBeenCalledWith({
        data: {
          organizationId: mockOrganizationId,
          entityType: EntityType.PROJECT,
          entityId: mockProjectId,
          name: 'database',
          source: PrismaTagSource.USER,
          confidence: 0.85,
        },
      });
    });

    it('should throw NotFoundException if project not found', async () => {
      mockPrismaService.db.project.findFirst.mockResolvedValue(null);

      await expect(
        service.assignToProject('non-existent', assignDto, mockOrganizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getArtifactTags', () => {
    it('should return tags for artifact', async () => {
      const artifact = {
        id: mockArtifactId,
        organizationId: mockOrganizationId,
      };
      const artifactTags = [mockTag];

      mockPrismaService.db.artifact.findFirst.mockResolvedValue(artifact);
      mockPrismaService.db.tag.findMany.mockResolvedValue(artifactTags);

      const result = await service.getArtifactTags(
        mockArtifactId,
        mockOrganizationId,
      );

      expect(mockPrismaService.db.tag.findMany).toHaveBeenCalledWith({
        where: {
          entityType: EntityType.ARTIFACT,
          entityId: mockArtifactId,
          organizationId: mockOrganizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(result).toHaveLength(1);
      const [tag] = result;
      if (!tag) {
        throw new Error('Expected tag result');
      }
      expect(tag.name).toBe('database');
    });

    it('should throw NotFoundException if artifact not found', async () => {
      mockPrismaService.db.artifact.findFirst.mockResolvedValue(null);

      await expect(
        service.getArtifactTags('non-existent', mockOrganizationId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getProjectTags', () => {
    it('should return tags for project', async () => {
      const project = {
        id: mockProjectId,
        organizationId: mockOrganizationId,
        deletedAt: null as Date | null,
      };
      const projectTags = [
        {
          ...mockTag,
          entityType: EntityType.PROJECT,
          entityId: mockProjectId,
        },
      ];

      mockPrismaService.db.project.findFirst.mockResolvedValue(project);
      mockPrismaService.db.tag.findMany.mockResolvedValue(projectTags);

      const result = await service.getProjectTags(
        mockProjectId,
        mockOrganizationId,
      );

      expect(mockPrismaService.db.tag.findMany).toHaveBeenCalledWith({
        where: {
          entityType: EntityType.PROJECT,
          entityId: mockProjectId,
          organizationId: mockOrganizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(result).toHaveLength(1);
      const [tag] = result;
      if (!tag) {
        throw new Error('Expected tag result');
      }
      expect(tag.name).toBe('database');
    });
  });

  describe('getInitiativeTags', () => {
    it('should return tags for initiative', async () => {
      const initiative = {
        id: mockInitiativeId,
        organizationId: mockOrganizationId,
      };
      const initiativeTags = [
        {
          ...mockTag,
          entityType: EntityType.INITIATIVE,
          entityId: mockInitiativeId,
        },
      ];

      mockPrismaService.db.initiative.findFirst.mockResolvedValue(initiative);
      mockPrismaService.db.tag.findMany.mockResolvedValue(initiativeTags);

      const result = await service.getInitiativeTags(
        mockInitiativeId,
        mockOrganizationId,
      );

      expect(mockPrismaService.db.tag.findMany).toHaveBeenCalledWith({
        where: {
          entityType: EntityType.INITIATIVE,
          entityId: mockInitiativeId,
          organizationId: mockOrganizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(result).toHaveLength(1);
      const [tag] = result;
      if (!tag) {
        throw new Error('Expected tag result');
      }
      expect(tag.name).toBe('database');
    });
  });

  describe('syncAllArtifactTags', () => {
    it('should sync all artifact tags', async () => {
      const artifacts = [{ id: 'art-1' }, { id: 'art-2' }];

      mockPrismaService.db.artifact.findMany.mockResolvedValue(artifacts);
      mockPrismaService.db.tag.findMany.mockResolvedValue([]);
      mockPrismaService.db.artifact.update.mockResolvedValue({});

      const result = await service.syncAllArtifactTags(mockOrganizationId);

      expect(mockPrismaService.db.artifact.update).toHaveBeenCalledTimes(2);
      expect(result.synced).toBe(2);
    });
  });

  describe('addTagsToArtifact', () => {
    it('should bulk add tags to artifact', async () => {
      const tags = [
        { name: 'tag1', source: PrismaTagSource.USER, confidence: 0.9 },
        { name: 'tag2', source: PrismaTagSource.SYSTEM_FAST },
      ];

      // Mock the bulk find/create flow
      mockPrismaService.db.tag.findMany
        .mockResolvedValueOnce([]) // No existing tag assignments
        .mockResolvedValueOnce([
          // Newly created tags after createMany
          { ...mockTag, name: 'tag1', id: 'tag-1' },
          { ...mockTag, name: 'tag2', id: 'tag-2' },
        ])
        .mockResolvedValueOnce([
          // For updateArtifactDenormalizedTags call
          { ...mockTag, name: 'tag1', id: 'tag-1' },
          { ...mockTag, name: 'tag2', id: 'tag-2' },
        ]);
      (mockPrismaService.db.tag as any).createMany.mockResolvedValue({});
      mockPrismaService.db.artifact.update.mockResolvedValue({});

      const result = await service.addTagsToArtifact(
        mockArtifactId,
        mockOrganizationId,
        tags,
      );

      expect(result).toHaveLength(2);
      const [firstTag, secondTag] = result;
      if (!firstTag || !secondTag) {
        throw new Error('Expected tag results');
      }
      expect(firstTag.name).toBe('tag1');
      expect(secondTag.name).toBe('tag2');
    });

    it('should handle empty tags array', async () => {
      const result = await service.addTagsToArtifact(
        mockArtifactId,
        mockOrganizationId,
        [],
      );

      expect(result).toEqual([]);
    });
  });

  describe('syncArtifactTagsFromStringArray', () => {
    it('should sync tags from artifact string array', async () => {
      const artifact = {
        id: mockArtifactId,
        organizationId: mockOrganizationId,
        tags: ['new-tag', 'database'],
      };
      const currentTags = [
        {
          id: 'tag-1',
          name: 'old-tag',
          organizationId: mockOrganizationId,
          entityType: EntityType.ARTIFACT,
          entityId: mockArtifactId,
          source: PrismaTagSource.USER,
          confidence: null as number | null,
          createdAt: new Date('2023-01-01'),
          updatedAt: new Date('2023-01-01'),
        },
        {
          id: mockTagId,
          name: 'database',
          organizationId: mockOrganizationId,
          entityType: EntityType.ARTIFACT,
          entityId: mockArtifactId,
          source: PrismaTagSource.USER,
          confidence: null as number | null,
          createdAt: new Date('2023-01-01'),
          updatedAt: new Date('2023-01-01'),
        },
      ];

      // Mock the artifact lookup
      mockPrismaService.db.artifact.findFirst.mockResolvedValue(artifact);

      // Mock the getArtifactTags call (which validates artifact exists and gets tags)
      mockPrismaService.db.artifact.findFirst.mockResolvedValue(artifact);
      mockPrismaService.db.tag.findMany.mockResolvedValue(currentTags);

      // Mock the tag removal and creation
      mockPrismaService.db.tag.findFirst
        .mockResolvedValueOnce(currentTags[0]) // For removal
        .mockResolvedValueOnce(null); // For creation check
      mockPrismaService.db.tag.delete.mockResolvedValue({});
      mockPrismaService.db.tag.create.mockResolvedValue({
        ...mockTag,
        name: 'new-tag',
      });

      await service.syncArtifactTagsFromStringArray(
        mockArtifactId,
        mockOrganizationId,
      );

      expect(mockPrismaService.db.tag.delete).toHaveBeenCalled();
      expect(mockPrismaService.db.tag.create).toHaveBeenCalled();
    });
  });
});
