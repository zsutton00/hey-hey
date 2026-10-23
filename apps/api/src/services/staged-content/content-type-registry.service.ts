/**
 * Content Type Registry Service
 *
 * Manages registration and retrieval of content type definitions for the
 * staged content framework. Provides a centralized registry for all
 * content types supported by the system.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ContentTypeDefinition,
  ContentTypeId,
  isValidContentTypeId,
} from '../../types/staged-content.types';

@Injectable()
export class ContentTypeRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ContentTypeRegistryService.name);
  private readonly contentTypes = new Map<
    ContentTypeId,
    ContentTypeDefinition
  >();
  private initialized = false;

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing Content Type Registry');
    await this.initialize();
  }

  /**
   * Initialize the registry with default content types
   * Called automatically during module initialization
   */
  private async initialize(): Promise<void> {
    try {
      this.logger.log('Content Type Registry initialized successfully');
      this.initialized = true;
    } catch (error) {
      this.logger.error('Failed to initialize Content Type Registry', error);
      throw error;
    }
  }

  /**
   * Register a new content type definition
   * @param definition - The content type definition to register
   * @throws Error if content type is invalid or already registered
   */
  register(definition: ContentTypeDefinition): void {
    this.validateContentTypeDefinition(definition);

    if (this.contentTypes.has(definition.id)) {
      this.logger.warn(
        `Content type '${definition.id}' is already registered. Overwriting.`,
      );
    }

    this.contentTypes.set(definition.id, definition);
    this.logger.log(
      `Registered content type: ${definition.id} (${definition.displayName})`,
    );
  }

  /**
   * Get a content type definition by ID
   * @param contentTypeId - The ID of the content type to retrieve
   * @returns The content type definition
   * @throws Error if content type is not found
   */
  get(contentTypeId: ContentTypeId): ContentTypeDefinition {
    if (!isValidContentTypeId(contentTypeId)) {
      throw new Error(`Invalid content type ID: ${contentTypeId as string}`);
    }

    const contentType = this.contentTypes.get(contentTypeId);
    if (!contentType) {
      throw new Error(
        `Content type '${contentTypeId}' not found. Available types: ${this.getAvailableTypeIds().join(', ')}`,
      );
    }

    return contentType;
  }

  /**
   * Get all registered content type definitions
   * @returns Array of all content type definitions
   */
  getAll(): ContentTypeDefinition[] {
    return Array.from(this.contentTypes.values());
  }

  /**
   * Get all available content type IDs
   * @returns Array of content type IDs
   */
  getAvailableTypeIds(): ContentTypeId[] {
    return Array.from(this.contentTypes.keys());
  }

  /**
   * Check if a content type is registered
   * @param contentTypeId - The content type ID to check
   * @returns True if the content type is registered
   */
  has(contentTypeId: ContentTypeId): boolean {
    return this.contentTypes.has(contentTypeId);
  }

  /**
   * Get content types by implementation type
   * @param implementationType - The implementation type to filter by
   * @returns Array of content type definitions matching the implementation type
   */
  getByImplementationType(
    implementationType: 'simple' | 'workflow' | 'hybrid',
  ): ContentTypeDefinition[] {
    return this.getAll().filter(
      (contentType) => contentType.implementationType === implementationType,
    );
  }

  /**
   * Get content types that support specific features
   * @param featureKey - The feature key to check for
   * @returns Array of content type definitions that support the feature
   */
  getByFeature(
    featureKey: keyof import('../../types/staged-content.types').ContentTypeFeatures,
  ): ContentTypeDefinition[] {
    return this.getAll().filter(
      (contentType) =>
        contentType.features && contentType.features[featureKey] === true,
    );
  }

  /**
   * Unregister a content type
   * @param contentTypeId - The content type ID to unregister
   * @returns True if the content type was unregistered, false if it wasn't registered
   */
  unregister(contentTypeId: ContentTypeId): boolean {
    const existed = this.contentTypes.has(contentTypeId);
    if (existed) {
      this.contentTypes.delete(contentTypeId);
      this.logger.log(`Unregistered content type: ${contentTypeId}`);
    }
    return existed;
  }

  /**
   * Clear all registered content types
   * Primarily used for testing
   */
  clear(): void {
    const count = this.contentTypes.size;
    this.contentTypes.clear();
    this.logger.log(`Cleared ${count} content types from registry`);
  }

  /**
   * Get registry statistics
   * @returns Object containing registry statistics
   */
  getStats(): {
    totalContentTypes: number;
    byImplementationType: Record<string, number>;
    byEntityType: Record<string, number>;
    initialized: boolean;
  } {
    const contentTypes = this.getAll();

    const byImplementationType = contentTypes.reduce(
      (acc, ct) => {
        acc[ct.implementationType] = (acc[ct.implementationType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byEntityType = contentTypes.reduce(
      (acc, ct) => {
        acc[ct.entitySchema.entityType] =
          (acc[ct.entitySchema.entityType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalContentTypes: contentTypes.length,
      byImplementationType,
      byEntityType,
      initialized: this.initialized,
    };
  }

  /**
   * Validate a content type definition
   * @param definition - The content type definition to validate
   * @throws Error if the definition is invalid
   */
  private validateContentTypeDefinition(
    definition: ContentTypeDefinition,
  ): void {
    if (!definition) {
      throw new Error('Content type definition is required');
    }

    if (!isValidContentTypeId(definition.id)) {
      throw new Error(`Invalid content type ID: ${definition.id as string}`);
    }

    if (!definition.displayName || definition.displayName.trim().length === 0) {
      throw new Error(
        `Content type '${definition.id}' must have a display name`,
      );
    }

    if (!definition.stages || definition.stages.length === 0) {
      throw new Error(
        `Content type '${definition.id}' must have at least one stage`,
      );
    }

    if (!definition.entitySchema) {
      throw new Error(
        `Content type '${definition.id}' must have an entity schema`,
      );
    }

    // Validate stages
    const stageIds = new Set<string>();
    const stageOrders = new Set<number>();

    for (const stage of definition.stages) {
      if (!stage.id || stage.id.trim().length === 0) {
        throw new Error(
          `Content type '${definition.id}' has a stage without an ID`,
        );
      }

      if (stageIds.has(stage.id)) {
        throw new Error(
          `Content type '${definition.id}' has duplicate stage ID: ${stage.id}`,
        );
      }
      stageIds.add(stage.id);

      if (stageOrders.has(stage.order)) {
        throw new Error(
          `Content type '${definition.id}' has duplicate stage order: ${stage.order}`,
        );
      }
      stageOrders.add(stage.order);

      if (!stage.contentFields || stage.contentFields.length === 0) {
        throw new Error(
          `Stage '${stage.id}' in content type '${definition.id}' must have at least one content field`,
        );
      }

      // Validate next stages exist
      for (const nextStageId of stage.nextStages) {
        if (!definition.stages.some((s) => s.id === nextStageId)) {
          throw new Error(
            `Stage '${stage.id}' in content type '${definition.id}' references non-existent next stage: ${nextStageId}`,
          );
        }
      }
    }

    // Validate entity schema
    if (
      !definition.entitySchema.entityType ||
      definition.entitySchema.entityType.trim().length === 0
    ) {
      throw new Error(
        `Content type '${definition.id}' entity schema must have an entity type`,
      );
    }

    // Entity schema validation - ensure basic structure is valid
    if (!definition.entitySchema.statusMapping) {
      throw new Error(
        `Content type '${definition.id}' entity schema must have status mapping`,
      );
    }

    // Validate status mappings reference valid stages
    for (const [stage, status] of Object.entries(
      definition.entitySchema.statusMapping,
    )) {
      if (!stageIds.has(stage)) {
        throw new Error(
          `Content type '${definition.id}' status mapping references non-existent stage: ${stage}`,
        );
      }
      if (!status || status.trim().length === 0) {
        throw new Error(
          `Content type '${definition.id}' status mapping for stage '${stage}' must have a status value`,
        );
      }
    }

    this.logger.debug(
      `Content type definition '${definition.id}' passed validation`,
    );
  }

  /**
   * Get a stage definition by ID within a content type
   * @param contentTypeId - The content type ID
   * @param stageId - The stage ID
   * @returns The stage definition
   * @throws Error if content type or stage is not found
   */
  getStage(
    contentTypeId: ContentTypeId,
    stageId: string,
  ): import('../../types/staged-content.types').StageDefinition {
    const contentType = this.get(contentTypeId);
    const stage = contentType.stages.find((s) => s.id === stageId);

    if (!stage) {
      throw new Error(
        `Stage '${stageId}' not found in content type '${contentTypeId}'. ` +
          `Available stages: ${contentType.stages.map((s) => s.id).join(', ')}`,
      );
    }

    return stage;
  }

  /**
   * Get the initial stage for a content type
   * @param contentTypeId - The content type ID
   * @returns The initial stage definition (lowest order)
   */
  getInitialStage(
    contentTypeId: ContentTypeId,
  ): import('../../types/staged-content.types').StageDefinition {
    const contentType = this.get(contentTypeId);
    const sortedStages = [...contentType.stages].sort(
      (a, b) => a.order - b.order,
    );

    if (sortedStages.length === 0) {
      throw new Error(`Content type '${contentTypeId}' has no stages`);
    }

    const firstStage = sortedStages[0];
    if (!firstStage) {
      throw new Error(`Content type '${contentTypeId}' has no stages`);
    }

    return firstStage;
  }

  /**
   * Get the terminal stages for a content type
   * @param contentTypeId - The content type ID
   * @returns Array of terminal stage definitions
   */
  getTerminalStages(
    contentTypeId: ContentTypeId,
  ): import('../../types/staged-content.types').StageDefinition[] {
    const contentType = this.get(contentTypeId);
    return contentType.stages.filter(
      (stage) => stage.isTerminal || stage.nextStages.length === 0,
    );
  }
}
