import { Injectable, Logger } from '@nestjs/common';
import { UIElement } from 'src/generated';
import {
  FlowUserMessage,
  MutableContextHandle,
  NodeResult,
  NodeType,
  OnboardingFlowContext,
  QuestionsNodeBase,
} from 'src/types/flow-internal.types';
import { ONBOARDING_NODES } from '../../constants/node-ids';
import {
  getRepositoryGroundingAnswers,
  parseRepositoryGroundingIntentAnswer,
  REPOSITORY_GROUNDING_FIELDS,
  REPOSITORY_GROUNDING_INTENT_HELPER,
  REPOSITORY_GROUNDING_INTENT_OPTIONS,
  REPOSITORY_GROUNDING_INTENT_QUESTION,
  RepositoryGroundingInputError,
} from './repository-grounding.contract';

@Injectable()
export class OnboardingRepositoryGroundingIntentNode extends QuestionsNodeBase<OnboardingFlowContext> {
  readonly id = ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT;
  readonly title = 'Existing project material';

  private readonly logger = new Logger(
    OnboardingRepositoryGroundingIntentNode.name,
  );

  async execute(
    tracker: MutableContextHandle<OnboardingFlowContext>,
  ): Promise<NodeResult> {
    this.logger.debug('Repository-grounding intent gate entered', {
      conversationId: tracker.getContext().core.conversationId,
      projectId: tracker.getContext().core.projectId,
    });

    const intentField: UIElement = {
      id: REPOSITORY_GROUNDING_FIELDS.intent,
      type: 'select',
      label: REPOSITORY_GROUNDING_INTENT_QUESTION,
      placeholder: REPOSITORY_GROUNDING_INTENT_HELPER,
      required: true,
      influences: [],
      options: REPOSITORY_GROUNDING_INTENT_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    };

    return {
      type: NodeType.QUESTIONS,
      message: REPOSITORY_GROUNDING_INTENT_HELPER,
      uiElements: [intentField],
      data: {
        detectedIntent: 'repository_grounding_intent',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<OnboardingFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    try {
      const answer = parseRepositoryGroundingIntentAnswer(
        getRepositoryGroundingAnswers(userMessage)[
          REPOSITORY_GROUNDING_FIELDS.intent
        ],
      );

      tracker.mutate((draft) => {
        draft.repositoryGroundingIntentRequired = false;
      });
    } catch (error) {
      if (error instanceof RepositoryGroundingInputError) {
        this.logger.warn('Repository-grounding intent answer rejected', {
          conversationId: tracker.getContext().core.conversationId,
          reason: error.message,
        });
        return;
      }
      throw error;
    }
  }

  async determineRoutingFromUserMessage(
    _context: Readonly<OnboardingFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    try {
      const answer = parseRepositoryGroundingIntentAnswer(
        getRepositoryGroundingAnswers(userMessage)[
          REPOSITORY_GROUNDING_FIELDS.intent
        ],
      );
      return answer.choice === 'yes'
        ? ONBOARDING_NODES.END
        : ONBOARDING_NODES.CLARIFY_CONCEPT;
    } catch (error) {
      if (error instanceof RepositoryGroundingInputError) {
        return this.id;
      }
      throw error;
    }
  }
}
