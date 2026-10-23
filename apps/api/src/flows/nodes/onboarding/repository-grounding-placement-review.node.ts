import { Injectable } from '@nestjs/common';
import {
  ExtendedUIFieldType,
  type RepositoryPlacementReviewElement,
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
  parseRepositoryPlacementReviewSubmission,
  REPOSITORY_PLACEMENT_FIELDS,
} from './repository-grounding.contract';

@Injectable()
export class RepositoryGroundingPlacementReviewNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.PLACEMENT_REVIEW;
  readonly title = 'Review imported Feature placement';

  constructor(private readonly lifecycle: FeatureListLifecycleService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const field = {
      id: REPOSITORY_PLACEMENT_FIELDS.review,
      type: ExtendedUIFieldType.RepositoryPlacementReview,
      label: 'Review intelligent placement',
      required: true,
      influences: [],
      payload: await this.lifecycle.buildPlacementReview(tracker.getContext()),
    } satisfies RepositoryPlacementReviewElement;

    return {
      type: NodeType.QUESTIONS,
      message: 'Review the suggested locations for the imported Features.',
      uiElements: [field],
      data: {
        detectedIntent: 'repository_placement_review',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const answers = getRepositoryGroundingAnswers(userMessage);
    const submission = parseRepositoryPlacementReviewSubmission(
      answers[REPOSITORY_PLACEMENT_FIELDS.review],
    );
    await this.lifecycle.applyPlacementOverrides(
      submission.payload.overrides,
      tracker,
      this.id,
    );
    await this.lifecycle.approve(tracker, this.id);
  }
}
