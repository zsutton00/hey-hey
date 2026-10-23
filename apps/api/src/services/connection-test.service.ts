import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationResponseDto,
  IntegrationType,
  IntegrationConnectionStatus,
  GitHubIntegrationConfig,
  JiraIntegrationConfig,
} from '../generated';

export interface ConnectionTestResult {
  connectionStatus: IntegrationConnectionStatus;
  message: string;
  testedAt: string;
  details?: object;
}

@Injectable()
export class ConnectionTestService {
  private readonly logger = new Logger(ConnectionTestService.name);

  async testConnection(
    integration: IntegrationResponseDto,
  ): Promise<ConnectionTestResult> {
    this.logger.log(
      `Testing connection for integration ${integration.id} of type ${integration.type}`,
    );

    const testedAt = new Date().toISOString();

    try {
      // Route to the appropriate test based on integration type
      switch (integration.type) {
        case IntegrationType.Github:
          return await this.testGitHubConnection(integration, testedAt);
        case IntegrationType.Slack:
          return await this.testSlackConnection(integration, testedAt);
        case IntegrationType.Teams:
          return await this.testTeamsConnection(integration, testedAt);
        case IntegrationType.Jira:
          return await this.testJiraConnection(integration, testedAt);
        case IntegrationType.Confluence:
          return await this.testConfluenceConnection(integration, testedAt);
        case IntegrationType.Linear:
          return await this.testLinearConnection(integration, testedAt);
        case IntegrationType.Notion:
          return await this.testNotionConnection(integration, testedAt);
        case IntegrationType.Figma:
          return await this.testFigmaConnection(integration, testedAt);
        case IntegrationType.Asana:
          return await this.testAsanaConnection(integration, testedAt);
        case IntegrationType.Trello:
          return await this.testTrelloConnection(integration, testedAt);
        case IntegrationType.Discord:
          return await this.testDiscordConnection(integration, testedAt);
        case IntegrationType.Webhook:
          return await this.testWebhookConnection(integration, testedAt);
        default:
          throw new Error(`Unsupported integration type: ${integration.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Connection test failed for integration ${integration.id}`,
        error,
      );
      return {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: `Connection test failed: ${(error as Error).message}`,
        testedAt,
        details: { error: (error as Error).message },
      };
    }
  }

  private async testGitHubConnection(
    integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    const config = integration.config as GitHubIntegrationConfig;

    if (!config?.token) {
      return {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: 'GitHub token is required',
        testedAt,
      };
    }

    try {
      // Test GitHub API connection with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `token ${config.token}`,
            'User-Agent': 'HeyHey-Integration-Test',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const user = await response.json();
          return {
            connectionStatus: IntegrationConnectionStatus.Connected,
            message: `Successfully connected to GitHub as ${user.login}`,
            testedAt,
            details: { username: user.login, userId: user.id },
          };
        } else {
          return {
            connectionStatus: IntegrationConnectionStatus.Error,
            message: `GitHub API returned ${response.status}: ${response.statusText}`,
            testedAt,
          };
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error) {
      // Handle timeout errors specifically
      if ((error as Error).name === 'AbortError') {
        return {
          connectionStatus: IntegrationConnectionStatus.Error,
          message:
            'Connection timeout: GitHub API did not respond within 10 seconds',
          testedAt,
        };
      }
      return {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: `Failed to connect to GitHub: ${(error as Error).message}`,
        testedAt,
      };
    }
  }

  private async testSlackConnection(
    integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    const config = integration.config as { botToken: string };

    if (!config.botToken) {
      return {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: 'Slack bot token is required',
        testedAt,
      };
    }

    try {
      // Test Slack API connection with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.botToken}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const result = await response.json();

        if (result.ok) {
          return {
            connectionStatus: IntegrationConnectionStatus.Connected,
            message: `Successfully connected to Slack workspace ${result.team}`,
            testedAt,
            details: { team: result.team, user: result.user },
          };
        } else {
          return {
            connectionStatus: IntegrationConnectionStatus.Error,
            message: `Slack API error: ${result.error}`,
            testedAt,
          };
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error) {
      // Handle timeout errors specifically
      if ((error as Error).name === 'AbortError') {
        return {
          connectionStatus: IntegrationConnectionStatus.Error,
          message:
            'Connection timeout: Slack API did not respond within 10 seconds',
          testedAt,
        };
      }
      return {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: `Failed to connect to Slack: ${(error as Error).message}`,
        testedAt,
      };
    }
  }

  private async testTeamsConnection(
    _integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    // Placeholder for Teams connection test
    return {
      connectionStatus: IntegrationConnectionStatus.Pending,
      message: 'Teams connection testing not yet implemented',
      testedAt,
    };
  }

  private async testJiraConnection(
    integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    const config = integration.config as JiraIntegrationConfig;

    if (!config.instanceUrl || !config.apiToken || !config.email) {
      return {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: 'Jira instance URL, API token, and email are required',
        testedAt,
      };
    }

    try {
      // Validate URL format before making request
      let instanceUrl = config.instanceUrl.trim();
      if (!instanceUrl.startsWith('https://')) {
        if (instanceUrl.startsWith('http://')) {
          return {
            connectionStatus: IntegrationConnectionStatus.Error,
            message: 'Jira instance URL must use HTTPS, not HTTP',
            testedAt,
          };
        }
        instanceUrl = `https://${instanceUrl}`;
      }

      // Remove trailing slash
      if (instanceUrl.endsWith('/')) {
        instanceUrl = instanceUrl.slice(0, -1);
      }

      // Test Jira API connection using Basic Auth (email + API token)
      const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
        'base64',
      );

      // Proper timeout handling with AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch(`${instanceUrl}/rest/api/3/myself`, {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
            'User-Agent': 'HeyHey-Integration-Test',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const user = await response.json();
          return {
            connectionStatus: IntegrationConnectionStatus.Connected,
            message: `Successfully connected to Jira as ${user.displayName}`,
            testedAt,
            details: {
              displayName: user.displayName,
              emailAddress: user.emailAddress,
              instanceUrl: instanceUrl,
            },
          };
        } else {
          return {
            connectionStatus: IntegrationConnectionStatus.Error,
            message: `Jira API returned ${response.status}: ${response.statusText}`,
            testedAt,
          };
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error) {
      // Handle timeout errors specifically
      if ((error as Error).name === 'AbortError') {
        return {
          connectionStatus: IntegrationConnectionStatus.Error,
          message:
            'Connection timeout: Jira API did not respond within 10 seconds',
          testedAt,
        };
      }

      // Sanitize error message to prevent sensitive data leakage
      const sanitizedMessage = (error as Error).message
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, '[REDACTED]')
        .replace(/Basic\s+[A-Za-z0-9+/]+=*/gi, '[REDACTED]');

      return {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: `Failed to connect to Jira: ${sanitizedMessage}`,
        testedAt,
      };
    }
  }

  private async testConfluenceConnection(
    _integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    // Placeholder for Confluence connection test
    return {
      connectionStatus: IntegrationConnectionStatus.Pending,
      message: 'Confluence connection testing not yet implemented',
      testedAt,
    };
  }

  private async testLinearConnection(
    _integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    // Placeholder for Linear connection test
    return {
      connectionStatus: IntegrationConnectionStatus.Pending,
      message: 'Linear connection testing not yet implemented',
      testedAt,
    };
  }

  private async testNotionConnection(
    _integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    // Placeholder for Notion connection test
    return {
      connectionStatus: IntegrationConnectionStatus.Pending,
      message: 'Notion connection testing not yet implemented',
      testedAt,
    };
  }

  private async testFigmaConnection(
    _integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    // Placeholder for Figma connection test
    return {
      connectionStatus: IntegrationConnectionStatus.Pending,
      message: 'Figma connection testing not yet implemented',
      testedAt,
    };
  }

  private async testAsanaConnection(
    _integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    // Placeholder for Asana connection test
    return {
      connectionStatus: IntegrationConnectionStatus.Pending,
      message: 'Asana connection testing not yet implemented',
      testedAt,
    };
  }

  private async testTrelloConnection(
    _integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    // Placeholder for Trello connection test
    return {
      connectionStatus: IntegrationConnectionStatus.Pending,
      message: 'Trello connection testing not yet implemented',
      testedAt,
    };
  }

  private async testDiscordConnection(
    _integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    // Placeholder for Discord connection test
    return {
      connectionStatus: IntegrationConnectionStatus.Pending,
      message: 'Discord connection testing not yet implemented',
      testedAt,
    };
  }

  private async testWebhookConnection(
    integration: IntegrationResponseDto,
    testedAt: string,
  ): Promise<ConnectionTestResult> {
    const config = integration.config as { url?: string };

    if (!config.url) {
      return {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: 'Webhook URL is required',
        testedAt,
      };
    }

    try {
      // Test webhook endpoint with a ping and timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch(config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'HeyHey-Integration-Test',
          },
          body: JSON.stringify({
            type: 'ping',
            timestamp: testedAt,
            source: 'heyhey-integration-test',
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return {
            connectionStatus: IntegrationConnectionStatus.Connected,
            message: `Successfully connected to webhook endpoint`,
            testedAt,
            details: {
              status: response.status,
              statusText: response.statusText,
            },
          };
        } else {
          return {
            connectionStatus: IntegrationConnectionStatus.Error,
            message: `Webhook returned ${response.status}: ${response.statusText}`,
            testedAt,
          };
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error) {
      // Handle timeout errors specifically
      if ((error as Error).name === 'AbortError') {
        return {
          connectionStatus: IntegrationConnectionStatus.Error,
          message:
            'Connection timeout: Webhook endpoint did not respond within 10 seconds',
          testedAt,
        };
      }

      // Sanitize error message to prevent sensitive data leakage
      const sanitizedMessage = (error as Error).message
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, '[REDACTED]')
        .replace(/Basic\s+[A-Za-z0-9+/]+=*/gi, '[REDACTED]');

      return {
        connectionStatus: IntegrationConnectionStatus.Error,
        message: `Failed to connect to webhook: ${sanitizedMessage}`,
        testedAt,
      };
    }
  }
}
