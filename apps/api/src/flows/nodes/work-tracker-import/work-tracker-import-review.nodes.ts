import { Injectable, Logger } from '@nestjs/common';
import {
  RepositoryGroundingEntryMode,
  RepositoryPlacementIntelligentlyIntegrateSubmission,
} from '../../../generated';
import { FeatureListLifecycleService } from '../../../services/feature-list/feature-list-lifecycle.service';
import {
  FlowUserMessage,
  IntermediateSystemMessageData,
  MutableContextHandle,
  NodeResult,
  NodeType,
  RepositoryImportFlowContext,
  WorkTrackerImportFlowContext,
} from '../../../types/flow-internal.types';
import { WORK_TRACKER_IMPORT_NODES } from '../../constants/node-ids';
import { FinalizeNodeBase } from '../base';
import { OnboardingGenerateFeaturesNode } from '../onboarding/onboarding-generate-features.node';
import {
  getRepositoryGroundingAnswers,
  parseRepositoryPlacementStrategy,
  REPOSITORY_PLACEMENT_FIELDS,
} from '../onboarding/repository-grounding.contract';
import { RepositoryGroundingPlacementStrategyNode } from '../onboarding/repository-grounding-placement-strategy.node';
import { mapWorkTrackerSuccessToFeatureGeneration } from './work-tracker-import.contract';

function isExistingProject(context: Readonly<RepositoryImportFlowContext>) {
  return (
    (context as WorkTrackerImportFlowContext).workTrackerImportEntry
      ?.entryMode === RepositoryGroundingEntryMode.ExistingProject
  );
}

/** Import-owned adapter around the shared Feature outline review. */
@Injectable()
export class WorkTrackerImportGenerateFeaturesNode extends OnboardingGenerateFeaturesNode {
  readonly id = WORK_TRACKER_IMPORT_NODES.GENERATE_FEATURES;

  private readonly trackerLogger = new Logger(
    WorkTrackerImportGenerateFeaturesNode.name,
  );

  constructor(featureListLifecycle: FeatureListLifecycleService) {
    super(featureListLifecycle);
  }

  async getPrecomputedResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<IntermediateSystemMessageData | undefined> {
    const context = tracker.getContext() as WorkTrackerImportFlowContext;
    const accepted = context.workTrackerImportAccepted;
    if (!accepted || context.onboardingFeatureProposal?.structuredRefinement) {
      return undefined;
    }
    this.trackerLogger.log('Mapping work-tracker outline into Feature review', {
      conversationId: context.core.conversationId,
      source: accepted.source,
      topLevelCount: accepted.hierarchy.topLevels.length,
    });
    return {
      ...mapWorkTrackerSuccessToFeatureGeneration(accepted),
      nodeId: this.id,
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const structured = this.getFeatureListUserMessage(userMessage);
    // Existing projects approve after placement is chosen.
    if (
      structured?.action === 'APPROVED' &&
      isExistingProject(tracker.getContext())
    ) {
      this.trackerLogger.log('Feature outline approved; placement pending', {
        conversationId: tracker.getContext().core.conversationId,
      });
      return;
    }
    await super.processUserResponse(tracker, userMessage);
  }

  async determineRoutingFromUserMessage(
    context: Readonly<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    const structured = this.getFeatureListUserMessage(userMessage);
    if (structured?.action !== 'APPROVED') return this.id;
    if (!context.onboardingFeatureProposal?.topLevels.length) return this.id;
    return isExistingProject(context)
      ? WORK_TRACKER_IMPORT_NODES.PLACEMENT_STRATEGY
      : WORK_TRACKER_IMPORT_NODES.FINALIZE;
  }
}

/**
 * Shared placement choices. Intelligent integration needs a repository
 * workspace, so work-tracker imports keep the deterministic strategies.
 */
@Injectable()
export class WorkTrackerImportPlacementStrategyNode extends RepositoryGroundingPlacementStrategyNode {
  readonly id = WORK_TRACKER_IMPORT_NODES.PLACEMENT_STRATEGY as never;
  readonly title = 'Choose imported Feature placement';

  private readonly trackerLogger = new Logger(
    WorkTrackerImportPlacementStrategyNode.name,
  );

  constructor(lifecycle: FeatureListLifecycleService) {
    super(lifecycle);
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    if (this.isIntelligent(userMessage)) {
      this.trackerLogger.warn(
        'Intelligent placement rejected for work-tracker import',
        { conversationId: tracker.getContext().core.conversationId },
      );
      return;
    }
    await super.processUserResponse(tracker, userMessage);
  }

  async determineRoutingFromUserMessage(
    _context: Readonly<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    return this.isIntelligent(userMessage)
      ? WORK_TRACKER_IMPORT_NODES.PLACEMENT_STRATEGY
      : WORK_TRACKER_IMPORT_NODES.FINALIZE;
  }

  private isIntelligent(userMessage: FlowUserMessage): boolean {
    const strategy = parseRepositoryPlacementStrategy(
      getRepositoryGroundingAnswers(userMessage)[
        REPOSITORY_PLACEMENT_FIELDS.strategy
      ],
    );
    return (
      strategy.action ===
      RepositoryPlacementIntelligentlyIntegrateSubmission.ActionEnum
        .IntelligentlyIntegrate
    );
  }
}

@Injectable()
export class WorkTrackerImportFinalizeNode extends FinalizeNodeBase<WorkTrackerImportFlowContext> {
  readonly id = WORK_TRACKER_IMPORT_NODES.FINALIZE;
  readonly title = 'Work-tracker import complete';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message: 'Imported Features were added after proposal approval.',
    };
  }
}

@Injectable()
export class WorkTrackerImportEndNode extends FinalizeNodeBase<WorkTrackerImportFlowContext> {
  readonly id = WORK_TRACKER_IMPORT_NODES.END;
  readonly title = 'Work-tracker import complete';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message: 'Work-tracker import complete.',
    };
  }
}
