import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Integration, IntegrationTargetType, Prisma } from '@prisma/client';
import {
  CreateIntegrationDto,
  UpdateIntegrationDto,
  IntegrationResponseDto,
  IntegrationType,
  IntegrationState,
  IntegrationConnectionStatus,
} from '../../generated';
import { IntegrationId, ProjectId, OrganizationId, UserId } from '../../types';
import { GitHubWebhookService } from './github-webhook.service';
import { GitHubOAuthService } from './github-oauth.service';
import { ExecutionContext } from '../../types/execution-context';
import { ConfigEncryptionService } from '../config-encryption.service';
import { JobEnqueueingService } from '../job-enqueuing.service';
import {
  IntegrationJobData,
  IntegrationTestJobData,
} from '../interfaces/job-enqueuer.interface';
import { randomBytes } from 'node:crypto';

@Injectable()
export class IntegrationService {
  constructor(
    private prisma: PrismaService,
    private configEncryptionService: ConfigEncryptionService,
    private jobEnqueringService: JobEnqueueingService,
    private githubWebhookService: GitHubWebhookService,
    private githubOAuthService: GitHubOAuthService,
  ) {}

  async create(
    organizationId: OrganizationId,
    projectId: ProjectId,
    createIntegrationDto: CreateIntegrationDto,
    createdBy?: UserId,
  ): Promise<IntegrationResponseDto> {
    // Verify project exists and belongs to organization
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: organizationId,
        deletedAt: null,
      },
    });

    if (!project) {
      throw new NotFoundException(
        `Project ${projectId} not found or does not belong to organization ${organizationId}`,
      );
    }

    // Check if integration with same name already exists for this project
    const existingIntegration = await this.prisma.integration.findFirst({
      where: {
        projectId: projectId,
        name: createIntegrationDto.name,
        deletedAt: null,
      },
    });

    if (existingIntegration) {
      throw new BadRequestException(
        `Integration with name '${createIntegrationDto.name}' already exists for this project`,
      );
    }

    // Encrypt sensitive fields in config
    const configWithWebhookSecret =
      createIntegrationDto.type === IntegrationType.Github
        ? this.ensureGitHubWebhookSecret(createIntegrationDto.config)
        : createIntegrationDto.config;
    const encryptedConfig = await this.configEncryptionService.encryptConfig(
      configWithWebhookSecret,
      createIntegrationDto.type,
      organizationId,
    );

    const integration = await this.prisma.integration.create({
      data: {
        projectId: projectId,
        organizationId: organizationId,
        type: createIntegrationDto.type,
        name: createIntegrationDto.name,
        description: createIntegrationDto.description,
        config: encryptedConfig as Prisma.InputJsonValue,
        state: createIntegrationDto.state || IntegrationState.Active,
        connectionStatus: IntegrationConnectionStatus.Pending,
        targetType: createIntegrationDto.targetType ?? undefined,
        createdBy: createdBy,
      },
      include: {
        project: true,
        organization: true,
      },
    });

    // Automatically register webhook for GitHub integrations
    if (createIntegrationDto.type === IntegrationType.Github) {
      await this.registerWebhookForIntegration(integration);
    }

    return this.mapToDto(integration);
  }

  async findAll(
    organizationId: OrganizationId,
    projectId: ProjectId,
    filters?: {
      type?: IntegrationType;
      state?: IntegrationState;
      connectionStatus?: IntegrationConnectionStatus;
      page?: number;
      limit?: number;
      targetType?: IntegrationTargetType;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
  ): Promise<IntegrationResponseDto[]> {
    // Verify project exists and belongs to organization
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: organizationId,
        deletedAt: null,
      },
    });

    if (!project) {
      throw new NotFoundException(
        `Project ${projectId} not found or does not belong to organization ${organizationId}`,
      );
    }

    const where: Prisma.IntegrationWhereInput = {
      projectId: projectId,
      organizationId: organizationId,
      deletedAt: null,
    };

    if (filters?.type) {
      where.type = filters.type;
    }
    if (filters?.state) {
      where.state = filters.state;
    }
    if (filters?.connectionStatus) {
      where.connectionStatus = filters.connectionStatus;
    }
    if (filters?.targetType) {
      where.targetType = filters.targetType;
    }

    const orderBy: Prisma.IntegrationOrderByWithRelationInput = {};
    if (filters?.sortBy) {
      orderBy[
        filters.sortBy as keyof Prisma.IntegrationOrderByWithRelationInput
      ] = filters.sortOrder || 'desc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const skip =
      filters?.page && filters?.limit
        ? (filters.page - 1) * filters.limit
        : undefined;
    const take = filters?.limit;

    const integrations = await this.prisma.integration.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        project: true,
        organization: true,
      },
    });

    return integrations.map((integration) => this.mapToDto(integration));
  }

  async findOne(
    organizationId: OrganizationId,
    projectId: ProjectId,
    integrationId: IntegrationId,
  ): Promise<IntegrationResponseDto> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        projectId: projectId,
        organizationId: organizationId,
        deletedAt: null,
      },
      include: {
        project: true,
        organization: true,
      },
    });

    if (!integration) {
      throw new NotFoundException(`Integration ${integrationId} not found`);
    }

    return this.mapToDto(integration);
  }

  /**
   * Get integration with decrypted config for internal services
   * WARNING: Only use this for internal services that need actual config values
   */
  async findOneWithDecryptedConfig(
    organizationId: OrganizationId,
    projectId: ProjectId,
    integrationId: IntegrationId,
  ): Promise<IntegrationResponseDto> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        projectId: projectId,
        organizationId: organizationId,
        deletedAt: null,
      },
      include: {
        project: true,
        organization: true,
      },
    });

    if (!integration) {
      throw new NotFoundException(`Integration ${integrationId} not found`);
    }

    const refreshedIntegration =
      await this.refreshGitHubAccessTokenIfNeeded(integration);

    // Decrypt the config for internal use
    const decryptedConfig = await this.configEncryptionService.decryptConfig(
      refreshedIntegration.config as object,
      refreshedIntegration.type as IntegrationType,
      organizationId,
    );

    const dto = this.mapToDto(refreshedIntegration);
    dto.config = decryptedConfig;
    return dto;
  }

  async findActiveGitHubIntegrationWithDecryptedConfig(
    integrationId: IntegrationId,
  ): Promise<IntegrationResponseDto> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        type: IntegrationType.Github,
        state: IntegrationState.Active,
        deletedAt: null,
        project: { deletedAt: null },
        organization: { isActive: true },
      },
      include: {
        project: true,
        organization: true,
      },
    });

    if (!integration) {
      throw new NotFoundException('Active GitHub integration not found');
    }

    const decryptedConfig = await this.configEncryptionService.decryptConfig(
      integration.config as object,
      IntegrationType.Github,
      integration.organizationId as OrganizationId,
    );
    const dto = this.mapToDto(integration);
    dto.config = decryptedConfig;
    return dto;
  }

  async update(
    organizationId: OrganizationId,
    projectId: ProjectId,
    integrationId: IntegrationId,
    updateIntegrationDto: UpdateIntegrationDto,
  ): Promise<IntegrationResponseDto> {
    // Verify integration exists and belongs to organization/project
    const existingIntegration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        projectId: projectId,
        organizationId: organizationId,
        deletedAt: null,
      },
    });

    if (!existingIntegration) {
      throw new NotFoundException(`Integration ${integrationId} not found`);
    }

    // Check if new name conflicts with existing integration
    if (
      updateIntegrationDto.name &&
      updateIntegrationDto.name !== existingIntegration.name
    ) {
      const nameConflict = await this.prisma.integration.findFirst({
        where: {
          projectId: projectId,
          name: updateIntegrationDto.name,
          id: { not: integrationId },
          deletedAt: null,
        },
      });

      if (nameConflict) {
        throw new BadRequestException(
          `Integration with name '${updateIntegrationDto.name}' already exists for this project`,
        );
      }
    }

    const updateData: Prisma.IntegrationUpdateInput = {};

    if (updateIntegrationDto.name !== undefined) {
      updateData.name = updateIntegrationDto.name;
    }
    if (updateIntegrationDto.description !== undefined) {
      updateData.description = updateIntegrationDto.description;
    }
    if (updateIntegrationDto.config !== undefined) {
      let updatedConfig = updateIntegrationDto.config;
      if (existingIntegration.type === IntegrationType.Github) {
        const existingConfig = await this.configEncryptionService.decryptConfig(
          existingIntegration.config as object,
          IntegrationType.Github,
          organizationId,
        );
        updatedConfig = this.ensureGitHubWebhookSecret({
          ...existingConfig,
          ...updateIntegrationDto.config,
        });
      }
      const encryptedConfig = await this.configEncryptionService.encryptConfig(
        updatedConfig,
        existingIntegration.type as IntegrationType,
        organizationId,
      );
      updateData.config = encryptedConfig as Prisma.InputJsonValue;
    }
    if (updateIntegrationDto.state !== undefined) {
      updateData.state = updateIntegrationDto.state;
    }

    const integration = await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        ...updateData,
      },
      include: {
        project: true,
        organization: true,
      },
    });

    if (integration.type === IntegrationType.Github) {
      await this.refreshWebhookRegistration(integration);
    }

    return this.mapToDto(integration);
  }

  async remove(
    organizationId: OrganizationId,
    projectId: ProjectId,
    integrationId: IntegrationId,
  ): Promise<IntegrationResponseDto> {
    // Verify integration exists and belongs to organization/project
    const existingIntegration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        projectId: projectId,
        organizationId: organizationId,
        deletedAt: null,
      },
      include: {
        project: true,
        organization: true,
      },
    });

    if (!existingIntegration) {
      throw new NotFoundException(`Integration ${integrationId} not found`);
    }

    // Clean up webhook before soft delete
    await this.cleanupWebhookForIntegration(existingIntegration);

    // Soft delete
    const integration = await this.prisma.integration.update({
      where: { id: integrationId },
      data: { deletedAt: new Date() },
      include: {
        project: true,
        organization: true,
      },
    });

    return this.mapToDto(integration);
  }

  async sync(
    organizationId: OrganizationId,
    projectId: ProjectId,
    integrationId: IntegrationId,
    context: ExecutionContext,
  ): Promise<{ jobId: string }> {
    // Verify integration exists and belongs to organization/project
    const integration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        projectId: projectId,
        organizationId: organizationId,
        deletedAt: null,
      },
    });

    if (!integration) {
      throw new NotFoundException(`Integration ${integrationId} not found`);
    }

    if (integration.state !== IntegrationState.Active) {
      throw new BadRequestException('Integration must be active to sync');
    }

    const jobData: IntegrationJobData = {
      integrationId,
      integrationType: integration.type,
    };

    const job = await this.jobEnqueringService.queueIntegrationSync(
      jobData,
      context,
    );

    return { jobId: job.id };
  }

  async testConnection(
    organizationId: OrganizationId,
    projectId: ProjectId,
    integrationId: IntegrationId,
    context: ExecutionContext,
    config?: object,
  ): Promise<{ jobId: string }> {
    // Verify integration exists and belongs to organization/project
    const integration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        projectId: projectId,
        organizationId: organizationId,
        deletedAt: null,
      },
    });

    if (!integration) {
      throw new NotFoundException(`Integration ${integrationId} not found`);
    }

    // Use provided config or existing integration config
    const configToTest = config || integration.config;

    if (!configToTest || typeof configToTest !== 'object') {
      throw new BadRequestException(
        'Valid configuration is required for connection test',
      );
    }

    const jobData: IntegrationTestJobData = {
      integrationId,
      config: configToTest,
    };

    const job = await this.jobEnqueringService.queueIntegrationConnectionTest(
      jobData,
      context,
    );

    return { jobId: job.id };
  }

  async updateConnectionStatus(
    integrationId: IntegrationId,
    connectionStatus: IntegrationConnectionStatus,
    errorMessage?: string,
  ): Promise<void> {
    const updateData: Prisma.IntegrationUpdateInput = {
      connectionStatus,
      lastConnectionCheck: new Date(),
    };

    if (connectionStatus === IntegrationConnectionStatus.Connected) {
      updateData.lastSuccessfulSync = new Date();
      updateData.errorMessage = null;
    } else if (
      connectionStatus === IntegrationConnectionStatus.Error &&
      errorMessage
    ) {
      updateData.errorMessage = errorMessage;
    }

    await this.prisma.integration.update({
      where: { id: integrationId },
      data: updateData,
    });
  }

  async storeGitHubOAuthTokens(
    organizationId: OrganizationId,
    projectId: ProjectId,
    integrationId: IntegrationId,
    tokenResponse: {
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
      refreshTokenExpiresIn?: number;
      scope?: string;
      tokenType?: string;
    },
  ): Promise<IntegrationResponseDto> {
    const integration = await this.prisma.integration.findFirst({
      where: {
        id: integrationId,
        projectId,
        organizationId,
        deletedAt: null,
      },
      include: {
        project: true,
        organization: true,
      },
    });

    if (!integration) {
      throw new NotFoundException(`Integration ${integrationId} not found`);
    }

    if (integration.type !== IntegrationType.Github) {
      throw new BadRequestException(
        'OAuth token storage is only supported for GitHub integrations',
      );
    }

    const decryptedConfig = (await this.configEncryptionService.decryptConfig(
      integration.config as object,
      IntegrationType.Github,
      organizationId,
    )) as Record<string, unknown>;

    const updatedConfig = this.ensureGitHubWebhookSecret({
      ...decryptedConfig,
      token: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken ?? decryptedConfig.refreshToken,
      tokenExpiresAt:
        this.buildExpiryDate(tokenResponse.expiresIn) ??
        decryptedConfig.tokenExpiresAt,
      refreshTokenExpiresAt:
        this.buildExpiryDate(tokenResponse.refreshTokenExpiresIn) ??
        decryptedConfig.refreshTokenExpiresAt,
      scope: tokenResponse.scope ?? decryptedConfig.scope,
      tokenType: tokenResponse.tokenType ?? decryptedConfig.tokenType,
    });

    const encryptedConfig = await this.configEncryptionService.encryptConfig(
      updatedConfig,
      IntegrationType.Github,
      organizationId,
    );

    const updatedIntegration = await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        config: encryptedConfig as Prisma.InputJsonValue,
        state: IntegrationState.Active,
        connectionStatus: IntegrationConnectionStatus.Connected,
        lastConnectionCheck: new Date(),
        errorMessage: null,
      },
      include: {
        project: true,
        organization: true,
      },
    });

    await this.refreshWebhookRegistration(updatedIntegration);

    return this.mapToDto(updatedIntegration);
  }

  public dtoToIntegration(integration: IntegrationResponseDto): Integration {
    const maskedConfig = this.configEncryptionService.maskConfigForResponse(
      integration.config as object,
      integration.type,
    );

    return {
      id: integration.id,
      projectId: integration.projectId,
      organizationId: integration.organizationId,
      type: integration.type,
      name: integration.name,
      description: integration.description ?? null,
      targetType: integration.targetType,
      config: maskedConfig,
      state: integration.state,
      connectionStatus: integration.connectionStatus,
      lastConnectionCheck: integration.lastConnectionCheck
        ? new Date(integration.lastConnectionCheck)
        : null,
      lastSuccessfulSync: integration.lastSuccessfulSync
        ? new Date(integration.lastSuccessfulSync)
        : null,
      errorMessage: integration.errorMessage ?? null,
      createdBy: integration.createdBy ?? null,
      createdAt: new Date(integration.createdAt),
      updatedAt: new Date(integration.updatedAt),
      deletedAt: integration.deletedAt ? new Date(integration.deletedAt) : null,
    };
  }

  public mapToDto(integration: Integration): IntegrationResponseDto {
    const maskedConfig = this.configEncryptionService.maskConfigForResponse(
      integration.config as object,
      integration.type as IntegrationType,
    );

    return {
      id: integration.id as IntegrationId,
      projectId: integration.projectId as ProjectId,
      organizationId: integration.organizationId as OrganizationId,
      type: integration.type as IntegrationType,
      name: integration.name,
      description: integration.description,
      targetType: integration.targetType,
      config: maskedConfig,
      state: integration.state as IntegrationState,
      connectionStatus:
        integration.connectionStatus as IntegrationConnectionStatus,
      lastConnectionCheck:
        integration.lastConnectionCheck?.toISOString() || null,
      lastSuccessfulSync: integration.lastSuccessfulSync?.toISOString() || null,
      errorMessage: integration.errorMessage,
      createdBy: integration.createdBy,
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
      deletedAt: integration.deletedAt?.toISOString() || null,
    };
  }

  async refreshGitHubAccessTokenIfNeeded(
    integration: Integration,
  ): Promise<Integration> {
    if (integration.type !== IntegrationType.Github) {
      return integration;
    }

    const decryptedConfig = (await this.configEncryptionService.decryptConfig(
      integration.config as object,
      IntegrationType.Github,
      integration.organizationId as OrganizationId,
    )) as Record<string, unknown>;

    const tokenExpiresAt =
      typeof decryptedConfig.tokenExpiresAt === 'string'
        ? decryptedConfig.tokenExpiresAt
        : undefined;
    if (!tokenExpiresAt) {
      return integration;
    }

    const expiresAtMs = Date.parse(tokenExpiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return integration;
    }

    const refreshToken =
      typeof decryptedConfig.refreshToken === 'string'
        ? decryptedConfig.refreshToken
        : undefined;
    if (!refreshToken) {
      throw new BadRequestException('GitHub refresh token is required');
    }

    const refreshBufferMs = 60 * 1000;
    if (Date.now() + refreshBufferMs < expiresAtMs) {
      return integration;
    }

    try {
      const refreshed =
        await this.githubOAuthService.refreshAccessToken(refreshToken);

      const updatedConfig = {
        ...decryptedConfig,
        token: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
        tokenExpiresAt:
          this.buildExpiryDate(refreshed.expiresIn) ??
          decryptedConfig.tokenExpiresAt,
        refreshTokenExpiresAt:
          this.buildExpiryDate(refreshed.refreshTokenExpiresIn) ??
          decryptedConfig.refreshTokenExpiresAt,
        scope: refreshed.scope ?? decryptedConfig.scope,
        tokenType: refreshed.tokenType ?? decryptedConfig.tokenType,
      };

      const encryptedConfig = await this.configEncryptionService.encryptConfig(
        updatedConfig,
        IntegrationType.Github,
        integration.organizationId as OrganizationId,
      );

      const updatedIntegration = await this.prisma.integration.update({
        where: { id: integration.id },
        data: {
          config: encryptedConfig as Prisma.InputJsonValue,
          connectionStatus: IntegrationConnectionStatus.Connected,
          lastConnectionCheck: new Date(),
          errorMessage: null,
        },
        include: {
          project: true,
          organization: true,
        },
      });

      return updatedIntegration;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'GitHub token refresh failed';
      await this.updateConnectionStatus(
        integration.id as IntegrationId,
        IntegrationConnectionStatus.Error,
        message,
      );
      throw error;
    }
  }

  /**
   * Find all active integrations across all organizations (for webhook routing)
   */
  async findAllActiveIntegrations(): Promise<IntegrationResponseDto[]> {
    const integrations = await this.prisma.integration.findMany({
      where: {
        state: IntegrationState.Active,
        deletedAt: null,
      },
      include: {
        project: true,
        organization: true,
      },
    });

    return integrations.map((integration) => this.mapToDto(integration));
  }

  /**
   * Register webhook for a GitHub integration
   * This method handles webhook registration gracefully - if it fails, it logs a warning
   * but doesn't fail the integration creation process
   */
  private async registerWebhookForIntegration(
    integration: Integration,
  ): Promise<void> {
    try {
      await this.githubWebhookService.registerWebhook(integration);
      // Webhook registration handled gracefully by the service
    } catch (error) {
      // Don't throw error - webhook registration is optional for integration creation
    }
  }

  private async refreshWebhookRegistration(
    integration: Integration,
  ): Promise<void> {
    const webhooks = await this.githubWebhookService.listWebhooks(integration);
    if (webhooks.length === 0) {
      await this.githubWebhookService.registerWebhook(integration);
      return;
    }
    await Promise.all(
      webhooks.map((webhook) =>
        this.githubWebhookService.updateWebhook(integration, webhook.id),
      ),
    );
  }

  private ensureGitHubWebhookSecret(config: object): object {
    const values = config as Record<string, unknown>;
    if (
      typeof values.webhookSecret === 'string' &&
      values.webhookSecret.length > 0
    ) {
      return config;
    }
    return {
      ...values,
      webhookSecret: randomBytes(32).toString('hex'),
    };
  }

  /**
   * Clean up webhook when integration is deleted
   */
  private async cleanupWebhookForIntegration(
    integration: Integration,
  ): Promise<void> {
    try {
      await this.githubWebhookService.cleanupAllWebhooks(integration);
      // Webhook cleanup handled gracefully by the service
    } catch (error) {
      // Don't throw the error - webhook cleanup should not prevent integration deletion
    }
  }

  private buildExpiryDate(expiresIn?: number): string | undefined {
    if (!expiresIn || expiresIn <= 0) {
      return undefined;
    }
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }
}
