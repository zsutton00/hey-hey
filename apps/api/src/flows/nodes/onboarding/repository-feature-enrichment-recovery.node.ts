import { Injectable } from '@nestjs/common';
import { ExtendedUIFieldType } from 'src/generated';
import {
  FlowUserMessage,
  MutableContextHandle,
  NodeResult,
  NodeType,
  RepositoryImportFlowContext,
  QuestionsNodeBase,
} from 'src/types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';

@Injectable()
export class RepositoryFeatureEnrichmentRecoveryNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.ENRICHMENT_RECOVERY;
  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const outcome =
      tracker.getContext().repositoryFeatureEnrichmentLatestOutcome;
    const message =
      outcome && 'message' in outcome
        ? outcome.message
        : 'Feature enrichment can be retried with the saved repository discovery and answers.';
    return {
      type: NodeType.QUESTIONS,
      message,
      uiElements: [
        {
          id: 'repository_feature_enrichment_retry',
          type: ExtendedUIFieldType.QuestionGroup,
          label: 'Retry Feature enrichment',
          submitText: 'Retry',
          required: true,
          influences: [],
          payload: {
            questions: [
              'Retry Feature enrichment with the saved discovery and answers?',
            ],
          },
        },
      ],
      data: {
        detectedIntent: 'repository_feature_enrichment_recovery',
        intentConfidence: 1,
      },
    };
  }
  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    _message: FlowUserMessage,
  ): Promise<void> {
    tracker.mutate((draft) => {
      draft.repositoryFeatureEnrichmentLatestOutcome = undefined;
    });
  }
  async determineRoutingFromUserMessage(): Promise<string> {
    return REPOSITORY_IMPORT_NODES.ENRICHMENT;
  }
}
