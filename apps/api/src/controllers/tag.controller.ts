import { ProjectAccessService } from '../auth/services/project-access.service';
import { ProjectResourceAccessService } from '../auth/services/project-resource-access.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  ProjectAccessGuard,
  ProjectResourceId,
} from '../auth/guards/project-access.guard';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { CurrentOrganization } from '../auth/decorators/current-user.decorator';
import { TagService } from '../services/tag.service';
import { Tag, TagQueryDto, UpdateTagDto, AssignTagDto } from 'src/generated';
import { OrganizationId } from '../types';

@ApiTags('Tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/tags')
@ProjectResourceId('tag')
export class TagController {
  constructor(
    private readonly tagService: TagService,
    private readonly projectAccess: ProjectAccessService,
    private readonly resources: ProjectResourceAccessService,
  ) {}

  // Note: Tag creation is now handled through entity-specific endpoints
  // POST /artifacts/{id}/tags, POST /initiatives/{id}/tags, etc.
  // This reflects the new polymorphic design where tags must be associated with entities

  @Get()
  @ApiOperation({ summary: 'List All Tags in Organization' })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: ['ARTIFACT', 'INITIATIVE', 'PROJECT'],
    description: 'Filter by entity type',
  })
  @ApiQuery({
    name: 'source',
    required: false,
    enum: ['USER', 'SYSTEM_FAST', 'SYSTEM_DEEP'],
    description: 'Filter by tag source',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search in tag name',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of tags to return (max 100)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of tags to skip',
  })
  @ApiResponse({
    status: 200,
    description: 'List of tags',
  })
  async findMany(
    @CurrentUser('userId') userId: string,
    @Query() queryDto: TagQueryDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<Tag[]> {
    const accessibleTagIds = await this.resources.accessibleTagIds(
      userId,
      organizationId,
    );
    return this.tagService.findMany(
      {
        ...queryDto,
        organizationId,
      },
      accessibleTagIds,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Tag by ID' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Tag ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Tag details',
  })
  @ApiResponse({
    status: 404,
    description: 'Tag not found',
  })
  async findOne(
    @Param('id') id: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<Tag> {
    return this.tagService.findOne(id, organizationId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update Tag Assignment' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Tag ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Tag updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Tag not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Tag name conflict',
  })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateTagDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<Tag> {
    return this.tagService.update(id, updateDto, organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete Tag Assignment' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Tag ID',
  })
  @ApiResponse({
    status: 204,
    description: 'Tag assignment deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Tag assignment not found',
  })
  async delete(
    @Param('id') id: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    return this.tagService.delete(id, organizationId);
  }

  @Post('sync/artifacts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync Denormalized Tags for All Artifacts' })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    type: String,
    description: 'Organization ID to scope sync operation',
  })
  @ApiResponse({
    status: 200,
    description: 'Tag synchronization completed',
    schema: {
      type: 'object',
      properties: {
        synced: {
          type: 'number',
          description: 'Number of artifacts synchronized',
        },
      },
    },
  })
  async syncAllArtifactTags(
    @CurrentUser('userId') userId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<{ synced: number }> {
    return this.tagService.syncAllArtifactTags(
      organizationId,
      await this.projectAccess.accessibleProjectIds(userId, organizationId),
    );
  }
}

@ApiTags('Artifacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('organizations/:organizationId/artifacts')
@ProjectResourceId('artifact')
export class ArtifactTagController {
  constructor(private readonly tagService: TagService) {}

  @Get(':id/tags')
  @ApiOperation({ summary: 'Get Tags for Artifact' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Artifact ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of artifact tags',
  })
  async getArtifactTags(
    @Param('id') artifactId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<Tag[]> {
    return this.tagService.getArtifactTags(artifactId, organizationId);
  }

  @Post(':id/tags')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign Tag to Artifact' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Artifact ID',
  })
  @ApiResponse({
    status: 201,
    description: 'Tag assigned to artifact successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Artifact or tag not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Tag already assigned to artifact',
  })
  async assignTagToArtifact(
    @Param('id') artifactId: string,
    @Body() assignDto: AssignTagDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    return this.tagService.assignToArtifact(
      artifactId,
      assignDto,
      organizationId,
    );
  }

  @Delete(':artifactId/tags/:tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove Tag from Artifact' })
  @ApiParam({
    name: 'artifactId',
    type: String,
    description: 'Artifact ID',
  })
  @ApiParam({
    name: 'tagId',
    type: String,
    description: 'Tag ID',
  })
  @ApiResponse({
    status: 204,
    description: 'Tag removed from artifact successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Tag assignment not found',
  })
  async removeTagFromArtifact(
    @Param('artifactId') artifactId: string,
    @Param('tagId') tagId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    return this.tagService.removeFromArtifact(
      artifactId,
      tagId,
      organizationId,
    );
  }

  @Post(':id/tags/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync Tag Relations from String Array' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Artifact ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Artifact tag relations synchronized from string array',
  })
  @ApiResponse({
    status: 404,
    description: 'Artifact not found',
  })
  async syncArtifactTagsFromStringArray(
    @Param('id') artifactId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    return this.tagService.syncArtifactTagsFromStringArray(
      artifactId,
      organizationId,
    );
  }
}

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('organizations/:organizationId/projects')
@ProjectResourceId('project')
export class ProjectTagController {
  constructor(private readonly tagService: TagService) {}

  @Get(':id/tags')
  @ApiOperation({ summary: 'Get Tags for Project' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Project ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of project tags',
  })
  async getProjectTags(
    @Param('id') projectId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<Tag[]> {
    return this.tagService.getProjectTags(projectId, organizationId);
  }

  @Post(':id/tags')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign Tag to Project' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Project ID',
  })
  @ApiResponse({
    status: 201,
    description: 'Tag assigned to project successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Project or tag not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Tag already assigned to project',
  })
  async assignTagToProject(
    @Param('id') projectId: string,
    @Body() assignDto: AssignTagDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    return this.tagService.assignToProject(
      projectId,
      assignDto,
      organizationId,
    );
  }

  @Delete(':projectId/tags/:tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove Tag from Project' })
  @ApiParam({
    name: 'projectId',
    type: String,
    description: 'Project ID',
  })
  @ApiParam({
    name: 'tagId',
    type: String,
    description: 'Tag ID',
  })
  @ApiResponse({
    status: 204,
    description: 'Tag removed from project successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Tag assignment not found',
  })
  async removeTagFromProject(
    @Param('projectId') projectId: string,
    @Param('tagId') tagId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    return this.tagService.removeFromProject(projectId, tagId, organizationId);
  }
}

@ApiTags('Initiatives')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('organizations/:organizationId/initiatives')
@ProjectResourceId('initiative')
export class InitiativeTagController {
  constructor(private readonly tagService: TagService) {}

  @Get(':id/tags')
  @ApiOperation({ summary: 'Get Tags for Initiative' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Initiative ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of initiative tags',
  })
  async getInitiativeTags(
    @Param('id') initiativeId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<Tag[]> {
    return this.tagService.getInitiativeTags(initiativeId, organizationId);
  }

  @Post(':id/tags')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign Tag to Initiative' })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Initiative ID',
  })
  @ApiResponse({
    status: 201,
    description: 'Tag assigned to initiative successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Initiative or tag not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Tag already assigned to initiative',
  })
  async assignTagToInitiative(
    @Param('id') initiativeId: string,
    @Body() assignDto: AssignTagDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    return this.tagService.assignToInitiative(
      initiativeId,
      assignDto,
      organizationId,
    );
  }

  @Delete(':initiativeId/tags/:tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove Tag from Initiative' })
  @ApiParam({
    name: 'initiativeId',
    type: String,
    description: 'Initiative ID',
  })
  @ApiParam({
    name: 'tagId',
    type: String,
    description: 'Tag ID',
  })
  @ApiResponse({
    status: 204,
    description: 'Tag removed from initiative successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Tag assignment not found',
  })
  async removeTagFromInitiative(
    @Param('initiativeId') initiativeId: string,
    @Param('tagId') tagId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    return this.tagService.removeFromInitiative(
      initiativeId,
      tagId,
      organizationId,
    );
  }
}
