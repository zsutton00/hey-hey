import { Injectable, Logger } from '@nestjs/common';
import {
  EventContextManager,
  WithEventContext,
} from '../../core/events/observable-event.context';
import { PrismaService } from '../../prisma/prisma.service';
import { InitiativeId, OrganizationId } from '../../types';
import { InitiativeArtifactService } from './initiative-artifact.service';
import { MaterializedWorkItemSection } from '../../generated';
import { materializedSectionsToContentMap } from '../../utils/work-item-section.util';

/**
 * Change detection result for initiative optimization
 */
export interface InitiativeChangeDetection {
  hasChanges: boolean;
  changesSummary: string;
  changedFields: string[];
  confidenceScore: number;
  originalData: InitiativeBaselineData | null;
  currentData: CurrentInitiativeData;
  semanticSimilarity: {
    name: number;
    description: number;
    overall: number;
  };
  fieldLevelChanges: {
    description?: FieldChange;
    details?: FieldChange;
    acceptanceCriteria?: FieldChange;
  };
}

/**
 * Current initiative data for comparison
 */
interface CurrentInitiativeData {
  name: string;
  description: string;
  priority: string;
  tags: string[];
  details?: string;
  acceptanceCriteria?: string;
  status: string;
}

interface InitiativeBaselineData {
  name: string;
  description: string;
  details: string;
  acceptanceCriteria: string;
  priority: string;
  tags: string[];
  reasoning?: string;
}

/**
 * Field-level change information
 */
type EditableField = 'description' | 'details' | 'acceptanceCriteria';

interface FieldChange {
  original: string;
  current: string;
  similarity: number;
  changeType: 'minor' | 'moderate' | 'major';
}

/**
 * Optimization context for LLM enhancement
 */
export interface OptimizationContext {
  shouldSkipLlm: boolean;
  changesSummary?: string;
  optimizationHints?: string[];
  previousGenerationContext?: Record<string, unknown>;
  confidenceScore: number;
}

/**
 * Service responsible for intelligent change detection and optimization
 * for initiative refinement workflows
 */
@Injectable()
export class InitiativeOptimizationService {
  private readonly logger = new Logger(InitiativeOptimizationService.name);

  // Thresholds for change detection
  private readonly editableFieldsByStatus: Record<string, EditableField[]> = {
    REFINING_DESCRIPTION: ['description'],
    REFINING_DETAILS: ['description', 'details'],
    REFINING_ACCEPTANCE_CRITERIA: [
      'description',
      'details',
      'acceptanceCriteria',
    ],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly _initiativeArtifactService: InitiativeArtifactService,
  ) {}

  /**
   * Perform comprehensive change detection for an initiative
   * Compares current initiative state against original LLM-generated data
   */
  @WithEventContext('InitiativeOptimizationService')
  async detectChanges(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
  ): Promise<InitiativeChangeDetection> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    this.logger.log('[detectChanges] Performing change detection', {
      initiativeId,
      organizationId,
      correlationId: currentContext?.correlationId,
    });

    // Get current initiative data
    const currentInitiative = await this.getCurrentInitiativeData(
      initiativeId,
      organizationId,
    );

    if (!currentInitiative) {
      throw new Error(`Initiative ${initiativeId} not found`);
    }

    const editableFields = this.getEditableFieldsForStatus(
      currentInitiative.status,
    );

    if (editableFields.length === 0) {
      return this.createPristineDetection(currentInitiative);
    }

    const originalData = await this.getOriginalInitiativeData(
      initiativeId,
      organizationId,
    );

    if (!originalData) {
      return {
        hasChanges: true,
        changesSummary:
          'No original artifact found - first time processing required',
        changedFields: [...editableFields],
        confidenceScore: 1,
        originalData: null,
        currentData: currentInitiative,
        semanticSimilarity: this.buildSemanticSimilarity(editableFields),
        fieldLevelChanges: {},
      };
    }

    const changedFields = editableFields.filter(
      (field) =>
        this.normalizeForComparison(currentInitiative[field]) !==
        this.normalizeForComparison(originalData[field]),
    );
    const fieldLevelChanges: InitiativeChangeDetection['fieldLevelChanges'] =
      {};

    for (const field of changedFields) {
      fieldLevelChanges[field] = {
        original: this.normalizeForComparison(originalData[field]),
        current: this.normalizeForComparison(currentInitiative[field]),
        similarity: 0,
        changeType:
          this.normalizeForComparison(originalData[field]).length === 0 ||
          this.normalizeForComparison(currentInitiative[field]).length === 0
            ? 'major'
            : 'moderate',
      };
    }

    const summary = this.generateChangesSummary(changedFields);

    const detection: InitiativeChangeDetection = {
      hasChanges: changedFields.length > 0,
      changesSummary: summary,
      changedFields,
      confidenceScore: 1,
      originalData,
      currentData: currentInitiative,
      semanticSimilarity: this.buildSemanticSimilarity(changedFields),
      fieldLevelChanges,
    };

    this.logger.log('[detectChanges] Change detection completed', {
      initiativeId,
      hasChanges: detection.hasChanges,
      changedFields: detection.changedFields,
      confidenceScore: detection.confidenceScore,
      correlationId: currentContext?.correlationId,
    });

    return detection;
  }

  /**
   * Generate optimization context for LLM workflow decision
   * Determines if LLM processing should be skipped and provides context
   */
  async generateOptimizationContext(
    changeDetection: InitiativeChangeDetection,
  ): Promise<OptimizationContext> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    this.logger.debug(
      '[generateOptimizationContext] Generating optimization context',
      {
        hasChanges: changeDetection.hasChanges,
        confidenceScore: changeDetection.confidenceScore,
        correlationId: currentContext?.correlationId,
      },
    );

    const shouldSkipLlm = !changeDetection.hasChanges;

    const optimizationHints: string[] = [];

    if (shouldSkipLlm) {
      optimizationHints.push('No pending user edits detected');
      optimizationHints.push(
        'Safe to prompt for next input without regeneration',
      );
    } else {
      optimizationHints.push(
        `Pending user edits detected in: ${changeDetection.changedFields.join(', ')}`,
      );
      optimizationHints.push(
        'Align downstream fields with latest manual edits',
      );
    }

    const optimizationContext: OptimizationContext = {
      shouldSkipLlm,
      changesSummary: changeDetection.changesSummary,
      optimizationHints,
      previousGenerationContext: undefined,
      confidenceScore: changeDetection.confidenceScore,
    };

    this.logger.debug(
      '[generateOptimizationContext] Optimization context generated',
      {
        shouldSkipLlm,
        hintsCount: optimizationHints.length,
        correlationId: currentContext?.correlationId,
      },
    );

    return optimizationContext;
  }

  /**
   * Batch change detection for multiple initiatives
   * Efficient processing with optimized database queries
   */
  async batchDetectChanges(
    initiativeIds: InitiativeId[],
    organizationId: OrganizationId,
  ): Promise<Map<InitiativeId, InitiativeChangeDetection>> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    this.logger.log('[batchDetectChanges] Performing batch change detection', {
      count: initiativeIds.length,
      organizationId,
      correlationId: currentContext?.correlationId,
    });

    const results = new Map<InitiativeId, InitiativeChangeDetection>();

    if (initiativeIds.length === 0) {
      return results;
    }

    for (const initiativeId of initiativeIds) {
      try {
        const changeDetection = await this.detectChanges(
          initiativeId,
          organizationId,
        );
        results.set(initiativeId, changeDetection);
      } catch (error) {
        this.logger.error('[batchDetectChanges] Error processing initiative', {
          initiativeId,
          error: error instanceof Error ? error.message : error,
          correlationId: currentContext?.correlationId,
        });

        results.set(initiativeId, {
          hasChanges: true,
          changesSummary: 'Error during change detection - regeneration needed',
          changedFields: ['error'],
          confidenceScore: 0,
          originalData: null,
          currentData: {
            name: '',
            description: '',
            priority: '',
            tags: [],
            status: 'UNKNOWN',
          },
          semanticSimilarity: { name: 0, description: 0, overall: 0 },
          fieldLevelChanges: {},
        });
      }
    }

    this.logger.log('[batchDetectChanges] Batch change detection completed', {
      count: results.size,
      correlationId: currentContext?.correlationId,
    });

    return results;
  }

  /**
   * Get current initiative data from database
   * Formats data for comparison with original generation
   */
  private async getCurrentInitiativeData(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
  ): Promise<CurrentInitiativeData | null> {
    const initiative = await this.prisma.db.initiative.findFirst({
      where: {
        id: initiativeId,
        organizationId,
        archivedAt: null,
      },
      select: {
        name: true,
        priority: true,
        tags: true,
        status: true,
      },
    });

    if (!initiative) {
      return null;
    }

    const sectionRows = await this.prisma.db.initiativeSection.findMany({
      where: { initiativeId },
      select: {
        id: true,
        key: true,
        order: true,
        materializedMarkdown: true,
      },
    });
    const sectionContent = materializedSectionsToContentMap(
      sectionRows as MaterializedWorkItemSection[],
    );

    return {
      name: initiative.name,
      description: sectionContent.description,
      priority: initiative.priority || '',
      tags: initiative.tags || [],
      details: sectionContent.details || undefined,
      acceptanceCriteria: sectionContent.acceptanceCriteria || undefined,
      status: initiative.status,
    };
  }

  private getEditableFieldsForStatus(status: string): EditableField[] {
    return this.editableFieldsByStatus[status] || [];
  }

  private async getOriginalInitiativeData(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
  ): Promise<InitiativeBaselineData | null> {
    const artifact =
      await this._initiativeArtifactService.getOriginalArtifactForInitiative(
        initiativeId,
        organizationId,
      );

    if (!artifact) {
      return null;
    }

    if (
      !('content' in artifact.data) ||
      typeof artifact.data.content !== 'string'
    ) {
      throw new Error(
        `Original initiative artifact ${artifact.id} is missing JSON content`,
      );
    }

    const parsedContent = JSON.parse(artifact.data.content) as unknown;
    const baselineCandidate = this.extractBaselineCandidate(parsedContent);

    return this.assertInitiativeBaselineData(
      baselineCandidate,
      initiativeId,
      artifact.id,
    );
  }

  private createPristineDetection(
    currentInitiative: CurrentInitiativeData,
  ): InitiativeChangeDetection {
    return {
      hasChanges: false,
      changesSummary: 'No changes detected',
      changedFields: [],
      confidenceScore: 1,
      originalData: null,
      currentData: currentInitiative,
      semanticSimilarity: {
        name: 1,
        description: 1,
        overall: 1,
      },
      fieldLevelChanges: {},
    };
  }

  private normalizeForComparison(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  private extractBaselineCandidate(parsedContent: unknown): unknown {
    if (!parsedContent || typeof parsedContent !== 'object') {
      return parsedContent;
    }

    const record = parsedContent as Record<string, unknown>;
    if (record.originalData && typeof record.originalData === 'object') {
      return record.originalData;
    }

    return record;
  }

  private assertInitiativeBaselineData(
    baseline: unknown,
    initiativeId: InitiativeId,
    artifactId: string,
  ): InitiativeBaselineData {
    if (!baseline || typeof baseline !== 'object') {
      throw new Error(
        `Original initiative artifact ${artifactId} for initiative ${initiativeId} has invalid baseline payload`,
      );
    }

    const record = baseline as Record<string, unknown>;
    const requiredStringFields = [
      'name',
      'description',
      'details',
      'acceptanceCriteria',
      'priority',
    ] as const;

    for (const field of requiredStringFields) {
      if (typeof record[field] !== 'string') {
        throw new Error(
          `Original initiative artifact ${artifactId} for initiative ${initiativeId} is missing required field '${field}'`,
        );
      }
    }

    if (
      !Array.isArray(record.tags) ||
      !record.tags.every((tag) => typeof tag === 'string')
    ) {
      throw new Error(
        `Original initiative artifact ${artifactId} for initiative ${initiativeId} has invalid tags`,
      );
    }

    if (
      record.reasoning !== undefined &&
      typeof record.reasoning !== 'string'
    ) {
      throw new Error(
        `Original initiative artifact ${artifactId} for initiative ${initiativeId} has invalid reasoning`,
      );
    }

    return {
      name: record.name as string,
      description: record.description as string,
      details: record.details as string,
      acceptanceCriteria: record.acceptanceCriteria as string,
      priority: record.priority as string,
      tags: record.tags as string[],
      reasoning: record.reasoning as string | undefined,
    };
  }

  private generateChangesSummary(changedFields: string[]): string {
    if (changedFields.length === 0) {
      return 'No changes detected';
    }

    const uniqueFields = Array.from(new Set(changedFields));
    return `User edits pending for: ${uniqueFields.join(', ')}`;
  }

  private buildSemanticSimilarity(changedFields: string[]) {
    const hasDescriptionChange = changedFields.includes('description');
    return {
      name: 1,
      description: hasDescriptionChange ? 0 : 1,
      overall: changedFields.length > 0 ? 0 : 1,
    };
  }
}
