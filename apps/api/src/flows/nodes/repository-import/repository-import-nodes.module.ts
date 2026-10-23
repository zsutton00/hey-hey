import { Module, OnModuleInit } from '@nestjs/common';
import { ContextModule } from '../../../context/context.module';
import { MachinePairingModule } from '../../../services/machine-pairing/machine-pairing.module';
import { ServiceModule } from '../../../services/service/service.module';
import { WorkItemModule } from '../../../services/work-item.module';
import { FeatureListLifecycleService } from '../../../services/feature-list/feature-list-lifecycle.service';
import { NodeRegistry } from '../node-registry.service';
import { OnboardingRepositoryGroundingPrerequisitesNode } from '../onboarding/repository-grounding-prerequisites.node';
import { OnboardingRepositoryGroundingConfigurationNode } from '../onboarding/repository-grounding-configuration.node';
import { OnboardingRepositoryGroundingStartNode } from '../onboarding/repository-grounding-start.node';
import { OnboardingRepositoryGroundingAnalysisNode } from '../onboarding/repository-grounding-analysis.node';
import { OnboardingRepositoryGroundingRecoveryNode } from '../onboarding/repository-grounding-recovery.node';
import { RepositoryFeatureEnrichmentNode } from '../onboarding/repository-feature-enrichment.node';
import { RepositoryFeatureEnrichmentQuestionsNode } from '../onboarding/repository-feature-enrichment-questions.node';
import { RepositoryFeatureEnrichmentRecoveryNode } from '../onboarding/repository-feature-enrichment-recovery.node';
import { RepositoryGroundingPlacementStrategyNode } from '../onboarding/repository-grounding-placement-strategy.node';
import { RepositoryGroundingPlacementNode } from '../onboarding/repository-grounding-placement.node';
import { RepositoryGroundingPlacementReviewNode } from '../onboarding/repository-grounding-placement-review.node';
import {
  RepositoryImportEndNode,
  RepositoryImportFinalizeNode,
} from './repository-import-finalize.node';
import { RepositoryImportGenerateFeaturesNode } from './repository-import-generate-features.node';

import { RepositoryImportEnrichmentChoiceNode } from './repository-import-enrichment-choice.node';
import { RepositoryImportFirstWorkQuestionNode } from './repository-import-first-work-question.node';
import { RepositoryImportFirstWorkNode } from './repository-import-first-work.node';
import { RepositoryImportFirstWorkFollowUpNode } from './repository-import-first-work-follow-up.node';
import { RepositoryImportFirstWorkRecoveryNode } from './repository-import-first-work-recovery.node';

const providers = [
  RepositoryImportEnrichmentChoiceNode,
  FeatureListLifecycleService,
  OnboardingRepositoryGroundingPrerequisitesNode,
  OnboardingRepositoryGroundingConfigurationNode,
  OnboardingRepositoryGroundingStartNode,
  OnboardingRepositoryGroundingAnalysisNode,
  OnboardingRepositoryGroundingRecoveryNode,
  RepositoryFeatureEnrichmentNode,
  RepositoryFeatureEnrichmentQuestionsNode,
  RepositoryFeatureEnrichmentRecoveryNode,
  RepositoryImportGenerateFeaturesNode,
  RepositoryGroundingPlacementStrategyNode,
  RepositoryGroundingPlacementNode,
  RepositoryGroundingPlacementReviewNode,
  RepositoryImportFinalizeNode,
  RepositoryImportFirstWorkQuestionNode,
  RepositoryImportFirstWorkNode,
  RepositoryImportFirstWorkFollowUpNode,
  RepositoryImportFirstWorkRecoveryNode,
  RepositoryImportEndNode,
];

@Module({
  imports: [ContextModule, WorkItemModule, MachinePairingModule, ServiceModule],
  providers,
  exports: providers,
})
export class RepositoryImportNodesModule implements OnModuleInit {
  constructor(
    private readonly registry: NodeRegistry,
    private readonly prerequisites: OnboardingRepositoryGroundingPrerequisitesNode,
    private readonly configuration: OnboardingRepositoryGroundingConfigurationNode,
    private readonly start: OnboardingRepositoryGroundingStartNode,
    private readonly analysis: OnboardingRepositoryGroundingAnalysisNode,
    private readonly recovery: OnboardingRepositoryGroundingRecoveryNode,
    private readonly enrichmentChoice: RepositoryImportEnrichmentChoiceNode,
    private readonly enrichment: RepositoryFeatureEnrichmentNode,
    private readonly enrichmentQuestions: RepositoryFeatureEnrichmentQuestionsNode,
    private readonly enrichmentRecovery: RepositoryFeatureEnrichmentRecoveryNode,
    private readonly generateFeatures: RepositoryImportGenerateFeaturesNode,
    private readonly placementStrategy: RepositoryGroundingPlacementStrategyNode,
    private readonly placement: RepositoryGroundingPlacementNode,
    private readonly placementReview: RepositoryGroundingPlacementReviewNode,
    private readonly finalize: RepositoryImportFinalizeNode,
    private readonly firstWorkQuestion: RepositoryImportFirstWorkQuestionNode,
    private readonly firstWork: RepositoryImportFirstWorkNode,
    private readonly firstWorkFollowUp: RepositoryImportFirstWorkFollowUpNode,
    private readonly firstWorkRecovery: RepositoryImportFirstWorkRecoveryNode,
    private readonly end: RepositoryImportEndNode,
  ) {}

  onModuleInit(): void {
    [
      this.prerequisites,
      this.configuration,
      this.start,
      this.analysis,
      this.recovery,
      this.enrichmentChoice,
      this.enrichment,
      this.enrichmentQuestions,
      this.enrichmentRecovery,
      this.generateFeatures,
      this.placementStrategy,
      this.placement,
      this.placementReview,
      this.finalize,
      this.firstWorkQuestion,
      this.firstWork,
      this.firstWorkFollowUp,
      this.firstWorkRecovery,
      this.end,
    ].forEach((node) => this.registry.register(node));
  }
}
