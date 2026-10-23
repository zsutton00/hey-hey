import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ApiKeyService, ValidatedApiKey } from '../../services/api-key.service';
import { OrganizationId, UserId } from '../../types';

// Import and define the custom strategy type
const CustomStrategy = require('passport-custom').Strategy;

export interface ApiKeyAuthenticatedUser {
  userId: UserId; // The user who created the API key
  organizationId: OrganizationId;
  scopes: string[];
  apiKeyId: string;
  apiKeyName: string;
  authType: 'api-key';
}

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(
  CustomStrategy,
  'api-key',
) {
  private readonly logger = new Logger(ApiKeyStrategy.name);

  constructor(private readonly apiKeyService: ApiKeyService) {
    super();
  }

  /**
   * Extract API key from request headers or query parameters
   */
  private extractApiKey(request: Request): string | null {
    this.logger.debug(
      `Extracting API key from request to ${request.method} ${request.url}`,
    );
    this.logger.debug(
      `Headers: ${JSON.stringify({
        'x-api-key': request.headers['x-api-key'] ? '[PRESENT]' : '[MISSING]',
        authorization: request.headers.authorization
          ? `[${request.headers.authorization.substring(0, 20)}...]`
          : '[MISSING]',
      })}`,
    );

    // Check X-API-Key header first (preferred)
    const headerKey = request.headers['x-api-key'] as string;
    if (headerKey) {
      this.logger.debug(
        `Found API key in X-API-Key header: ${headerKey.substring(0, 10)}...`,
      );
      return headerKey;
    }

    // Fall back to Authorization header with Bearer scheme
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      this.logger.debug(`Found Bearer token: ${token.substring(0, 10)}...`);
      // Only consider it an API key if it has our format
      if (token.startsWith('hh_')) {
        this.logger.debug('Token starts with hh_ - treating as API key');
        return token;
      } else {
        this.logger.debug('Token does not start with hh_ - not an API key');
      }
    }

    // Last resort: check query parameter (less secure, but sometimes necessary)
    const queryKey = request.query.api_key as string;
    if (queryKey) {
      this.logger.debug(
        `Found API key in query parameter: ${queryKey.substring(0, 10)}...`,
      );
      return queryKey;
    }

    this.logger.debug('No API key found in request');
    return null;
  }

  /**
   * Get client IP from request
   */
  private getClientIp(request: Request): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      request.connection.remoteAddress ||
      'unknown'
    );
  }

  async validate(request: Request): Promise<ApiKeyAuthenticatedUser> {
    this.logger.debug(
      `[API Key Strategy] Starting validation for ${request.method} ${request.url}`,
    );

    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      this.logger.warn('No API key found in request - authentication failed');
      throw new Error('No API key provided');
    }

    this.logger.debug(
      `[API Key Strategy] Attempting to validate key: ${apiKey.substring(0, 10)}...`,
    );

    try {
      const clientIp = this.getClientIp(request);
      this.logger.debug(`[API Key Strategy] Client IP: ${clientIp}`);

      const validatedKey: ValidatedApiKey =
        await this.apiKeyService.validateApiKey(apiKey, clientIp);

      this.logger.log(
        `[API Key Strategy] ✅ API key authenticated successfully: ${validatedKey.id} for org ${validatedKey.organizationId}`,
      );

      const authenticatedUser = {
        userId: validatedKey.createdBy,
        organizationId: validatedKey.organizationId,
        scopes: validatedKey.scopes,
        apiKeyId: validatedKey.id,
        apiKeyName: validatedKey.name,
        authType: 'api-key' as const,
      };

      this.logger.debug(
        `[API Key Strategy] Returning authenticated user: ${JSON.stringify({
          userId: authenticatedUser.userId,
          organizationId: authenticatedUser.organizationId,
          scopes: authenticatedUser.scopes,
          authType: authenticatedUser.authType,
        })}`,
      );

      return authenticatedUser;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[API Key Strategy] ❌ API key validation failed: ${errorMessage}`,
      );
      throw new Error('Invalid API key');
    }
  }
}
