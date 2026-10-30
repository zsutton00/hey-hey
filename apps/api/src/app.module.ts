import { WorkspaceSkillsController } from './controllers/workspace-skills.controller';
import { RuntimeModelCatalogController } from './controllers/runtime-model-catalog.controller';
import { RuntimeModelCatalogReadService } from './services/runtime-model-catalog-read.service';
import { WorkspaceSkillsReadService } from './services/workspace-skills-read.service';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { OAuthModule } from './auth/oauth/oauth.module';
import {
  ApiKeyThrottlerGuard,
  isGlobalRateLimitingEnabled,
} from './auth/guards/api-key-throttler.guard';
import { FlexibleAuthGuard } from './auth/guards/flexible-auth.guard';
import { ScopePathParamsGuard } from './auth/guards/scope-path-params.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { CustomLoggerService } from './common/logger/logger.service';
import { ContextModule } from './context/context.module';
import { AdminOutboxController } from './controllers/admin-outbox.controller';
import { AgentCallbackController } from './controllers/agent-callback.controller';
import { AgentEdgeController } from './controllers/agent-edge.controller';
import { ApiKeyController } from './controllers/api-key.controller';
import { MachineController } from './controllers/machine.controller';
import { ArtifactController } from './controllers/artifact.controller';
import { AdminController } from './controllers/admin.controller';
import { DemoSandboxController } from './controllers/demo-sandbox.controller';
import { DemoTemplateController } from './controllers/demo-template.controller';
import { AdminHintController } from './controllers/admin-hint.controller';
import { AdminImplementationHintController } from './controllers/admin-implementation-hint.controller';
import { PlatformAdminAccessController } from './controllers/platform-admin-access.controller';
import { BotCheckService } from './services/demo-sandbox/bot-check.service';
import { DemoSandboxAdmissionService } from './services/demo-sandbox/demo-sandbox-admission.service';
import { DemoSandboxDiscardService } from './services/demo-sandbox/demo-sandbox-discard.service';
import { DemoSandboxLifecycleService } from './services/demo-sandbox/demo-sandbox-lifecycle.service';
import { DemoSandboxProgramService } from './services/demo-sandbox/demo-sandbox-program.service';
import { DemoSandboxReadinessService } from './services/demo-sandbox/demo-sandbox-readiness.service';
import { DemoTemplateService } from './services/demo-sandbox/demo-template.service';
import { ProjectTemplateCloneService } from './services/demo-sandbox/project-template-clone.service';
import { DemoTemplateGraphService } from './services/demo-sandbox/template-graph.service';
import { AuthController } from './controllers/auth.controller';
import { AnalyticsController } from './controllers/analytics.controller';
import { ConversationController } from './controllers/conversation.controller';
import { OnboardingReplyController } from './controllers/onboarding-reply.controller';
import { RepositoryImportReplyController } from './controllers/repository-import-reply.controller';
import { WorkTrackerImportReplyController } from './controllers/work-tracker-import-reply.controller';
import { DebugController } from './controllers/debug.controller';
import { DesignDocController } from './controllers/design-doc.controller';
import { LLMTrackingController } from './controllers/llm-tracking.controller';
import { InitiativeRefinementController } from './controllers/initiative-refinement.controller';
import { EntitySearchController } from './controllers/entity-search.controller';
import { UnifiedSearchController } from './controllers/unified-search.controller';
import {
  ConversationInitiativeController,
  InitiativeController,
} from './controllers/initiative.controller';
import { MessageController } from './controllers/message.controller';
import { OrganizationController } from './controllers/organization.controller';
import { ProjectController } from './controllers/project.controller';
import { QueueController } from './controllers/queue.controller';
import {
  ProjectReportsController,
  ReportController,
} from './controllers/report.controller';
import { NotificationController } from './controllers/notification.controller';
import {
  ArtifactTagController,
  InitiativeTagController,
  ProjectTagController,
  TagController,
} from './controllers/tag.controller';
import { WebhookController } from './controllers/webhook.controller';
import { PaymentProviderWebhookController } from './controllers/payment-provider-webhook.controller';
import { SuggestionController } from './controllers/suggestion.controller';
import { GoalPmRoutingDecisionController } from './controllers/goal-pm-routing-decision.controller';
import { GoalPmRoutingEnactmentController } from './controllers/goal-pm-routing-enactment.controller';
import { OpenItemsTriageSessionController } from './controllers/open-items-triage-session.controller';
import { AgentSessionController } from './controllers/agent-session.controller';
import {
  AgentInteractionController,
  AgentInteractionReadController,
  AgentSessionTurnAdmissionController,
  SubagentDispatchController,
  SubagentDispatchScopesController,
  SubagentInteractionController,
  SessionMessageInteractionController,
  SessionMessageTargetController,
} from './controllers/agent-interaction.controller';
import { AgentInteractionAdmissionService } from './services/agent-interaction/agent-interaction-admission.service';
import { AgentSessionCurrentStateController } from './controllers/agent-session-current-state.controller';
import { AgentSessionOutputAttentionController } from './controllers/agent-session-output-attention.controller';
import { SecondaryActionsController } from './controllers/secondary-actions.controller';
import { CodingPromptController } from './controllers/coding-prompt.controller';
import { ImplementationHintController } from './controllers/implementation-hint.controller';
import { ServiceController } from './controllers/service.controller';
import {
  TopologyController,
  TopologyQueryController,
} from './controllers/topology.controller';
import { SummaryDebugController } from './controllers/summary-debug.controller';
import { ActivityCorrelationController } from './controllers/activity-correlation.controller';
import { HelpController } from './controllers/help.controller';
import { WorkflowController } from './controllers/workflow.controller';
import { ExecutionController } from './controllers/execution.controller';
import { EntityStarController } from './controllers/entity-star.controller';
import { ProposalController } from './controllers/proposal.controller';
import { ProposalGroupController } from './controllers/proposal-group.controller';
import { ProposalGroupAuthoringController } from './controllers/proposal-group-authoring.controller';
import { WorkItemTypeController } from './controllers/work-item-type.controller';
import {
  EntityContextController,
  FeatureSyncContextController,
  ProjectFeaturesController,
  ProjectGoalsController,
} from './controllers/entity-context.controller';
import { ValidationSessionController } from './controllers/validation-session.controller';
import { WorkItemPlanGenerationController } from './controllers/work-item-plan-generation.controller';
import { CoreModule } from './core/core.module';
import { OutboxPublisherModule } from './core/events/outbox-publisher.module';
import { ProcessingModule } from './core/processing/processing.module';
import { WebsocketsModule } from './core/websockets/websockets.module';
import { CoreDomainModule } from './domain/core-domain.module';
import { IntegrationModule } from './integration/integration.module';
import { StagedContentModule } from './modules/staged-content.module';
import { OpenItemsModule } from './services/open-items/open-items.module';
import { WorkflowTimelineModule } from './modules/workflow-timeline.module';
import { TemporalModule } from './prisma/temporal.module';
import { LoggerModule } from './common/logger/logger.module';
import { LoggingModule } from './core/logging/logging.module';
import { DependencyAnalyzer } from './services/dependency-analyzer.service';
import { KeyProviderFactory } from './services/encryption/key-provider.factory';
import { ServiceModule } from './services/service/service.module';
import { PlanModule } from './services/plan/plan.module';
import { WorkItemModule } from './services/work-item.module';
import { WorkflowModule } from './services/workflows/workflow.module';
import { TopologyConsolidationSchedulerService } from './services/topology/topology-consolidation-scheduler.service';
import { SubfacetCandidateService } from './services/entity-summary/subfacet-candidate.service';
import { SubfacetLifecycleService } from './services/entity-summary/subfacet-lifecycle.service';
import { SubfacetService } from './services/entity-summary/subfacet.service';
import { GoalTracksService } from './services/tasks/goal-tracks.service';
import { WorkItemTypeImpactService } from './services/tasks/work-item-type-impact.service';
import { TrackingCleanupWorkerService } from './services/tasks/tracking-cleanup-worker.service';
import { WorkItemTypeCascadeExecutionWorkerService } from './services/tasks/work-item-type-cascade-execution-worker.service';
import { OrganizationClosureDueWorkService } from './services/organization-closure-due-work.service';
import { OrganizationAccountDataDeletionOwner } from './services/organization-account-data-deletion.owner';
import { OrganizationAccountDataDeletionService } from './services/organization-account-data-deletion.service';
import { OrganizationClosureWorkerService } from './services/organization-closure-worker.service';
import { OrganizationProjectionDeletionCoordinatorService } from './services/organization-projection-deletion-coordinator.service';
import { InteractionHelper } from './utils/interaction.helper';
import { AnalyticsService } from './services/analytics/analytics.service';
import { BetaOnboardingService } from './services/beta-onboarding.service';
import { HelpContentBootstrapService } from './services/help-content-bootstrap.service';
import { HelpAssetService } from './services/help-asset.service';
import { HelpService } from './services/help.service';
import { McpServerModule } from './mcp/mcp-server.module';
import { MachineEnrollmentClaimModule } from './services/machine-pairing/machine-enrollment-claim.module';
import { MachineEnrollmentConfirmationModule } from './services/machine-pairing/machine-enrollment-confirmation.module';
import { MachinePairingModule } from './services/machine-pairing/machine-pairing.module';
import { MachineSecurityEventModule } from './services/machine-security-events/machine-security-event.module';
import { ControllerAuthorizationModule } from './services/controller-authorization/controller-authorization.module';
import { ControllerManagementModule } from './services/controller-management/controller-management.module';
import { MachineEffectAdmissionModule } from './services/machine-effect-admission/machine-effect-admission.module';
import { TaskMonitorCommandController } from './controllers/task-monitor-command.controller';
import { TaskMonitorCommandService } from './services/task-monitor-command.service';
import { TaskMonitorJudgmentResponseService } from './services/task-monitor-judgment-response.service';
import { ReportBugController } from './controllers/report-bug.controller';
import { ReportBugService } from './services/report-bug.service';
import { UserSettingsController } from './controllers/user-settings.controller';
import { UserSettingsService } from './services/user-settings.service';
import { EntityPromptTemplateController } from './controllers/entity-prompt-template.controller';
import { EntityPromptTemplateService } from './services/entity-prompt-template.service';
import { PrivateBetaAccessController } from './controllers/private-beta-access.controller';
import { PrivateBetaAccessService } from './services/private-beta-access.service';
import { PrivateBetaAccessReviewController } from './controllers/private-beta-access-review.controller';
import { PrivateBetaAccessReviewService } from './services/private-beta-access-review.service';
import { PrivateBetaAccessDecisionController } from './controllers/private-beta-access-decision.controller';
import { PrivateBetaAccessDecisionService } from './services/private-beta-access-decision.service';
import { PrivateBetaAccessProgramController } from './controllers/private-beta-access-program.controller';
import { PrivateBetaAccessProgramService } from './services/private-beta-access-program.service';
import { PrivateBetaDisclosureController } from './controllers/private-beta-disclosure.controller';
import { PrivateBetaDisclosureService } from './services/private-beta-disclosure.service';
import { AgentOperationModule } from './services/agent-operation/agent-operation.module';
import { EventReplayRepairService } from './services/events/event-replay-repair.service';
import { OnboardingReplyFormValidator } from './services/onboarding-reply-form-validator';
import { OnboardingReplyService } from './services/onboarding-reply.service';
import { RepositoryImportReplyFormValidator } from './services/repository-import-reply-form-validator';
import { RepositoryImportReplyService } from './services/repository-import-reply.service';
import { WorkTrackerImportReplyService } from './services/work-tracker-import-reply.service';
import { SessionMonitorDecisionController } from './controllers/session-monitor-decision.controller';
import { TaskMonitorMachineEffectController } from './controllers/task-monitor-machine-effect.controller';
import { SessionMonitorDecisionService } from './services/session-monitor-decision/session-monitor-decision.service';
import { ExternalAgentCompletionController } from './controllers/external-agent-completion.controller';
import { ExternalAgentCompletionService } from './services/external-agent-completion/external-agent-completion.service';
import { ProjectMetricsController } from './controllers/project-metrics.controller';
import { EvalRunController } from './controllers/eval-run.controller';
import { EvalOutputAdmissionService } from './services/eval/eval-output-admission.service';
import { EvalRunService } from './services/eval-runs/eval-run.service';
import { ProposalAgentFixService } from './services/proposal/proposal-agent-fix.service';
import { ProjectReportRequestController } from './controllers/project-report-request.controller';
import { ProjectReportLaunchService } from './services/project-reports/project-report-launch.service';
import { MetricsModule } from './core/metrics/metrics.module';
import { TypeSafeJevModule } from './services/typesafe-jev/typesafe-jev.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 3600000, // 1 hour in milliseconds
        limit: isGlobalRateLimitingEnabled() ? 2000 : 0,
      },
    ]),
    LoggerModule, // Import FIRST so CustomLoggerService is available
    LoggingModule, // Import SECOND so it can use CustomLoggerService
    MetricsModule,
    CoreModule,
    WebsocketsModule,
    AuthModule,
    OAuthModule,
    OutboxPublisherModule,
    CoreDomainModule,
    WorkflowModule,
    ProcessingModule,
    WorkItemModule,
    ServiceModule,
    PlanModule,
    IntegrationModule,
    StagedContentModule,
    OpenItemsModule,
    WorkflowTimelineModule,
    TemporalModule,
    ContextModule,
    McpServerModule,
    MachineEnrollmentClaimModule,
    MachineEnrollmentConfirmationModule,
    MachinePairingModule,
    MachineSecurityEventModule,
    ControllerAuthorizationModule,
    ControllerManagementModule,
    MachineEffectAdmissionModule,
    AgentOperationModule,
    TypeSafeJevModule,
  ],
  controllers: [
    WorkspaceSkillsController,
    RuntimeModelCatalogController,
    AdminController,
    PlatformAdminAccessController,
    AdminImplementationHintController,
    AdminHintController,
    DemoTemplateController,
    DemoSandboxController,
    AuthController,
    AgentCallbackController,
    AgentEdgeController,
    ApiKeyController,
    MachineController,
    AnalyticsController,
    OrganizationController,
    ProjectMetricsController,
    QueueController,
    ProjectController,
    ReportController,
    ProjectReportsController,
    ProjectReportRequestController,
    EvalRunController,
    NotificationController,
    DesignDocController,
    InitiativeController,
    ConversationInitiativeController,
    InitiativeRefinementController,
    MessageController,
    ConversationController,
    OnboardingReplyController,
    RepositoryImportReplyController,
    WorkTrackerImportReplyController,
    ArtifactController,
    DebugController,
    LLMTrackingController,
    AdminOutboxController,
    TagController,
    ArtifactTagController,
    InitiativeTagController,
    ProjectTagController,
    WebhookController,
    PaymentProviderWebhookController,
    SuggestionController,
    GoalPmRoutingDecisionController,
    GoalPmRoutingEnactmentController,
    OpenItemsTriageSessionController,
    AgentSessionController,
    AgentInteractionController,
    AgentInteractionReadController,
    SubagentDispatchController,
    SubagentDispatchScopesController,
    SubagentInteractionController,
    SessionMessageInteractionController,
    SessionMessageTargetController,
    AgentSessionTurnAdmissionController,
    AgentSessionCurrentStateController,
    AgentSessionOutputAttentionController,
    SecondaryActionsController,
    CodingPromptController,
    ImplementationHintController,
    ServiceController,
    TopologyController,
    TopologyQueryController,
    SummaryDebugController,
    ActivityCorrelationController,
    HelpController,
    EntitySearchController,
    EntityStarController,
    UnifiedSearchController,
    WorkflowController,
    ExecutionController,
    WorkItemPlanGenerationController,
    ProposalController,
    ProposalGroupController,
    ProposalGroupAuthoringController,
    WorkItemTypeController,
    EntityContextController,
    FeatureSyncContextController,
    ProjectFeaturesController,
    ProjectGoalsController,
    ValidationSessionController,
    TaskMonitorCommandController,
    ReportBugController,
    UserSettingsController,
    EntityPromptTemplateController,
    PrivateBetaAccessController,
    PrivateBetaAccessReviewController,
    PrivateBetaAccessDecisionController,
    PrivateBetaAccessProgramController,
    PrivateBetaDisclosureController,
    SessionMonitorDecisionController,
    TaskMonitorMachineEffectController,
    ExternalAgentCompletionController,
  ],
  providers: [
    WorkspaceSkillsReadService,
    RuntimeModelCatalogReadService,
    CustomLoggerService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: FlexibleAuthGuard,
    },
    // Must follow FlexibleAuthGuard (401 first) and precede route access
    // guards, so malformed scope ids get 400 rather than a membership 403.
    {
      provide: APP_GUARD,
      useClass: ScopePathParamsGuard,
    },
    ...(isGlobalRateLimitingEnabled()
      ? [
          {
            provide: APP_GUARD,
            useClass: ApiKeyThrottlerGuard,
          },
        ]
      : []),
    BetaOnboardingService,
    DemoTemplateService,
    BotCheckService,
    DemoSandboxAdmissionService,
    DemoSandboxDiscardService,
    DemoSandboxLifecycleService,
    DemoSandboxProgramService,
    DemoSandboxReadinessService,
    ProjectTemplateCloneService,
    DemoTemplateGraphService,
    InteractionHelper,
    DependencyAnalyzer,
    KeyProviderFactory,
    AnalyticsService,
    HelpContentBootstrapService,
    HelpAssetService,
    HelpService,
    TopologyConsolidationSchedulerService,
    SubfacetCandidateService,
    SubfacetLifecycleService,
    SubfacetService,
    GoalTracksService,
    WorkItemTypeImpactService,
    TrackingCleanupWorkerService,
    WorkItemTypeCascadeExecutionWorkerService,
    OrganizationClosureDueWorkService,
    OrganizationAccountDataDeletionService,
    {
      provide: OrganizationAccountDataDeletionOwner,
      useExisting: OrganizationAccountDataDeletionService,
    },
    OrganizationProjectionDeletionCoordinatorService,
    OrganizationClosureWorkerService,
    TaskMonitorCommandService,
    TaskMonitorJudgmentResponseService,
    ReportBugService,
    UserSettingsService,
    EntityPromptTemplateService,
    PrivateBetaAccessService,
    PrivateBetaAccessReviewService,
    PrivateBetaAccessDecisionService,
    PrivateBetaAccessProgramService,
    PrivateBetaDisclosureService,
    EventReplayRepairService,
    OnboardingReplyFormValidator,
    OnboardingReplyService,
    RepositoryImportReplyFormValidator,
    RepositoryImportReplyService,
    WorkTrackerImportReplyService,
    SessionMonitorDecisionService,
    AgentInteractionAdmissionService,
    ExternalAgentCompletionService,
    ProjectReportLaunchService,
    EvalOutputAdmissionService,
    EvalRunService,
    ProposalAgentFixService,
  ],
})
export class AppModule {}
