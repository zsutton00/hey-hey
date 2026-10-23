import { Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { SuggestedUser } from '../../services/user-suggestion.service';

export interface Integration2 {
  id: string;
  organizationId: string;
  projectId: string;
  type: string;
  name: string;
  config: object;
  lastSuccessfulSync?: Date;
  connectionStatus: string;
}

export interface ConnectionTestResult {
  connected: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

@Injectable()
export abstract class BaseIntegrationHandler<
  WebhookInput = unknown,
  WebhookResult = unknown,
> {
  /**
   * Sync data from the external service
   */
  abstract sync(integration: Integration): Promise<void>;

  /**
   * Test the connection to the external service
   */
  abstract testConnection(
    config: object,
    organizationId: string,
  ): Promise<ConnectionTestResult>;

  /**
   * Handle incoming webhook from the external service
   */
  abstract handleWebhook(
    payload: WebhookInput,
    integration: Integration,
  ): Promise<WebhookResult>;

  /**
   * Get the integration type this handler supports
   */
  abstract getIntegrationType(): string;

  /**
   * Validate the configuration for this integration type
   */
  abstract validateConfig(config: object): Promise<boolean>;

  /**
   * Get required configuration fields for this integration
   */
  abstract getRequiredConfigFields(): string[];

  /**
   * Get suggested users from the external service
   */
  abstract getSuggestedUsers(
    integration: Integration,
    projectId?: string,
  ): Promise<SuggestedUser[]>;

  /**
   * Parse repository URL to extract owner and repo name
   */
  protected parseRepositoryUrl(url: string): { owner: string; repo: string } {
    // Handle various GitHub URL formats:
    // https://github.com/owner/repo
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    // owner/repo

    let cleanUrl = url.trim();

    // Remove .git suffix
    if (cleanUrl.endsWith('.git')) {
      cleanUrl = cleanUrl.slice(0, -4);
    }

    // Handle SSH format
    if (cleanUrl.startsWith('git@github.com:')) {
      cleanUrl = cleanUrl.replace('git@github.com:', '');
    }

    // Handle HTTPS format
    if (cleanUrl.startsWith('https://github.com/')) {
      cleanUrl = cleanUrl.replace('https://github.com/', '');
    }

    // Handle HTTP format
    if (cleanUrl.startsWith('http://github.com/')) {
      cleanUrl = cleanUrl.replace('http://github.com/', '');
    }

    const parts = cleanUrl.split('/');
    if (parts.length !== 2) {
      throw new Error(
        `Invalid repository URL format: ${url}. Expected format: owner/repo`,
      );
    }

    const owner = parts[0];
    const repo = parts[1];
    if (!owner || !repo) {
      throw new Error(
        `Invalid repository URL format: ${url}. Expected format: owner/repo`,
      );
    }

    return {
      owner,
      repo,
    };
  }

  /**
   * Create a standardized error message for external API failures
   */
  protected createAPIError(
    service: string,
    operation: string,
    error: unknown,
  ): Error {
    const errorMessage = error instanceof Error ? error.message : error;
    const message = `${service} API error during ${operation}: ${errorMessage}`;
    return new Error(message);
  }
}
