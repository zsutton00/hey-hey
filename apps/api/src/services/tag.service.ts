import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTagDto,
  Tag as ApiTag,
  TagQueryDto,
  UpdateTagDto,
  AssignTagDto,
  TagSource,
} from '../generated';
import {
  Prisma,
  Tag as PrismaTag,
  TagSource as PrismaTagSource,
  EntityType,
} from '@prisma/client';
import { ensureStringDate } from '../utils/date.util';

@Injectable()
export class TagService {
  private readonly logger = new Logger(TagService.name);
  private readonly MAX_TAG_NAME_LENGTH = 64;
  private readonly TAG_NAME_PATTERN = /^[a-zA-Z0-9_\-\s]+$/;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates a tag name for length and character restrictions
   */
  private validateTagName(name: string): void {
    if (!name || !name.trim()) {
      throw new BadRequestException('Tag name cannot be empty');
    }

    const trimmedName = name.trim();

    if (trimmedName.length > this.MAX_TAG_NAME_LENGTH) {
      throw new BadRequestException(
        `Tag name cannot exceed ${this.MAX_TAG_NAME_LENGTH} characters`,
      );
    }

    if (!this.TAG_NAME_PATTERN.test(trimmedName)) {
      throw new BadRequestException(
        'Tag name can only contain letters, numbers, spaces, hyphens, and underscores',
      );
    }
  }

  /**
   * Create a tag assignment for a specific entity
   */
  async create(
    createDto: CreateTagDto & {
      entityType: EntityType;
      entityId: string;
      confidence?: number;
    },
  ): Promise<ApiTag> {
    try {
      // Validate tag name
      this.validateTagName(createDto.name);

      // Normalize tag name
      const normalizedName = createDto.name.trim();

      // Check if tag assignment already exists
      const existingTag = await this.prisma.db.tag.findFirst({
        where: {
          organizationId: createDto.organizationId,
          entityType: createDto.entityType,
          entityId: createDto.entityId,
          name: normalizedName,
        },
      });

      if (existingTag) {
        throw new ConflictException(
          `Tag with name "${createDto.name}" already assigned to this ${createDto.entityType.toLowerCase()}`,
        );
      }

      // Map OpenAPI TagSource to Prisma TagSource
      let prismaSource: PrismaTagSource = PrismaTagSource.USER;
      if (createDto.source === TagSource.System) {
        prismaSource = PrismaTagSource.SYSTEM_FAST;
      } else if (createDto.source === TagSource.AiGenerated) {
        prismaSource = PrismaTagSource.SYSTEM_DEEP;
      }

      const tag = await this.prisma.db.tag.create({
        data: {
          organizationId: createDto.organizationId,
          entityType: createDto.entityType,
          entityId: createDto.entityId,
          name: normalizedName,
          source: prismaSource,
          confidence: createDto.confidence,
        },
      });

      this.logger.log(`Created tag assignment: ${tag.id}`);
      return this.toResponseDto(tag);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Failed to create tag assignment', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to create tag assignment: ${(error as Error).message}`,
      );
    }
  }

  async findMany(
    queryDto: TagQueryDto & { entityType?: EntityType; entityId?: string },
    accessibleTagIds?: string[],
  ): Promise<ApiTag[]> {
    try {
      const where: Prisma.TagWhereInput = accessibleTagIds
        ? { id: { in: accessibleTagIds } }
        : {};

      if (queryDto.organizationId) {
        where.organizationId = queryDto.organizationId;
      }

      if (queryDto.entityType) {
        where.entityType = queryDto.entityType;
      }

      if (queryDto.entityId) {
        where.entityId = queryDto.entityId;
      }

      if (queryDto.source) {
        where.source = queryDto.source as PrismaTagSource;
      }

      if (queryDto.search) {
        where.name = { contains: queryDto.search, mode: 'insensitive' };
      }

      const tags = await this.prisma.db.tag.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      // Deduplicate by tag name, keeping the most recent record for each name
      const uniqueTagsMap = new Map<string, PrismaTag>();
      for (const tag of tags) {
        if (!uniqueTagsMap.has(tag.name)) {
          uniqueTagsMap.set(tag.name, tag);
        }
      }

      // Convert map to array and apply pagination
      const uniqueTags = Array.from(uniqueTagsMap.values());
      const offset = queryDto.offset ? Number(queryDto.offset) : 0;
      const limit = queryDto.limit ? Number(queryDto.limit) : 20;
      const paginatedTags = uniqueTags.slice(offset, offset + limit);

      return paginatedTags.map((tag) => this.toResponseDto(tag));
    } catch (error) {
      this.logger.error('Failed to fetch tags', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to fetch tags: ${(error as Error).message}`,
      );
    }
  }

  async findOne(id: string, organizationId: string): Promise<ApiTag> {
    try {
      const tag = await this.prisma.db.tag.findFirst({
        where: {
          id,
          // CRITICAL: Always filter by organization ID to prevent cross-org access
          organizationId,
        },
      });

      if (!tag) {
        throw new NotFoundException(`Tag with ID ${id} not found`);
      }

      return this.toResponseDto(tag);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to fetch tag', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to fetch tag: ${(error as Error).message}`,
      );
    }
  }

  async update(
    id: string,
    updateDto: UpdateTagDto & { confidence?: number },
    organizationId: string,
  ): Promise<ApiTag> {
    try {
      const existingTag = await this.prisma.db.tag.findFirst({
        where: {
          id,
          // CRITICAL: Always filter by organization ID to prevent cross-org access
          organizationId,
        },
      });

      if (!existingTag) {
        throw new NotFoundException(`Tag with ID ${id} not found`);
      }

      // Check name uniqueness if name is being updated
      if (updateDto.name && updateDto.name !== existingTag.name) {
        const nameConflict = await this.prisma.db.tag.findFirst({
          where: {
            organizationId: existingTag.organizationId,
            entityType: existingTag.entityType,
            entityId: existingTag.entityId,
            name: updateDto.name,
            id: { not: id },
          },
        });

        if (nameConflict) {
          throw new ConflictException(
            `Tag with name "${updateDto.name}" already assigned to this ${existingTag.entityType.toLowerCase()}`,
          );
        }
      }

      const tag = await this.prisma.db.tag.update({
        where: { id },
        data: {
          name: updateDto.name,
          confidence: updateDto.confidence,
        },
      });

      this.logger.log(`Updated tag: ${tag.id}`);
      return this.toResponseDto(tag);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.logger.error('Failed to update tag', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to update tag: ${(error as Error).message}`,
      );
    }
  }

  async delete(id: string, organizationId: string): Promise<void> {
    try {
      const tag = await this.prisma.db.tag.findFirst({
        where: {
          id,
          // CRITICAL: Always filter by organization ID to prevent cross-org access
          organizationId,
        },
      });

      if (!tag) {
        throw new NotFoundException(`Tag with ID ${id} not found`);
      }

      await this.prisma.db.tag.delete({
        where: { id },
      });

      // Update denormalized tags based on entity type
      if (tag.entityType === EntityType.ARTIFACT) {
        await this.updateArtifactDenormalizedTags(tag.entityId);
      } else if (tag.entityType === EntityType.INITIATIVE) {
        await this.updateInitiativeDenormalizedTags(tag.entityId);
      }

      this.logger.log(`Deleted tag: ${id}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete tag', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to delete tag: ${(error as Error).message}`,
      );
    }
  }

  async assignToArtifact(
    artifactId: string,
    assignDto: AssignTagDto,
    organizationId: string,
  ): Promise<void> {
    try {
      // Check if artifact exists and belongs to organization
      const artifact = await this.prisma.db.artifact.findFirst({
        where: {
          id: artifactId,
          // CRITICAL: Ensure artifact belongs to organization
          organizationId,
        },
      });

      if (!artifact) {
        throw new NotFoundException(`Artifact with ID ${artifactId} not found`);
      }

      // Get the tag by ID first to get its name
      const existingTag = await this.prisma.db.tag.findFirst({
        where: {
          id: assignDto.tagId,
          organizationId,
        },
      });

      if (!existingTag) {
        throw new NotFoundException(`Tag with ID ${assignDto.tagId} not found`);
      }

      // Use find-or-create to avoid duplicates
      await this.findOrCreateTagAssignment(
        organizationId,
        EntityType.ARTIFACT,
        artifactId,
        existingTag.name,
        existingTag.source,
        assignDto.confidence ?? undefined,
      );

      // Update denormalized tags array on artifact
      await this.updateArtifactDenormalizedTags(artifactId);

      this.logger.log(`Assigned tag to artifact ${artifactId}`);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.logger.error('Failed to assign tag to artifact', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to assign tag to artifact: ${(error as Error).message}`,
      );
    }
  }

  async removeFromArtifact(
    artifactId: string,
    tagId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      // Find and delete the tag assignment
      const tag = await this.prisma.db.tag.findFirst({
        where: {
          id: tagId,
          entityType: EntityType.ARTIFACT,
          entityId: artifactId,
          organizationId,
        },
      });

      if (!tag) {
        throw new NotFoundException(
          `Tag assignment not found for artifact ${artifactId} and tag ${tagId}`,
        );
      }

      await this.prisma.db.tag.delete({
        where: { id: tagId },
      });

      // Update denormalized tags array on artifact
      await this.updateArtifactDenormalizedTags(artifactId);

      this.logger.log(`Removed tag ${tagId} from artifact ${artifactId}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to remove tag from artifact', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to remove tag from artifact: ${(error as Error).message}`,
      );
    }
  }

  async assignToProject(
    projectId: string,
    assignDto: AssignTagDto,
    organizationId: string,
  ): Promise<void> {
    try {
      // Check if project exists and belongs to organization
      const project = await this.prisma.db.project.findFirst({
        where: {
          id: projectId,
          // CRITICAL: Ensure project belongs to organization
          organizationId,
          deletedAt: null,
        },
      });

      if (!project) {
        throw new NotFoundException(`Project with ID ${projectId} not found`);
      }

      // Get the tag by ID first to get its name
      const existingTag = await this.prisma.db.tag.findFirst({
        where: {
          id: assignDto.tagId,
          organizationId,
        },
      });

      if (!existingTag) {
        throw new NotFoundException(`Tag with ID ${assignDto.tagId} not found`);
      }

      // Use find-or-create to avoid duplicates
      await this.findOrCreateTagAssignment(
        organizationId,
        EntityType.PROJECT,
        projectId,
        existingTag.name,
        existingTag.source,
        assignDto.confidence ?? undefined,
      );

      this.logger.log(`Assigned tag to project ${projectId}`);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.logger.error('Failed to assign tag to project', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to assign tag to project: ${(error as Error).message}`,
      );
    }
  }

  async removeFromProject(
    projectId: string,
    tagId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      // Find and delete the tag assignment
      const tag = await this.prisma.db.tag.findFirst({
        where: {
          id: tagId,
          entityType: EntityType.PROJECT,
          entityId: projectId,
          organizationId,
        },
      });

      if (!tag) {
        throw new NotFoundException(
          `Tag assignment not found for project ${projectId} and tag ${tagId}`,
        );
      }

      await this.prisma.db.tag.delete({
        where: { id: tagId },
      });

      this.logger.log(`Removed tag ${tagId} from project ${projectId}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to remove tag from project', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to remove tag from project: ${(error as Error).message}`,
      );
    }
  }

  async assignToInitiative(
    initiativeId: string,
    assignDto: AssignTagDto,
    organizationId: string,
  ): Promise<void> {
    try {
      // Check if initiative exists and belongs to organization
      const initiative = await this.prisma.db.initiative.findFirst({
        where: {
          id: initiativeId,
          // CRITICAL: Ensure initiative belongs to organization
          organizationId,
        },
      });

      if (!initiative) {
        throw new NotFoundException(
          `Initiative with ID ${initiativeId} not found`,
        );
      }

      // Get the tag by ID first to get its name
      const existingTag = await this.prisma.db.tag.findFirst({
        where: {
          id: assignDto.tagId,
          organizationId,
        },
      });

      if (!existingTag) {
        throw new NotFoundException(`Tag with ID ${assignDto.tagId} not found`);
      }

      // Use find-or-create to avoid duplicates
      await this.findOrCreateTagAssignment(
        organizationId,
        EntityType.INITIATIVE,
        initiativeId,
        existingTag.name,
        existingTag.source,
        assignDto.confidence ?? undefined,
      );

      // Update denormalized tags array on initiative
      await this.updateInitiativeDenormalizedTags(initiativeId);

      this.logger.log(`Assigned tag to initiative ${initiativeId}`);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.logger.error('Failed to assign tag to initiative', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to assign tag to initiative: ${(error as Error).message}`,
      );
    }
  }

  async removeFromInitiative(
    initiativeId: string,
    tagId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      // Find and delete the tag assignment
      const tag = await this.prisma.db.tag.findFirst({
        where: {
          id: tagId,
          entityType: EntityType.INITIATIVE,
          entityId: initiativeId,
          organizationId,
        },
      });

      if (!tag) {
        throw new NotFoundException(
          `Tag assignment not found for initiative ${initiativeId} and tag ${tagId}`,
        );
      }

      await this.prisma.db.tag.delete({
        where: { id: tagId },
      });

      // Update denormalized tags array on initiative
      await this.updateInitiativeDenormalizedTags(initiativeId);

      this.logger.log(`Removed tag ${tagId} from initiative ${initiativeId}`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to remove tag from initiative', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to remove tag from initiative: ${(error as Error).message}`,
      );
    }
  }

  async getInitiativeTags(
    initiativeId: string,
    organizationId: string,
  ): Promise<ApiTag[]> {
    try {
      // CRITICAL: Validate initiative belongs to organization
      const initiative = await this.prisma.db.initiative.findFirst({
        where: { id: initiativeId, organizationId },
      });

      if (!initiative) {
        throw new NotFoundException(
          `Initiative with ID ${initiativeId} not found`,
        );
      }

      const initiativeTags = await this.prisma.db.tag.findMany({
        where: {
          entityType: EntityType.INITIATIVE,
          entityId: initiativeId,
          // CRITICAL: Only return tags from same organization
          organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      return initiativeTags.map((tag) => this.toResponseDto(tag));
    } catch (error) {
      this.logger.error('Failed to fetch initiative tags', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to fetch initiative tags: ${(error as Error).message}`,
      );
    }
  }

  async getArtifactTags(
    artifactId: string,
    organizationId: string,
  ): Promise<ApiTag[]> {
    try {
      // CRITICAL: Validate artifact belongs to organization
      const artifact = await this.prisma.db.artifact.findFirst({
        where: { id: artifactId, organizationId },
      });

      if (!artifact) {
        throw new NotFoundException(`Artifact with ID ${artifactId} not found`);
      }

      const artifactTags = await this.prisma.db.tag.findMany({
        where: {
          entityType: EntityType.ARTIFACT,
          entityId: artifactId,
          // CRITICAL: Only return tags from same organization
          organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      return artifactTags.map((tag) => this.toResponseDto(tag));
    } catch (error) {
      this.logger.error('Failed to fetch artifact tags', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to fetch artifact tags: ${(error as Error).message}`,
      );
    }
  }

  async getProjectTags(
    projectId: string,
    organizationId: string,
  ): Promise<ApiTag[]> {
    try {
      // CRITICAL: Validate project belongs to organization
      const project = await this.prisma.db.project.findFirst({
        where: { id: projectId, organizationId, deletedAt: null },
      });

      if (!project) {
        throw new NotFoundException(`Project with ID ${projectId} not found`);
      }

      const projectTags = await this.prisma.db.tag.findMany({
        where: {
          entityType: EntityType.PROJECT,
          entityId: projectId,
          // CRITICAL: Only return tags from same organization
          organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      return projectTags.map((tag) => this.toResponseDto(tag));
    } catch (error) {
      this.logger.error('Failed to fetch project tags', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to fetch project tags: ${(error as Error).message}`,
      );
    }
  }

  private async updateArtifactDenormalizedTags(
    artifactId: string,
  ): Promise<void> {
    const artifactTags = await this.prisma.db.tag.findMany({
      where: {
        entityType: EntityType.ARTIFACT,
        entityId: artifactId,
      },
    });

    const tagNames = artifactTags.map((tag) => tag.name).sort();

    await this.prisma.db.artifact.update({
      where: { id: artifactId },
      data: { tags: tagNames },
    });
  }

  private async updateInitiativeDenormalizedTags(
    initiativeId: string,
  ): Promise<void> {
    const initiativeTags = await this.prisma.db.tag.findMany({
      where: {
        entityType: EntityType.INITIATIVE,
        entityId: initiativeId,
      },
    });

    const tagNames = initiativeTags.map((tag) => tag.name).sort();

    try {
      await this.prisma.db.initiative.update({
        where: { id: initiativeId },
        data: { tags: tagNames },
      });
    } catch (error) {
      // SQLite test database doesn't have tags field, skip silently
      if ((error as Error).message?.includes('Unknown argument `tags`')) {
        this.logger.debug(
          'Skipping denormalized tags update (not supported in current database)',
        );
        return;
      }
      throw error;
    }
  }

  async syncAllArtifactTags(
    organizationId?: string,
    accessibleProjectIds?: string[],
  ): Promise<{ synced: number }> {
    try {
      const where: Prisma.ArtifactWhereInput = accessibleProjectIds
        ? { projectId: { in: accessibleProjectIds } }
        : {};
      if (organizationId) {
        where.organizationId = organizationId;
      }

      // Get all artifacts
      const artifacts = await this.prisma.db.artifact.findMany({
        where,
      });

      let syncedCount = 0;

      // Update each artifact's denormalized tags
      for (const artifact of artifacts) {
        await this.updateArtifactDenormalizedTags(artifact.id);
        syncedCount++;
      }

      this.logger.log(
        `Synchronized denormalized tags for ${syncedCount} artifacts`,
      );
      return { synced: syncedCount };
    } catch (error) {
      this.logger.error('Failed to sync artifact tags', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to sync artifact tags: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Bulk add tags to initiative using true bulk operations
   */
  async addTagsToInitiative(
    initiativeId: string,
    organizationId: string,
    tags: { name: string; source: PrismaTagSource; confidence?: number }[],
  ) {
    if (tags.length === 0) return [];

    // Validate all tag names first
    for (const tag of tags) {
      try {
        this.validateTagName(tag.name);
      } catch (error) {
        this.logger.error(
          `Invalid tag name: ${tag.name} - ${(error as Error).message}`,
        );
        throw new BadRequestException(
          `Invalid tag name "${tag.name}": ${(error as Error).message}`,
        );
      }
    }

    // Use bulk operations to eliminate N+1 queries
    const results = await this.bulkFindOrCreateTagAssignments(
      organizationId,
      EntityType.INITIATIVE,
      initiativeId,
      tags,
    );

    // Update denormalized tags
    await this.updateInitiativeDenormalizedTags(initiativeId);

    return results;
  }

  /**
   * Bulk add tags to artifact using true bulk operations
   */
  async addTagsToArtifact(
    artifactId: string,
    organizationId: string,
    tags: { name: string; source: PrismaTagSource; confidence?: number }[],
  ) {
    if (tags.length === 0) return [];

    // Validate all tag names first
    for (const tag of tags) {
      try {
        this.validateTagName(tag.name);
      } catch (error) {
        this.logger.error(
          `Invalid tag name: ${tag.name} - ${(error as Error).message}`,
        );
        throw new BadRequestException(
          `Invalid tag name "${tag.name}": ${(error as Error).message}`,
        );
      }
    }

    // Use bulk operations to eliminate N+1 queries
    const results = await this.bulkFindOrCreateTagAssignments(
      organizationId,
      EntityType.ARTIFACT,
      artifactId,
      tags,
    );

    // Update denormalized tags
    await this.updateArtifactDenormalizedTags(artifactId);

    return results;
  }

  /**
   * Sync initiative tags - replaces all tags from a specific source
   */
  async syncInitiativeTags(
    initiativeId: string,
    organizationId: string,
    tags: { name: string; source: PrismaTagSource; confidence?: number }[],
    _source: PrismaTagSource,
  ) {
    // Get current initiative tags
    const currentTags = await this.getInitiativeTags(
      initiativeId,
      organizationId,
    );

    // Remove existing tags (we'll re-add the new ones)
    for (const currentTag of currentTags) {
      try {
        await this.removeFromInitiative(
          initiativeId,
          currentTag.id,
          organizationId,
        );
      } catch (error) {
        // Log but don't fail completely for tag removal - this is less critical
        this.logger.warn(`Failed to remove tag: ${(error as Error).message}`);
        // Continue with removal of other tags
      }
    }

    // Add new tags
    return this.addTagsToInitiative(initiativeId, organizationId, tags);
  }

  /**
   * Sync artifact tags - replaces all tags from a specific source
   */
  async syncArtifactTags(
    artifactId: string,
    organizationId: string,
    tags: { name: string; source: PrismaTagSource; confidence?: number }[],
  ) {
    // Get current artifact tags
    const currentTags = await this.getArtifactTags(artifactId, organizationId);

    // Remove existing tags (we'll re-add the new ones)
    for (const currentTag of currentTags) {
      try {
        await this.removeFromArtifact(
          artifactId,
          currentTag.id,
          organizationId,
        );
      } catch (error) {
        // Log but don't fail completely for tag removal - this is less critical
        this.logger.warn(`Failed to remove tag: ${(error as Error).message}`);
        // Continue with removal of other tags
      }
    }

    // Add new tags
    return this.addTagsToArtifact(artifactId, organizationId, tags);
  }

  async syncArtifactTagsFromStringArray(
    artifactId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      // Get artifact with current string tags AND verify organization
      const artifact = await this.prisma.db.artifact.findFirst({
        where: {
          id: artifactId,
          organizationId, // CRITICAL: Ensure artifact belongs to organization
        },
      });

      if (!artifact) {
        throw new NotFoundException(`Artifact with ID ${artifactId} not found`);
      }

      // Get current tag assignments
      const currentTags = await this.getArtifactTags(
        artifactId,
        organizationId,
      );

      // Get target tag names from denormalized array
      const targetTagNames = new Set(artifact.tags || []);
      const currentTagNames = new Set(currentTags.map((tag) => tag.name));

      // Remove tags not in the target set
      for (const currentTag of currentTags) {
        if (!targetTagNames.has(currentTag.name)) {
          await this.removeFromArtifact(
            artifactId,
            currentTag.id,
            organizationId,
          );
        }
      }

      // Add missing tags
      for (const tagName of Array.from(targetTagNames)) {
        if (!currentTagNames.has(tagName)) {
          try {
            // Use find-or-create to avoid duplicates
            await this.findOrCreateTagAssignment(
              organizationId,
              EntityType.ARTIFACT,
              artifactId,
              tagName,
            );
          } catch (error) {
            this.logger.error(
              `Invalid tag name during sync: ${tagName} - ${(error as Error).message}`,
            );
            throw new BadRequestException(
              `Invalid tag name "${tagName}": ${(error as Error).message}`,
            );
          }
        }
      }

      this.logger.log(
        `Synchronized normalized tags for artifact ${artifactId}`,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to sync artifact tags from string array', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to sync artifact tags: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Find or create a tag assignment for an entity, ensuring no duplicates
   */
  /**
   * Bulk version of findOrCreateTagAssignment that eliminates N+1 queries
   */
  private async bulkFindOrCreateTagAssignments(
    organizationId: string,
    entityType: EntityType,
    entityId: string,
    tags: { name: string; source: PrismaTagSource; confidence?: number }[],
  ): Promise<{ tagId: string; name: string }[]> {
    if (tags.length === 0) return [];

    const normalizedTags = tags.map((tag) => ({
      ...tag,
      name: tag.name.trim(),
    }));

    // Step 1: Find all existing tag assignments in one query
    const existingTagAssignments = await this.prisma.db.tag.findMany({
      where: {
        organizationId,
        entityType,
        entityId,
        name: { in: normalizedTags.map((t) => t.name) },
      },
    });

    // Step 2: Identify which tags need to be created
    const existingTagNames = new Set(existingTagAssignments.map((t) => t.name));
    const tagsToCreate = normalizedTags.filter(
      (t) => !existingTagNames.has(t.name),
    );

    // Step 3: Bulk create missing tag assignments
    let newTagAssignments: PrismaTag[] = [];
    if (tagsToCreate.length > 0) {
      this.logger.debug(
        `[bulkFindOrCreateTagAssignments] Creating ${tagsToCreate.length} new tag assignments`,
        {
          organizationId,
          entityType,
          entityId,
          tagNames: tagsToCreate.map((t) => t.name),
        },
      );

      const createData = tagsToCreate.map((tag) => ({
        organizationId,
        entityType,
        entityId,
        name: tag.name,
        source: tag.source,
        confidence: tag.confidence,
      }));

      await this.prisma.db.tag.createMany({ data: createData });

      // Fetch the newly created tag assignments
      newTagAssignments = await this.prisma.db.tag.findMany({
        where: {
          organizationId,
          entityType,
          entityId,
          name: { in: tagsToCreate.map((t) => t.name) },
        },
      });
    }

    // Step 4: Combine existing and new tag assignments
    const allTagAssignments = [...existingTagAssignments, ...newTagAssignments];

    return allTagAssignments.map((tag) => ({
      tagId: tag.id,
      name: tag.name,
    }));
  }

  private async findOrCreateTagAssignment(
    organizationId: string,
    entityType: EntityType,
    entityId: string,
    tagName: string,
    source: PrismaTagSource = PrismaTagSource.USER,
    confidence?: number,
  ): Promise<ApiTag> {
    // Normalize tag name
    const normalizedName = tagName.trim();

    // Check if tag assignment already exists for this specific entity
    const existingTag = await this.prisma.db.tag.findFirst({
      where: {
        organizationId,
        entityType,
        entityId,
        name: normalizedName,
      },
    });

    if (existingTag) {
      return this.toResponseDto(existingTag);
    }

    // Create new tag assignment
    const newTag = await this.prisma.db.tag.create({
      data: {
        organizationId,
        entityType,
        entityId,
        name: normalizedName,
        source,
        confidence,
      },
    });

    return this.toResponseDto(newTag);
  }

  private toResponseDto(tag: PrismaTag): ApiTag {
    // Map Prisma TagSource back to OpenAPI TagSource
    let apiSource: TagSource = TagSource.User;
    if (tag.source === PrismaTagSource.SYSTEM_FAST) {
      apiSource = TagSource.System;
    } else if (tag.source === PrismaTagSource.SYSTEM_DEEP) {
      apiSource = TagSource.AiGenerated;
    }

    return {
      id: tag.id,
      organizationId: tag.organizationId,
      name: tag.name,
      description: null, // Not stored in new schema
      color: null, // Not stored in new schema
      source: apiSource,
      createdAt: ensureStringDate(tag.createdAt),
      updatedAt: ensureStringDate(tag.updatedAt),
    };
  }
}
