import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseArrayPipe,
  ParseIntPipe,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { EntityType } from '@prisma/client';
import {
  AuthToken,
  CurrentOrganization,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { SearchResult } from '../generated/embeddings';
import { EmbeddingsClientService } from '../services/embeddings-client.service';
import { EntityRegistryService } from '../services/entity-registry/entity-registry.service';
import { OrganizationId, ProjectId } from '../types';
import { EntitySearchResultDto } from './dto/entity-search-result.dto';
import { EntityNameDto, GetEntityNamesDto } from './dto/get-entity-names.dto';

const DEFAULT_ENTITY_TYPES = [
  EntityType.DESIGN_DOC,
  EntityType.TASK,
  EntityType.INITIATIVE,
  EntityType.SERVICE,
];

@ApiTags('Entities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard)
@Controller('api/v1/organizations/:organizationId/entities')
export class EntitySearchController {
  constructor(
    private readonly entityRegistryService: EntityRegistryService,
    private readonly embeddingsClientService: EmbeddingsClientService,
  ) {}

  @Get('search')
  @ApiOperation({ summary: 'Fuzzy search for entities by name' })
  @ApiQuery({
    name: 'query',
    required: true,
    type: String,
    description: 'Search term for fuzzy matching against entity names.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of entities to return (default 10, max 100)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of entities to skip (for pagination)',
  })
  @ApiQuery({
    name: 'entityTypes',
    required: false,
    enum: EntityType,
    isArray: true,
    type: [String],
    description:
      'Filter results by entity types (defaults to DESIGN_DOC, TASK, INITIATIVE, SERVICE)',
  })
  @ApiResponse({
    status: 200,
    description: 'A list of entities matching the search query.',
    type: [EntitySearchResultDto],
  })
  async searchEntities(
    @Query('query') query: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query(
      'entityTypes',
      new ParseArrayPipe({
        items: String,
        separator: ',',
        optional: true,
      }),
    )
    entityTypes: string[] | undefined,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<EntitySearchResultDto[]> {
    const parsedEntityTypes = this.normalizeEntityTypes(entityTypes);

    return this.entityRegistryService.searchEntities(
      organizationId,
      query,
      limit,
      offset,
      parsedEntityTypes,
    );
  }

  @Get('semantic-search')
  @ApiOperation({
    summary: 'Semantic search using embeddings service',
    description:
      'Proxies search request to embeddings service with user JWT token for semantic similarity search',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    type: String,
    description: 'Search query for semantic matching',
  })
  @ApiQuery({
    name: 'projectId',
    required: true,
    type: String,
    description: 'Filter results by project ID',
  })
  @ApiQuery({
    name: 'maxResults',
    required: false,
    type: Number,
    description: 'Maximum number of results to return (default 10)',
  })
  @ApiQuery({
    name: 'threshold',
    required: false,
    type: Number,
    description: 'Similarity threshold (0-1, default 0.15)',
  })
  @ApiQuery({
    name: 'searchType',
    required: false,
    enum: ['semantic', 'keyword', 'hybrid'],
    description: 'Type of search to perform (default: semantic)',
  })
  @ApiQuery({
    name: 'boostRecent',
    required: false,
    type: Boolean,
    description: 'Boost more recent results (default: false)',
  })
  @ApiQuery({
    name: 'statuses',
    required: false,
    type: [String],
    description: 'Filter by status values',
  })
  @ApiQuery({
    name: 'initiativeId',
    required: false,
    type: String,
    description: 'Filter by initiative ID',
  })
  @ApiQuery({
    name: 'parentTaskId',
    required: false,
    type: String,
    description: 'Filter by parent task ID',
  })
  @ApiQuery({
    name: 'entityType',
    required: false,
    type: String,
    description: 'Filter by entity type',
  })
  @ApiResponse({
    status: 200,
    description: 'Search results from embeddings service',
    type: Object,
  })
  @ApiResponse({
    status: 401,
    description: 'Authentication token not found',
  })
  async semanticSearch(
    @Query('q') query: string,
    @Query('projectId') projectId: ProjectId | undefined,
    @Query('maxResults', new DefaultValuePipe(10), ParseIntPipe)
    maxResults: number,
    @Query('threshold') threshold: number | undefined,
    @Query('searchType')
    searchType: 'semantic' | 'keyword' | 'hybrid' | undefined,
    @Query('boostRecent') boostRecent: boolean | undefined,
    @Query(
      'statuses',
      new ParseArrayPipe({
        items: String,
        separator: ',',
        optional: true,
      }),
    )
    statuses: string[] | undefined,
    @Query('initiativeId') initiativeId: string | undefined,
    @Query('parentTaskId') parentTaskId: string | undefined,
    @Query('entityType') entityType: string | undefined,
    @CurrentOrganization() organizationId: OrganizationId,
    @AuthToken() userToken: string | null,
  ): Promise<SearchResult[]> {
    if (!userToken) {
      throw new UnauthorizedException('Authentication token not found');
    }
    if (!projectId) {
      throw new BadRequestException(
        'projectId is required for semantic search',
      );
    }

    return this.embeddingsClientService.searchWithUserToken(
      {
        q: query,
        organizationId,
        projectId,
        maxResults,
        threshold,
        searchType,
        boostRecent,
        statuses,
        initiativeId,
        parentTaskId,
        entityType,
      },
      userToken,
    );
  }

  @Post('names')
  @ApiOperation({
    summary: 'Get entity names by ID and type pairs',
    description:
      'Look up display names for a batch of entities using the entity registry.',
  })
  @ApiBody({ type: GetEntityNamesDto })
  @ApiResponse({
    status: 200,
    description: 'Entity names for the requested entities.',
    type: [EntityNameDto],
  })
  async getEntityNames(
    @Body() dto: GetEntityNamesDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<EntityNameDto[]> {
    const results = await this.entityRegistryService.getEntitiesByIds({
      organizationId,
      entities: dto.entities,
    });

    return results.map((r) => ({
      entityId: r.entityId,
      entityType: r.entityType,
      entityName: r.entityName,
    }));
  }

  private normalizeEntityTypes(entityTypes?: string[]): EntityType[] {
    if (!entityTypes || entityTypes.length === 0) {
      return DEFAULT_ENTITY_TYPES;
    }

    const normalizedTypes = entityTypes.map((type) =>
      type.trim().toUpperCase(),
    ) as EntityType[];

    const invalidTypes = normalizedTypes.filter(
      (type) => !Object.values(EntityType).includes(type),
    );

    if (invalidTypes.length > 0) {
      throw new BadRequestException(
        `Invalid entityTypes: ${invalidTypes.join(', ')}`,
      );
    }

    return normalizedTypes;
  }
}
