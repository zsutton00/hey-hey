import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import type { ContextResolutionService } from '../../../../context/services/context-resolution.service';
import { InitiativeId, OrganizationId, ProjectId } from '../../../../types';
import type {
  FlowContext,
  FlowUserMessage,
  InitiativeRefinementFlowContext,
} from '../../../../types/flow-internal.types';
import type { ArtifactService } from '../../../artifacts/artifact.service';
import type { DesignDocService } from '../../../design-doc/design-doc.service';
import type { EntityRegistryService } from '../../../entity-registry/entity-registry.service';
import type { InitiativeService } from '../../../initiatives/initiative.service';
import type { MessageService } from '../../../message.service';
import type { TaskService } from '../../../tasks/task.service';
import type { EntitySummaryService } from '../../../entity-summary/entity-summary.service';
import type { SubfacetService } from '../../../entity-summary/subfacet.service';
import type { NodeBuildContext, PlaceholderContext } from './placeholder-types';

/**
 * Builder for creating PlaceholderContext instances
 */
export class PlaceholderContextBuilder {
  private context: Partial<PlaceholderContext> = {};

  static create(): PlaceholderContextBuilder {
    return new PlaceholderContextBuilder();
  }

  withFlowContext(flowContext: FlowContext): this {
    this.context.flowContext = flowContext;

    return this;
  }

  withUserMessage(userMessage: FlowUserMessage): this {
    this.context.userMessage = userMessage;
    return this;
  }

  withNodeBuildContext(nodeBuildContext: NodeBuildContext): this {
    this.context.nodeBuildContext = nodeBuildContext;
    return this;
  }

  withServices(services: {
    initiativeService: InitiativeService;
    artifactService: ArtifactService;
    taskService: TaskService;
    designDocService: DesignDocService;
    messageService?: MessageService;
    entityRegistryService?: EntityRegistryService;
    contextResolutionService?: ContextResolutionService;
    entitySummaryService?: EntitySummaryService;
    subfacetService?: SubfacetService;
  }): this {
    this.context.services = services;
    return this;
  }

  withOptions(options: { includeHistory?: boolean }): this {
    this.context.options = { ...this.context.options, ...options };
    return this;
  }

  build(): PlaceholderContext {
    // Validate required fields
    if (!this.context.flowContext) {
      throw new Error('FlowContext is required');
    }
    if (!this.context.services) {
      throw new Error('Services are required');
    }

    return {
      flowContext: this.context.flowContext,
      userMessage: this.context.userMessage,
      nodeBuildContext: this.context.nodeBuildContext || {},
      services: this.context.services,
      options: this.context.options || {},
    };
  }
}

/**
 * Utility functions for working with PlaceholderContext
 */
export class PlaceholderContextUtils {
  /**
   * Check if the context has initiative data
   */
  static hasInitiativeContext(context: PlaceholderContext): boolean {
    return 'initiativeId' in context.flowContext;
  }

  /**
   * Get initiative ID from context, throwing if not present
   */
  static requireInitiativeId(context: PlaceholderContext): InitiativeId {
    if (!this.hasInitiativeContext(context)) {
      throw new Error('Initiative context is required but not present');
    }
    return (context.flowContext as InitiativeRefinementFlowContext)
      .initiativeId;
  }

  /**
   * Check if the context is for onboarding flow
   */
  static isOnboardingContext(context: PlaceholderContext): boolean {
    return context.flowContext.flowId === 'onboarding';
  }

  /**
   * Safely get a value from nodeBuildContext
   */
  static getNodeContextValue<T>(
    context: PlaceholderContext,
    key: keyof NodeBuildContext,
    defaultValue: T,
  ): T {
    const value = context.nodeBuildContext?.[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  /**
   * Get organization ID from context
   */
  static getOrganizationId(context: PlaceholderContext): OrganizationId {
    return context.flowContext.core.organizationId;
  }

  /**
   * Get project ID from context
   */
  static getProjectId(context: PlaceholderContext): ProjectId {
    return context.flowContext.core.projectId;
  }

  /**
   * Get conversation ID from context
   */
  static getConversationId(context: PlaceholderContext): string {
    return context.flowContext.core.conversationId;
  }

  /**
   * Get user message content safely
   */
  static getUserMessageContent(context: PlaceholderContext): string {
    if (!context.userMessage) {
      return '';
    }

    return MessageContentExtractor.extractMessageContent(context.userMessage);
  }

  /**
   * Get a typed ID from workflowAboutId based on the workflowAboutType
   * @param context PlaceholderContext containing the flowContext
   * @param expectedType The type to match against workflowAboutType
   * @returns The workflowAboutId if the type matches, undefined otherwise
   */
  static getTypedIdFromWorkflowAbout(
    context: PlaceholderContext,
    expectedType: string,
  ): string | undefined {
    const { workflowAboutId, workflowAboutType } = context.flowContext.core;

    if (workflowAboutType === expectedType) {
      return workflowAboutId;
    }

    return undefined;
  }
}
