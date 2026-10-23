import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthToken,
  CurrentOrganization,
} from '../auth/decorators/current-user.decorator';
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
@UseGuards(JwtAuthGuard, OrganizationGuard)
@Controller('api/v1/organizations/:organizationId/projects/:projectId/search')
export class UnifiedSearchController {
  constructor(private readonly unifiedSearchService: UnifiedSearchService) {}

  @Post()
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
