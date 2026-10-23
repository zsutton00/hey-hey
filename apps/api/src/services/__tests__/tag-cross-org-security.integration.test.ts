import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TagService } from '../tag.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTagDto,
  UpdateTagDto,
  AssignTagDto,
  TagSource,
} from '../../generated';
import * as TestUtils from '../../utils/testUtils';

const { testIds } = TestUtils;

describe('TagService - Cross-Organization Security Integration Tests', () => {
  let service: TagService;
  let prisma: PrismaService;

  // Test data for two different organizations
  const ORG_A_ID = testIds.organization;
  const ORG_B_ID = 'org-b-456';

  const PROJECT_A_ID = testIds.project;
  const PROJECT_B_ID = 'project-b-456';

  const ARTIFACT_A_ID = testIds.artifactId;
  const ARTIFACT_B_ID = 'artifact-b-456';

  interface TagWithMetadata extends CreateTagDto {
    id: string;
    createdAt: Date;
    updatedAt: Date;
  }

  let tagInOrgA: TagWithMetadata;
  let tagInOrgB: TagWithMetadata;

  beforeEach(async () => {
    const mockPrisma = TestUtils.createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<TagService>(TagService);
    prisma = module.get<PrismaService>(PrismaService);

    // Setup test data using TestUtils
    tagInOrgA = {
      ...TestUtils.createMockTag({
        organizationId: ORG_A_ID,
        name: 'Tag A',
        description: 'Tag in Organization A',
        color: '#FF0000',
      }),
      id: 'tag-a-123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    tagInOrgB = {
      ...TestUtils.createMockTag({
        organizationId: ORG_B_ID,
        name: 'Tag B',
        description: 'Tag in Organization B',
        color: '#0000FF',
      }),
      id: 'tag-b-123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  describe('findOne - Cross-Organization Access Prevention', () => {
    it('should NOT return tag from different organization', async () => {
      // INTENT: Verify that users from Org A cannot access tags from Org B
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne(tagInOrgB.id, ORG_A_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgB.id,
          organizationId: ORG_A_ID, // Should filter by requesting org, not tag's org
        },
      });
    });

    it('should return tag from same organization', async () => {
      // INTENT: Verify that users can access tags from their own organization
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(tagInOrgA);

      const result = await service.findOne(tagInOrgA.id, ORG_A_ID);

      expect(result).toBeDefined();
      expect(result?.id).toBe(tagInOrgA.id);
      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgA.id,
          organizationId: ORG_A_ID,
        },
      });
    });

    it('should throw NotFoundException when accessing non-existent tag from different org', async () => {
      // INTENT: Ensure proper error handling for cross-org access attempts
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne('non-existent-tag-id', ORG_A_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update - Cross-Organization Access Prevention', () => {
    it('should NOT allow updating tag from different organization', async () => {
      // INTENT: Prevent users from Org A updating tags in Org B
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null);

      const updateDto: UpdateTagDto = {
        name: 'Hacked Tag Name',
        description: 'Malicious update attempt',
      };

      await expect(
        service.update(tagInOrgB.id, updateDto, ORG_A_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgB.id,
          organizationId: ORG_A_ID, // Should filter by requesting org
        },
      });
      expect(prisma.db.tag.update).not.toHaveBeenCalled();
    });

    it('should allow updating tag from same organization', async () => {
      // INTENT: Verify legitimate updates work within same organization
      (prisma.db.tag.findFirst as jest.Mock)
        .mockResolvedValueOnce(tagInOrgA) // First call: find existing tag
        .mockResolvedValueOnce(null); // Second call: check name uniqueness (no conflict)
      (prisma.db.tag.update as jest.Mock).mockResolvedValue({
        ...tagInOrgA,
        name: 'Updated Tag A',
      });

      const updateDto: UpdateTagDto = {
        name: 'Updated Tag A',
      };

      const result = await service.update(tagInOrgA.id, updateDto, ORG_A_ID);

      expect(result.name).toBe('Updated Tag A');
      expect(prisma.db.tag.update).toHaveBeenCalledWith({
        where: { id: tagInOrgA.id },
        data: { name: 'Updated Tag A' },
      });
    });
  });

  describe('delete - Cross-Organization Access Prevention', () => {
    it('should NOT allow deleting tag from different organization', async () => {
      // INTENT: Prevent deletion of tags from other organizations
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.delete(tagInOrgB.id, ORG_A_ID)).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgB.id,
          organizationId: ORG_A_ID,
        },
      });
      expect(prisma.db.tag.delete).not.toHaveBeenCalled();
    });

    it('should allow deleting tag from same organization', async () => {
      // INTENT: Verify legitimate deletions work within same organization
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue({
        ...tagInOrgA,
        artifacts: [],
        projects: [],
      });

      await service.delete(tagInOrgA.id, ORG_A_ID);

      expect(prisma.db.tag.delete).toHaveBeenCalledWith({
        where: { id: tagInOrgA.id },
      });
    });
  });

  describe('assignToArtifact - Cross-Organization Access Prevention', () => {
    it('should NOT allow assigning tag from different organization to artifact', async () => {
      // INTENT: Prevent cross-organization tag assignments
      const artifactInOrgA = {
        id: ARTIFACT_A_ID,
        organizationId: ORG_A_ID,
      };

      (prisma.db.artifact.findFirst as jest.Mock).mockResolvedValue(
        artifactInOrgA,
      );
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null); // Tag not found in Org A

      const assignDto: AssignTagDto = {
        tagId: tagInOrgB.id, // Trying to assign tag from Org B
        confidence: 0.9,
      };

      await expect(
        service.assignToArtifact(ARTIFACT_A_ID, assignDto, ORG_A_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgB.id,
          organizationId: ORG_A_ID, // Should only find tags in same org
        },
      });
      // In polymorphic model, tags are created directly, not via relation table
    });

    it('should NOT allow assigning tag to artifact from different organization', async () => {
      // INTENT: Prevent assigning tags to artifacts not owned by user's organization
      (prisma.db.artifact.findFirst as jest.Mock).mockResolvedValue(null); // Artifact not found in Org A
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(tagInOrgA);

      const assignDto: AssignTagDto = {
        tagId: tagInOrgA.id,
        confidence: 0.9,
      };

      await expect(
        service.assignToArtifact(ARTIFACT_B_ID, assignDto, ORG_A_ID), // Artifact from Org B
      ).rejects.toThrow(NotFoundException);

      expect(prisma.db.artifact.findFirst).toHaveBeenCalledWith({
        where: {
          id: ARTIFACT_B_ID,
          organizationId: ORG_A_ID, // Should only find artifacts in same org
        },
      });
      // In polymorphic model, tags are created directly, not via relation table
    });

    it('should allow assigning tag to artifact within same organization', async () => {
      // INTENT: Verify legitimate assignments work within same organization
      const artifactInOrgA = {
        id: ARTIFACT_A_ID,
        organizationId: ORG_A_ID,
      };

      (prisma.db.artifact.findFirst as jest.Mock).mockResolvedValue(
        artifactInOrgA,
      );
      // Mock sequence: first call for getting tag by ID, second call for checking existing assignment
      (prisma.db.tag.findFirst as jest.Mock)
        .mockResolvedValueOnce(tagInOrgA) // First call: get tag by ID
        .mockResolvedValueOnce(null); // Second call: check for existing assignment (should be null)
      // In polymorphic model, tags are created directly with entityType and entityId
      (prisma.db.tag.create as jest.Mock).mockResolvedValue({
        id: 'new-tag-123',
        organizationId: ORG_A_ID,
        entityType: 'ARTIFACT',
        entityId: ARTIFACT_A_ID,
        name: tagInOrgA.name,
        confidence: 0.9,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (prisma.db.artifact.update as jest.Mock).mockResolvedValue({});
      // Mock updateArtifactDenormalizedTags dependencies
      (prisma.db.tag.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.db.artifact.update as jest.Mock).mockResolvedValue({});

      const assignDto: AssignTagDto = {
        tagId: tagInOrgA.id,
        confidence: 0.9,
      };

      await service.assignToArtifact(ARTIFACT_A_ID, assignDto, ORG_A_ID);

      // In polymorphic model, a new tag record is created with entityType and entityId
      expect(prisma.db.tag.create).toHaveBeenCalledWith({
        data: {
          name: tagInOrgA.name,
          organizationId: ORG_A_ID,
          entityType: 'ARTIFACT',
          entityId: ARTIFACT_A_ID,
          confidence: 0.9,
          source: 'USER',
        },
      });
    });
  });

  describe('assignToProject - Cross-Organization Access Prevention', () => {
    it('should NOT allow assigning tag from different organization to project', async () => {
      // INTENT: Prevent cross-organization tag assignments to projects
      const projectInOrgA = {
        id: PROJECT_A_ID,
        organizationId: ORG_A_ID,
        deletedAt: null as Date | null,
      };

      (prisma.db.project.findFirst as jest.Mock).mockResolvedValue(
        projectInOrgA,
      );
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null); // Tag not found in Org A

      const assignDto: AssignTagDto = {
        tagId: tagInOrgB.id, // Trying to assign tag from Org B
      };

      await expect(
        service.assignToProject(PROJECT_A_ID, assignDto, ORG_A_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgB.id,
          organizationId: ORG_A_ID,
        },
      });
      // In polymorphic model, tags are created directly, not via relation table
    });

    it('should NOT allow assigning tag to project from different organization', async () => {
      // INTENT: Prevent assigning tags to projects not owned by user's organization
      (prisma.db.project.findFirst as jest.Mock).mockResolvedValue(null); // Project not found in Org A
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(tagInOrgA);

      const assignDto: AssignTagDto = {
        tagId: tagInOrgA.id,
      };

      await expect(
        service.assignToProject(PROJECT_B_ID, assignDto, ORG_A_ID), // Project from Org B
      ).rejects.toThrow(NotFoundException);

      expect(prisma.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: PROJECT_B_ID,
          organizationId: ORG_A_ID,
          deletedAt: null as Date | null,
        },
      });
      // In polymorphic model, tags are created directly, not via relation table
    });
  });

  describe('getArtifactTags - Cross-Organization Access Prevention', () => {
    it('should NOT return tags for artifact from different organization', async () => {
      // INTENT: Prevent viewing tags of artifacts from other organizations
      (prisma.db.artifact.findFirst as jest.Mock).mockResolvedValue(null); // Artifact not found in Org A

      await expect(
        service.getArtifactTags(ARTIFACT_B_ID, ORG_A_ID), // Artifact from Org B
      ).rejects.toThrow('Artifact with ID artifact-b-456 not found');

      expect(prisma.db.artifact.findFirst).toHaveBeenCalledWith({
        where: {
          id: ARTIFACT_B_ID,
          organizationId: ORG_A_ID,
        },
      });
      // In polymorphic model, no separate relation table queries needed
    });

    it('should return tags for artifact from same organization', async () => {
      // INTENT: Verify users can view tags of their own artifacts
      const artifactInOrgA = {
        id: ARTIFACT_A_ID,
        organizationId: ORG_A_ID,
      };

      (prisma.db.artifact.findFirst as jest.Mock).mockResolvedValue(
        artifactInOrgA,
      );
      // In polymorphic model, tags are found directly
      (prisma.db.tag.findMany as jest.Mock).mockResolvedValue([tagInOrgA]);

      const result = await service.getArtifactTags(ARTIFACT_A_ID, ORG_A_ID);

      expect(result).toHaveLength(1);
      const [tag] = result;
      if (!tag) {
        throw new Error('Expected tag result');
      }
      expect(tag.id).toBe(tagInOrgA.id);
      expect(prisma.db.tag.findMany).toHaveBeenCalledWith({
        where: {
          entityType: 'ARTIFACT',
          entityId: ARTIFACT_A_ID,
          organizationId: ORG_A_ID, // CRITICAL: Only return tags from same org
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getProjectTags - Cross-Organization Access Prevention', () => {
    it('should NOT return tags for project from different organization', async () => {
      // INTENT: Prevent viewing tags of projects from other organizations
      (prisma.db.project.findFirst as jest.Mock).mockResolvedValue(null); // Project not found in Org A

      await expect(
        service.getProjectTags(PROJECT_B_ID, ORG_A_ID), // Project from Org B
      ).rejects.toThrow('Project with ID project-b-456 not found');

      expect(prisma.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: PROJECT_B_ID,
          organizationId: ORG_A_ID,
          deletedAt: null as Date | null,
        },
      });
      // In polymorphic model, no separate relation table queries needed
    });

    it('should return tags for project from same organization', async () => {
      // INTENT: Verify users can view tags of their own projects
      const projectInOrgA = {
        id: PROJECT_A_ID,
        organizationId: ORG_A_ID,
        deletedAt: null as Date | null,
      };

      (prisma.db.project.findFirst as jest.Mock).mockResolvedValue(
        projectInOrgA,
      );
      // In polymorphic model, tags are found directly
      (prisma.db.tag.findMany as jest.Mock).mockResolvedValue([tagInOrgA]);

      const result = await service.getProjectTags(PROJECT_A_ID, ORG_A_ID);

      expect(result).toHaveLength(1);
      const [tag] = result;
      if (!tag) {
        throw new Error('Expected tag result');
      }
      expect(tag.id).toBe(tagInOrgA.id);
      expect(prisma.db.tag.findMany).toHaveBeenCalledWith({
        where: {
          entityType: 'PROJECT',
          entityId: PROJECT_A_ID,
          organizationId: ORG_A_ID, // CRITICAL: Only return tags from same org
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('removeFromArtifact - Cross-Organization Access Prevention', () => {
    it('should NOT allow removing tag from artifact in different organization', async () => {
      // INTENT: Prevent removal operations across organization boundaries
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null); // Tag not found with this artifact

      await expect(
        service.removeFromArtifact(ARTIFACT_B_ID, tagInOrgA.id, ORG_A_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgA.id,
          entityType: 'ARTIFACT',
          entityId: ARTIFACT_B_ID,
          organizationId: ORG_A_ID,
        },
      });
      // In polymorphic model, tags are deleted directly
    });

    it('should NOT allow removing tag from different organization from artifact', async () => {
      // INTENT: Prevent using tags from other organizations in removal operations
      const artifactInOrgA = {
        id: ARTIFACT_A_ID,
        organizationId: ORG_A_ID,
      };

      (prisma.db.artifact.findFirst as jest.Mock).mockResolvedValue(
        artifactInOrgA,
      );
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null); // Tag not in Org A

      await expect(
        service.removeFromArtifact(ARTIFACT_A_ID, tagInOrgB.id, ORG_A_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgB.id,
          organizationId: ORG_A_ID,
          entityType: 'ARTIFACT',
          entityId: ARTIFACT_A_ID,
        },
      });
      // In polymorphic model, tags are deleted directly
    });
  });

  describe('removeFromProject - Cross-Organization Access Prevention', () => {
    it('should NOT allow removing tag from project in different organization', async () => {
      // INTENT: Prevent removal operations across organization boundaries for projects
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null); // Tag not found with this project

      await expect(
        service.removeFromProject(PROJECT_B_ID, tagInOrgA.id, ORG_A_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgA.id,
          entityType: 'PROJECT',
          entityId: PROJECT_B_ID,
          organizationId: ORG_A_ID,
        },
      });
      // In polymorphic model, tags are deleted directly
    });

    it('should NOT allow removing tag from different organization from project', async () => {
      // INTENT: Prevent using tags from other organizations in project removal operations
      const projectInOrgA = {
        id: PROJECT_A_ID,
        organizationId: ORG_A_ID,
        deletedAt: null as Date | null,
      };

      (prisma.db.project.findFirst as jest.Mock).mockResolvedValue(
        projectInOrgA,
      );
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null); // Tag not in Org A

      await expect(
        service.removeFromProject(PROJECT_A_ID, tagInOrgB.id, ORG_A_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgB.id,
          organizationId: ORG_A_ID,
          entityType: 'PROJECT',
          entityId: PROJECT_A_ID,
        },
      });
      // In polymorphic model, tags are deleted directly
    });
  });

  describe('findMany - Organization Filtering', () => {
    it('should only return tags from specified organization', async () => {
      // INTENT: Verify that tag listing is properly scoped to organization
      const tagsInOrgA = [tagInOrgA];
      (prisma.db.tag.findMany as jest.Mock).mockResolvedValue(tagsInOrgA);

      const result = await service.findMany({
        organizationId: ORG_A_ID,
        limit: 20,
        offset: 0,
      });

      expect(result).toHaveLength(1);
      const [tag] = result;
      if (!tag) {
        throw new Error('Expected tag result');
      }
      expect(tag.organizationId).toBe(ORG_A_ID);
      expect(prisma.db.tag.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A_ID, // CRITICAL: Must filter by organization
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no tags exist in organization', async () => {
      // INTENT: Verify proper handling when organization has no tags
      (prisma.db.tag.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findMany({
        organizationId: 'empty-org-123',
        limit: 20,
        offset: 0,
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('Edge Cases - Security Validation', () => {
    it('should handle null organizationId gracefully', async () => {
      // INTENT: Ensure system doesn't break with invalid organization IDs
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne(tagInOrgA.id, null as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle empty string organizationId', async () => {
      // INTENT: Ensure system doesn't break with empty organization IDs
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne(tagInOrgA.id, '')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should prevent SQL injection through organizationId', async () => {
      // INTENT: Verify that organization ID is safely handled in queries
      const maliciousOrgId = "'; DROP TABLE tags; --";
      (prisma.db.tag.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne(tagInOrgA.id, maliciousOrgId),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.db.tag.findFirst).toHaveBeenCalledWith({
        where: {
          id: tagInOrgA.id,
          organizationId: maliciousOrgId, // Should be safely parameterized
        },
      });
    });
  });
});
