import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ExtendedUIFieldType } from 'src/generated';
import {
  FlowUserMessage,
  MutableContextHandle,
  NodeResult,
  NodeType,
  QuestionsNodeBase,
  RepositoryImportFlowContext,
} from 'src/types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';

export const FIRST_WORK_FOLLOW_UP_FIELD = 'repository_first_work_follow_up';
export const MAX_FIRST_WORK_FOLLOW_UP_ROUNDS = 1;
const MAX_FIRST_WORK_FOLLOW_UP_QUESTIONS = 3;

/** Mirrors RepositoryFirstWorkFollowUpAnswers in conversations.yaml. */
export const firstWorkFollowUpAnswersSchema = z
  .object({
    clarifyingAnswers: z
      .array(
        z
          .object({
            question: z.string().trim().min(1),
            answer: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_FIRST_WORK_FOLLOW_UP_QUESTIONS),
  })
  .strict();

@Injectable()
export class RepositoryImportFirstWorkFollowUpNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.FIRST_WORK_FOLLOW_UP;
  private readonly logger = new Logger(
    RepositoryImportFirstWorkFollowUpNode.name,
  );

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const outcome = tracker.getContext().repositoryFirstWorkLatestOutcome;
    if (
      !outcome ||
      outcome.outcome !== 'questions' ||
      outcome.questionGroup.questions.length >
        MAX_FIRST_WORK_FOLLOW_UP_QUESTIONS
    )
      throw new Error('A valid bounded first-work question group is required.');
    return {
      type: NodeType.QUESTIONS,
      message: 'A little more detail will help shape the first task.',
      uiElements: [
        {
          id: FIRST_WORK_FOLLOW_UP_FIELD,
          type: ExtendedUIFieldType.QuestionGroup,
          label: 'First task details',
          submitText: 'Continue',
          required: true,
          influences: [],
          payload: outcome.questionGroup,
        },
      ],
      data: {
        detectedIntent: 'repository_first_work_follow_up',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    message: FlowUserMessage,
  ): Promise<void> {
    const value = (message.data ?? {})[FIRST_WORK_FOLLOW_UP_FIELD];
    if (
      !value ||
      typeof value !== 'object' ||
      !('clarifyingAnswers' in value) ||
      !Array.isArray(value.clarifyingAnswers)
    )
      throw new Error('First-work follow-up requires clarifying answers.');
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
            'Every first-work follow-up question requires a non-empty answer.',
          );
        return { question: entry.question, answer: entry.answer };
      },
    );
    const context = tracker.getContext();
    const round = (context.repositoryFirstWorkFollowUpRoundCount ?? 0) + 1;
    if (round > MAX_FIRST_WORK_FOLLOW_UP_ROUNDS)
      throw new Error('The first-work stage allows only one follow-up round.');
    tracker.mutate((draft) => {
      draft.repositoryFirstWorkFollowUpAnswers = answers;
      draft.repositoryFirstWorkFollowUpRoundCount = round;
      draft.repositoryFirstWorkLatestOutcome = undefined;
    });
    this.logger.debug('Repository first-work follow-up recorded', {
      conversationId: context.core.conversationId,
      answerCount: answers.length,
    });
  }

  async determineRoutingFromUserMessage(): Promise<string> {
    return REPOSITORY_IMPORT_NODES.FIRST_WORK;
  }
}
