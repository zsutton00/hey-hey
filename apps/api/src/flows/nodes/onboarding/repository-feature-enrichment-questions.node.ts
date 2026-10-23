import { Injectable, Logger } from '@nestjs/common';
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

export const REPOSITORY_FEATURE_ENRICHMENT_QUESTION_FIELD =
  'repository_feature_enrichment_questions';

const MAX_ENRICHMENT_QUESTIONS_PER_ROUND = 3;

@Injectable()
export class RepositoryFeatureEnrichmentQuestionsNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.ENRICHMENT_QUESTIONS;
  private readonly logger = new Logger(
    RepositoryFeatureEnrichmentQuestionsNode.name,
  );
  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const outcome =
      tracker.getContext().repositoryFeatureEnrichmentLatestOutcome;
    if (
      !outcome ||
      outcome.outcome !== 'questions' ||
      outcome.questionGroup.questions.length >
        MAX_ENRICHMENT_QUESTIONS_PER_ROUND
    )
      throw new Error('A valid bounded enrichment question group is required.');
    return {
      type: NodeType.QUESTIONS,
      message: 'A few answers would materially improve the Feature proposal.',
      uiElements: [
        {
          id: REPOSITORY_FEATURE_ENRICHMENT_QUESTION_FIELD,
          type: ExtendedUIFieldType.QuestionGroup,
          label: 'Feature details',
          submitText: 'Continue',
          required: true,
          influences: [],
          payload: outcome.questionGroup,
        },
      ],
      data: {
        detectedIntent: 'repository_feature_enrichment_questions',
        intentConfidence: 1,
      },
    };
  }
  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    message: FlowUserMessage,
  ): Promise<void> {
    const value = (message.data ?? {})[
      REPOSITORY_FEATURE_ENRICHMENT_QUESTION_FIELD
    ];
    if (
      !value ||
      typeof value !== 'object' ||
      !('clarifyingAnswers' in value) ||
      !Array.isArray(value.clarifyingAnswers)
    ) {
      throw new Error('Feature enrichment requires clarifying answers.');
    }
    const rawAnswers: Array<unknown> = value.clarifyingAnswers;
    const answers = rawAnswers.map(
      (entry): { question: string; answer: string } => {
        if (
          !entry ||
          typeof entry !== 'object' ||
          !('question' in entry) ||
          !('answer' in entry) ||
          typeof entry.question !== 'string' ||
          typeof entry.answer !== 'string' ||
          !entry.question.trim() ||
          !entry.answer.trim()
        )
          throw new Error(
            'Every Feature enrichment question requires a non-empty answer.',
          );
        return { question: entry.question, answer: entry.answer };
      },
    );
    const context = tracker.getContext();
    const round = (context.repositoryFeatureEnrichmentCompletedRounds ?? 0) + 1;
    if (round > 2)
      throw new Error(
        'Repository Feature enrichment cannot record a third answer batch.',
      );
    tracker.mutate((draft) => {
      draft.repositoryFeatureEnrichmentAnswerBatches = [
        ...(draft.repositoryFeatureEnrichmentAnswerBatches ?? []),
        { round, answers },
      ];
      draft.repositoryFeatureEnrichmentCompletedRounds = round;
      draft.repositoryFeatureEnrichmentLatestOutcome = undefined;
    });
    this.logger.debug('Repository Feature enrichment answer batch recorded', {
      conversationId: context.core.conversationId,
      round,
      answerCount: answers.length,
    });
  }
  async determineRoutingFromUserMessage(): Promise<string> {
    return REPOSITORY_IMPORT_NODES.ENRICHMENT;
  }
}
