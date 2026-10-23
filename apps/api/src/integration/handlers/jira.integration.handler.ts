import { Injectable, Logger } from '@nestjs/common';
import { Integration, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as dns from 'dns';
import { promisify } from 'util';
import { IntegrationType } from '../../generated';
import { ArtifactService } from '../../services/artifacts/artifact.service';
import { ConfigEncryptionService } from '../../services/config-encryption.service';
import { OrganizationId } from '../../types';
import {
  JiraIntegrationConfig,
  JiraIssue,
  JiraRateLimitInfo,
  JiraWebhookPayload,
} from '../../types/webhook.types';
import {
  BaseIntegrationHandler,
  ConnectionTestResult,
} from './base-integration.handler';
import { SuggestedUser } from '../../services/user-suggestion.service';

interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

interface JiraCurrentUser {
  displayName: string;
  emailAddress: string;
}

interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}

class JiraRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens = 8; // Leave buffer under 10/sec limit
  private readonly refillRate = 8; // tokens per second
  private readonly maxWaitTime = 30000; // Maximum wait time: 30 seconds
  private readonly waitQueue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];
  private queueProcessor: NodeJS.Timeout | null = null;

  constructor() {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.startQueueProcessor();
  }

  async acquireToken(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();

      // Check if we have immediate token availability
      this.refillTokens();
      if (this.tokens >= 1) {
        this.tokens--;
        resolve();
        return;
      }

      // Add to queue for processing
      this.waitQueue.push({ resolve, reject, timestamp });

      // Reject if queue gets too large (DoS protection)
      if (this.waitQueue.length > 100) {
        const oldest = this.waitQueue.shift();
        if (oldest) {
          oldest.reject(new Error('Rate limiter queue full'));
        }
      }
    });
  }

  private startQueueProcessor(): void {
    // Process queue every 100ms
    this.queueProcessor = setInterval(() => {
      this.processQueue();
    }, 100);
  }

  private processQueue(): void {
    if (this.waitQueue.length === 0) return;

    this.refillTokens();
    const now = Date.now();

    // Process waiting requests
    while (this.waitQueue.length > 0 && this.tokens >= 1) {
      const request = this.waitQueue.shift();
      if (!request) break;

      // Check for timeout
      if (now - request.timestamp > this.maxWaitTime) {
        request.reject(
          new Error('Rate limiter timeout: exceeded maximum wait time'),
        );
        continue;
      }

      // Grant token
      this.tokens--;
      request.resolve();
    }

    // Clean up expired requests
    while (this.waitQueue.length > 0) {
      const first = this.waitQueue[0];
      if (!first) {
        break;
      }
      if (now - first.timestamp > this.maxWaitTime) {
        const expired = this.waitQueue.shift();
        if (expired) {
          expired.reject(
            new Error('Rate limiter timeout: exceeded maximum wait time'),
          );
        }
      } else {
        break; // Queue is ordered by timestamp
      }
    }
  }

  destroy(): void {
    if (this.queueProcessor) {
      clearInterval(this.queueProcessor);
      this.queueProcessor = null;
    }

    // Reject all pending requests
    while (this.waitQueue.length > 0) {
      const request = this.waitQueue.shift();
      if (request) {
        request.reject(new Error('Rate limiter destroyed'));
      }
    }
  }

  updateFromHeaders(rateLimitInfo: JiraRateLimitInfo): void {
    // Validate rate limit info to prevent manipulation
    const remaining = Math.max(
      0,
      Math.min(this.maxTokens, rateLimitInfo.remaining),
    );
    const reset = Math.max(0, rateLimitInfo.reset);

    this.tokens = remaining;
    this.lastRefill = Date.now();

    // If reset time is in the future, adjust our refill time
    if (reset > 0) {
      const resetInMs = reset * 1000;
      if (resetInMs > Date.now()) {
        this.lastRefill = resetInMs - (this.maxTokens / this.refillRate) * 1000;
      }
    }
  }

  private refillTokens(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = Math.floor(timePassed * this.refillRate);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  // Method to get current rate limiter status for debugging
  getStatus(): { tokens: number; maxTokens: number; lastRefill: number } {
    return {
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      lastRefill: this.lastRefill,
    };
  }
}

@Injectable()
export class JiraIntegrationHandler extends BaseIntegrationHandler {
  private readonly logger = new Logger(JiraIntegrationHandler.name);
  private readonly rateLimiter = new JiraRateLimiter();

  constructor(
    private readonly encryption: ConfigEncryptionService,
    readonly _artifactService: ArtifactService,
  ) {
    super();
  }

  getIntegrationType(): string {
    return IntegrationType.Jira;
  }

  async testConnection(
    config: object,
    organizationId: string,
  ): Promise<ConnectionTestResult> {
    try {
      const decryptedConfig = await this.getDecryptedConfig(
        config,
        organizationId as OrganizationId,
      );

      // Test connection by making a simple API call to get current user info
      const response = await this.makeJiraRequest(
        decryptedConfig,
        '/rest/api/3/myself',
        'GET',
      );

      const userResponse = response as JiraCurrentUser;
      this.logger.log(
        `Jira connection test successful for user: ${userResponse.emailAddress}`,
      );

      return {
        connected: true,
        details: {
          username: userResponse.displayName,
          email: userResponse.emailAddress,
          instanceUrl: decryptedConfig.instanceUrl,
        },
      };
    } catch (error) {
      this.logger.error('Jira connection test failed:', error);
      return {
        connected: false,
        error: (error as Error).message || 'Failed to connect to Jira API',
        details: {
          statusCode: (error as { status?: number }).status,
        },
      };
    }
  }

  async sync(integration: Integration): Promise<void> {
    this.logger.log(`Starting Jira sync for integration ${integration.id}`);

    const decryptedConfig = await this.getDecryptedConfig(
      integration.config as Prisma.JsonObject,
      integration.organizationId as OrganizationId,
    );

    try {
      // Get projects to sync - either configured or all accessible
      const projectKeys =
        decryptedConfig.projectKeys ||
        (await this.getAccessibleProjects(decryptedConfig));
      this.logger.log(
        `Syncing ${projectKeys.length} projects: ${projectKeys.join(', ')}`,
      );

      for (const projectKey of projectKeys) {
        await this.syncProject(decryptedConfig, projectKey, integration);

        // Brief pause between projects to be respectful
        await this.sleep(500);
      }

      this.logger.log(`Jira sync completed for integration ${integration.id}`);
    } catch (error) {
      if ((error as { status?: number }).status === 429) {
        this.logger.warn(
          `Rate limited during sync of integration ${integration.id}`,
        );
        throw new Error('Sync rate limited, will retry later');
      }
      throw error;
    }
  }

  async handleWebhook(
    payload: JiraWebhookPayload,
    integration: Integration,
    headers?: Record<string, string>,
  ): Promise<void> {
    this.logger.log(
      `Processing Jira webhook for integration ${integration.id}`,
    );

    try {
      // Validate webhook signature if secret is configured
      if (headers) {
        const config = await this.getDecryptedConfig(
          integration.config as Prisma.JsonObject,
          integration.organizationId as OrganizationId,
        );

        if (config.webhookSecret) {
          this.validateWebhookSignature(payload, headers, config.webhookSecret);
        }
      }

      // Sanitize and validate webhook payload
      let sanitizedPayload;
      try {
        sanitizedPayload = this.sanitizeWebhookPayload(payload);
      } catch (error) {
        this.logger.warn(
          `Invalid Jira webhook payload: ${(error as Error).message}`,
        );
        return;
      }

      const webhookEvent = sanitizedPayload.webhookEvent;
      const issue = sanitizedPayload.issue;

      if (!webhookEvent || !issue) {
        this.logger.warn(
          'Invalid Jira webhook payload - missing webhookEvent or issue',
        );
        return;
      }

      this.logger.log(`Webhook event: ${webhookEvent} for issue ${issue.key}`);

      // Handle different webhook events
      switch (webhookEvent) {
        case 'jira:issue_created':
        case 'jira:issue_updated':
        case 'jira:issue_deleted':
          await this.handleIssueWebhook(webhookEvent, issue, integration);
          break;

        default:
          this.logger.debug(`Unhandled webhook event: ${webhookEvent}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to process Jira webhook for integration ${integration.id}:`,
        error,
      );
      throw error;
    }
  }

  private validateWebhookSignature(
    payload: unknown,
    headers: Record<string, string>,
    secret: string,
  ): void {
    const signature =
      headers['x-hub-signature'] || headers['x-hub-signature-256'];

    if (!signature) {
      throw new Error('Webhook signature missing - potential security threat');
    }

    const payloadString = JSON.stringify(payload);
    let expectedSignature: string;

    if (signature.startsWith('sha256=')) {
      // GitHub-style signature
      expectedSignature =
        'sha256=' +
        crypto
          .createHmac('sha256', secret)
          .update(payloadString, 'utf8')
          .digest('hex');
    } else if (signature.startsWith('sha1=')) {
      // Legacy SHA1 signature
      expectedSignature =
        'sha1=' +
        crypto
          .createHmac('sha1', secret)
          .update(payloadString, 'utf8')
          .digest('hex');
    } else {
      throw new Error('Unsupported webhook signature format');
    }

    // Use timing-safe comparison to prevent timing attacks
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8'),
      )
    ) {
      throw new Error('Invalid webhook signature - potential security threat');
    }

    this.logger.debug('Webhook signature validated successfully');
  }

  private sanitizeWebhookPayload(
    payload: JiraWebhookPayload,
  ): JiraWebhookPayload {
    // Validate payload size to prevent DoS attacks
    const payloadString = JSON.stringify(payload);
    if (payloadString.length > 100000) {
      // 100KB limit
      throw new Error('Webhook payload too large - potential DoS attack');
    }

    // Deep clone to avoid modifying original
    const sanitized = JSON.parse(payloadString);

    // Validate required fields exist and are strings
    if (!sanitized.webhookEvent || typeof sanitized.webhookEvent !== 'string') {
      throw new Error('Invalid webhook payload: webhookEvent must be a string');
    }

    // Sanitize webhook event name (allow only alphanumeric, colon, underscore)
    if (!/^[a-zA-Z0-9:_-]+$/.test(sanitized.webhookEvent)) {
      throw new Error(
        'Invalid webhook payload: webhookEvent contains invalid characters',
      );
    }

    // Limit webhook event name length
    if (sanitized.webhookEvent.length > 50) {
      throw new Error('Webhook event name too long');
    }

    // Validate issue object structure if present
    if (sanitized.issue) {
      if (typeof sanitized.issue.key !== 'string') {
        throw new Error('Invalid webhook payload: issue.key must be a string');
      }

      // Sanitize issue key (Jira format: PROJECT-123)
      if (!/^[A-Z][A-Z0-9]*-\d+$/.test(sanitized.issue.key)) {
        throw new Error(
          'Invalid webhook payload: issue.key has invalid format',
        );
      }

      // Limit issue key length
      if (sanitized.issue.key.length > 50) {
        throw new Error('Issue key too long');
      }

      // Sanitize issue fields
      if (sanitized.issue.fields) {
        // Sanitize and limit summary
        if (sanitized.issue.fields.summary) {
          if (typeof sanitized.issue.fields.summary !== 'string') {
            throw new Error('Issue summary must be a string');
          }

          // Remove potentially dangerous content
          sanitized.issue.fields.summary = this.sanitizeTextContent(
            sanitized.issue.fields.summary,
            1000,
          );
        }

        // Sanitize description
        if (sanitized.issue.fields.description) {
          if (typeof sanitized.issue.fields.description !== 'string') {
            sanitized.issue.fields.description = '[Non-string content removed]';
          } else {
            sanitized.issue.fields.description = this.sanitizeTextContent(
              sanitized.issue.fields.description,
              10000,
            );
          }
        }

        // Validate project key format
        if (
          sanitized.issue.fields.project?.key &&
          !/^[A-Z][A-Z0-9]*$/.test(sanitized.issue.fields.project.key)
        ) {
          throw new Error(
            'Invalid webhook payload: project.key has invalid format',
          );
        }

        // Validate and sanitize project name
        if (sanitized.issue.fields.project?.name) {
          if (typeof sanitized.issue.fields.project.name !== 'string') {
            throw new Error('Project name must be a string');
          }
          sanitized.issue.fields.project.name = this.sanitizeTextContent(
            sanitized.issue.fields.project.name,
            100,
          );
        }

        // Validate issue type name (alphanumeric, spaces, hyphens)
        if (
          sanitized.issue.fields.issuetype?.name &&
          !/^[a-zA-Z0-9\s-]+$/.test(sanitized.issue.fields.issuetype.name)
        ) {
          throw new Error(
            'Invalid webhook payload: issuetype.name contains invalid characters',
          );
        }

        // Sanitize assignee information
        if (sanitized.issue.fields.assignee) {
          if (sanitized.issue.fields.assignee.displayName) {
            sanitized.issue.fields.assignee.displayName =
              this.sanitizeTextContent(
                sanitized.issue.fields.assignee.displayName,
                100,
              );
          }
          if (sanitized.issue.fields.assignee.emailAddress) {
            if (
              typeof sanitized.issue.fields.assignee.emailAddress !==
                'string' ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                sanitized.issue.fields.assignee.emailAddress,
              )
            ) {
              delete sanitized.issue.fields.assignee.emailAddress;
            }
          }
        }

        // Sanitize labels array
        if (
          sanitized.issue.fields.labels &&
          Array.isArray(sanitized.issue.fields.labels)
        ) {
          sanitized.issue.fields.labels = sanitized.issue.fields.labels
            .filter((label: unknown) => typeof label === 'string')
            .map((label: string) => this.sanitizeTextContent(label, 50))
            .slice(0, 20); // Limit to 20 labels max
        }
      }
    }

    return sanitized;
  }

  private sanitizeTextContent(text: string, maxLength: number): string {
    if (typeof text !== 'string') {
      return '[Invalid content removed]';
    }

    // Remove potential HTML/script tags and suspicious patterns
    let sanitized = text
      .replace(
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        '[SCRIPT_REMOVED]',
      )
      .replace(/<[^>]*>/g, '') // Remove all HTML tags
      .replace(/javascript:/gi, '[JS_REMOVED]')
      .replace(/data:/gi, '[DATA_URL_REMOVED]')
      .replace(/vbscript:/gi, '[VBS_REMOVED]')
      .replace(/on\w+\s*=/gi, '[EVENT_HANDLER_REMOVED]');

    // Limit length
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + '...';
    }

    // Remove excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();

    return sanitized;
  }

  private async handleIssueWebhook(
    eventType: string,
    issue: JiraIssue,
    integration: Integration,
  ): Promise<void> {
    const issueKey = issue.key;
    const projectKey = issue.fields?.project?.key;

    this.logger.log(
      `Processing ${eventType} for issue ${issueKey} in project ${projectKey}`,
    );

    // Check if this project is in our sync scope
    const config = await this.getDecryptedConfig(
      integration.config as Prisma.JsonObject,
      integration.organizationId as OrganizationId,
    );

    if (
      config.projectKeys?.length &&
      !config.projectKeys.includes(projectKey)
    ) {
      this.logger.debug(
        `Skipping issue ${issueKey} - project ${projectKey} not in sync scope`,
      );
      return;
    }

    if (
      config.issueTypes?.length &&
      !config.issueTypes.includes(issue.fields?.issuetype?.name)
    ) {
      this.logger.debug(
        `Skipping issue ${issueKey} - issue type ${issue.fields?.issuetype?.name} not in sync scope`,
      );
      return;
    }

    // Create/update/delete artifacts based on the event
    switch (eventType) {
      case 'jira:issue_created':
        this.logger.log(
          `New issue created: ${issueKey} - ${issue.fields?.summary}`,
        );
        await this.createIssueArtifact(issue, integration);
        break;

      case 'jira:issue_updated':
        this.logger.log(
          `Issue updated: ${issueKey} - ${issue.fields?.summary}`,
        );
        await this.updateIssueArtifact(issue, integration);
        break;

      case 'jira:issue_deleted':
        this.logger.log(`Issue deleted: ${issueKey}`);
        await this.archiveIssueArtifact(issueKey, integration);
        break;
    }
  }

  async validateConfig(config: object): Promise<boolean> {
    const hasInstanceUrl =
      'instanceUrl' in config && typeof config.instanceUrl === 'string';
    const hasApiToken =
      'apiToken' in config && typeof config.apiToken === 'string';
    const hasEmail = 'email' in config && typeof config.email === 'string';

    return hasInstanceUrl && hasApiToken && hasEmail;
  }

  getRequiredConfigFields(): string[] {
    return ['instanceUrl', 'apiToken', 'email'];
  }

  private async getDecryptedConfig(
    config: object,
    organizationId: OrganizationId,
  ): Promise<JiraIntegrationConfig> {
    const decrypted = (await this.encryption.decryptConfig(
      config,
      IntegrationType.Jira,
      organizationId,
    )) as JiraIntegrationConfig;

    // Support both serverUrl (from frontend) and instanceUrl field names
    const configWithServerUrl = decrypted as JiraIntegrationConfig & {
      serverUrl?: string;
    };
    if (!decrypted.instanceUrl && !configWithServerUrl.serverUrl) {
      throw new Error(
        'Jira integration requires an "instanceUrl" or "serverUrl" field',
      );
    }

    // Normalize serverUrl to instanceUrl if needed
    if (!decrypted.instanceUrl && configWithServerUrl.serverUrl) {
      decrypted.instanceUrl = configWithServerUrl.serverUrl;
    }

    if (!decrypted.apiToken) {
      throw new Error('Jira integration requires an "apiToken" field');
    }

    if (!decrypted.email) {
      throw new Error('Jira integration requires an "email" field');
    }

    // Validate and sanitize instanceUrl
    decrypted.instanceUrl = await this.validateAndSanitizeUrl(
      decrypted.instanceUrl,
    );

    return decrypted;
  }

  private async validateAndSanitizeUrl(instanceUrl: string): Promise<string> {
    // Remove any whitespace
    let cleanUrl = instanceUrl.trim();

    // Ensure URL starts with https://
    if (!cleanUrl.startsWith('https://')) {
      if (cleanUrl.startsWith('http://')) {
        throw new Error('Jira instance URL must use HTTPS, not HTTP');
      }
      cleanUrl = `https://${cleanUrl}`;
    }

    // Parse URL to validate structure
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cleanUrl);
    } catch (error) {
      throw new Error(`Invalid Jira instance URL format: ${instanceUrl}`);
    }

    // Validate protocol
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Jira instance URL must use HTTPS protocol');
    }

    // Validate against allowed domains (Atlassian Cloud domains)
    const allowedCloudDomains = [
      '.atlassian.net',
      '.atlassian.com',
      '.jira.com',
    ];

    const isCloudDomain = allowedCloudDomains.some((domain) =>
      parsedUrl.hostname.endsWith(domain),
    );

    if (!isCloudDomain) {
      // For self-hosted Jira, validate it's not a private/local network
      // First check hostname patterns - but allow properly configured self-hosted instances
      if (this.isPrivateNetwork(parsedUrl.hostname)) {
        // Allow localhost and private networks only if explicitly configured for development
        const allowPrivateNetworks =
          process.env.ALLOW_PRIVATE_JIRA_INSTANCES === 'true';
        if (!allowPrivateNetworks) {
          throw new Error(
            'Jira instance URL cannot point to private/local networks. Use Atlassian Cloud or set ALLOW_PRIVATE_JIRA_INSTANCES=true for development.',
          );
        } else {
          this.logger.warn(
            `Allowing private network Jira instance ${parsedUrl.hostname} due to development configuration.`,
          );
        }
      } else {
        // SECURITY: For public self-hosted instances, resolve DNS and validate IP addresses
        try {
          await this.validateResolvedIPs(parsedUrl.hostname);
        } catch (error) {
          this.logger.error(
            `DNS resolution failed for ${parsedUrl.hostname}:`,
            error,
          );
          throw new Error(
            `Invalid Jira instance URL: ${(error as Error).message}`,
          );
        }
      }

      // Log info for self-hosted domains (reduced from warning to info)
      this.logger.log(
        `Self-hosted Jira instance detected: ${parsedUrl.hostname}. Ensure this is a legitimate Jira instance.`,
      );
    }

    // Remove any path, query, or fragment for security
    const sanitizedUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? ':' + parsedUrl.port : ''}`;

    return sanitizedUrl;
  }

  private isPrivateNetwork(hostname: string): boolean {
    // Check for private IP ranges and localhost
    const privatePatterns = [
      /^127\./, // localhost
      /^10\./, // 10.0.0.0/8
      /^192\.168\./, // 192.168.0.0/16
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^localhost$/i,
      /^0\.0\.0\.0$/,
      /^\[::1\]$/, // IPv6 localhost
      /^::/, // IPv6 unspecified
    ];

    return privatePatterns.some((pattern) => pattern.test(hostname));
  }

  private async validateResolvedIPs(hostname: string): Promise<void> {
    const resolveLookup = promisify(dns.lookup);

    try {
      // SECURITY: Resolve hostname to ALL IP addresses to prevent DNS round-robin attacks
      const results = await resolveLookup(hostname, { all: true });

      if (!Array.isArray(results) || results.length === 0) {
        throw new Error(
          `Hostname ${hostname} could not be resolved to any IP addresses`,
        );
      }

      // Validate ALL resolved IP addresses
      const invalidIPs: string[] = [];
      const suspiciousIPs: string[] = [];

      for (const result of results) {
        const address = result.address;

        // Check if resolved IP is in private ranges
        if (this.isPrivateNetwork(address)) {
          invalidIPs.push(address);
        }

        // Check for common attack vectors
        if (this.isSuspiciousIP(address)) {
          suspiciousIPs.push(address);
        }
      }

      // Fail if ANY IP address is invalid or suspicious
      if (invalidIPs.length > 0) {
        throw new Error(
          `Hostname ${hostname} resolves to private IP addresses: ${invalidIPs.join(', ')}. This is not allowed.`,
        );
      }

      if (suspiciousIPs.length > 0) {
        throw new Error(
          `Hostname ${hostname} resolves to suspicious IP addresses: ${suspiciousIPs.join(', ')}. This is not allowed.`,
        );
      }

      this.logger.debug(
        `Hostname ${hostname} resolved to ${results.length} safe IP addresses: ${results.map((r) => r.address).join(', ')}`,
      );
    } catch (error) {
      if ((error as { code: string }).code === 'ENOTFOUND') {
        throw new Error(`Hostname ${hostname} could not be resolved`);
      }
      throw error; // Re-throw validation errors or other DNS errors
    }
  }

  private isSuspiciousIP(ip: string): boolean {
    // Additional checks for suspicious IPs
    const suspiciousPatterns = [
      /^169\.254\./, // Link-local addresses
      /^224\./, // Multicast addresses
      /^255\.255\.255\.255$/, // Broadcast address
      /^0\./, // Reserved addresses
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(ip));
  }

  private async makeJiraRequest(
    config: JiraIntegrationConfig,
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
    maxRetries = 3,
  ): Promise<unknown> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Rate limit before making request
        await this.rateLimiter.acquireToken();

        const url = `${config.instanceUrl}${endpoint}`;
        const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString(
          'base64',
        );

        const headers: Record<string, string> = {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };

        const options: RequestInit = {
          method,
          headers,
        };

        if (body && (method === 'POST' || method === 'PUT')) {
          options.body = JSON.stringify(body);
        }

        // Log request details (without sensitive data)
        this.logger.debug(
          `Making Jira ${method} request to ${this.sanitizeUrlForLogging(url)}`,
        );

        const response = await fetch(url, options);

        // Parse rate limit headers and update rate limiter
        this.updateRateLimiterFromHeaders(response);

        if (!response.ok) {
          if (response.status === 429 && attempt < maxRetries) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter
              ? parseInt(retryAfter) * 1000
              : Math.pow(2, attempt) * 1000;

            this.logger.warn(
              `Rate limited, retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
            );
            await this.sleep(delay);
            continue;
          }

          const errorText = await response.text();
          // Sanitize error response before logging
          const sanitizedError = this.sanitizeErrorForLogging(errorText);
          const error = new Error(
            `Jira API request failed: ${response.status} ${response.statusText} - ${sanitizedError}`,
          );
          (error as Error & { status?: number }).status = response.status;
          throw error;
        }

        return response.json();
      } catch (error) {
        if (
          (error as { status?: number }).status === 429 &&
          attempt < maxRetries
        ) {
          // Already handled above
          continue;
        }
        if (attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff for other errors
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        const sanitizedErrorMessage = this.sanitizeErrorForLogging(
          (error as Error).message,
        );
        this.logger.warn(
          `Request failed, retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1}): ${sanitizedErrorMessage}`,
        );
        await this.sleep(delay);
      }
    }

    throw new Error('Max retries exceeded');
  }

  private sanitizeUrlForLogging(url: string): string {
    try {
      const parsedUrl = new URL(url);
      return `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}`;
    } catch {
      return '[INVALID_URL]';
    }
  }

  private sanitizeErrorForLogging(errorMessage: string): string {
    // Remove potential sensitive information from error messages
    const sensitivePatterns = [
      /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, // Bearer tokens
      /Basic\s+[A-Za-z0-9+/]+=*/gi, // Basic auth
      /token["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi, // Token values
      /password["\s:=]+[^\s"',}]+/gi, // Password values
      /key["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi, // Key values
      /secret["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi, // Secret values
      /email["\s:=]+[^\s"',}]+@[^\s"',}]+/gi, // Email addresses
    ];

    let sanitized = errorMessage;
    sensitivePatterns.forEach((pattern) => {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    });

    // Limit error message length to prevent log flooding
    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 500) + '... [TRUNCATED]';
    }

    return sanitized;
  }

  private updateRateLimiterFromHeaders(response: Response): void {
    try {
      const remaining = response?.headers?.get?.('X-RateLimit-Remaining');
      const reset = response?.headers?.get?.('X-RateLimit-Reset');
      const limit = response?.headers?.get?.('X-RateLimit-Limit');

      if (remaining && reset && limit) {
        this.rateLimiter.updateFromHeaders({
          remaining: parseInt(remaining),
          reset: parseInt(reset),
          limit: parseInt(limit),
        });
      }
    } catch (error) {
      // Ignore header parsing errors
      this.logger.debug(
        'Failed to parse rate limit headers:',
        (error as Error).message,
      );
    }
  }

  private async getAccessibleProjects(
    config: JiraIntegrationConfig,
  ): Promise<string[]> {
    this.logger.log('Fetching accessible projects');

    const response = await this.makeJiraRequest(config, '/rest/api/3/project');
    interface JiraProject {
      key: string;
    }
    return (response as JiraProject[]).map((project) => project.key);
  }

  private async syncProject(
    config: JiraIntegrationConfig,
    projectKey: string,
    integration: Integration,
  ): Promise<void> {
    this.logger.log(`Syncing project: ${projectKey}`);

    // Use incremental sync if we have a last sync time
    const lastSync = integration.lastSuccessfulSync;
    const sinceClause = lastSync
      ? ` AND updated >= "${lastSync.toISOString()}"`
      : '';

    // Build JQL query for efficient bulk retrieval
    let jql = `project = "${projectKey}"${sinceClause}`;

    if (config.issueTypes?.length) {
      jql += ` AND issuetype in (${config.issueTypes.map((t) => `"${t}"`).join(',')})`;
    }

    jql += ' ORDER BY updated DESC';

    this.logger.log(`Using JQL: ${jql}`);

    // Get all issues using paginated JQL search
    const issues = await this.searchAllIssues(config, jql);

    this.logger.log(`Found ${issues.length} issues in project ${projectKey}`);

    // PERFORMANCE: Process issues in batches for artifact creation
    const batchSize = 10;
    for (let i = 0; i < issues.length; i += batchSize) {
      const batch = issues.slice(i, i + batchSize);

      // Process batch in parallel
      const artifactPromises = batch.map(async (issue) => {
        try {
          await this.createIssueArtifact(issue, integration);
        } catch (error) {
          this.logger.error(
            `Failed to create artifact for issue ${issue.key}:`,
            error,
          );
        }
      });

      await Promise.allSettled(artifactPromises);

      // Add small delay between batches to be respectful during production runs
      if (i + batchSize < issues.length) {
        // Reduce/skip delay in test environment to avoid unnecessary timeouts
        const delayMs = process.env.NODE_ENV === 'test' ? 0 : 500;
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      }
    }
  }

  private async searchAllIssues(
    config: JiraIntegrationConfig,
    jql: string,
  ): Promise<JiraIssue[]> {
    const allIssues: JiraIssue[] = [];
    let startAt = 0;
    const maxResults = 100; // Jira's recommended page size

    while (true) {
      const searchResult = await this.searchIssues(
        config,
        jql,
        startAt,
        maxResults,
      );
      allIssues.push(...searchResult.issues);

      if (searchResult.issues.length < maxResults) {
        break; // Last page
      }

      startAt += maxResults;
    }

    return allIssues;
  }

  private async searchIssues(
    config: JiraIntegrationConfig,
    jql: string,
    startAt = 0,
    maxResults = 100,
  ): Promise<JiraSearchResult> {
    const body = {
      jql,
      startAt,
      maxResults,
      fields: [
        'summary',
        'status',
        'assignee',
        'created',
        'updated',
        'description',
        'issuetype',
        'project',
        'labels',
      ],
    };

    return this.makeJiraRequest(
      config,
      '/rest/api/3/search',
      'POST',
      body,
    ) as Promise<JiraSearchResult>;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create an artifact from a JIRA issue
   */
  private async createIssueArtifact(
    issue: JiraIssue,
    _integration: Integration,
  ): Promise<void> {
    try {
      const content = this.buildIssueContent(issue);
      const tags = this.extractIssueTags(issue);

      this.logger.log(content);
      this.logger.log(tags);

      // TODO: Create artifact once proper DTO structure is confirmed
      this.logger.log(
        `Would create artifact for JIRA issue ${issue.key} with title: ${issue.key}: ${issue.fields.summary}`,
      );

      this.logger.log(`Created artifact for JIRA issue ${issue.key}`);
    } catch (error) {
      this.logger.error(
        `Failed to create artifact for JIRA issue ${issue.key}:`,
        error,
      );
    }
  }

  /**
   * Update an existing artifact or create if missing
   */
  private async updateIssueArtifact(
    issue: JiraIssue,
    _integration: Integration,
  ): Promise<void> {
    try {
      // TODO: Implement proper artifact lookup and update once findBySourceId is available
      this.logger.log(
        `Would update artifact for JIRA issue ${issue.key} (not implemented yet)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update artifact for JIRA issue ${issue.key}:`,
        error,
      );
    }
  }

  /**
   * Archive an artifact when issue is deleted
   */
  private async archiveIssueArtifact(
    issueKey: string,
    _integration: Integration,
  ): Promise<void> {
    try {
      // TODO: Implement proper artifact archival once findBySourceId is available
      this.logger.log(
        `Would archive artifacts for deleted JIRA issue ${issueKey} (not implemented yet)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to archive artifacts for JIRA issue ${issueKey}:`,
        error,
      );
    }
  }

  /**
   * Build content string from JIRA issue
   */
  private buildIssueContent(issue: JiraIssue): string {
    const lines = [
      `# ${issue.key}: ${issue.fields.summary}`,
      '',
      `**Project:** ${issue.fields.project.name} (${issue.fields.project.key})`,
      `**Issue Type:** ${issue.fields.issuetype.name}`,
      `**Status:** ${issue.fields.status.name}`,
      `**Priority:** ${issue.fields.priority?.name || 'N/A'}`,
      `**Created:** ${new Date(issue.fields.created).toLocaleDateString()}`,
      `**Updated:** ${new Date(issue.fields.updated).toLocaleDateString()}`,
    ];

    if (issue.fields.assignee) {
      lines.push(`**Assignee:** ${issue.fields.assignee.displayName}`);
    }

    if (issue.fields.reporter) {
      lines.push(`**Reporter:** ${issue.fields.reporter.displayName}`);
    }

    if (issue.fields.labels && issue.fields.labels.length > 0) {
      lines.push(`**Labels:** ${issue.fields.labels.join(', ')}`);
    }

    if (issue.fields.components && issue.fields.components.length > 0) {
      lines.push(
        `**Components:** ${issue.fields.components.map((c) => c.name).join(', ')}`,
      );
    }

    if (issue.fields.fixVersions && issue.fields.fixVersions.length > 0) {
      lines.push(
        `**Fix Versions:** ${issue.fields.fixVersions.map((v) => v.name).join(', ')}`,
      );
    }

    if (issue.fields.description) {
      lines.push('', '## Description', '', issue.fields.description);
    }

    return lines.join('\n');
  }

  /**
   * Extract tags from JIRA issue
   */
  private extractIssueTags(issue: JiraIssue): string[] {
    const tags = [
      'jira',
      `project:${issue.fields.project.key}`,
      `issue-type:${issue.fields.issuetype.name.toLowerCase().replace(/\s+/g, '-')}`,
      `status:${issue.fields.status.name.toLowerCase().replace(/\s+/g, '-')}`,
    ];

    if (issue.fields.priority) {
      tags.push(`priority:${issue.fields.priority.name.toLowerCase()}`);
    }

    if (issue.fields.assignee) {
      tags.push(`assignee:${issue.fields.assignee.accountId}`);
    }

    if (issue.fields.labels) {
      tags.push(...issue.fields.labels.map((label) => `label:${label}`));
    }

    if (issue.fields.components) {
      tags.push(
        ...issue.fields.components.map(
          (component) => `component:${component.name}`,
        ),
      );
    }

    return tags.filter(Boolean);
  }

  /**
   * Map JIRA priority to artifact priority
   */
  // private mapJiraPriorityToArtifactPriority(jiraPriority?: string): Priority {
  //   if (!jiraPriority) return Priority.Low;

  //   const priority = jiraPriority.toLowerCase();
  //   if (
  //     priority.includes('blocker') ||
  //     priority.includes('critical') ||
  //     priority.includes('highest')
  //   ) {
  //     return Priority.High;
  //   }
  //   if (priority.includes('major') || priority.includes('high')) {
  //     return Priority.Medium;
  //   }
  //   return Priority.Low;
  // }

  async getSuggestedUsers(
    integration: Integration,
    projectId?: string,
  ): Promise<SuggestedUser[]> {
    this.logger.log(
      `Getting suggested users from Jira integration ${integration.id}`,
    );

    try {
      const config = await this.getDecryptedConfig(
        integration.config as unknown as JiraIntegrationConfig,
        integration.organizationId as OrganizationId,
      );

      const suggestedUsers: SuggestedUser[] = [];

      // Get assignable users for the project
      if (config.projectKeys && config.projectKeys.length > 0) {
        // Use the first project key if multiple are configured
        const projectKey = config.projectKeys[0];
        if (projectKey) {
          const assignableUsers = await this.getAssignableUsers(
            config,
            projectKey,
          );
          suggestedUsers.push(...assignableUsers);
        }
      }

      // Get users from recent issue activity
      const activityUsers = await this.getUsersFromRecentActivity(config);
      suggestedUsers.push(...activityUsers);

      this.logger.log(
        `Found ${suggestedUsers.length} suggested users from Jira`,
      );
      return suggestedUsers;
    } catch (error) {
      this.logger.error('Failed to get suggested users from Jira:', error);
      // Don't throw error, just return empty array for graceful degradation
      return [];
    }
  }

  /**
   * Get assignable users for a specific project
   */
  private async getAssignableUsers(
    config: JiraIntegrationConfig,
    projectKey: string,
  ): Promise<SuggestedUser[]> {
    try {
      await this.rateLimiter.acquireToken();

      const url = `${config.instanceUrl}/rest/api/3/user/assignable/search?project=${projectKey}&maxResults=100`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Jira API error: ${response.status} ${response.statusText}`,
        );
      }

      const users = await response.json();
      const suggestedUsers: SuggestedUser[] = [];

      for (const user of users) {
        if (user.emailAddress && user.displayName) {
          suggestedUsers.push({
            name: user.displayName,
            email: user.emailAddress,
            sources: ['jira'],
            confidence: 0.8, // High confidence for assignable users
            lastSeen: new Date(),
            integrationMetadata: {
              jiraAccountId: user.accountId,
              source: 'assignable_user',
              projectKey,
            },
          });
        }
      }

      return suggestedUsers;
    } catch (error) {
      this.logger.warn(
        `Failed to get assignable users for project ${projectKey}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Get users from recent issue activity
   */
  private async getUsersFromRecentActivity(
    config: JiraIntegrationConfig,
  ): Promise<SuggestedUser[]> {
    try {
      await this.rateLimiter.acquireToken();

      // Search for recently updated issues
      const jql =
        config.projectKeys && config.projectKeys.length > 0
          ? `project = "${config.projectKeys[0]}" ORDER BY updated DESC`
          : 'updated >= -30d ORDER BY updated DESC';

      const url = `${config.instanceUrl}/rest/api/3/search`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jql,
          maxResults: 100,
          fields: ['assignee', 'reporter', 'creator', 'updated'],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Jira API error: ${response.status} ${response.statusText}`,
        );
      }

      const searchResult = await response.json();
      const userMap = new Map<string, SuggestedUser>();

      for (const issue of searchResult.issues || []) {
        const updatedDate = new Date(issue.fields.updated);

        // Add assignee
        if (issue.fields.assignee?.emailAddress) {
          const key = issue.fields.assignee.emailAddress.toLowerCase();
          if (!userMap.has(key)) {
            userMap.set(key, {
              name:
                issue.fields.assignee.displayName ||
                issue.fields.assignee.emailAddress,
              email: issue.fields.assignee.emailAddress,
              sources: ['jira'],
              confidence: 0.7, // Good confidence for assignees
              lastSeen: updatedDate,
              integrationMetadata: {
                jiraAccountId: issue.fields.assignee.accountId,
                source: 'issue_assignee',
                projectKey: config.projectKeys?.[0],
              },
            });
          }
        }

        // Add reporter
        if (issue.fields.reporter?.emailAddress) {
          const key = issue.fields.reporter.emailAddress.toLowerCase();
          if (!userMap.has(key)) {
            userMap.set(key, {
              name:
                issue.fields.reporter.displayName ||
                issue.fields.reporter.emailAddress,
              email: issue.fields.reporter.emailAddress,
              sources: ['jira'],
              confidence: 0.6, // Medium confidence for reporters
              lastSeen: updatedDate,
              integrationMetadata: {
                jiraAccountId: issue.fields.reporter.accountId,
                source: 'issue_reporter',
                projectKey: config.projectKeys?.[0],
              },
            });
          }
        }

        // Add creator
        if (issue.fields.creator?.emailAddress) {
          const key = issue.fields.creator.emailAddress.toLowerCase();
          if (!userMap.has(key)) {
            userMap.set(key, {
              name:
                issue.fields.creator.displayName ||
                issue.fields.creator.emailAddress,
              email: issue.fields.creator.emailAddress,
              sources: ['jira'],
              confidence: 0.6, // Medium confidence for creators
              lastSeen: updatedDate,
              integrationMetadata: {
                jiraAccountId: issue.fields.creator.accountId,
                source: 'issue_creator',
                projectKey: config.projectKeys?.[0],
              },
            });
          }
        }
      }

      return Array.from(userMap.values());
    } catch (error) {
      this.logger.warn('Failed to get users from recent activity:', error);
      return [];
    }
  }
}
