import { ProjectAccessService } from '../auth/services/project-access.service';
import {
  ProjectAccessGuard,
  ProjectResourceId,
} from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotImplementedException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentOrganization,
} from '../auth/decorators/current-user.decorator';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ArtifactService } from '../services/artifacts/artifact.service';
import { OrganizationId, ProjectId } from 'src/types';
import {
  ArtifactResponseDto,
  CreateArtifactDto,
  PaginatedArtifactsDto,
  QueryArtifactsDto,
  SemanticSearchDto,
  SemanticSearchResponseDto,
  UpdateArtifactDto,
} from 'src/generated';

@ApiTags('Artifacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@ProjectResourceId('artifact')
@Controller('api/v1/organizations/:organizationId/artifacts')
export class ArtifactController {
  private readonly logger = new Logger(ArtifactController.name);

  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly artifactTypedService: ArtifactService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create Artifact',
    description: 'Create a new artifact with optional embedding generation',
  })
  @ApiResponse({
    status: 201,
    description: 'Artifact created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() createDto: CreateArtifactDto,
  ): Promise<ArtifactResponseDto> {
    this.logger.log(
      `Creating artifact of type: ${createDto.type} for user: ${user.userId} in org: ${organizationId}`,
    );
    return this.artifactTypedService.create(createDto);
  }

  @Get()
  @SkipTransform()
  @ApiOperation({
    summary: 'List Artifacts',
    description: 'Get artifact objects with filtering and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Artifacts retrieved successfully',
  })
  async findMany(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query() queryDto: QueryArtifactsDto,
  ): Promise<PaginatedArtifactsDto> {
    this.logger.log(
      `User ${user.userId} querying artifact objects in org ${organizationId} with filters: ${JSON.stringify(queryDto)}`,
    );
    return this.artifactTypedService.findMany(
      queryDto,
      organizationId,
      await this.projectAccess.accessibleProjectIds(
        user.userId,
        organizationId,
      ),
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Artifact',
    description: 'Get a specific artifact object by ID',
  })
  @ApiParam({
    name: 'id',
    description: 'Artifact object ID',
    example: 'uuid-string',
  })
  @ApiResponse({
    status: 200,
    description: 'Artifact retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Artifact object not found',
  })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('id') id: string,
  ): Promise<ArtifactResponseDto> {
    this.logger.log(
      `User ${user.userId} getting artifact: ${id} in org: ${organizationId}`,
    );
    return this.artifactTypedService.findOne(id, organizationId);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update Artifact',
    description: 'Update an existing artifact object',
  })
  @ApiParam({
    name: 'id',
    description: 'Artifact object ID',
    example: 'uuid-string',
  })
  @ApiResponse({
    status: 200,
    description: 'Artifact object updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Artifact object not found',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('id') id: string,
    @Body() updateDto: UpdateArtifactDto,
  ): Promise<ArtifactResponseDto> {
    this.logger.log(
      `User ${user.userId} updating artifact: ${id} in org: ${organizationId}`,
    );
    return this.artifactTypedService.update(id, updateDto, organizationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete Artifact',
    description: 'Soft delete a artifact object (archives it)',
  })
  @ApiParam({
    name: 'id',
    description: 'Artifact object ID',
    example: 'uuid-string',
  })
  @ApiResponse({
    status: 204,
    description: 'Artifact object deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Artifact object not found',
  })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('id') id: string,
  ): Promise<void> {
    this.logger.log(
      `User ${user.userId} deleting artifact: ${id} in org: ${organizationId}`,
    );
    return this.artifactTypedService.delete(id, organizationId);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Semantic Search',
    description: 'Search artifact objects using semantic similarity',
  })
  @ApiResponse({
    status: 200,
    description: 'Search completed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid search parameters',
  })
  async semanticSearch(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() searchDto: SemanticSearchDto,
  ): Promise<SemanticSearchResponseDto> {
    this.logger.log(
      `User ${user.userId} performing semantic search: "${searchDto.query}" in org: ${organizationId}`,
    );
    return this.artifactTypedService.semanticSearch(searchDto, organizationId);
  }

  @Get('search/simple')
  @ApiOperation({
    summary: 'Simple Search',
    description: 'Simple search using query parameters',
  })
  @ApiQuery({
    name: 'q',
    description: 'Search query',
    example: 'JWT authentication',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Filter by project ID',
    required: false,
  })
  @ApiQuery({
    name: 'maxResults',
    description: 'Maximum results to return',
    required: false,
    example: 10,
  })
  @ApiQuery({
    name: 'threshold',
    description: 'Similarity threshold (0.0-1.0)',
    required: false,
    example: 0.15,
  })
  @ApiResponse({
    status: 200,
    description: 'Search completed successfully',
  })
  async simpleSearch(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('q') query: string,
    @Query('projectId') projectId?: ProjectId,
    @Query('maxResults') _maxResults?: number,
    @Query('threshold') threshold?: number,
  ): Promise<SemanticSearchResponseDto> {
    this.logger.log(
      `User ${user.userId} performing simple search: "${query}" in org: ${organizationId}`,
    );

    const searchDto: SemanticSearchDto = {
      query,
      projectId,
      threshold: threshold || 0.15,
    };

    return this.artifactTypedService.semanticSearch(searchDto, organizationId);
  }

  @Get('project/:projectId/summary')
  @ApiOperation({
    summary: 'Project Artifact Summary',
    description: 'Get summary statistics for artifacts in a project',
  })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    example: 'proj-uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary statistics retrieved successfully',
  })
  async getProjectSummary(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
  ) {
    this.logger.log(
      `User ${user.userId} getting artifact summary for project: ${projectId} in org: ${organizationId}`,
    );

    const queryDto: QueryArtifactsDto = {
      projectId,
      status: 'ACTIVE',
      limit: 1000, // Large limit to get comprehensive stats
    };

    const result = await this.artifactTypedService.findMany(
      queryDto,
      organizationId,
    );

    // Calculate summary statistics
    const stats = {
      total: result.total,
      byType: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      withEmbeddings: 0,
      publicCount: 0,
      recentCount: 0, // Created in last 7 days
    };

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    result.data.forEach((ko) => {
      // Type distribution
      stats.byType[ko.type] = (stats.byType[ko.type] || 0) + 1;

      // Category distribution
      if (ko.category) {
        stats.byCategory[ko.category] =
          (stats.byCategory[ko.category] || 0) + 1;
      }

      // Other counts
      if (ko.hasEmbedding) stats.withEmbeddings++;
      if (ko.isPublic) stats.publicCount++;
      if (new Date(ko.createdAt) > oneWeekAgo) stats.recentCount++;
    });

    return {
      projectId,
      summary: stats,
      sampleObjects: result.data.slice(0, 5), // Return first 5 as samples
    };
  }

  @Get(':id/hierarchy')
  @ApiOperation({
    summary: 'Get Artifact Hierarchy',
    description: 'Get the complete hierarchy tree for a artifact object',
  })
  @ApiParam({
    name: 'id',
    description: 'Artifact object ID',
    example: 'uuid-string',
  })
  @ApiResponse({
    status: 200,
    description: 'Hierarchy retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Artifact object not found',
  })
  async getHierarchy(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('id') id: string,
  ) {
    this.logger.log(
      `User ${user.userId} getting hierarchy for artifact object: ${id} in org: ${organizationId}`,
    );

    // Get the artifact object
    const artifact = await this.artifactTypedService.findOne(
      id,
      organizationId,
    );

    // Find all objects in the same hierarchy
    const rootId = artifact.rootId || artifact.id;

    const hierarchyObjects = await this.artifactTypedService.findMany(
      {
        projectId: artifact.projectId,
        status: 'ACTIVE',
        limit: 100,
      },
      organizationId,
    );

    // Filter to objects in the same hierarchy
    const relatedObjects = hierarchyObjects.data.filter(
      (ko) => ko.rootId === rootId || ko.id === rootId,
    );

    return {
      rootId,
      targetObjectId: id,
      hierarchy: relatedObjects,
      totalInHierarchy: relatedObjects.length,
    };
  }

  @Get(':id/similar')
  @ApiOperation({
    summary: 'Find Similar Artifacts',
    description:
      'Find artifact objects similar to the given one using embeddings',
  })
  @ApiParam({
    name: 'id',
    description: 'Artifact object ID',
    example: 'uuid-string',
  })
  @ApiQuery({
    name: 'limit',
    description: 'Maximum number of similar objects to return',
    required: false,
    example: 5,
  })
  @ApiQuery({
    name: 'threshold',
    description: 'Similarity threshold (0.0-1.0)',
    required: false,
    example: 0.3,
  })
  @ApiResponse({
    status: 200,
    description: 'Similar objects retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Artifact object not found',
  })
  async findSimilar(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('id') id: string,
    @Query('limit') limit?: number,
    @Query('threshold') threshold?: number,
  ): Promise<SemanticSearchResponseDto> {
    throw new NotImplementedException('Semantic search not yet implemented');
  }
}
