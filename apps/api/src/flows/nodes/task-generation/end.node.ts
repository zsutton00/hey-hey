import { Injectable } from '@nestjs/common';
import { FinalizeNodeBase } from '../base/';
import {
  FlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { TASK_GENERATION_NODES } from '../../constants/node-ids';

/**
 * Task Generation End Node - Completes task generation flow
 *
 * FINALIZE node that:
 * - Marks task generation flow as complete
 * - Returns completion message
 * - Provides continuation options
 */
@Injectable()
export class TaskGenerationEndNode extends FinalizeNodeBase<FlowContext> {
  readonly id = TASK_GENERATION_NODES.END;
  readonly title = 'Task Generation Complete';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message:
        'Great! Task generation is complete. You can continue the conversation or generate more tasks as needed.',
      uiElements: [
        {
          id: 'task_generation_complete',
          type: 'complete_onboarding',
          label: 'Continue Working',
          required: false,
          influences: [],
        },
      ],
      actions: [],
    };
  }
}
