import { Injectable } from '@nestjs/common';
import {
  DailySessionFlowContext,
  NodeResult,
  NodeType,
  QuestionsNodeBase,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { DAILY_SESSION_NODES } from '../../constants';

@Injectable()
export class DailySessionRecoveryNode extends QuestionsNodeBase<DailySessionFlowContext> {
  readonly id = DAILY_SESSION_NODES.RECOVERY;
  readonly title = 'Daily Session Recovery';

  async execute(
    _tracker: MutableContextHandle<DailySessionFlowContext>,
  ): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message:
        'I ran into an issue processing that message. Can you rephrase or add more detail?',
      uiElements: [
        {
          type: 'textarea',
          id: 'daily_session_retry',
          label: 'Try again',
          required: false,
          influences: [],
        },
      ],
      data: {
        detectedIntent: 'daily_session_recovery',
        intentConfidence: 0.5,
      },
    };
  }
}
