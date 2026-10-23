import { Injectable } from '@nestjs/common';
import {
  ExtendedUIFieldType,
  type RepositoryPlacementStrategySubmission,
  type UIElement,
} from '../../../generated';
import { FeatureListLifecycleService } from '../../../services/feature-list/feature-list-lifecycle.service';
import {
  FlowUserMessage,
  MutableContextHandle,
  NodeResult,
  NodeType,
  RepositoryImportFlowContext,
  QuestionsNodeBase,
} from '../../../types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import {
  getRepositoryGroundingAnswers,
  parseRepositoryPlacementStrategy,
  REPOSITORY_PLACEMENT_FIELDS,
} from './repository-grounding.contract';

@Injectable()
export class RepositoryGroundingPlacementStrategyNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY;
  readonly title = 'Choose imported Feature placement';

  constructor(private readonly lifecycle: FeatureListLifecycleService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const state = tracker.getContext().onboardingFeatureProposal;
    if (!state)
      throw new Error('Placement strategy requires pending Feature proposals.');
    const field: UIElement = {
      id: REPOSITORY_PLACEMENT_FIELDS.strategy,
      type: ExtendedUIFieldType.RepositoryPlacementStrategy,
      label: 'Where should the imported Features live?',
      required: true,
      influences: [],
      payload: { roots: this.lifecycle.toPlacementRoots(state) },
    };
    return {
      type: NodeType.QUESTIONS,
      message:
        'Choose how the proposed top-level Features should join this project.',
      uiElements: [field],
      data: {
        detectedIntent: 'repository_placement_strategy',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const strategy = this.readStrategy(userMessage);
    await this.lifecycle.applyPlacementStrategy(strategy, tracker, this.id);
    if (strategy.action !== 'INTELLIGENTLY_INTEGRATE') {
      await this.lifecycle.approve(tracker, this.id);
    }
  }

  async determineRoutingFromUserMessage(
    _context: Readonly<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    const strategy = this.readStrategy(userMessage);
    return strategy.action === 'INTELLIGENTLY_INTEGRATE'
      ? REPOSITORY_IMPORT_NODES.PLACEMENT_AGENT
      : REPOSITORY_IMPORT_NODES.FINALIZE;
  }

  private readStrategy(
    userMessage: FlowUserMessage,
  ): RepositoryPlacementStrategySubmission {
    const answers = getRepositoryGroundingAnswers(userMessage);
    return parseRepositoryPlacementStrategy(
      answers[REPOSITORY_PLACEMENT_FIELDS.strategy],
    );
  }
}
