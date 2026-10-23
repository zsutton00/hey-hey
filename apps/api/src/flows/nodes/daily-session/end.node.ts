import { Injectable } from '@nestjs/common';
import {
  DailySessionFlowContext,
  FinalizeNodeBase,
  NodeResult,
  NodeType,
} from 'src/types/flow-internal.types';
import { DAILY_SESSION_NODES } from '../../constants';

@Injectable()
export class DailySessionEndNode extends FinalizeNodeBase<DailySessionFlowContext> {
  readonly id = DAILY_SESSION_NODES.END;
  readonly title = 'Daily Session Complete';

  twoPhase: boolean = false;

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message: 'Session complete. See you next time!',
    };
  }
}
