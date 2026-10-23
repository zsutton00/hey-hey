import { Injectable, Logger } from '@nestjs/common';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import type { RepositoryGroundingAnalysisConfiguration } from 'src/generated';
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
  repositoryGroundingAnalysisConfigurationSchema,
  RepositoryGroundingInputError,
  REPOSITORY_GROUNDING_TYPED_FIELDS,
} from './repository-grounding.contract';

@Injectable()
export class OnboardingRepositoryGroundingConfigurationNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.CONFIGURATION;
  readonly title = 'Repository analysis configuration';

  private readonly logger = new Logger(
    OnboardingRepositoryGroundingConfigurationNode.name,
  );

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    this.logger.debug('Repository-grounding configuration rendered', {
      conversationId: context.core.conversationId,
      hasPrerequisites: !!context.repositoryGroundingPrerequisites,
      hasSavedConfiguration: !!context.repositoryGroundingAnalysisConfiguration,
    });

    const repositoryField: UIElement = {
      id: 'repository_grounding',
      type: ExtendedUIFieldType.RepositoryGrounding,
      label: 'Repository capability analysis',
      required: true,
      influences: [],
      payload: buildRepositoryGroundingFieldPayload(context, {
        phase: 'configuration',
      }),
    };

    return {
      type: NodeType.QUESTIONS,
      message:
        'Choose the analysis scope and complete runtime configuration. Your current choices are retained when you return here.',
      uiElements: [repositoryField],
      data: {
        detectedIntent: 'repository_grounding_configuration',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const context = tracker.getContext();
    const prerequisites = context.repositoryGroundingPrerequisites;
    if (!prerequisites) {
      this.logger.warn(
        'Repository-grounding configuration rejected because prerequisites are missing',
        { conversationId: context.core.conversationId },
      );
      return;
    }

    let configuration: RepositoryGroundingAnalysisConfiguration;
    try {
      const answers = getRepositoryGroundingAnswers(userMessage);
      configuration = repositoryGroundingAnalysisConfigurationSchema.parse(
        answers[REPOSITORY_GROUNDING_TYPED_FIELDS.analysisConfiguration],
      );
    } catch (error) {
      if (error instanceof RepositoryGroundingInputError) {
        this.logger.warn('Repository-grounding configuration rejected', {
          conversationId: context.core.conversationId,
          reason: error.message,
        });
        return;
      }
      throw error;
    }

    tracker.mutate((draft) => {
      draft.repositoryGroundingAnalysisConfiguration = configuration;
      draft.repositoryGrounding = {
        prerequisites,
        analysisConfiguration: configuration,
      };
      draft.repositoryGroundingCompletion = undefined;
    });

    this.logger.debug('Repository-grounding configuration accepted', {
      conversationId: context.core.conversationId,
      provider: configuration.provider,
      resolvedFrontierModel: configuration.resolvedFrontierModel,
      scope: configuration.scope.scope,
    });
  }

  async determineRoutingFromUserMessage(
    context: Readonly<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    const answers = getRepositoryGroundingAnswers(userMessage);
    if (hasRepositoryGroundingTypedAnswers(answers)) {
      try {
        const { action } = parseRepositoryGroundingFormSubmission(answers);
        switch (action) {
          case 'START_ANALYSIS':
          case 'RETRY_ANALYSIS':
            return context.repositoryGrounding
              ? REPOSITORY_IMPORT_NODES.ANALYSIS
              : this.id;
          case 'FINISH_LATER':
            return REPOSITORY_IMPORT_NODES.RECOVERY;
          case 'CONTINUE_CONVERSATION':
            return REPOSITORY_IMPORT_NODES.RECOVERY;
          default:
            return this.id;
        }
      } catch (error) {
        if (error instanceof RepositoryGroundingInputError) return this.id;
        throw error;
      }
    }
    return context.repositoryGrounding
      ? REPOSITORY_IMPORT_NODES.START
      : this.id;
  }
}
