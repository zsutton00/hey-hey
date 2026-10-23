import { Injectable, Logger } from '@nestjs/common';
import {
  FlowUserMessage,
  MutableContextHandle,
  NodeResult,
  NodeType,
  QuestionsNodeBase,
  RepositoryImportFlowContext,
} from '../../../types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import { getRepositoryGroundingAnswers } from '../onboarding/repository-grounding.contract';

export const FIRST_WORK_REQUEST_FIELD = 'repository_first_work_request';

@Injectable()
export class RepositoryImportFirstWorkQuestionNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.FIRST_WORK_QUESTION;
  readonly title = 'Choose your first piece of work';
  private readonly logger = new Logger(
    RepositoryImportFirstWorkQuestionNode.name,
  );

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    if (!context.repositoryImportMaterializedFeatureIds?.length)
      throw new Error('The first-work stage requires materialized Features.');
    this.logger.debug('Repository first-work question rendered', {
      conversationId: context.core.conversationId,
      materializedFeatureCount:
        context.repositoryImportMaterializedFeatureIds.length,
    });
    // Deliberately no skip option: the import completes only once first work exists.
    return {
      type: NodeType.QUESTIONS,
      message:
        'Your Features are in place. What do you want to work on next? Describe a change, fix, or new capability and I will propose a first task under the most relevant Feature.',
      uiElements: [
        {
          id: FIRST_WORK_REQUEST_FIELD,
          type: 'textarea',
          label: 'What do you want to work on next?',
          required: true,
          influences: [],
          submitText: 'Continue',
        },
      ],
      data: {
        detectedIntent: 'repository_first_work_question',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    message: FlowUserMessage,
  ): Promise<void> {
    const value =
      getRepositoryGroundingAnswers(message)[FIRST_WORK_REQUEST_FIELD];
    if (typeof value !== 'string' || !value.trim())
      throw new Error(
        'The first-work stage requires a description of the work.',
      );
    tracker.mutate((draft) => {
      draft.repositoryFirstWorkRequest = value.trim();
      draft.repositoryFirstWorkFollowUpRoundCount = 0;
      draft.repositoryFirstWorkFollowUpAnswers = [];
      draft.repositoryFirstWorkLatestOutcome = undefined;
    });
    this.logger.debug('Repository first-work request saved', {
      conversationId: tracker.getContext().core.conversationId,
      requestLength: value.trim().length,
    });
  }

  async determineRoutingFromUserMessage(): Promise<string> {
    return REPOSITORY_IMPORT_NODES.FIRST_WORK;
  }
}
