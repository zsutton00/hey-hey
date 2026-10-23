import { Injectable } from '@nestjs/common';
import {
  TaskRefinementFlowContext,
  NodeType,
  NodeResult,
  GenericConfirmData,
} from '../../../types/flow-internal.types';
import { ActionNodeBase } from '../base/';
import { TASK_REFINEMENT_NODES } from '../../constants/node-ids';
import { MutableContext } from 'src/utils/mutable-context';

/**
 * Task Refinement End Node
 *
 * Confirms task refinement completion.
 */
@Injectable()
export class TaskRefinementEndNode extends ActionNodeBase<TaskRefinementFlowContext> {
  readonly id = TASK_REFINEMENT_NODES.END;
  readonly title = 'Task Refinement Complete';

  async execute(
    tracker: MutableContext<TaskRefinementFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const message =
      "Great! I've finished refining your task. The task is now ready for implementation.";

    const data: GenericConfirmData = {
      type: 'GENERIC_CONFIRM',
      detectedIntent: 'task_refinement_complete',
      intentConfidence: 1.0,
      taskId: context.taskId,
      conversationId: context.core.conversationId,
      summary: 'Task refinement completed successfully',
    };

    return {
      type: NodeType.CONFIRM,
      message,
      data,
    };
  }
}
