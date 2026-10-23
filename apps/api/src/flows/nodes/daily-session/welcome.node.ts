import { Injectable } from '@nestjs/common';
import {
  DailySessionFlowContext,
  NodeResult,
  NodeType,
  OpenerNodeBase,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { DAILY_SESSION_NODES } from '../../constants';

@Injectable()
export class DailySessionWelcomeNode extends OpenerNodeBase<DailySessionFlowContext> {
  readonly id = DAILY_SESSION_NODES.WELCOME;
  readonly title = 'Daily Session';

  async execute(
    _tracker: MutableContextHandle<DailySessionFlowContext>,
  ): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message:
        "Welcome to your daily session. We're looking into what you can work on next.",
      data: {
        detectedIntent: 'daily_session_started',
        intentConfidence: 1,
        reasoning: 'Initial daily session prompt',
      },
    };
  }
}
