import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthToken,
  CurrentOrganization,
} from '../auth/decorators/current-user.decorator';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import {
  UnifiedBatchSearchRequest,
  UnifiedBatchSearchResponse,
  UnifiedSearchRequest,
  UnifiedSearchResponse,
} from '../generated';
import { UnifiedSearchService } from '../services/unified-search/unified-search.service';
import { OrganizationId, ProjectId } from '../types';

@ApiTags('Search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/projects/:projectId/search')
export class UnifiedSearchController {
  constructor(private readonly unifiedSearchService: UnifiedSearchService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Unified search across graph and embeddings services',
    description:
      'Routes search queries to the graph service, embeddings service, or both based on intent.',
  })
  async search(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body() request: UnifiedSearchRequest,
    @AuthToken() userToken: string | null,
  ): Promise<UnifiedSearchResponse> {
    return this.unifiedSearchService.search(
      organizationId,
      projectId,
      request,
      userToken,
    );
  }

  @Post('batch')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Batch unified search across graph and embeddings services',
    description:
      'Runs multiple unified search queries and returns a single aggregated result list.',
  })
  async batchSearch(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body() request: UnifiedBatchSearchRequest,
    @AuthToken() userToken: string | null,
  ): Promise<UnifiedBatchSearchResponse> {
    return this.unifiedSearchService.batchSearch(
      organizationId,
      projectId,
      request,
      userToken,
    );
  }
}
