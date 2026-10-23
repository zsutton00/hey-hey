import { Injectable, Logger } from '@nestjs/common';
import { UIElement } from 'src/generated';
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
  parseRepositoryGroundingStartAnswer,
  REPOSITORY_GROUNDING_FIELDS,
  REPOSITORY_GROUNDING_START_ACTIONS,
  RepositoryGroundingInputError,
} from './repository-grounding.contract';

@Injectable()
export class OnboardingRepositoryGroundingStartNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.START;
  readonly title = 'Start repository analysis';

  private readonly logger = new Logger(
    OnboardingRepositoryGroundingStartNode.name,
  );

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    this.logger.debug('Repository-grounding explicit start gate entered', {
      conversationId: context.core.conversationId,
      hasAcceptedContext: !!context.repositoryGrounding,
    });

    const startField: UIElement = {
      id: REPOSITORY_GROUNDING_FIELDS.start,
      type: 'select',
      label: 'When should Hey Hey run the bounded analysis?',
      required: true,
      influences: [],
      options: [
        {
          value: REPOSITORY_GROUNDING_START_ACTIONS.START,
          label: 'Start analysis',
        },
        {
          value: REPOSITORY_GROUNDING_START_ACTIONS.FINISH_LATER,
          label: 'Finish later',
        },
      ],
    };

    return {
      type: NodeType.QUESTIONS,
      message:
        'Your Service, machine, scope, and provider choices are ready. Start analysis only when you are ready to send the signed request to the selected machine.',
      uiElements: [startField],
      data: {
        detectedIntent: 'repository_grounding_start',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    _tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    try {
      parseRepositoryGroundingStartAnswer(
        getRepositoryGroundingAnswers(userMessage)[
          REPOSITORY_GROUNDING_FIELDS.start
        ],
      );
    } catch (error) {
      if (error instanceof RepositoryGroundingInputError) {
        this.logger.warn('Repository-grounding start answer rejected', {
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
      const choice = parseRepositoryGroundingStartAnswer(
        getRepositoryGroundingAnswers(userMessage)[
          REPOSITORY_GROUNDING_FIELDS.start
        ],
      );
      if (!context.repositoryGrounding) return this.id;
      return choice === REPOSITORY_GROUNDING_START_ACTIONS.START
        ? REPOSITORY_IMPORT_NODES.ANALYSIS
        : REPOSITORY_IMPORT_NODES.RECOVERY;
    } catch (error) {
      if (error instanceof RepositoryGroundingInputError) return this.id;
      throw error;
    }
  }
}
