import { Injectable } from '@nestjs/common';
import {
  EntityConversationFlowContext,
  NodeResult,
  NodeType,
  QuestionsNodeBase,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { ENTITY_CONVERSATION_NODES } from '../../constants';

@Injectable()
export class EntityConversationRecoveryNode extends QuestionsNodeBase<EntityConversationFlowContext> {
  readonly id = ENTITY_CONVERSATION_NODES.RECOVERY;
  readonly title = 'Entity Conversation Recovery';

  async execute(
    _tracker: MutableContextHandle<EntityConversationFlowContext>,
  ): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message:
        'I ran into an issue processing that message. Can you rephrase or add more detail?',
      uiElements: [
        {
          type: 'textarea',
          id: 'entity_conversation_retry',
          label: 'Try again',
          required: false,
          influences: [],
        },
      ],
      data: {
        detectedIntent: 'entity_conversation_recovery',
        intentConfidence: 0.5,
      },
    };
  }
}
