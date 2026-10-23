import { Injectable } from '@nestjs/common';
import { FinalizeNodeBase } from '../base/';
import {
  FlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { TASK_PRIORITIZATION_NODES } from '../../constants';

@Injectable()
export class TaskPrioritizationEndNode extends FinalizeNodeBase<FlowContext> {
  readonly id = TASK_PRIORITIZATION_NODES.END;
  readonly title = 'Task Prioritization Complete';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message:
        'Task prioritization completed. Review the queue above to plan execution.',
    };
  }
}
