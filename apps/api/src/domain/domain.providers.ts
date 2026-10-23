import { ProposalReconciliationGroupService } from '../services/proposal/proposal-reconciliation-group.service';
import { ProposalReconciliationService } from '../services/proposal/proposal-reconciliation.service';
import { ProposalReconciliationAdapterService } from '../services/proposal/proposal-reconciliation-adapter.service';
import { PlanDependenciesService } from '../services/plan/plan-dependencies.service';
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArtifactAdapter } from '../services/artifacts/artifact.adapter';
import { ArtifactDataService } from '../services/artifacts/artifact-data.service';
import { ArtifactDataValidators } from '../services/artifacts/artifact-data.validators';
import { ArtifactGraphService } from '../services/artifacts/artifact-graph.service';
import { ArtifactService } from '../services/artifacts/artifact.service';
import { ArchiveOrchestrationService } from '../services/archive-orchestration/archive-orchestration.service';
import { EmbeddingsClientService } from '../services/embeddings-client.service';
import { GraphsClientService } from '../services/graphs-client.service';
import { FeatureFlagService } from '../services/feature-flag/feature-flag.service';
import { InitiativeArtifactService } from '../services/initiatives/initiative-artifact.service';
import { InitiativeService } from '../services/initiatives/initiative.service';
import { MessageService } from '../services/message.service';
import { OrganizationService } from '../services/organization.service';
import { OrganizationProjectEntitlementService } from '../services/organization-project-entitlement.service';
import { AccountEntitlementService } from '../services/account-entitlement.service';
import { PaymentProviderBindingService } from '../services/payment-entitlement/payment-provider-binding.service';
import { PaymentProviderAdapterRegistry } from '../services/payment-entitlement/payment-provider-adapter.registry';
import { PaymentEntitlementReconciliationOwner } from '../services/payment-entitlement/payment-entitlement-reconciliation.owner';
import { PaymentEntitlementReconciliationService } from '../services/payment-entitlement/payment-entitlement-reconciliation.service';
import { OrganizationAccountLifecycleOwner } from '../services/organization-account-lifecycle.owner';
import { OrganizationAccountLifecycleService } from '../services/organization-account-lifecycle.service';
import { ProjectService } from '../services/project.service';
import { SecurityLoggerService } from '../services/security-logger.service';
import { TagService } from '../services/tag.service';
import { TaskService } from '../services/tasks/task.service';
import { WorkItemGraphParticipationComposer } from '../services/tasks/work-item-graph-participation';
import { FeatureRequirementAuthoringService } from '../services/tasks/feature-requirement-authoring.service';
import { GoalTracksService } from '../services/tasks/goal-tracks.service';
import { TaskSupersedeService } from '../services/tasks/task-supersede.service';
import { GoalMembershipService } from '../services/tasks/goal-membership.service';
import { WorkItemTypeImpactService } from '../services/tasks/work-item-type-impact.service';
import { WorkItemTypeRegistryService } from '../services/tasks/work-item-type-registry.service';
import { WorkItemTypeLifecycleService } from '../services/tasks/work-item-type-lifecycle.service';
import { WorkItemParentageValidator } from '../services/tasks/work-item-parentage-validator.service';
import { PlanHierarchyRollupService } from '../services/tasks/plan-hierarchy-rollup.service';
import { UserService } from '../services/user.service';
import { ApiKeyService } from '../services/api-key.service';
import { EmailService } from '../services/email.service';
import { PrivateBetaAccessNotificationService } from '../services/private-beta-access-notification.service';
import { StandardPromptBuilderStrategy } from 'src/services/llm/strategies/standard-prompt-builder.strategy';
import { InitiativeRefinementPromptBuilderStrategy } from 'src/services/llm/strategies/initiative-refinement-prompt-builder.strategy';
import { TaskArtifactService } from 'src/services/tasks/task-artifact.service';
import { InfluenceService } from 'src/services/influence/influence.service';
import { EntityRegistryService } from 'src/services/entity-registry/entity-registry.service';
import { EntityGraphEmbeddingMappingService } from 'src/services/entity-graph-embedding-mapping/entity-graph-embedding-mapping.service';
import { SuggestionDecisionService } from 'src/services/suggestion-decision.service';
import { GoalPmRoutingDecisionService } from 'src/services/goal-pm-routing-decision.service';
import { GoalPmRoutingEnactmentService } from 'src/services/goal-pm-routing-enactment.service';
import { OpenItemsTriageSessionService } from 'src/services/open-items/open-items-triage-session.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { AgentSessionCurrentStateProjection } from 'src/services/agent-session-current-state-projection.service';
import { ConversationPhaseProjection } from 'src/services/conversation-phase-projection.service';
import { AgentSessionCurrentStateReadService } from 'src/services/agent-session-current-state-read.service';
import { AgentSessionOutputAttentionProjection } from 'src/services/agent-session-output-attention-projection.service';
import { AgentSessionOutputAttentionService } from 'src/services/agent-session-output-attention.service';
import { CodingPromptService } from 'src/services/coding-prompt.service';
import { SubfacetService } from 'src/services/entity-summary/subfacet.service';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { EntityLifecycleProcessor } from 'src/core/processing/entity-lifecycle-processor.service';
import { SummarizationService } from 'src/services/summarization/summarization.service';
import { AnalyticsService } from 'src/services/analytics/analytics.service';
import { AttentionEventService } from 'src/services/analytics/attention-event.service';
import { TopologyAuditService } from 'src/services/audit/topology-audit.service';
import { TopologyCategorySummaryService } from 'src/services/topology/topology-category-summary.service';
import { Configuration as EmbeddingsConfiguration } from 'src/generated/embeddings/configuration';
import { SearchService as EmbeddingsSearchService } from 'src/generated/embeddings/api/search.service';
import { OrganizationLifecycleService as EmbeddingsLifecycleService } from 'src/generated/embeddings/api/organizationLifecycle.service';
import { MonitoringService as EmbeddingsMonitoringService } from 'src/generated/embeddings/api/monitoring.service';
import { DevelopmentService as EmbeddingsDevelopmentService } from 'src/generated/embeddings/api/development.service';
import { Configuration as GraphsConfiguration } from 'src/generated/graphs/configuration';
import { QueriesService as GraphsQueriesService } from 'src/generated/graphs/api/queries.service';
import { LifecycleService as GraphsLifecycleService } from 'src/generated/graphs/api/lifecycle.service';
import { TemplateGraphService } from 'src/generated/graphs/api/templateGraph.service';
import { AgentEdgesService as GraphsAgentEdgesService } from 'src/generated/graphs/api/agentEdges.service';
import { HintsService as GraphsHintsService } from 'src/generated/graphs/api/hints.service';
import { HintsConfig } from 'src/config/hints.config';
import { HintService } from 'src/services/hints/hint.service';
import { AgentEdgeClientService } from 'src/services/agent-edge-client.service';
import { ProjectModeEligibilityService } from 'src/services/tasks/project-mode-eligibility.service';
import { PlanDesignDocLinksService } from 'src/services/design-doc/plan-design-doc-links.service';
import { MentionProcessingService } from 'src/services/mentions/mention-processing.service';
import { MentionRelationService } from 'src/services/mentions/mention-relation.service';
import { ReportRetentionService } from 'src/services/reports/report-retention.service';
import { ReportService } from 'src/services/reports/report.service';
import { PlanLineageBoostService } from 'src/services/unified-search/plan-lineage-boost.service';
import { UnifiedSearchService } from 'src/services/unified-search/unified-search.service';
import { EntityStarService } from 'src/services/entity-star/entity-star.service';
import { TaskDependencyInferenceService } from 'src/services/tasks/task-dependency-inference.service';
import { SecondaryActionsService } from 'src/services/secondary-actions/secondary-actions.service';
import { ProposalService } from 'src/services/proposal/proposal.service';
import { ProjectApprovalPolicyService } from 'src/services/proposal/project-approval-policy.service';
import { ProposalGroupService } from 'src/services/proposal/proposal-group.service';
import { ProposalGroupCoordinatorService } from 'src/services/proposal/proposal-group-coordinator.service';
import { ProposalGroupAuthoringService } from 'src/services/proposal/proposal-group-authoring.service';
import { ProposalGroupFinalizationService } from 'src/services/proposal/proposal-group-finalization.service';
import { ProposalGroupDecisionService } from 'src/services/proposal/proposal-group-decision.service';
import { ProposalGroupLifecycleEventService } from 'src/services/proposal/proposal-group-lifecycle-event.service';
import { ProposalGroupReferenceValidation } from 'src/services/proposal/proposal-group-reference-validation';
import { ProposalApprovalService } from 'src/services/proposal/proposal-approval.service';
import { PlanStageBatchApprovalService } from 'src/services/proposal/plan-stage-batch-approval.service';
import { PlanStepBatchApprovalService } from 'src/services/proposal/plan-step-batch-approval.service';
import {
  PendingEdgeService,
  SERVICE_TOKEN_FACTORY,
} from 'src/services/proposal/pending-edge.service';
import { JwtKeysService } from 'src/auth/services/jwt-keys.service';
import { EntityContextService } from 'src/services/entity-context/entity-context.service';
import { EntityPromptTemplateService } from 'src/services/entity-prompt-template.service';
import { ProposalValidationEngine } from 'src/services/proposal/proposal-validation.engine';
import { WorkItemChangeSetProjectorService } from 'src/services/proposal/work-item-change-set-projector.service';
import { WorkItemChangeSetMaterializerService } from 'src/services/proposal/work-item-change-set-materializer.service';
import { ProposalVoteService } from 'src/services/proposal/proposal-vote.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { ValidationSessionService } from 'src/services/validation-session.service';
import { ActivityCorrelationService } from 'src/services/activity-correlation.service';
import { ActivityCorrelationAugmentationService } from 'src/services/activity-correlation/activity-correlation-augmentation.service';
import { ActivityCorrelationRecordAssemblerService } from 'src/services/activity-correlation/activity-correlation-record-assembler.service';
import { ActivityCorrelationSeedSelectorService } from 'src/services/activity-correlation/activity-correlation-seed-selector.service';
import { ActivityCorrelationTraversalService } from 'src/services/activity-correlation/activity-correlation-traversal.service';
import { ActivitySleepService } from 'src/services/activity-correlation/activity-sleep.service';
import { ActivityQueryService } from 'src/services/activity-correlation/activity-query.service';
import { ProjectReportActivityService } from 'src/services/project-reports/project-report-activity.service';
import { ProjectReportContextService } from 'src/services/project-reports/project-report-context.service';
import { ProjectReportPlacementService } from 'src/services/project-reports/project-report-placement.service';
import { ProjectReportRequestService } from 'src/services/project-reports/project-report-request.service';
import { ProjectReportSessionOutcomeListener } from 'src/services/project-reports/project-report-session-outcome.listener';
import { AcceptedEvidenceSelectorService } from 'src/services/project-metrics/accepted-evidence-selector.service';
import { ProjectMetricsService } from 'src/services/project-metrics/project-metrics.service';
import { PROJECT_METRICS_CLOCK } from 'src/services/project-metrics/project-metrics.types';

export const DOMAIN_SERVICES: Provider[] = [
  {
    provide: EmbeddingsConfiguration,
    useFactory: (configService: ConfigService) =>
      new EmbeddingsConfiguration({
        basePath: configService.get<string>(
          'EMBEDDINGS_SERVICE_URL',
          'http://localhost:5005',
        ),
      }),
    inject: [ConfigService],
  },
  {
    provide: GraphsConfiguration,
    useFactory: (configService: ConfigService) =>
      new GraphsConfiguration({
        basePath: configService.get<string>(
          'GRAPH_SERVICE_URL',
          'http://localhost:8081/api',
        ),
      }),
    inject: [ConfigService],
  },
  ActivityCorrelationService,
  ActivityCorrelationAugmentationService,
  ActivityCorrelationRecordAssemblerService,
  ActivityCorrelationSeedSelectorService,
  ActivityCorrelationTraversalService,
  ActivitySleepService,
  ActivityQueryService,
  ProjectReportActivityService,
  ProjectReportContextService,
  ProjectReportPlacementService,
  ProjectReportRequestService,
  ProjectReportSessionOutcomeListener,
  {
    provide: PROJECT_METRICS_CLOCK,
    useValue: () => new Date(),
  },
  AcceptedEvidenceSelectorService,
  ProjectMetricsService,
  PlanHierarchyRollupService,
  PlanDependenciesService,
  AgentEdgeClientService,
  ProjectModeEligibilityService,
  PlanDesignDocLinksService,
  ApiKeyService,
  ArchiveOrchestrationService,
  ArtifactAdapter,
  ArtifactDataService,
  ArtifactDataValidators,
  ArtifactGraphService,
  ArtifactService,
  EmbeddingsClientService,
  EmbeddingsSearchService,
  EmbeddingsLifecycleService,
  EmbeddingsMonitoringService,
  EmbeddingsDevelopmentService,
  GraphsClientService,
  GraphsQueriesService,
  GraphsLifecycleService,
  TemplateGraphService,
  GraphsAgentEdgesService,
  GraphsHintsService,
  HintsConfig,
  HintService,
  FeatureFlagService,
  EntityGraphEmbeddingMappingService,
  EntityRegistryService,
  InfluenceService,
  InitiativeArtifactService,
  InitiativeService,
  MessageService,
  OrganizationService,
  OrganizationProjectEntitlementService,
  AccountEntitlementService,
  PaymentProviderBindingService,
  PaymentProviderAdapterRegistry,
  PaymentEntitlementReconciliationService,
  {
    provide: PaymentEntitlementReconciliationOwner,
    useExisting: PaymentEntitlementReconciliationService,
  },
  OrganizationAccountLifecycleService,
  {
    provide: OrganizationAccountLifecycleOwner,
    useExisting: OrganizationAccountLifecycleService,
  },
  EmailService,
  PrivateBetaAccessNotificationService,
  ProjectService,
  ReportService,
  ReportRetentionService,
  SecurityLoggerService,
  TagService,
  TaskService,
  WorkItemGraphParticipationComposer,
  FeatureRequirementAuthoringService,
  GoalTracksService,
  WorkItemTypeImpactService,
  TaskSupersedeService,
  GoalMembershipService,
  WorkItemTypeRegistryService,
  WorkItemTypeLifecycleService,
  WorkItemParentageValidator,
  TaskArtifactService,
  TaskDependencyInferenceService,
  UserService,
  SuggestionDecisionService,
  GoalPmRoutingDecisionService,
  GoalPmRoutingEnactmentService,
  OpenItemsTriageSessionService,
  AgentSessionCurrentStateProjection,
  ConversationPhaseProjection,
  AgentSessionCurrentStateReadService,
  AgentSessionOutputAttentionProjection,
  AgentSessionOutputAttentionService,
  AgentSessionService,
  CodingPromptService,
  SubfacetService,
  EntitySummaryService,
  EntityLifecycleProcessor,
  SummarizationService,
  StandardPromptBuilderStrategy,
  InitiativeRefinementPromptBuilderStrategy,
  AnalyticsService,
  AttentionEventService,
  TopologyAuditService,
  TopologyCategorySummaryService,
  MentionProcessingService,
  MentionRelationService,
  PlanLineageBoostService,
  UnifiedSearchService,
  EntityStarService,
  SecondaryActionsService,
  DesignDocService,
  JwtKeysService,
  {
    provide: SERVICE_TOKEN_FACTORY,
    useFactory: (jwtKeys: JwtKeysService) => {
      return (organizationId: string, projectId: string) =>
        jwtKeys.getToken({ organizationId, projectId } as any, {
          expiresIn: '5m',
        });
    },
    inject: [JwtKeysService],
  },
  PendingEdgeService,
  ProposalService,
  ProjectApprovalPolicyService,
  ProposalGroupService,
  ProposalGroupCoordinatorService,
  ProposalGroupAuthoringService,
  ProposalGroupFinalizationService,
  ProposalGroupDecisionService,
  ProposalGroupLifecycleEventService,
  ProposalGroupReferenceValidation,
  ProposalReconciliationGroupService,
  ProposalReconciliationService,
  ProposalReconciliationAdapterService,
  ProposalApprovalService,
  PlanStageBatchApprovalService,
  PlanStepBatchApprovalService,
  ProposalValidationEngine,
  WorkItemChangeSetProjectorService,
  WorkItemChangeSetMaterializerService,
  ProposalVoteService,
  ValidationSessionService,
  EntityContextService,
  EntityPromptTemplateService,
];

export const DOMAIN_EXPORTS = [
  PlanDesignDocLinksService,
  EmbeddingsConfiguration,
  GraphsConfiguration,
  ActivityCorrelationService,
  ActivityCorrelationAugmentationService,
  ActivityCorrelationRecordAssemblerService,
  ActivityCorrelationSeedSelectorService,
  ActivityCorrelationTraversalService,
  ActivitySleepService,
  ActivityQueryService,
  ProjectReportActivityService,
  ProjectReportContextService,
  ProjectReportPlacementService,
  ProjectReportRequestService,
  ProjectReportSessionOutcomeListener,
  AcceptedEvidenceSelectorService,
  ProjectMetricsService,
  PlanHierarchyRollupService,
  PlanDependenciesService,
  AgentEdgeClientService,
  ProjectModeEligibilityService,
  ApiKeyService,
  ArchiveOrchestrationService,
  ArtifactAdapter,
  ArtifactDataService,
  ArtifactDataValidators,
  ArtifactGraphService,
  ArtifactService,
  EmbeddingsClientService,
  EmbeddingsSearchService,
  EmbeddingsLifecycleService,
  EmbeddingsMonitoringService,
  EmbeddingsDevelopmentService,
  GraphsClientService,
  GraphsQueriesService,
  GraphsLifecycleService,
  TemplateGraphService,
  GraphsAgentEdgesService,
  GraphsHintsService,
  HintsConfig,
  HintService,
  FeatureFlagService,
  EntityGraphEmbeddingMappingService,
  EntityRegistryService,
  InfluenceService,
  InitiativeArtifactService,
  InitiativeService,
  MessageService,
  OrganizationService,
  OrganizationProjectEntitlementService,
  AccountEntitlementService,
  PaymentProviderBindingService,
  PaymentProviderAdapterRegistry,
  PaymentEntitlementReconciliationOwner,
  PaymentEntitlementReconciliationService,
  OrganizationAccountLifecycleOwner,
  OrganizationAccountLifecycleService,
  EmailService,
  PrivateBetaAccessNotificationService,
  ProjectService,
  ReportService,
  SecurityLoggerService,
  TagService,
  TaskService,
  WorkItemGraphParticipationComposer,
  FeatureRequirementAuthoringService,
  GoalTracksService,
  WorkItemTypeImpactService,
  TaskSupersedeService,
  GoalMembershipService,
  WorkItemTypeRegistryService,
  WorkItemTypeLifecycleService,
  WorkItemParentageValidator,
  TaskArtifactService,
  TaskDependencyInferenceService,
  UserService,
  SuggestionDecisionService,
  GoalPmRoutingDecisionService,
  GoalPmRoutingEnactmentService,
  OpenItemsTriageSessionService,
  AgentSessionCurrentStateProjection,
  ConversationPhaseProjection,
  AgentSessionCurrentStateReadService,
  AgentSessionOutputAttentionProjection,
  AgentSessionOutputAttentionService,
  AgentSessionService,
  CodingPromptService,
  SubfacetService,
  EntitySummaryService,
  EntityLifecycleProcessor,
  SummarizationService,
  StandardPromptBuilderStrategy,
  InitiativeRefinementPromptBuilderStrategy,
  AnalyticsService,
  AttentionEventService,
  TopologyAuditService,
  TopologyCategorySummaryService,
  MentionProcessingService,
  MentionRelationService,
  PlanLineageBoostService,
  UnifiedSearchService,
  EntityStarService,
  SecondaryActionsService,
  DesignDocService,
  SERVICE_TOKEN_FACTORY,
  PendingEdgeService,
  ProposalService,
  ProjectApprovalPolicyService,
  ProposalGroupService,
  ProposalGroupCoordinatorService,
  ProposalGroupAuthoringService,
  ProposalGroupFinalizationService,
  ProposalGroupDecisionService,
  ProposalGroupReferenceValidation,
  ProposalReconciliationGroupService,
  ProposalReconciliationService,
  ProposalReconciliationAdapterService,
  ProposalApprovalService,
  PlanStageBatchApprovalService,
  PlanStepBatchApprovalService,
  ProposalValidationEngine,
  WorkItemChangeSetProjectorService,
  WorkItemChangeSetMaterializerService,
  ProposalVoteService,
  ValidationSessionService,
  EntityContextService,
  EntityPromptTemplateService,
];
