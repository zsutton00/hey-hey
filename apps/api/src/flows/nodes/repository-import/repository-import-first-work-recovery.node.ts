import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class RepositoryImportFirstWorkRecoveryNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.FIRST_WORK_RECOVERY;
  private readonly logger = new Logger(
    RepositoryImportFirstWorkRecoveryNode.name,
  );

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const outcome = tracker.getContext().repositoryFirstWorkLatestOutcome;
    const message =
      outcome && 'message' in outcome
        ? outcome.message
        : 'Preparing the first task can be retried with your saved answers.';
    return {
      type: NodeType.QUESTIONS,
      message,
      uiElements: [
        {
          id: 'repository_first_work_retry',
          type: ExtendedUIFieldType.QuestionGroup,
          label: 'Retry first task',
          submitText: 'Retry',
          required: true,
          influences: [],
          payload: {
            questions: [
              'Retry preparing the first task with your saved answers?',
            ],
          },
        },
      ],
      data: {
        detectedIntent: 'repository_first_work_recovery',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    _message: FlowUserMessage,
  ): Promise<void> {
    tracker.mutate((draft) => {
      draft.repositoryFirstWorkLatestOutcome = undefined;
    });
    this.logger.debug('Repository first-work retry requested', {
      conversationId: tracker.getContext().core.conversationId,
    });
  }

  async determineRoutingFromUserMessage(): Promise<string> {
    return REPOSITORY_IMPORT_NODES.FIRST_WORK;
  }
}
