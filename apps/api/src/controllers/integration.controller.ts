import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';

import {
  CreateIntegrationDto,
  IntegrationConnectionStatus,
  IntegrationResponseDto,
  IntegrationState,
  IntegrationType,
  PaginatedGitHubRepositoryResponse,
  TestIntegrationConnection200ResponseAllOfData,
  UpdateGitHubPrimaryRepositoryDto,
  UpdateIntegrationDto,
} from '../generated';
import { ConnectionTestService } from '../services/connection-test.service';
import { IntegrationService } from '../services/integrations/integration.service';
import { GitHubOAuthService } from '../services/integrations/github-oauth.service';
import { GitHubRepositoryService } from '../services/integrations/github-repository.service';
import { UserSuggestionService } from '../services/user-suggestion.service';
import { IntegrationId, OrganizationId, ProjectId, UserId } from '../types';
import { ExecutionContext } from '../types/execution-context';
import { ensureStringDate } from '../utils/date.util';
import { Public } from '../auth/decorators/public.decorator';

@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/integrations',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class IntegrationController {
  constructor(
    private readonly integrationService: IntegrationService,
    private readonly connectionTestService: ConnectionTestService,
    private readonly userSuggestionService: UserSuggestionService,
    private readonly githubOAuthService: GitHubOAuthService,
    private readonly githubRepositoryService: GitHubRepositoryService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createIntegration(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body() createIntegrationDto: CreateIntegrationDto,
    @CurrentUser('userId') userId: UserId,
  ): Promise<IntegrationResponseDto> {
    const integration = await this.integrationService.create(
      organizationId,
      projectId,
      createIntegrationDto,
      userId,
    );

    // Automatically trigger initial sync if integration is active
    if (integration.state === IntegrationState.Active) {
      const context: ExecutionContext = {
        organizationId,
        userId,
        projectId,
      };

      try {
        await this.integrationService.sync(
          organizationId,
          projectId,
          integration.id,
          context,
        );
      } catch (error) {
        // Log sync error but don't fail integration creation
        console.warn(
          `Failed to trigger initial sync for integration ${integration.id}:`,
          error,
        );
      }
    } else {
      // Provide visibility that no sync was attempted for inactive integrations
      console.warn(
        `Failed to trigger initial sync for integration ${integration.id}:`,
        new Error('Integration is inactive'),
      );
    }

    return integration;
  }

  @Get()
  async findAllIntegrations(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Query('type') type?: IntegrationType,
    @Query('state') state?: IntegrationState,
    @Query('connectionStatus') connectionStatus?: IntegrationConnectionStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ): Promise<IntegrationResponseDto[]> {
    const integrations = await this.integrationService.findAll(
      organizationId,
      projectId,
      {
        type,
        state,
        connectionStatus,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        sortBy,
        sortOrder,
      },
    );

    return integrations;
  }

  @Get('github/authorize')
  @Redirect()
  async authorizeGitHubIntegration(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Query('integrationId') integrationId?: IntegrationId,
  ): Promise<{ url: string }> {
    if (!integrationId) {
      throw new BadRequestException('integrationId is required');
    }

    const integration = await this.integrationService.findOne(
      organizationId,
      projectId,
      integrationId,
    );

    if (integration.type !== IntegrationType.Github) {
      throw new BadRequestException('Integration must be GitHub');
    }

    const redirectUri = this.buildGitHubCallbackUrl(organizationId, projectId);
    const { state } = this.githubOAuthService.buildState({
      integrationId,
      organizationId,
      projectId,
    });
    const url = this.githubOAuthService.buildAuthorizeUrl({
      state,
      redirectUri,
      scope: 'repo',
    });

    return { url };
  }

  @Public()
  @Get('github/callback')
  @Redirect()
  async handleGitHubOAuthCallback(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ): Promise<{ url: string }> {
    if (error) {
      const message = errorDescription || error;
      if (state) {
        try {
          const payload = this.githubOAuthService.parseState(state);
          await this.integrationService.updateConnectionStatus(
            payload.integrationId as IntegrationId,
            IntegrationConnectionStatus.Error,
            message,
          );
        } catch (stateError) {
          throw new BadRequestException(
            (stateError as Error).message || message,
          );
        }
      }
      throw new BadRequestException(message);
    }

    if (!code || !state) {
      throw new BadRequestException('Missing OAuth code or state');
    }

    const payload = this.githubOAuthService.parseState(state);
    if (
      payload.organizationId !== organizationId ||
      payload.projectId !== projectId
    ) {
      throw new BadRequestException('OAuth state does not match request');
    }

    const redirectUri = this.buildGitHubCallbackUrl(organizationId, projectId);

    try {
      const tokenResponse = await this.githubOAuthService.exchangeCodeForToken(
        code,
        redirectUri,
      );
      await this.integrationService.storeGitHubOAuthTokens(
        organizationId,
        projectId,
        payload.integrationId as IntegrationId,
        tokenResponse,
      );
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : 'GitHub OAuth failed';
      await this.integrationService.updateConnectionStatus(
        payload.integrationId as IntegrationId,
        IntegrationConnectionStatus.Error,
        message,
      );
      throw new BadRequestException(message);
    }

    return { url: this.buildAppRedirectUrl(projectId) };
  }

  @Get(':integrationId')
  async findOneIntegration(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('integrationId') integrationId: IntegrationId,
  ): Promise<IntegrationResponseDto> {
    return this.integrationService.findOne(
      organizationId,
      projectId,
      integrationId,
    );
  }

  @Patch(':integrationId')
  async updateIntegration(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('integrationId') integrationId: IntegrationId,
    @Body() updateIntegrationDto: UpdateIntegrationDto,
  ): Promise<IntegrationResponseDto> {
    return this.integrationService.update(
      organizationId,
      projectId,
      integrationId,
      updateIntegrationDto,
    );
  }

  @Get(':integrationId/repositories')
  async listGitHubRepositories(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('integrationId') integrationId: IntegrationId,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('org') org?: string,
  ): Promise<PaginatedGitHubRepositoryResponse> {
    const parsedPage = page ? Number(page) : undefined;
    const parsedLimit = limit ? Number(limit) : undefined;

    return this.githubRepositoryService.listRepositories({
      organizationId,
      projectId,
      integrationId,
      page: parsedPage,
      limit: parsedLimit,
      org: org?.trim() || undefined,
    });
  }

  @Patch(':integrationId/repositories/primary')
  async updateGitHubPrimaryRepository(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('integrationId') integrationId: IntegrationId,
    @Body() updatePrimaryRepoDto: UpdateGitHubPrimaryRepositoryDto,
  ): Promise<IntegrationResponseDto> {
    return this.githubRepositoryService.updatePrimaryRepository({
      organizationId,
      projectId,
      integrationId,
      payload: updatePrimaryRepoDto,
    });
  }

  @Delete(':integrationId')
  async removeIntegration(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('integrationId') integrationId: IntegrationId,
  ): Promise<IntegrationResponseDto> {
    return this.integrationService.remove(
      organizationId,
      projectId,
      integrationId,
    );
  }

  @Post(':integrationId/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncIntegration(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('integrationId') integrationId: IntegrationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<{ jobId: string }> {
    const context: ExecutionContext = {
      organizationId,
      userId,
      projectId,
    };

    return this.integrationService.sync(
      organizationId,
      projectId,
      integrationId,
      context,
    );
  }

  @Post(':integrationId/test-connection')
  async testIntegrationConnection(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('integrationId') integrationId: IntegrationId,
  ): Promise<TestIntegrationConnection200ResponseAllOfData> {
    // Get the integration with decrypted config for testing
    const integration =
      await this.integrationService.findOneWithDecryptedConfig(
        organizationId,
        projectId,
        integrationId,
      );

    // Test the connection
    const testResult =
      await this.connectionTestService.testConnection(integration);

    // Update the connection status based on test result
    await this.integrationService.updateConnectionStatus(
      integrationId,
      testResult.connectionStatus,
      testResult.message,
    );

    return {
      connectionStatus: testResult.connectionStatus,
      message: testResult.message,
      testedAt: testResult.testedAt,
      details: testResult.details,
    };
  }

  @Get('suggested-users')
  async getSuggestedUsers(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId?: ProjectId,
    @Query('integrationType') integrationType?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ): Promise<{
    users: Array<{
      name: string;
      email: string;
      sources: string[];
      confidence: number;
      lastSeen: string;
    }>;
    totalCount: number;
    cached: boolean;
  }> {
    const result = await this.userSuggestionService.getSuggestedUsers({
      organizationId,
      projectId,
      integrationType,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });

    return {
      users: result.users.map((user) => ({
        name: user.name,
        email: user.email,
        sources: user.sources,
        confidence: user.confidence,
        lastSeen: ensureStringDate(user.lastSeen),
      })),
      totalCount: result.totalCount,
      cached: result.cached,
    };
  }

  private buildGitHubCallbackUrl(
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): string {
    const baseUrl = process.env.API_BASE_URL;
    if (!baseUrl) {
      throw new BadRequestException('API_BASE_URL is required');
    }
    return `${baseUrl}/api/v1/organizations/${organizationId}/projects/${projectId}/integrations/github/callback`;
  }

  private buildAppRedirectUrl(projectId: ProjectId): string {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) {
      throw new BadRequestException('APP_BASE_URL is required');
    }
    return `${baseUrl}/projects/${projectId}`;
  }
}
