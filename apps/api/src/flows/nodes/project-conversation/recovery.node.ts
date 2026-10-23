import { Injectable } from '@nestjs/common';
import {
  NodeResult,
  NodeType,
  ProjectConversationFlowContext,
  QuestionsNodeBase,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { PROJECT_CONVERSATION_NODES } from '../../constants';

@Injectable()
export class ProjectConversationRecoveryNode extends QuestionsNodeBase<ProjectConversationFlowContext> {
  readonly id = PROJECT_CONVERSATION_NODES.RECOVERY;
  readonly title = 'Project Conversation Recovery';

  async execute(
    _tracker: MutableContextHandle<ProjectConversationFlowContext>,
  ): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message:
        'I ran into an issue processing that message. Can you rephrase or add more detail?',
      uiElements: [
        {
          type: 'textarea',
          id: 'project_conversation_retry',
          label: 'Try again',
          required: false,
          influences: [],
        },
      ],
      data: {
        detectedIntent: 'project_conversation_recovery',
        intentConfidence: 0.5,
      },
    };
  }
}
