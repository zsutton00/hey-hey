import type { ContextResolutionService } from '../../../../context/services/context-resolution.service';
import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../../types';
import type {
  FlowContext,
  FlowUserMessage,
} from '../../../../types/flow-internal.types';
import type { ArtifactService } from '../../../artifacts/artifact.service';
import type { DesignDocService } from '../../../design-doc/design-doc.service';
import type { EntityRegistryService } from '../../../entity-registry/entity-registry.service';
import type { InitiativeService } from '../../../initiatives/initiative.service';
import type { MessageService } from '../../../message.service';
import type { TaskService } from '../../../tasks/task.service';
import type { EntitySummaryService } from '../../../entity-summary/entity-summary.service';
import type { SubfacetService } from '../../../entity-summary/subfacet.service';

/**
 * Context passed to prompts for building
 */
export interface PromptContext {
  projectId: ProjectId;
  organizationId: OrganizationId;
  conversationId: ConversationId;
  user: {
    id: UserId;
    role: string;
  };
}

/**
 * Context data built by node's buildContext() method
 * This contains all the computed data that nodes generate
 */
export interface NodeBuildContext {
  nodeId?: string;
  nodeType?: string;
  nodeTitle?: string;

  // Initiative-related data
  currentLevel?: string;
  levelNames?: string[];

  // Analysis data
  task?: unknown;
  gatheredData?: Record<string, unknown>;
  technicalAnalysis?: string;
  userFeedback?: string;
  integrations?: string;

  // Related entities
  relatedInitiatives?: unknown[];
  similarProjects?: unknown[];

  // Change detection for optimization - flexible format
  changeDetection?: {
    hasChanges: boolean;
    changes?: unknown[];
    originalArtifact?: unknown;
    // Extended format for initiative refinement
    changeType?: 'minor' | 'major' | 'structural';
    affectedFields?: string[];
    summary?: string;
    confidence?: number;
  };
}

/**
 * Complete context passed to placeholder resolvers
 */
export interface PlaceholderContext {
  flowContext: FlowContext;
  userMessage?: FlowUserMessage;
  nodeBuildContext?: NodeBuildContext;
  services: {
    initiativeService: InitiativeService;
    artifactService: ArtifactService;
    taskService: TaskService;
    designDocService: DesignDocService;
    messageService?: MessageService;
    entityRegistryService?: EntityRegistryService;
    contextResolutionService?: ContextResolutionService;
    entitySummaryService?: EntitySummaryService;
    subfacetService?: SubfacetService;
    // Add more services as needed
  };
  options: {
    includeHistory?: boolean;
    // Add more options as needed
  };
}

// Primitive types that can be safely converted to strings and cached
export type PlaceholderValue = string | number | boolean;

/**
 * Type for placeholder resolver functions (constrained to primitive types)
 */
export type PlaceholderResolver<T extends PlaceholderValue = string> = (
  context: PlaceholderContext,
  options?: Record<string, unknown>,
) => Promise<T> | T;

/**
 * Validation result for templates
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  usedPlaceholders: string[];
  missingPlaceholders: string[];
}

/**
 * Cache entry for resolved placeholders (stores any primitive value)
 */
export interface CacheEntry {
  value: PlaceholderValue;
  timestamp: number;
  ttl: number;
}

/**
 * Options for placeholder resolution
 */
export interface ResolutionOptions {
  enableCaching?: boolean;
  cacheTtl?: number; // in milliseconds
  throwOnMissing?: boolean;
  defaultValue?: string;
}
