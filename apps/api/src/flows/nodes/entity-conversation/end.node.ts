import { Injectable } from '@nestjs/common';
import {
  EntityConversationFlowContext,
  FinalizeNodeBase,
  NodeResult,
  NodeType,
} from 'src/types/flow-internal.types';
import { ENTITY_CONVERSATION_NODES } from '../../constants';

@Injectable()
export class EntityConversationEndNode extends FinalizeNodeBase<EntityConversationFlowContext> {
  readonly id = ENTITY_CONVERSATION_NODES.END;
  readonly title = 'Entity Conversation Complete';

  twoPhase: boolean = false;

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message: 'Conversation complete. Let me know if you want to dig deeper.',
    };
  }
}
