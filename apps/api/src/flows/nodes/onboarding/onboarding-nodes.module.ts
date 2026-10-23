import { Module, OnModuleInit } from '@nestjs/common';
import { ContextModule } from '../../../context/context.module';
import { WorkItemModule } from '../../../services/work-item.module';
import { PlanModule } from '../../../services/plan/plan.module';
import { NodeRegistry } from '../node-registry.service';
import { OnboardingAnalyzeProjectConceptNode } from './onboarding-analyze-project-concept.node';
import { OnboardingClarifyConceptNode } from './onboarding-clarify-concept.node';
import { OnboardingEndNode } from './onboarding-end.node';
import { OnboardingFinalizeNode } from './onboarding-finalize.node';
import { OnboardingGenerateFeaturesNode } from './onboarding-generate-features.node';
import { OnboardingGeneratePlansNode } from './onboarding-generate-plans.node';
import { OnboardingCreatePlansNode } from './onboarding-create-plans.node';
import { OnboardingRecoveryNode } from './onboarding-recovery.node';
import { OnboardingWelcomeNode } from './onboarding-welcome.node';
import { FeatureListLifecycleService } from '../../../services/feature-list/feature-list-lifecycle.service';
import { OnboardingNextStepsService } from '../../../services/onboarding-next-steps.service';
import { OnboardingRepositoryGroundingIntentNode } from './repository-grounding-intent.node';

/**
 * Module for onboarding flow nodes
 *
 * Registers all onboarding-related nodes with the NodeRegistry
 * during module initialization.
 *
 * Imports:
 * - ContextModule: Provides context services
 * - WorkflowModule: Provides ConversationService, ConversationValidation, and workflow services
 * - WorkItemModule: Provides InitiativeService and other work item services
 */
@Module({
  imports: [ContextModule, WorkItemModule, PlanModule],
  providers: [
    OnboardingWelcomeNode,
    OnboardingEndNode,
    OnboardingGenerateFeaturesNode,
    FeatureListLifecycleService,
    OnboardingNextStepsService,
    OnboardingGeneratePlansNode,
    OnboardingCreatePlansNode,
    OnboardingClarifyConceptNode,
    OnboardingAnalyzeProjectConceptNode,
    OnboardingFinalizeNode,
    OnboardingRecoveryNode,
    OnboardingRepositoryGroundingIntentNode,
  ],
  exports: [
    OnboardingWelcomeNode,
    OnboardingEndNode,
    OnboardingGenerateFeaturesNode,
    FeatureListLifecycleService,
    OnboardingGeneratePlansNode,
    OnboardingCreatePlansNode,
    OnboardingClarifyConceptNode,
    OnboardingAnalyzeProjectConceptNode,
    OnboardingFinalizeNode,
    OnboardingRecoveryNode,
    OnboardingRepositoryGroundingIntentNode,
  ],
})
export class OnboardingNodesModule implements OnModuleInit {
  constructor(
    private nodeRegistry: NodeRegistry,
    private welcomeNode: OnboardingWelcomeNode,
    private endNode: OnboardingEndNode,
    private generateFeaturesNode: OnboardingGenerateFeaturesNode,
    private generatePlansNode: OnboardingGeneratePlansNode,
    private createPlansNode: OnboardingCreatePlansNode,
    private clarifyConceptNode: OnboardingClarifyConceptNode,
    private analyzeProjectConceptNode: OnboardingAnalyzeProjectConceptNode,
    private finalizeNode: OnboardingFinalizeNode,
    private recoveryNode: OnboardingRecoveryNode,
    private repositoryGroundingIntentNode: OnboardingRepositoryGroundingIntentNode,
  ) {}

  onModuleInit() {
    // Register all onboarding nodes with the registry
    this.nodeRegistry.register(this.welcomeNode);
    this.nodeRegistry.register(this.endNode);
    this.nodeRegistry.register(this.generateFeaturesNode);
    this.nodeRegistry.register(this.generatePlansNode);
    this.nodeRegistry.register(this.createPlansNode);
    this.nodeRegistry.register(this.clarifyConceptNode);
    this.nodeRegistry.register(this.analyzeProjectConceptNode);
    this.nodeRegistry.register(this.finalizeNode);
    this.nodeRegistry.register(this.recoveryNode);
    this.nodeRegistry.register(this.repositoryGroundingIntentNode);
  }
}
