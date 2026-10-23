import { Injectable } from '@nestjs/common';
import {
  FinalizeNodeBase,
  NodeResult,
  NodeType,
  ProjectConversationFlowContext,
} from 'src/types/flow-internal.types';
import { PROJECT_CONVERSATION_NODES } from '../../constants';

@Injectable()
export class ProjectConversationEndNode extends FinalizeNodeBase<ProjectConversationFlowContext> {
  readonly id = PROJECT_CONVERSATION_NODES.END;
  readonly title = 'Project Conversation Complete';

  twoPhase: boolean = false;

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message: 'Conversation complete. Let me know if you want to dig deeper.',
    };
  }
}
