import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GitHubIntegrationHandler } from '../handlers/github.integration.handler';
import { JiraIntegrationHandler } from '../handlers/jira.integration.handler';
import { BaseIntegrationHandler } from '../handlers/base-integration.handler';
import { IntegrationType, IntegrationConnectionStatus } from '../../generated';
import { QUEUE_SERVICE_TOKEN } from '../../core/queue/queue.module';
import { IntegrationService } from '../../services/integrations/integration.service';
import {
  IQueueService,
  QueueJob,
} from '../../core/queue/interfaces/queue.interface';
import { JOB_CHANNELS, JOB_TYPES } from '../../core/events/types/event.types';
import { Integration, Prisma } from '@prisma/client';

export interface SyncJobData {
  integrationId: string;
  integrationType?: IntegrationType;
}

@Injectable()
export class SyncIntegrationProcessor {
  private readonly logger = new Logger(SyncIntegrationProcessor.name);
  private readonly handlers = new Map<string, BaseIntegrationHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubHandler: GitHubIntegrationHandler,
    private readonly jiraHandler: JiraIntegrationHandler,
    private readonly integrationService: IntegrationService,
    @Inject(QUEUE_SERVICE_TOKEN) private readonly queueService: IQueueService,
  ) {
    // Register handlers
    this.handlers.set(IntegrationType.Github, this.githubHandler);
    this.handlers.set(IntegrationType.Jira, this.jiraHandler);

    // Register queue processors
    this.registerProcessors();
  }

  private registerProcessors(): void {
    this.queueService.addProcessor(
      JOB_CHANNELS.INTEGRATION,
      JOB_TYPES.INTEGRATION.SYNC,
      this.processSync.bind(this),
    );

    this.queueService.addProcessor(
      JOB_CHANNELS.INTEGRATION,
      JOB_TYPES.INTEGRATION.TEST_CONNECTION,
      this.processConnectionTest.bind(this),
    );
  }

  async processSync(job: QueueJob<SyncJobData>): Promise<void> {
    const { integrationId, integrationType } = job.data;

    // If integration type is not provided, fetch it from database
    const finalIntegrationType =
      integrationType || (await this.getIntegrationType(integrationId));

    return this.handleSync(job, finalIntegrationType);
  }

  async processConnectionTest(
    job: QueueJob<{ integrationId: string; config: object }>,
  ): Promise<void> {
    const { integrationId, config } = job.data;

    this.logger.log(
      `Processing connection test for integration ${integrationId}`,
    );

    try {
      let integration = await this.getIntegration(integrationId);
      if (integration.type === IntegrationType.Github) {
        integration =
          await this.integrationService.refreshGitHubAccessTokenIfNeeded(
            integration,
          );
      }
      const handler = this.getHandler(integration.type as IntegrationType);

      const result = await handler.testConnection(
        config,
        integration.organizationId,
      );

      const status = result.connected
        ? IntegrationConnectionStatus.Connected
        : IntegrationConnectionStatus.Error;

      await this.updateConnectionStatus(integrationId, status, result.error);

      this.logger.log(
        `Connection test completed for integration ${integrationId}: ${result.connected ? 'success' : 'failed'}`,
      );
    } catch (error) {
      const sanitizedError = this.sanitizeErrorMessage(
        (error as Error).message,
      );
      this.logger.error(
        `Connection test failed for integration ${integrationId}:`,
        { message: sanitizedError, stack: (error as Error).stack },
      );
      await this.updateConnectionStatus(
        integrationId,
        IntegrationConnectionStatus.Error,
        sanitizedError,
      );

      // Create sanitized error for re-throwing
      const sanitizedErrorObj = new Error(sanitizedError);
      sanitizedErrorObj.name = (error as Error).name;
      throw sanitizedErrorObj;
    }
  }

  private async getIntegrationType(
    integrationId: string,
  ): Promise<IntegrationType> {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
      select: { type: true },
    });

    if (!integration) {
      throw new Error(`Integration ${integrationId} not found`);
    }

    return integration.type as IntegrationType;
  }

  private async handleSync(
    job: QueueJob<SyncJobData>,
    integrationType: IntegrationType,
  ): Promise<void> {
    const { integrationId } = job.data;

    this.logger.log(
      `Processing ${integrationType} sync job for integration ${integrationId}`,
    );

    try {
      // Get integration from database
      const integration = await this.getIntegration(integrationId);

      // Update connection status to indicate sync is starting
      await this.updateConnectionStatus(
        integrationId,
        IntegrationConnectionStatus.Pending,
      );

      // Get the appropriate handler
      const handler = this.getHandler(integrationType);

      // Perform the sync
      await handler.sync(integration);

      // Update connection status to success
      await this.updateConnectionStatus(
        integrationId,
        IntegrationConnectionStatus.Connected,
      );

      this.logger.log(
        `Successfully completed ${integrationType} sync for integration ${integrationId}`,
      );
    } catch (error) {
      const sanitizedError = this.sanitizeErrorMessage(
        (error as Error).message,
      );
      this.logger.error(
        `Failed to sync ${integrationType} integration ${integrationId}:`,
        { message: sanitizedError, stack: (error as Error).stack },
      );

      // Update connection status to error
      await this.updateConnectionStatus(
        integrationId,
        IntegrationConnectionStatus.Error,
        sanitizedError,
      );

      // Re-throw sanitized error to mark job as failed
      const sanitizedErrorObj = new Error(sanitizedError);
      sanitizedErrorObj.name = (error as Error).name;
      throw sanitizedErrorObj;
    }
  }

  private async getIntegration(integrationId: string): Promise<Integration> {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
      include: {
        project: true,
        organization: true,
      },
    });

    if (!integration) {
      throw new Error(`Integration ${integrationId} not found`);
    }

    if (integration.deletedAt) {
      throw new Error(`Integration ${integrationId} has been deleted`);
    }

    return {
      id: integration.id,
      organizationId: integration.organizationId,
      projectId: integration.projectId,
      type: integration.type,
      name: integration.name,
      config: integration.config as object,
      lastSuccessfulSync: integration.lastSuccessfulSync || null,
      connectionStatus: integration.connectionStatus,
      description: integration.description,
      state: integration.state,
      targetType: integration.targetType,
      lastConnectionCheck: integration.lastConnectionCheck,
      errorMessage: integration.errorMessage,
      createdBy: integration.createdBy,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
      deletedAt: integration.deletedAt,
    };
  }

  private getHandler(integrationType: IntegrationType): BaseIntegrationHandler {
    const handler = this.handlers.get(integrationType);

    if (!handler) {
      throw new Error(
        `No handler registered for integration type: ${integrationType}`,
      );
    }

    return handler;
  }

  private async updateConnectionStatus(
    integrationId: string,
    status: IntegrationConnectionStatus,
    errorMessage?: string,
  ): Promise<void> {
    const updateData: Prisma.IntegrationUpdateInput = {
      connectionStatus: status,
      lastConnectionCheck: new Date(),
    };

    if (status === IntegrationConnectionStatus.Connected) {
      updateData.errorMessage = null;
    } else if (status === IntegrationConnectionStatus.Error && errorMessage) {
      updateData.errorMessage = errorMessage;
    }

    await this.prisma.integration.update({
      where: { id: integrationId },
      data: updateData,
    });
  }

  /**
   * Add a new integration handler
   */
  registerHandler(
    integrationType: string,
    handler: BaseIntegrationHandler,
  ): void {
    this.handlers.set(integrationType, handler);
    this.logger.log(
      `Registered handler for integration type: ${integrationType}`,
    );
  }

  /**
   * Get all registered integration types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Sanitize error messages to prevent sensitive data leakage
   */
  private sanitizeErrorMessage(errorMessage: string): string {
    if (!errorMessage || typeof errorMessage !== 'string') {
      return 'An unknown error occurred';
    }

    // Remove sensitive patterns that might contain tokens, keys, or credentials
    let sanitized = errorMessage
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
      .replace(/Basic\s+[A-Za-z0-9+/]+=*/gi, 'Basic [REDACTED]')
      .replace(/token["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi, 'token=[REDACTED]')
      .replace(/password["\s:=]+[^\s"',}]+/gi, 'password=[REDACTED]')
      .replace(/key["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi, 'key=[REDACTED]')
      .replace(/secret["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi, 'secret=[REDACTED]')
      .replace(/apikey["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi, 'apikey=[REDACTED]')
      .replace(
        /client_secret["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi,
        'client_secret=[REDACTED]',
      )
      .replace(
        /access_token["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi,
        'access_token=[REDACTED]',
      )
      .replace(
        /refresh_token["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi,
        'refresh_token=[REDACTED]',
      )
      .replace(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        '[EMAIL_REDACTED]',
      )
      .replace(/https?:\/\/[^\s"']+/g, (url) => {
        try {
          const parsed = new URL(url);
          return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
        } catch {
          return '[URL_REDACTED]';
        }
      });

    // Limit length to prevent log flooding
    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 500) + '... [TRUNCATED]';
    }

    // Remove excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();

    return sanitized || 'An error occurred (details redacted for security)';
  }
}
