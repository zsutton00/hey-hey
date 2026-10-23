import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GitHubIntegrationHandler } from '../integration/handlers/github.integration.handler';
import { JiraIntegrationHandler } from '../integration/handlers/jira.integration.handler';
import { SuggestedUserDto, SuggestedUsersResponseDto } from '../generated';

export interface SuggestedUser {
  name: string;
  email: string;
  sources: string[];
  confidence: number;
  lastSeen: Date;
  integrationMetadata?: Record<string, unknown>;
}

export interface UserSuggestionFilters {
  organizationId: string;
  projectId?: string;
  integrationType?: string;
  limit?: number;
  search?: string;
}

@Injectable()
export class UserSuggestionService {
  private readonly logger = new Logger(UserSuggestionService.name);
  private readonly STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubHandler: GitHubIntegrationHandler,
    private readonly jiraHandler: JiraIntegrationHandler,
  ) {}

  async getSuggestedUsers(
    filters: UserSuggestionFilters,
  ): Promise<SuggestedUsersResponseDto> {
    const {
      organizationId,
      projectId,
      integrationType,
      limit = 50,
      search,
    } = filters;

    // Get stored suggestions first (immediate response)
    const stored = await this.getStoredSuggestions(filters);

    // Check if we should refresh (async, doesn't block response)
    const shouldRefresh = this.shouldRefresh(stored);

    if (shouldRefresh) {
      // Fire-and-forget refresh for next time
      this.refreshSuggestions(organizationId, projectId).catch((err) =>
        this.logger.warn('Failed to refresh suggestions', {
          err: err instanceof Error ? err.message : String(err),
          organizationId,
          projectId,
        }),
      );
    }

    // If no stored data exists and we need fresh data, block and fetch
    if (stored.length === 0 && shouldRefresh) {
      this.logger.log('No stored suggestions found, fetching fresh data', {
        organizationId,
        projectId,
      });

      try {
        const fresh = await this.refreshSuggestions(organizationId, projectId);
        return {
          users: this.convertToDto(
            this.applyFilters(fresh, { integrationType, limit, search }),
          ),
          totalCount: fresh.length,
          cached: false,
        };
      } catch (error) {
        this.logger.error('Failed to fetch fresh suggestions', {
          error: error instanceof Error ? error.message : String(error),
          organizationId,
          projectId,
        });
        // Fall back to empty response
        return { users: [], totalCount: 0, cached: false };
      }
    }

    return {
      users: this.convertToDto(
        this.applyFilters(stored, { integrationType, limit, search }),
      ),
      totalCount: stored.length,
      cached: !shouldRefresh,
    };
  }

  private async getStoredSuggestions(
    filters: UserSuggestionFilters,
  ): Promise<SuggestedUser[]> {
    const { organizationId, projectId } = filters;

    const suggestions = await this.prisma.db.userSuggestion.findMany({
      where: {
        organizationId,
        projectId: projectId || null,
      },
      orderBy: [{ confidence: 'desc' }, { lastSeen: 'desc' }],
    });

    return suggestions.map((s) => ({
      name: s.name,
      email: s.email,
      sources: s.sources,
      confidence: s.confidence.toNumber(),
      lastSeen: s.lastSeen,
      integrationMetadata: s.integrationMetadata as Record<string, unknown>,
    }));
  }

  private shouldRefresh(suggestions: SuggestedUser[]): boolean {
    if (suggestions.length === 0) {
      return true;
    }

    // Refresh if oldest suggestion is > 24 hours old
    const oldestSuggestion = Math.min(
      ...suggestions.map((s) => s.lastSeen.getTime()),
    );
    const isStale = Date.now() - oldestSuggestion > this.STALE_THRESHOLD_MS;

    this.logger.debug('Checking if refresh needed', {
      suggestionsCount: suggestions.length,
      oldestAge: Math.round((Date.now() - oldestSuggestion) / (60 * 60 * 1000)),
      isStale,
    });

    return isStale;
  }

  private async refreshSuggestions(
    organizationId: string,
    projectId?: string,
  ): Promise<SuggestedUser[]> {
    this.logger.log('Refreshing user suggestions', {
      organizationId,
      projectId,
    });

    // Get active integrations for this organization/project
    const integrations = await this.prisma.db.integration.findMany({
      where: {
        organizationId,
        projectId: projectId || undefined,
        state: 'ACTIVE',
        connectionStatus: 'CONNECTED',
      },
    });

    if (integrations.length === 0) {
      this.logger.debug('No active integrations found', {
        organizationId,
        projectId,
      });
      return [];
    }

    // Call each integration handler in parallel
    const integrationPromises = integrations.map(async (integration) => {
      try {
        switch (integration.type) {
          case 'github':
            return await this.githubHandler.getSuggestedUsers(
              integration,
              projectId,
            );
          case 'jira':
            return await this.jiraHandler.getSuggestedUsers(
              integration,
              projectId,
            );
          default:
            this.logger.warn(`Unknown integration type: ${integration.type}`);
            return [];
        }
      } catch (error) {
        this.logger.error(
          `Failed to get users from ${integration.type} integration:`,
          {
            error: error instanceof Error ? error.message : String(error),
            integrationId: integration.id,
          },
        );
        return [];
      }
    });

    const integrationResults = await Promise.all(integrationPromises);
    const allUsers = integrationResults.flat();

    // Deduplicate and score the results
    const freshSuggestions = this.deduplicateAndScore(allUsers);

    // Update stored suggestions
    if (freshSuggestions.length > 0) {
      await this.updateStoredSuggestions(
        organizationId,
        projectId,
        freshSuggestions,
      );
    }

    this.logger.log(`Refreshed ${freshSuggestions.length} user suggestions`, {
      organizationId,
      projectId,
      integrationCount: integrations.length,
    });

    return freshSuggestions;
  }

  private async updateStoredSuggestions(
    organizationId: string,
    projectId: string | undefined,
    suggestions: SuggestedUser[],
  ): Promise<void> {
    this.logger.log('Updating stored suggestions', {
      organizationId,
      projectId,
      count: suggestions.length,
    });

    // Use transaction to update all suggestions atomically
    await this.prisma.$transaction(async (tx) => {
      // Delete existing suggestions for this org/project
      await tx.userSuggestion.deleteMany({
        where: {
          organizationId,
          projectId: projectId || null,
        },
      });

      // Insert fresh suggestions
      if (suggestions.length > 0) {
        await tx.userSuggestion.createMany({
          data: suggestions.map((s) => ({
            organizationId,
            projectId: projectId || null,
            name: s.name,
            email: s.email,
            sources: s.sources,
            confidence: new Decimal(s.confidence),
            lastSeen: s.lastSeen,
            firstSeen: new Date(),
            integrationMetadata: (s.integrationMetadata ||
              {}) as Prisma.InputJsonValue,
          })),
        });
      }
    });

    this.logger.log('Successfully updated stored suggestions', {
      organizationId,
      projectId,
      count: suggestions.length,
    });
  }

  private applyFilters(
    suggestions: SuggestedUser[],
    filters: {
      integrationType?: string;
      limit?: number;
      search?: string;
    },
  ): SuggestedUser[] {
    let filtered = [...suggestions];

    // Filter by integration type
    const integrationType = filters.integrationType;
    if (integrationType) {
      filtered = filtered.filter((s) => s.sources.includes(integrationType));
    }

    // Filter by search term (name or email)
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(searchLower) ||
          s.email.toLowerCase().includes(searchLower),
      );
    }

    // Apply limit
    if (filters.limit) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered;
  }

  // TODO: Phase 2 - Implement deduplication and confidence scoring
  private deduplicateAndScore(users: SuggestedUser[]): SuggestedUser[] {
    const emailMap = new Map<string, SuggestedUser>();

    for (const user of users) {
      const existingUser = emailMap.get(user.email.toLowerCase());

      if (existingUser) {
        // Merge sources and take higher confidence
        existingUser.sources = Array.from(
          new Set([...existingUser.sources, ...user.sources]),
        );
        existingUser.confidence = Math.max(
          existingUser.confidence,
          user.confidence,
        );
        existingUser.lastSeen = new Date(
          Math.max(existingUser.lastSeen.getTime(), user.lastSeen.getTime()),
        );

        // Merge metadata
        existingUser.integrationMetadata = {
          ...existingUser.integrationMetadata,
          ...user.integrationMetadata,
        };
      } else {
        emailMap.set(user.email.toLowerCase(), { ...user });
      }
    }

    return Array.from(emailMap.values()).sort(
      (a, b) => b.confidence - a.confidence,
    );
  }

  private convertToDto(users: SuggestedUser[]): SuggestedUserDto[] {
    return users.map((user) => ({
      name: user.name,
      email: user.email,
      sources: user.sources as SuggestedUserDto.SourcesEnum[],
      confidence: user.confidence,
      lastSeen: user.lastSeen.toISOString(),
    }));
  }
}
