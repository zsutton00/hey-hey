import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  ArtifactStatus as PrismaArtifactStatus,
  ArtifactType as PrismaArtifactType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ArtifactWithMetadata,
  ContextFilters,
  ContextProvider,
  ContextRequest,
  ContextResult,
  ContextType,
} from '../interfaces';
import { ProviderPriority } from '../types/context.types';
import { ArtifactSourceType } from 'src/generated';

@Injectable()
export class DatabaseContextProvider implements ContextProvider {
  private readonly logger = new Logger(DatabaseContextProvider.name);

  name = 'database-context-provider';
  priority = ProviderPriority.HIGH;
  supportedTypes = [
    ContextType.CONVERSATION,
    ContextType.PROJECT,
    ContextType.RELATED,
    ContextType.INITIATIVE,
  ];

  constructor(private readonly prisma: PrismaService) {}

  canHandle(request: ContextRequest): boolean {
    const canHandle = this.supportedTypes.includes(request.type);

    this.logger.debug('[canHandle] Checking if request can be handled', {
      requestType: request.type,
      canHandle,
      supportedTypes: this.supportedTypes,
      correlationId: request.correlationId,
    });

    return canHandle;
  }

  async resolve(
    request: ContextRequest,
    filters?: ContextFilters,
  ): Promise<ContextResult> {
    const startTime = Date.now();

    this.logger.log('[resolve] Starting database context resolution', {
      requestType: request.type,
      scope: request.scope,
      organizationId: request.organizationId,
      projectId: request.projectId,
      conversationId: request.conversationId,
      initiativeId: request.initiativeId,
      maxResults: request.maxResults,
      correlationId: request.correlationId,
      filters: filters ? Object.keys(filters) : undefined,
    });

    try {
      const where = this.buildWhereClause(request, filters);
      const orderBy = this.buildOrderBy(request);
      const take = request.maxResults || 20;

      this.logger.debug('[resolve] Executing database query', {
        where: this.sanitizeWhereForLogging(where),
        orderBy,
        take,
        correlationId: request.correlationId,
      });

      const [artifacts, totalCount] = await Promise.all([
        this.prisma.db.artifact.findMany({
          where,
          orderBy,
          take,
          include: {
            project: true,
            parent: true,
            children: true,
          },
        }),
        this.prisma.db.artifact.count({ where }),
      ]);

      const artifactsWithMetadata = artifacts.map((artifact) =>
        this.mapToArtifactWithMetadata(artifact, request),
      );
      const tokenEstimate = this.estimateTokens(artifactsWithMetadata);
      const executionTime = Date.now() - startTime;

      this.logger.log('[resolve] Database context resolution completed', {
        artifactsReturned: artifacts.length,
        totalCount,
        tokenEstimate,
        executionTime,
        queryStrategy: this.getQueryStrategy(request),
        correlationId: request.correlationId,
      });

      return {
        artifacts: artifactsWithMetadata,
        totalCount,
        tokenEstimate,
        providerName: this.name,
        executionTimeMs: executionTime,
        metadata: {
          queryStrategy: this.getQueryStrategy(request),
          filters,
          databaseQuery: {
            where: this.sanitizeWhereForLogging(where),
            orderBy,
            take,
          },
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.logger.error('[resolve] Database context resolution failed', {
        requestType: request.type,
        organizationId: request.organizationId,
        error: error instanceof Error ? error.message : error,
        executionTime,
        correlationId: request.correlationId,
      });

      throw error;
    }
  }

  private buildWhereClause(
    request: ContextRequest,
    filters?: ContextFilters,
  ): Prisma.ArtifactWhereInput {
    const where: Prisma.ArtifactWhereInput = {
      // CRITICAL: Always filter by organization ID to prevent cross-org access
      organizationId: request.organizationId,
      status: PrismaArtifactStatus.ACTIVE, // Only show active artifacts
    };

    // Apply request-specific filters
    if (request.projectId) {
      where.projectId = request.projectId;
    }

    if (request.conversationId) {
      where.sourceType = ArtifactSourceType.Conversation;
      where.sourceId = request.conversationId;
    }

    if (request.initiativeId) {
      where.OR = [
        {
          sourceType: ArtifactSourceType.Initiative,
          sourceId: request.initiativeId,
        },
        { tags: { hasSome: [`initiative-${request.initiativeId}`] } },
      ];
    }

    if (request.artifactTypes && request.artifactTypes.length > 0) {
      where.type = { in: request.artifactTypes as PrismaArtifactType[] };
    }

    // Apply additional filters
    if (filters) {
      if (filters.tags && filters.tags.length > 0) {
        where.tags = { hasSome: filters.tags };
      }

      if (filters.categories && filters.categories.length > 0) {
        where.category = { in: filters.categories };
      }

      if (filters.dateRange) {
        where.createdAt = {
          gte: filters.dateRange.start,
          lte: filters.dateRange.end,
        };
      }

      if (filters.excludeArtifactIds && filters.excludeArtifactIds.length > 0) {
        where.id = { notIn: filters.excludeArtifactIds };
      }
    }

    return where;
  }

  private buildOrderBy(
    request: ContextRequest,
  ): Prisma.ArtifactOrderByWithRelationInput {
    // Default to most recent first
    let orderBy: Prisma.ArtifactOrderByWithRelationInput = {
      createdAt: 'desc',
    };

    // Adjust based on context type
    switch (request.type) {
      case ContextType.RELATED:
        // For related context, prioritize by relevance if available, otherwise recency
        orderBy = { updatedAt: 'desc' };
        break;
      case ContextType.CONVERSATION:
        // For conversation context, chronological order
        orderBy = { createdAt: 'asc' };
        break;
      case ContextType.PROJECT:
      case ContextType.INITIATIVE:
      default:
        // Most recent first for project and initiative context
        orderBy = { createdAt: 'desc' };
        break;
    }

    return orderBy;
  }

  private getQueryStrategy(request: ContextRequest): string {
    if (request.conversationId) return 'conversation_artifacts';
    if (request.initiativeId) return 'initiative_artifacts';
    if (request.projectId) return 'project_artifacts';
    return 'organization_artifacts';
  }

  private mapToArtifactWithMetadata(
    artifact: {
      id: string;
      organizationId: string;
      projectId: string;
      data: unknown;
      type: PrismaArtifactType;
      title: string | null;
      tags: string[];
      category: string | null;
      createdAt: Date;
      updatedAt: Date;
      sourceType: ArtifactSourceType;
      sourceId: string;
      parentId: string | null;
      priority: string | null;
      status: PrismaArtifactStatus;
      isPublic: boolean;
    },
    request: ContextRequest,
  ): ArtifactWithMetadata {
    return {
      id: artifact.id,
      organizationId: artifact.organizationId,
      projectId: artifact.projectId,
      type: artifact.type,
      title: artifact.title ?? '',
      data: artifact.data,
      tags: artifact.tags,
      category: artifact.category ?? '',
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
      sourceType: artifact.sourceType,
      sourceId: artifact.sourceId,
      parentId: artifact.parentId ?? '',
      priority: artifact.priority ?? '',
      status: artifact.status,
      isPublic: artifact.isPublic,
      relevanceScore: this.calculateRelevanceScore(artifact, request),
      selectionReason: this.getSelectionReason(artifact, request),
    };
  }

  private calculateRelevanceScore(
    artifact: {
      sourceId: string;
      projectId: string;
      createdAt: Date;
      type: PrismaArtifactType;
    },
    request: ContextRequest,
  ): number {
    let score = 0.5; // Base score

    // Boost score for direct matches
    if (
      request.conversationId &&
      artifact.sourceId === request.conversationId
    ) {
      score += 0.3;
    }

    if (request.projectId && artifact.projectId === request.projectId) {
      score += 0.2;
    }

    // Recent artifacts get higher scores
    const daysSinceCreated =
      (Date.now() - artifact.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreated < 7) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  private getSelectionReason(
    artifact: {
      sourceId: string | null;
      projectId: string;
      type: PrismaArtifactType;
    },
    request: ContextRequest,
  ): string {
    const reasons: string[] = [];

    if (
      request.conversationId &&
      artifact.sourceId === request.conversationId
    ) {
      reasons.push('from_target_conversation');
    }

    if (request.projectId && artifact.projectId === request.projectId) {
      reasons.push('from_target_project');
    }

    if (artifact.type === request.artifactTypes?.[0]) {
      reasons.push('matching_artifact_type');
    }

    return reasons.join(', ') || 'organization_artifact';
  }

  estimateTokens(artifacts: ArtifactWithMetadata[]): number {
    // Rough estimation: 4 characters per token, plus metadata overhead
    return artifacts.reduce((total, artifact) => {
      const contentLength = JSON.stringify(artifact.data).length;
      const metadataLength = 200; // Estimated metadata overhead
      return total + Math.ceil((contentLength + metadataLength) / 4);
    }, 0);
  }

  private sanitizeWhereForLogging(
    where: Prisma.ArtifactWhereInput,
  ): Record<string, string | number | boolean | object | null> {
    // Remove sensitive data and simplify complex objects for logging
    const sanitized = { ...where };

    // Keep only the structure, not the actual values for complex queries
    if (sanitized.OR && Array.isArray(sanitized.OR)) {
      (sanitized as Record<string, string>).OR =
        `[${sanitized.OR.length} conditions]`;
    }

    if (sanitized.AND && Array.isArray(sanitized.AND)) {
      (sanitized as Record<string, string>).AND =
        `[${sanitized.AND.length} conditions]`;
    }

    return sanitized;
  }
}
