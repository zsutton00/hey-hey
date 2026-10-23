import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { CoreModule } from '../../core/core.module';
import { ContextModule } from '../../context/context.module';
import { ConversationValidation } from '../../validation/conversation.validation';
import { ConversationService } from '../conversation.service';
import { IntentDetectorService } from '../intent-detector.service';
import { DesignDocService } from '../design-doc/design-doc.service';
import { ConversationWorkflowService } from './conversation-workflow.service';
import { FlowExecutionService } from './flow-execution.service';
import { NodeExecutionService } from './node-execution.service';
import { PendingTriggerService } from './pending-trigger.service';
import { FlowSecurityService } from './flow-security.service';
import { InitiativeRefinementWorkflowService } from './initiative-refinement-workflow.service';
import { WorkflowExecutionService } from './workflow-execution.service';
import { WorkflowVisibilityService } from './workflow-visibility.service';
import { WorkflowRouterService } from './workflow-router.service';
import { WorkflowTypeRegistryService } from './workflow-type-registry.service';

// LLM Services
import { LLMClientService } from '../llm/llm-client.service';
import { LLMTrackingService } from '../llm/llm-tracking.service';
import { PlaceholderResolver } from '../llm/placeholders/resolver.service';
import { ClassificationClientService } from '../classification/classification-client.service';
import { PromptBuilderService } from '../llm/prompt-builder.service';

// All Node Modules
import { NodeRegistry } from '../../flows/nodes/node-registry.service';
import { OnboardingNodesModule } from '../../flows/nodes/onboarding/onboarding-nodes.module';
import { RepositoryImportNodesModule } from '../../flows/nodes/repository-import/repository-import-nodes.module';
import { WorkTrackerImportNodesModule } from '../../flows/nodes/work-tracker-import/work-tracker-import-nodes.module';
import { SharedNodesModule } from '../../flows/nodes/shared/shared-nodes.module';
import { InitiativeRefinementNodesModule } from '../../flows/nodes/initiative-refinement/initiative-refinement-nodes.module';
import { TaskRefinementNodesModule } from '../../flows/nodes/task-refinement/task-refinement-nodes.module';
import { TaskGenerationNodesModule } from '../../flows/nodes/task-generation/task-generation-nodes.module';
import { TaskPrioritizationNodesModule } from '../../flows/nodes/task-prioritization/task-prioritization-nodes.module';
import { AdrRefinementNodesModule } from '../../flows/nodes/adr-refinement/adr-refinement-nodes.module';
import { BrainstormRefinementNodesModule } from '../../flows/nodes/brainstorm-refinement/brainstorm-refinement-nodes.module';
import { DecisionRefinementNodesModule } from '../../flows/nodes/decision-refinement/decision-refinement-nodes.module';
import { RfcNodesModule } from '../../flows/nodes/rfc/rfc-nodes.module';
import { CodingPromptResearchNodesModule } from '../../flows/nodes/coding-prompt-research/coding-prompt-research-nodes.module';
import { EntityConversationNodesModule } from '../../flows/nodes/entity-conversation/entity-conversation-nodes.module';
import { ProjectConversationNodesModule } from '../../flows/nodes/project-conversation/project-conversation-nodes.module';
import { TopologyNodesModule } from '../../flows/nodes/topology/topology-nodes.module';
import { SuggestedTaskNodesModule } from '../../flows/nodes/suggested-task/suggested-task-nodes.module';
import { SuggestedDesignDocNodesModule } from '../../flows/nodes/suggested-design-doc/suggested-design-doc-nodes.module';
import { TaskDependencyInferenceNodesModule } from '../../flows/nodes/task-dependency-inference/task-dependency-inference-nodes.module';
import { DailySessionNodesModule } from '../../flows/nodes/daily-session/daily-session-nodes.module';
import { FeatureSyncNodesModule } from '../../flows/nodes/feature-sync/feature-sync-nodes.module';
import { PlanShapingNodesModule } from '../../flows/nodes/plan-shaping/plan-shaping-nodes.module';
import { PlanModule } from '../plan/plan.module';

/**
 * Consolidated Workflow Module
 *
 * Contains all workflow execution, LLM services, and flow nodes.
 * Made @Global to avoid circular dependency issues.
 *
 * This module consolidates:
 * - Workflow orchestration services
 * - LLM client and prompt building
 * - All flow node implementations
 */
@Global()
@Module({
  imports: [
    CoreModule,
    ConfigModule,
    HttpModule,
    ContextModule,
    forwardRef(() => PlanModule),
    // All node modules
    OnboardingNodesModule,
    RepositoryImportNodesModule,
    WorkTrackerImportNodesModule,
    SharedNodesModule,
    InitiativeRefinementNodesModule,
    TaskRefinementNodesModule,
    TaskGenerationNodesModule,
    TaskPrioritizationNodesModule,
    AdrRefinementNodesModule,
    BrainstormRefinementNodesModule,
    DecisionRefinementNodesModule,
    RfcNodesModule,
    CodingPromptResearchNodesModule,
    EntityConversationNodesModule,
    ProjectConversationNodesModule,
    TopologyNodesModule,
    SuggestedTaskNodesModule,
    SuggestedDesignDocNodesModule,
    TaskDependencyInferenceNodesModule,
    DailySessionNodesModule,
    FeatureSyncNodesModule,
    PlanShapingNodesModule,
  ],
  providers: [
    // Workflow Services
    ConversationService,
    ConversationValidation,
    ConversationWorkflowService,
    DesignDocService,
    FlowExecutionService,
    NodeExecutionService,
    PendingTriggerService,
    FlowSecurityService,
    InitiativeRefinementWorkflowService,
    IntentDetectorService,
    WorkflowExecutionService,
    WorkflowVisibilityService,
    WorkflowRouterService,
    WorkflowTypeRegistryService,

    // LLM Services
    LLMClientService,
    LLMTrackingService,
    PlaceholderResolver,
    ClassificationClientService,
    PromptBuilderService,

    // Node Registry
    NodeRegistry,
  ],
  exports: [
    // Workflow Services
    ConversationService,
    ConversationValidation,
    ConversationWorkflowService,
    DesignDocService,
    FlowExecutionService,
    NodeExecutionService,
    PendingTriggerService,
    FlowSecurityService,
    InitiativeRefinementWorkflowService,
    IntentDetectorService,
    WorkflowExecutionService,
    WorkflowVisibilityService,
    WorkflowRouterService,
    WorkflowTypeRegistryService,
    // LLM Services
    LLMClientService,
    LLMTrackingService,
    PlaceholderResolver,
    ClassificationClientService,
    PromptBuilderService,

    // Node Registry
    NodeRegistry,

    // Re-export node modules for any consumers
    OnboardingNodesModule,
    RepositoryImportNodesModule,
    WorkTrackerImportNodesModule,
    SharedNodesModule,
    InitiativeRefinementNodesModule,
    TaskRefinementNodesModule,
    TaskGenerationNodesModule,
    TaskPrioritizationNodesModule,
    AdrRefinementNodesModule,
    BrainstormRefinementNodesModule,
    DecisionRefinementNodesModule,
    RfcNodesModule,
    CodingPromptResearchNodesModule,
    EntityConversationNodesModule,
    ProjectConversationNodesModule,
    TopologyNodesModule,
    SuggestedTaskNodesModule,
    SuggestedDesignDocNodesModule,
    TaskDependencyInferenceNodesModule,
    DailySessionNodesModule,
    FeatureSyncNodesModule,
    PlanShapingNodesModule,
  ],
})
export class WorkflowModule {}
