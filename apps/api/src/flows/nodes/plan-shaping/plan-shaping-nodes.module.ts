import { Module, OnModuleInit } from '@nestjs/common';
import { PlanModule } from '../../../services/plan/plan.module';
import { NodeRegistry } from '../node-registry.service';
import { PlanShapingFeatureSyncAnalyzeNode } from './feature-sync-analyze.node';
import { PlanShapingFeatureSyncIterateNode } from './feature-sync-iterate.node';
import { PlanShapingFeatureSyncReviewNode } from './feature-sync-review.node';
import { PlanShapingFinalizeNode } from './finalize.node';
import { PlanShapingVisualPreviewNode } from './visual-preview.node';
import { PlanShapingVisualPreviewFeedbackNode } from './visual-preview-feedback.node';
import { PlanShapingPhaseBreakdownNode } from './phase-breakdown.node';
import { PlanShapingStepReviewNode } from './step-review.node';
import { PlanShapingProposedStagesNode } from './proposed-stages.node';
import { PlanShapingProposedStagesFeedbackNode } from './proposed-stages-feedback.node';

/**
 * Registers the post-design-doc plan-shaping nodes used by the
 * plan-from-design-doc workflow:
 *
 *   proposed-stages (opening node — the conversation's Run is bound up
 *     front by the `startConversationRun` materialize-only workflow arm,
 *     which fires no turn, so the first SYSTEM trigger lands in a live
 *     Run; there is no in-graph opening gate)
 *     → proposed-stages-feedback (QUESTIONS review gate)
 *     → visual-preview → visual-preview-feedback (QUESTIONS review gate)
 *     → phase-breakdown* (accumulation-driven self-loop)
 *     → step-review* (per-stage tightening self-loop)
 *     → finalize
 *
 * The QUESTIONS gates are user-driven so routing stays driven by the
 * user's button click. phase-breakdown's per-action routing hook derives
 * the next phase index from `FlowContext.accumulatedPhases`, and
 * step-review's hook derives the next stage index from
 * `FlowContext.reviewedStages`. Batched materialization runs on
 * step-review's loop exit so the per-stage tightening sweep can rewrite
 * each stage's accumulated steps before they land.
 */
@Module({
  imports: [PlanModule],
  providers: [
    PlanShapingFeatureSyncAnalyzeNode,
    PlanShapingFeatureSyncReviewNode,
    PlanShapingFeatureSyncIterateNode,
    PlanShapingProposedStagesNode,
    PlanShapingProposedStagesFeedbackNode,
    PlanShapingVisualPreviewNode,
    PlanShapingVisualPreviewFeedbackNode,
    PlanShapingPhaseBreakdownNode,
    PlanShapingStepReviewNode,
    PlanShapingFinalizeNode,
  ],
  exports: [
    PlanShapingFeatureSyncAnalyzeNode,
    PlanShapingFeatureSyncReviewNode,
    PlanShapingFeatureSyncIterateNode,
    PlanShapingProposedStagesNode,
    PlanShapingProposedStagesFeedbackNode,
    PlanShapingVisualPreviewNode,
    PlanShapingVisualPreviewFeedbackNode,
    PlanShapingPhaseBreakdownNode,
    PlanShapingStepReviewNode,
    PlanShapingFinalizeNode,
  ],
})
export class PlanShapingNodesModule implements OnModuleInit {
  constructor(
    private readonly nodeRegistry: NodeRegistry,
    private readonly featureSyncAnalyzeNode: PlanShapingFeatureSyncAnalyzeNode,
    private readonly featureSyncReviewNode: PlanShapingFeatureSyncReviewNode,
    private readonly featureSyncIterateNode: PlanShapingFeatureSyncIterateNode,
    private readonly proposedStagesNode: PlanShapingProposedStagesNode,
    private readonly proposedStagesFeedbackNode: PlanShapingProposedStagesFeedbackNode,
    private readonly visualPreviewNode: PlanShapingVisualPreviewNode,
    private readonly visualPreviewFeedbackNode: PlanShapingVisualPreviewFeedbackNode,
    private readonly phaseBreakdownNode: PlanShapingPhaseBreakdownNode,
    private readonly stepReviewNode: PlanShapingStepReviewNode,
    private readonly finalizeNode: PlanShapingFinalizeNode,
  ) {}

  onModuleInit(): void {
    this.nodeRegistry.register(this.featureSyncAnalyzeNode);
    this.nodeRegistry.register(this.featureSyncReviewNode);
    this.nodeRegistry.register(this.featureSyncIterateNode);
    this.nodeRegistry.register(this.proposedStagesNode);
    this.nodeRegistry.register(this.proposedStagesFeedbackNode);
    this.nodeRegistry.register(this.visualPreviewNode);
    this.nodeRegistry.register(this.visualPreviewFeedbackNode);
    this.nodeRegistry.register(this.phaseBreakdownNode);
    this.nodeRegistry.register(this.stepReviewNode);
    this.nodeRegistry.register(this.finalizeNode);
  }
}
