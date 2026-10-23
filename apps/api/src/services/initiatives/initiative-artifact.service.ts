import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { OrganizationId, ProjectId, InitiativeId } from '../../types';
import {
  CreateArtifactDto,
  ArtifactResponseDto,
  QueryArtifactsDto,
  Influence,
  ArtifactType,
  ArtifactStatus,
  ArtifactSourceType,
  InitiativeArtifactData,
  InsightData,
  UpdateArtifactDto,
} from '../../generated';
import {
  EventContextManager,
  WithEventContext,
} from '../../core/events/observable-event.context';
import { ArtifactService } from '../artifacts/artifact.service';
import { InfluenceService } from '../influence/influence.service';

/**
 * Original initiative data structure for artifacts
 */
export interface InitiativeOriginalData {
  name: string;
  description: string;
  details: string;
  acceptanceCriteria: string;
  priority: string;
  estimatedEffort?: string;
  tags: string[];
  reasoning?: string;
  influences: Influence[];
}

/**
 * Specialized service for managing INITIATIVE_ORIGINAL artifacts
 * Provides operations specific to storing and retrieving original LLM-generated initiative data
 */
@Injectable()
export class InitiativeArtifactService {
  private readonly logger = new Logger(InitiativeArtifactService.name);

  constructor(
    private readonly artifactService: ArtifactService,
    private readonly influenceService: InfluenceService,
  ) {}

  /**
   * Store original LLM-generated initiative data as artifacts
   * Called during initiative generation to preserve original data for change detection
   */
  @WithEventContext('InitiativeArtifactService')
  async storeOriginalGeneration(
    initiatives: InitiativeOriginalData[],
    realInitiatives: Array<{ id: InitiativeId }>,
    organizationId: OrganizationId,
    projectId: ProjectId,
    generationContext?: {
      sourceId?: string;
      generationModel?: string;
      generationPrompt?: string;
      originalRequestContext?: Record<string, unknown>;
    },
  ): Promise<ArtifactResponseDto[]> {
    this.logger.debug(`[storeOriginalGeneration] starting`, {
      initiatives,
    });

    // Input validation
    if (!initiatives || initiatives.length === 0) {
      throw new BadRequestException('Initiatives array cannot be empty');
    }
    if (!realInitiatives || realInitiatives.length === 0) {
      throw new BadRequestException('Real initiatives array cannot be empty');
    }
    if (!organizationId) {
      throw new BadRequestException('Organization ID is required');
    }
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    this.logger.log(
      '[storeOriginalGeneration] Storing original initiative artifacts',
      {
        count: initiatives.length,
        organizationId,
        projectId,
        correlationId: currentContext?.correlationId,
      },
    );

    if (initiatives.length !== realInitiatives.length) {
      const error = new BadRequestException(
        'Initiative generation validation failed: mismatch between draft and real initiatives',
        {
          cause: 'INITIATIVE_COUNT_MISMATCH',
          description: `Expected ${initiatives.length} initiatives but found ${realInitiatives.length} real initiatives`,
        },
      );

      this.logger.error('[storeOriginalGeneration] Initiative count mismatch', {
        draftCount: initiatives.length,
        realCount: realInitiatives.length,
        projectId,
        organizationId,
        correlationId: currentContext?.correlationId,
      });

      throw error;
    }

    const artifactDtos: CreateArtifactDto[] = initiatives
      .map((draft, index) => {
        const realInitiative = realInitiatives[index];
        if (!realInitiative) {
          this.logger.error(
            `Could not find created initiative for draft ${draft.name}`,
          );
          return undefined;
        }

        // Store initiative-specific information in the artifact content
        const enhancedContent = {
          initiativeId: realInitiative.id, // Store initiative ID in content
          generatedAt: new Date().toISOString(),
          generationSource: 'onboarding-flow',
          generationModel: generationContext?.generationModel,
          originalData: {
            name: draft.name,
            description: draft.description,
            details: draft.details,
            acceptanceCriteria: draft.acceptanceCriteria,
            priority: draft.priority,
            estimatedEffort: draft.estimatedEffort,
            tags: draft.tags,
            reasoning: draft.reasoning,
          },
        };

        const artifactData: InitiativeArtifactData = {
          type: 'INITIATIVE_ORIGINAL',
          confidence: 0.95,
          reasoning: `Original LLM-generated data for initiative: ${draft.name}`,
          content: JSON.stringify(enhancedContent),
        };

        return {
          projectId,
          organizationId,
          type: ArtifactType.InitiativeOriginal,
          title: `Original: ${draft.name}`,
          data: artifactData,
          sourceType: ArtifactSourceType.Initiative,
          sourceId: realInitiative.id,
          category: 'initiative-generation',
          status: ArtifactStatus.Active,
          tags: [
            ...draft.tags,
            'initiative-original',
            'llm-generated',
            `initiative-${realInitiative.id}`, // Tag-based initiative ID tracking
          ],
          isPublic: false,
          generateEmbedding: true,
          influences: draft.influences,
        } satisfies CreateArtifactDto;
      })
      .filter((a) => a !== undefined);

    // Log influence information before creating artifacts
    const influenceCount = artifactDtos.reduce(
      (count, dto) => count + (dto.influences?.length || 0),
      0,
    );

    this.logger.debug(
      '[storeOriginalGeneration] Creating artifacts with influences',
      {
        artifactCount: artifactDtos.length,
        influenceCount,
        hasInfluences: influenceCount > 0,
        correlationId: currentContext?.correlationId,
      },
    );

    // Use artifact service to create artifacts in batch
    const createdCount = await this.artifactService.createMany(artifactDtos);

    this.logger.log(
      '[storeOriginalGeneration] Original initiative artifacts stored',
      {
        createdCount,
        requestedCount: initiatives.length,
        correlationId: currentContext?.correlationId,
      },
    );

    // Store influences directly on initiatives
    const allInfluences = initiatives
      .flatMap((draft, index) => {
        const realInitiative = realInitiatives[index];
        if (!realInitiative) {
          this.logger.error(
            `Could not find created initiative for draft ${draft.name}`,
          );
          return undefined;
        }

        return (draft.influences || []).map((inf) => ({
          influencedType: 'initiative' as const,
          influencedId: realInitiative.id,
          influencingId: inf.entityId,
          reasoning: inf.reasoning,
          reasonType: inf.reasonType,
          confidence: inf.confidence,
          organizationId,
        }));
      })
      .filter((a) => a !== undefined);

    if (allInfluences.length > 0) {
      await this.influenceService.createMany(allInfluences);

      this.logger.log(
        '[storeOriginalGeneration] Stored initiative influences',
        {
          influenceCount: allInfluences.length,
          correlationId: currentContext?.correlationId,
        },
      );
    }

    // Return the created artifacts for reference
    const createdArtifacts = await this.getOriginalGenerationArtifacts(
      realInitiatives.map((r) => r.id),
      organizationId,
    );

    return createdArtifacts;
  }

  /**
   * Retrieve INITIATIVE_ORIGINAL artifacts for specific initiatives
   * Used for change detection and optimization context
   */
  async getOriginalGenerationArtifacts(
    initiativeIds: InitiativeId[],
    organizationId: OrganizationId,
  ): Promise<ArtifactResponseDto[]> {
    this.logger.debug(
      '[getOriginalGenerationArtifacts] Retrieving original artifacts',
      {
        initiativeIds: initiativeIds.length,
        organizationId,
      },
    );

    // Query for INITIATIVE_ORIGINAL artifacts using tags to identify initiatives
    const queryDto: QueryArtifactsDto = {
      type: 'INITIATIVE_ORIGINAL',
      status: 'ACTIVE',
      sourceType: 'INITIATIVE',
      category: 'initiative-generation',
      // Use tags to filter by initiative IDs - artifact service will handle the filtering
      tags: initiativeIds.map((id) => `initiative-${id}`).join(','),
    };

    const artifactsResult = await this.artifactService.findMany(
      queryDto,
      organizationId,
    );

    this.logger.debug(
      '[getOriginalGenerationArtifacts] Found original artifacts',
      {
        count: artifactsResult.data.length,
        initiativeIds: initiativeIds.length,
      },
    );

    // Filter artifacts to only those matching our initiative IDs
    const filteredArtifacts = artifactsResult.data.filter((artifact) => {
      return initiativeIds.some((id) =>
        artifact.tags.includes(`initiative-${id}`),
      );
    });

    return filteredArtifacts;
  }

  /**
   * Get original artifact for a specific initiative
   * Returns the most recent INITIATIVE_ORIGINAL artifact for the initiative
   */
  async getOriginalArtifactForInitiative(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
  ): Promise<ArtifactResponseDto | null> {
    this.logger.debug(
      '[getOriginalArtifactForInitiative] Retrieving original artifact',
      {
        initiativeId,
        organizationId,
      },
    );

    // Query for artifacts with the specific initiative tag
    const queryDto: QueryArtifactsDto = {
      type: 'INITIATIVE_ORIGINAL',
      status: 'ACTIVE',
      sourceType: 'INITIATIVE',
      category: 'initiative-generation',
      tags: `initiative-${initiativeId}`,
      orderBy: 'createdAt',
      orderDirection: 'desc',
      limit: 1,
    };

    const artifactsResult = await this.artifactService.findMany(
      queryDto,
      organizationId,
    );

    if (!artifactsResult.data[0]) {
      this.logger.debug(
        '[getOriginalArtifactForInitiative] No original artifact found',
        {
          initiativeId,
          organizationId,
        },
      );
      return null;
    }

    return artifactsResult.data[0];
  }

  async updateOriginalArtifactFields(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
    updates: Partial<
      Pick<
        InitiativeOriginalData,
        'description' | 'details' | 'acceptanceCriteria'
      >
    >,
  ): Promise<void> {
    if (!updates || Object.keys(updates).length === 0) {
      this.logger.warn(
        '[updateOriginalArtifactFields] No updates provided for initiative artifact',
        {
          initiativeId,
          organizationId,
        },
      );
      return;
    }

    const artifact = await this.getOriginalArtifactForInitiative(
      initiativeId,
      organizationId,
    );

    if (!artifact) {
      this.logger.warn(
        '[updateOriginalArtifactFields] No original artifact found',
        {
          initiativeId,
          organizationId,
        },
      );
      return;
    }

    if (!this.isInitiativeOriginalArtifactData(artifact.data)) {
      this.logger.warn(
        '[updateOriginalArtifactFields] Artifact data is not INITIATIVE_ORIGINAL',
        {
          initiativeId,
          artifactId: artifact.id,
          organizationId,
          dataType: artifact.data?.type,
        },
      );
      return;
    }

    let parsedContent: unknown;
    try {
      parsedContent = JSON.parse(artifact.data.content);
    } catch (error) {
      this.logger.warn(
        '[updateOriginalArtifactFields] Failed to parse artifact content JSON',
        {
          initiativeId,
          artifactId: artifact.id,
          organizationId,
          error: error instanceof Error ? error.message : error,
        },
      );
      return;
    }

    const parsedRecord =
      parsedContent && typeof parsedContent === 'object'
        ? (parsedContent as Record<string, unknown>)
        : null;
    const originalData = parsedRecord?.originalData;

    if (!parsedRecord || !originalData || typeof originalData !== 'object') {
      this.logger.warn(
        '[updateOriginalArtifactFields] Artifact content missing originalData object',
        {
          initiativeId,
          artifactId: artifact.id,
          organizationId,
        },
      );
      return;
    }

    const updatedContent = {
      ...parsedRecord,
      originalData: {
        ...(originalData as Record<string, unknown>),
        ...updates,
      },
    };

    const updatedData: InitiativeArtifactData = {
      ...artifact.data,
      content: JSON.stringify(updatedContent),
      type: ArtifactType.InitiativeOriginal,
    };

    const updateDto: UpdateArtifactDto = {
      data: updatedData,
    };

    await this.artifactService.update(artifact.id, updateDto, organizationId);
  }

  /**
   * Get original artifacts for multiple initiatives in bulk
   * Optimized to avoid N+1 queries when processing multiple initiatives
   */
  async getBulkOriginalArtifacts(
    initiativeIds: InitiativeId[],
    organizationId: OrganizationId,
  ): Promise<Map<InitiativeId, ArtifactResponseDto>> {
    this.logger.debug(
      '[getBulkOriginalArtifacts] Retrieving bulk original artifacts',
      {
        count: initiativeIds.length,
        organizationId,
      },
    );

    const results = new Map<InitiativeId, ArtifactResponseDto>();

    if (initiativeIds.length === 0) {
      return results;
    }

    // Query for all artifacts with initiative tags
    const queryDto: QueryArtifactsDto = {
      type: 'INITIATIVE_ORIGINAL',
      status: 'ACTIVE',
      sourceType: 'INITIATIVE',
      category: 'initiative-generation',
      orderBy: 'createdAt',
      orderDirection: 'desc',
      limit: 1000, // Reasonable limit for batch operations
    };

    const artifactsResult = await this.artifactService.findMany(
      queryDto,
      organizationId,
    );

    // Filter and map artifacts to initiatives
    for (const artifact of artifactsResult.data) {
      if (!artifact.tags) continue;

      // Find which initiative this artifact belongs to
      for (const initiativeId of initiativeIds) {
        const expectedTag = `initiative-${initiativeId}`;
        if (artifact.tags.includes(expectedTag)) {
          // Only store if we haven't found a more recent one for this initiative
          if (!results.has(initiativeId)) {
            results.set(initiativeId, artifact);
          }
          break;
        }
      }
    }

    this.logger.debug('[getBulkOriginalArtifacts] Bulk retrieval completed', {
      requestedCount: initiativeIds.length,
      foundCount: results.size,
      organizationId,
    });

    return results;
  }

  private isInitiativeOriginalArtifactData(
    data: ArtifactResponseDto['data'],
  ): data is InitiativeArtifactData {
    return (
      (data as InitiativeArtifactData)?.type === ArtifactType.InitiativeOriginal
    );
  }

  /**
   * Store refinement iteration as artifact
   * Used to track changes during the refinement process
   */
  @WithEventContext('InitiativeArtifactService')
  async storeLevelRefinement(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
    level: 'description' | 'details' | 'acceptanceCriteria',
    refinementData: {
      content: string;
      previousContent?: string;
      updateContext: {
        timestamp: Date;
        source: string;
        userContext?: Record<string, unknown>;
      };
    },
  ): Promise<ArtifactResponseDto> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    this.logger.log('[storeLevelRefinement] Storing refinement artifact', {
      initiativeId,
      level,
      organizationId,
      correlationId: currentContext?.correlationId,
    });

    // Store refinement information in content instead of metadata
    const refinementContent = {
      initiativeId,
      level,
      generatedAt: refinementData.updateContext.timestamp.toISOString(),
      generationSource: 'refinement-flow',
      updateSource: refinementData.updateContext.source,
      userContext: refinementData.updateContext.userContext,
      refinementData: {
        level,
        content: refinementData.content,
        previousContent: refinementData.previousContent,
        updateContext: refinementData.updateContext,
      },
    };

    const artifactData: InsightData = {
      type: 'INSIGHT',
      confidence: 0.9,
      reasoning: `Level refinement for ${level} of initiative ${initiativeId}`,
      content: JSON.stringify(refinementContent),
    };

    const artifactDto: CreateArtifactDto = {
      projectId: currentContext?.projectId ?? undefined,
      organizationId,
      type: ArtifactType.InitiativeOriginal,
      title: `Refinement: ${level} for ${initiativeId}`,
      data: artifactData,
      sourceType: ArtifactSourceType.Initiative,
      sourceId: initiativeId,
      category: 'initiative-refinement',
      status: ArtifactStatus.Active,
      tags: [
        'initiative-refinement',
        level,
        'user-modified',
        `initiative-${initiativeId}`,
      ],
      isPublic: false,
      generateEmbedding: true,
    };

    const createdArtifact = await this.artifactService.create(artifactDto);

    this.logger.log('[storeLevelRefinement] Refinement artifact stored', {
      artifactId: createdArtifact.id,
      initiativeId,
      level,
      correlationId: currentContext?.correlationId,
    });

    return createdArtifact;
  }

  /**
   * Get refinement history for an initiative
   * Returns all refinement artifacts for tracking evolution
   */
  async getRefinementHistory(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
  ): Promise<ArtifactResponseDto[]> {
    this.logger.debug('[getRefinementHistory] Retrieving refinement history', {
      initiativeId,
      organizationId,
    });

    const queryDto: QueryArtifactsDto = {
      type: 'INITIATIVE_ORIGINAL',
      status: 'ACTIVE',
      sourceType: 'INITIATIVE',
      category: 'initiative-refinement',
      tags: `initiative-${initiativeId}`,
      orderBy: 'createdAt',
      orderDirection: 'asc',
    };

    const artifactsResult = await this.artifactService.findMany(
      queryDto,
      organizationId,
    );

    this.logger.debug('[getRefinementHistory] Found refinement artifacts', {
      count: artifactsResult.data.length,
      initiativeId,
    });

    return artifactsResult.data;
  }
}
