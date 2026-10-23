import { Injectable, Logger } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { PrismaService } from '../../prisma/prisma.service';
import { Integration } from '@prisma/client';
import { OrganizationId } from '../../types';
import { GitHubConfig } from '../../integration/types/github.types';
import { IntegrationType } from '../../generated';
import { ConfigEncryptionService } from '../config-encryption.service';

export interface WebhookInfo {
  id: string;
  externalWebhookId: string | null;
  url: string;
  events: string[];
  active: boolean;
  webhookType: string;
  lastTriggered?: Date | null;
  errorCount: number;
}

export interface WebhookRegistrationResult {
  webhookId: string; // Our database ID
  externalWebhookId: string | number;
  webhookUrl: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class GitHubWebhookService {
  private readonly logger = new Logger(GitHubWebhookService.name);

  // Default events to subscribe to
  private readonly DEFAULT_WEBHOOK_EVENTS = [
    'pull_request',
    'issues',
    'issue_comment',
    'pull_request_review_comment',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: ConfigEncryptionService,
  ) {}

  /**
   * Register a webhook for a GitHub integration
   */
  async registerWebhook(
    integration: Integration,
  ): Promise<WebhookRegistrationResult> {
    this.logger.log(`Registering webhook for integration ${integration.id}`);

    try {
      const decryptedConfig = await this.getDecryptedConfig(integration);
      const octokit = this.createOctokit(decryptedConfig.token);

      const webhookUrl = this.buildWebhookUrl(integration.id);
      const webhookConfig = this.buildWebhookConfig(
        webhookUrl,
        decryptedConfig,
      );

      // Determine if this is a repository or organization webhook
      if (decryptedConfig.repositoryUrl) {
        const parsedRepo = this.parseRepositoryUrl(
          decryptedConfig.repositoryUrl,
        );
        const webhook = await this.registerRepositoryWebhook(
          octokit,
          parsedRepo.owner,
          parsedRepo.repo,
          webhookConfig,
        );

        // Save webhook to database
        const webhookRecord = await this.prisma.integrationWebhook.create({
          data: {
            integrationId: integration.id,
            webhookType: 'github_repository',
            externalWebhookId: webhook.id.toString(),
            webhookUrl,
            events: webhookConfig.events,
          },
        });

        return {
          webhookId: webhookRecord.id,
          externalWebhookId: webhook.id,
          webhookUrl,
          success: true,
        };
      } else if (decryptedConfig.organization) {
        const webhook = await this.registerOrganizationWebhook(
          octokit,
          decryptedConfig.organization,
          webhookConfig,
        );

        // Save webhook to database
        const webhookRecord = await this.prisma.integrationWebhook.create({
          data: {
            integrationId: integration.id,
            webhookType: 'github_organization',
            externalWebhookId: webhook.id.toString(),
            webhookUrl,
            events: webhookConfig.events,
          },
        });

        return {
          webhookId: webhookRecord.id,
          externalWebhookId: webhook.id,
          webhookUrl,
          success: true,
        };
      } else {
        throw new Error(
          'Integration must specify either repositoryUrl or organizationName for webhook registration',
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to register webhook for integration ${integration.id}:`,
        error,
      );

      return {
        webhookId: '',
        externalWebhookId: '',
        webhookUrl: '',
        success: false,
        error: this.extractErrorMessage(error),
      };
    }
  }

  /**
   * Update an existing webhook
   */
  async updateWebhook(
    integration: Integration,
    webhookId: string,
  ): Promise<void> {
    this.logger.log(
      `Updating webhook ${webhookId} for integration ${integration.id}`,
    );

    try {
      // Get webhook record from database
      const webhookRecord = await this.prisma.integrationWebhook.findFirst({
        where: {
          id: webhookId,
          integrationId: integration.id,
        },
      });

      if (!webhookRecord || !webhookRecord.externalWebhookId) {
        throw new Error(`Webhook ${webhookId} not found`);
      }

      const decryptedConfig = await this.getDecryptedConfig(integration);
      const octokit = this.createOctokit(decryptedConfig.token);

      const webhookUrl = this.buildWebhookUrl(integration.id);
      const webhookConfig = this.buildWebhookConfig(
        webhookUrl,
        decryptedConfig,
      );

      if (webhookRecord.webhookType === 'github_repository') {
        const repositoryUrl = decryptedConfig.repositoryUrl;
        if (!repositoryUrl) {
          throw new Error(
            'Integration is missing repositoryUrl required for webhook update',
          );
        }
        const parsedRepo = this.parseRepositoryUrl(repositoryUrl);
        await octokit.rest.repos.updateWebhook({
          owner: parsedRepo.owner,
          repo: parsedRepo.repo,
          hook_id: parseInt(webhookRecord.externalWebhookId),
          config: webhookConfig.config,
          events: webhookConfig.events,
          active: webhookConfig.active,
        });
      } else if (webhookRecord.webhookType === 'github_organization') {
        const organization = decryptedConfig.organization;
        if (!organization) {
          throw new Error(
            'Integration is missing organization required for webhook update',
          );
        }
        await octokit.rest.orgs.updateWebhook({
          org: organization,
          hook_id: parseInt(webhookRecord.externalWebhookId),
          config: webhookConfig.config,
          events: webhookConfig.events,
          active: webhookConfig.active,
        });
      }

      // Update webhook record in database
      await this.prisma.integrationWebhook.update({
        where: { id: webhookId },
        data: {
          webhookUrl,
          events: webhookConfig.events,
          updatedAt: new Date(),
        },
      });

      this.logger.log(`Successfully updated webhook ${webhookId}`);
    } catch (error) {
      this.logger.error(`Failed to update webhook ${webhookId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(
    integration: Integration,
    webhookId: string,
  ): Promise<void> {
    this.logger.log(
      `Deleting webhook ${webhookId} for integration ${integration.id}`,
    );

    try {
      // Get webhook record from database
      const webhookRecord = await this.prisma.integrationWebhook.findFirst({
        where: {
          id: webhookId,
          integrationId: integration.id,
        },
      });

      if (webhookRecord?.externalWebhookId) {
        const decryptedConfig = await this.getDecryptedConfig(integration);
        const octokit = this.createOctokit(decryptedConfig.token);

        if (
          webhookRecord.webhookType === 'github_repository' &&
          decryptedConfig.repositoryUrl
        ) {
          const parsedRepo = this.parseRepositoryUrl(
            decryptedConfig.repositoryUrl,
          );
          await octokit.rest.repos.deleteWebhook({
            owner: parsedRepo.owner,
            repo: parsedRepo.repo,
            hook_id: parseInt(webhookRecord.externalWebhookId),
          });
        } else if (
          webhookRecord.webhookType === 'github_organization' &&
          decryptedConfig.organization
        ) {
          await octokit.rest.orgs.deleteWebhook({
            org: decryptedConfig.organization,
            hook_id: parseInt(webhookRecord.externalWebhookId),
          });
        }
      }

      // Delete webhook record from database
      if (webhookRecord) {
        await this.prisma.integrationWebhook.delete({
          where: { id: webhookId },
        });
      }

      this.logger.log(`Successfully deleted webhook ${webhookId}`);
    } catch (error) {
      // Log warning but don't throw - webhook might already be deleted
      this.logger.warn(
        `Failed to delete webhook ${webhookId} (may already be deleted):`,
        error,
      );
    }
  }

  /**
   * List all webhooks for an integration
   */
  async listWebhooks(integration: Integration): Promise<WebhookInfo[]> {
    this.logger.log(`Listing webhooks for integration ${integration.id}`);

    try {
      const webhookRecords = await this.prisma.integrationWebhook.findMany({
        where: {
          integrationId: integration.id,
          isActive: true,
        },
      });

      return webhookRecords.map((record) => ({
        id: record.id,
        externalWebhookId: record.externalWebhookId,
        url: record.webhookUrl,
        events: record.events,
        active: record.isActive,
        webhookType: record.webhookType,
        lastTriggered: record.lastTriggered,
        errorCount: record.errorCount,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to list webhooks for integration ${integration.id}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Validate webhook configuration and permissions
   */
  async validateWebhookAccess(
    integration: Integration,
  ): Promise<{ hasAccess: boolean; error?: string }> {
    try {
      const decryptedConfig = await this.getDecryptedConfig(integration);
      const octokit = this.createOctokit(decryptedConfig.token);

      if (decryptedConfig.repositoryUrl) {
        const parsedRepo = this.parseRepositoryUrl(
          decryptedConfig.repositoryUrl,
        );

        // Check if user has admin access to repository
        const { data: repo } = await octokit.rest.repos.get({
          owner: parsedRepo.owner,
          repo: parsedRepo.repo,
        });

        return {
          hasAccess: repo.permissions?.admin === true,
          error: repo.permissions?.admin
            ? undefined
            : 'Admin access required to manage webhooks',
        };
      } else if (decryptedConfig.organization) {
        // Check organization permissions
        const { data: membership } =
          await octokit.rest.orgs.getMembershipForAuthenticatedUser({
            org: decryptedConfig.organization,
          });

        const hasAccess =
          membership.role === 'admin' || membership.state === 'active';
        return {
          hasAccess,
          error: hasAccess
            ? undefined
            : 'Organization admin access required to manage webhooks',
        };
      }

      return {
        hasAccess: false,
        error: 'No repository or organization specified',
      };
    } catch (error) {
      return {
        hasAccess: false,
        error: `Failed to validate webhook access: ${this.extractErrorMessage(error)}`,
      };
    }
  }

  /**
   * Clean up all webhooks for an integration
   */
  async cleanupAllWebhooks(integration: Integration): Promise<void> {
    this.logger.log(
      `Cleaning up all webhooks for integration ${integration.id}`,
    );

    try {
      const webhookRecords = await this.prisma.integrationWebhook.findMany({
        where: {
          integrationId: integration.id,
        },
      });

      for (const webhookRecord of webhookRecords) {
        await this.deleteWebhook(integration, webhookRecord.id);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to cleanup webhooks for integration ${integration.id}:`,
        error,
      );
    }
  }

  private async getDecryptedConfig(
    integration: Integration,
  ): Promise<GitHubConfig> {
    if (!integration.config || integration.config === null) {
      throw new Error('Integration config is required');
    }

    const decrypted = (await this.encryption.decryptConfig(
      integration.config as object,
      IntegrationType.Github,
      integration.organizationId as OrganizationId,
    )) as GitHubConfig & { organizationName?: string };

    return decrypted as GitHubConfig;
  }

  private createOctokit(token: string): Octokit {
    return new Octokit({
      auth: token,
      userAgent: 'hey-hey-api',
    });
  }

  private buildWebhookUrl(integrationId: string): string {
    const baseUrl = process.env.WEBHOOK_BASE_URL || process.env.API_BASE_URL;
    if (!baseUrl) {
      throw new Error(
        'WEBHOOK_BASE_URL or API_BASE_URL environment variable is required',
      );
    }
    return `${baseUrl}/webhooks/github/${integrationId}`;
  }

  private buildWebhookConfig(webhookUrl: string, config: GitHubConfig) {
    const secret = config.webhookSecret;
    if (!secret) {
      throw new Error('GitHub webhook secret is required to register webhooks');
    }

    return {
      name: 'web',
      active: true,
      events: config.webhookEvents || this.DEFAULT_WEBHOOK_EVENTS,
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret,
        insecure_ssl: process.env.NODE_ENV === 'development' ? '1' : '0',
      },
    };
  }

  private async registerRepositoryWebhook(
    octokit: Octokit,
    owner: string,
    repo: string,
    webhookConfig: {
      name: string;
      active: boolean;
      events: string[];
      config: {
        url: string;
        content_type: string;
        secret: string;
        insecure_ssl: string;
      };
    },
  ) {
    try {
      // Check if a webhook with this URL already exists
      const { data: existingWebhooks } = await octokit.rest.repos.listWebhooks({
        owner,
        repo,
      });

      const existingWebhook = existingWebhooks.find(
        (webhook) => webhook.config?.url === webhookConfig.config.url,
      );

      if (existingWebhook) {
        this.logger.log(
          `Webhook already exists for ${owner}/${repo} with ID ${existingWebhook.id}, updating configuration`,
        );

        // Update existing webhook instead of creating a new one
        const { data: updatedWebhook } = await octokit.rest.repos.updateWebhook(
          {
            owner,
            repo,
            hook_id: existingWebhook.id,
            ...webhookConfig,
          },
        );

        return updatedWebhook;
      }

      // Create new webhook if none exists
      const { data: webhook } = await octokit.rest.repos.createWebhook({
        owner,
        repo,
        ...webhookConfig,
      });

      this.logger.log(
        `Successfully registered repository webhook ${webhook.id} for ${owner}/${repo}`,
      );
      return webhook;
    } catch (error) {
      // If it's still a "webhook already exists" error after our check,
      // it might be a race condition - try to find and return the existing one
      if (
        (error as { status: number }).status === 422 &&
        ((error as { message?: string })?.message ?? '').includes(
          'Hook already exists',
        )
      ) {
        this.logger.log(
          `Race condition detected - webhook was created by another process for ${owner}/${repo}`,
        );

        const { data: existingWebhooks } =
          await octokit.rest.repos.listWebhooks({
            owner,
            repo,
          });

        const existingWebhook = existingWebhooks.find(
          (webhook) => webhook.config?.url === webhookConfig.config.url,
        );

        if (existingWebhook) {
          return existingWebhook;
        }
      }

      throw error;
    }
  }

  private async registerOrganizationWebhook(
    octokit: Octokit,
    org: string,
    webhookConfig: {
      name: string;
      active: boolean;
      events: string[];
      config: {
        url: string;
        content_type: string;
        secret: string;
        insecure_ssl: string;
      };
    },
  ) {
    const { data: webhook } = await octokit.rest.orgs.createWebhook({
      org,
      ...webhookConfig,
    });

    this.logger.log(
      `Successfully registered organization webhook ${webhook.id} for ${org}`,
    );
    return webhook;
  }

  private parseRepositoryUrl(repositoryUrl: string): {
    owner: string;
    repo: string;
  } {
    // Handle both SSH and HTTPS URLs
    const match = repositoryUrl.match(
      /github\.com[/:]([\w-]+)\/([\w-]+)(?:\.git)?$/,
    );
    if (!match) {
      throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
    }

    const owner = match[1];
    const repo = match[2];
    if (!owner || !repo) {
      throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
    }

    return {
      owner,
      repo,
    };
  }

  private extractErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
      const maybeError = error as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      if (maybeError.response?.data?.message) {
        return maybeError.response.data.message;
      }
      if (maybeError.message) {
        return maybeError.message;
      }
    }
    return 'Unknown error occurred';
  }
}
