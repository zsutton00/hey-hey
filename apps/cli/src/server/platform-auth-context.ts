import type { OAuthClient } from '../auth/oauth-client';
import { extractOrganizationIdFromToken, extractUserIdFromToken } from '../auth/token-utils';
import type { ServerLogger } from './logger';
import type { MonitorProjectContext } from './monitors/project-context';

export interface PlatformAuth {
  accessToken: string;
  organizationId: string;
  userId: string;
  projectId: string;
}

/** Resolves the live token and project-scoped platform identity for server features. */
export class PlatformAuthContext {
  public constructor(
    private readonly oauthClient: OAuthClient,
    private readonly projectContext: MonitorProjectContext,
    private readonly logger: ServerLogger,
  ) {}

  public async resolve(projectIdOverride?: string): Promise<PlatformAuth | null> {
    const tokenResult = await this.oauthClient.getAccessToken({});
    if (!tokenResult.success) {
      this.logger.warn('platform.auth_context.token_unavailable', {
        error: tokenResult.error,
      });
      return null;
    }

    const organizationId = extractOrganizationIdFromToken(tokenResult.data);
    const userId = extractUserIdFromToken(tokenResult.data);
    const projectId = projectIdOverride ?? this.projectContext.currentProjectId;
    if (!organizationId || !userId || !projectId) {
      this.logger.warn('platform.auth_context.identity_incomplete', {
        hasOrganizationId: Boolean(organizationId),
        hasUserId: Boolean(userId),
        hasProjectId: Boolean(projectId),
      });
      return null;
    }

    this.logger.debug('platform.auth_context.resolved', {
      organizationId,
      projectId,
      projectSource: projectIdOverride === undefined ? 'learned' : 'caller',
    });
    return {
      accessToken: tokenResult.data,
      organizationId,
      userId,
      projectId,
    };
  }

  public async getAccessToken(): Promise<string> {
    const result = await this.oauthClient.getAccessToken({});
    if (!result.success) {
      this.logger.error('platform.auth_context.token_required', { error: result.error });
      throw new Error(`Authentication failed: ${result.error}`);
    }
    return result.data;
  }
}
