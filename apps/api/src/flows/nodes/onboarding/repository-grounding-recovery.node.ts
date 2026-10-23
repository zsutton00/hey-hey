import { Injectable, Logger } from '@nestjs/common';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import {
  FlowUserMessage,
  MutableContextHandle,
  NodeResult,
  NodeType,
  RepositoryImportFlowContext,
  QuestionsNodeBase,
} from 'src/types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import {
  getRepositoryGroundingAnswers,
  buildRepositoryGroundingFieldPayload,
  hasRepositoryGroundingTypedAnswers,
  parseRepositoryGroundingFormSubmission,
  parseRepositoryGroundingRecoveryAnswer,
  REPOSITORY_GROUNDING_FIELDS,
  REPOSITORY_GROUNDING_RECOVERY_ACTIONS,
  RepositoryGroundingInputError,
} from './repository-grounding.contract';

@Injectable()
export class OnboardingRepositoryGroundingRecoveryNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.RECOVERY;
  readonly title = 'Repository analysis recovery';

  private readonly logger = new Logger(
    OnboardingRepositoryGroundingRecoveryNode.name,
  );

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const completion = context.repositoryGroundingCompletion;
    const failureMessage =
      completion?.outcome === 'retryable_failure'
        ? `The bounded analysis can be retried without changing your saved choices. ${completion.message}`
        : completion?.outcome === 'terminal_failure'
          ? `The bounded analysis could not be accepted with the current request. ${completion.message}`
          : 'The bounded analysis is paused. Your accepted choices remain available.';

    this.logger.debug('Repository-grounding recovery gate entered', {
      conversationId: context.core.conversationId,
      outcome: completion?.outcome ?? 'not_started',
      failureCode:
        completion && completion.outcome !== 'success'
          ? completion.code
          : undefined,
    });

    const phase =
      completion?.outcome === 'retryable_failure'
        ? 'retryable-error'
        : completion?.outcome === 'terminal_failure'
          ? 'failed'
          : 'finished-later';
    const repositoryField: UIElement = {
      id: 'repository_grounding',
      type: ExtendedUIFieldType.RepositoryGrounding,
      label: 'Repository capability analysis',
      required: false,
      influences: [],
      payload: buildRepositoryGroundingFieldPayload(context, {
        phase,
        statusMessage: failureMessage,
        ...(completion?.outcome === 'retryable_failure' ||
        completion?.outcome === 'terminal_failure'
          ? { errorMessage: completion.message }
          : {}),
      }),
    };

    return {
      type: NodeType.QUESTIONS,
      message: failureMessage,
      uiElements: [repositoryField],
      data: {
        detectedIntent: 'repository_grounding_recovery',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    try {
      const answers = getRepositoryGroundingAnswers(userMessage);
      if (hasRepositoryGroundingTypedAnswers(answers)) {
        const { action } = parseRepositoryGroundingFormSubmission(answers);
        tracker.mutate((draft) => {
          if (action === 'START_ANALYSIS' || action === 'RETRY_ANALYSIS') {
            draft.repositoryGroundingCompletion = undefined;
            draft.repositoryGroundingPaused = false;
          } else if (action === 'FINISH_LATER') {
            draft.repositoryGroundingPaused = true;
          } else if (action === 'CONTINUE_CONVERSATION') {
            draft.repositoryGrounding = undefined;
            draft.repositoryGroundingPrerequisites = undefined;
            draft.repositoryGroundingAnalysisConfiguration = undefined;
            draft.repositoryGroundingCompletion = undefined;
            draft.repositoryGroundingPaused = undefined;
          }
        });
        return;
      }

      const choice = parseRepositoryGroundingRecoveryAnswer(
        answers[REPOSITORY_GROUNDING_FIELDS.recovery],
      );
      if (
        choice ===
        REPOSITORY_GROUNDING_RECOVERY_ACTIONS.CONTINUE_WITHOUT_ANALYSIS
      ) {
        tracker.mutate((draft) => {
          draft.repositoryGrounding = undefined;
          draft.repositoryGroundingPrerequisites = undefined;
          draft.repositoryGroundingAnalysisConfiguration = undefined;
          draft.repositoryGroundingCompletion = undefined;
          draft.repositoryGroundingPaused = undefined;
        });
      }
    } catch (error) {
      if (error instanceof RepositoryGroundingInputError) {
        this.logger.warn('Repository-grounding recovery answer rejected', {
          conversationId: tracker.getContext().core.conversationId,
          reason: error.message,
        });
        return;
      }
      throw error;
    }
  }

  async determineRoutingFromUserMessage(
    context: Readonly<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    try {
      const answers = getRepositoryGroundingAnswers(userMessage);
      if (hasRepositoryGroundingTypedAnswers(answers)) {
        const { action } = parseRepositoryGroundingFormSubmission(answers);
        switch (action) {
          case 'START_ANALYSIS':
          case 'RETRY_ANALYSIS':
            return context.repositoryGrounding
              ? REPOSITORY_IMPORT_NODES.ANALYSIS
              : this.id;
          case 'CONTINUE_CONVERSATION':
            return REPOSITORY_IMPORT_NODES.RECOVERY;
          case 'FINISH_LATER':
          default:
            return this.id;
        }
      }

      const choice = parseRepositoryGroundingRecoveryAnswer(
        answers[REPOSITORY_GROUNDING_FIELDS.recovery],
      );
      switch (choice) {
        case REPOSITORY_GROUNDING_RECOVERY_ACTIONS.RETRY:
          return context.repositoryGrounding
            ? REPOSITORY_IMPORT_NODES.START
            : this.id;
        case REPOSITORY_GROUNDING_RECOVERY_ACTIONS.EDIT_PREREQUISITES:
          return REPOSITORY_IMPORT_NODES.PREREQUISITES;
        case REPOSITORY_GROUNDING_RECOVERY_ACTIONS.EDIT_CONFIGURATION:
          return REPOSITORY_IMPORT_NODES.CONFIGURATION;
        case REPOSITORY_GROUNDING_RECOVERY_ACTIONS.CONTINUE_WITHOUT_ANALYSIS:
          return REPOSITORY_IMPORT_NODES.RECOVERY;
        default:
          return this.id;
      }
    } catch (error) {
      if (error instanceof RepositoryGroundingInputError) return this.id;
      throw error;
    }
  }
}
