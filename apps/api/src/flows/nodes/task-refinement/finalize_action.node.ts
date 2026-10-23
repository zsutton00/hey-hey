import { Injectable, Logger } from '@nestjs/common';
import {
  NodeResult,
  TaskRefinementFlowContext,
  NodeType,
  FinalizeActionData,
} from '../../../types/flow-internal.types';
import { TaskService } from '../../../services/tasks/task.service';
import { ActionNodeBase } from '../base/';
import { TASK_REFINEMENT_NODES } from '../../constants/node-ids';
import { MutableContext } from 'src/utils/mutable-context';

/**
 * Task Refinement Finalize Action Node
 *
 * Finalizes task refinement by setting status to ACTIVE.
 */
@Injectable()
export class TaskRefinementFinalizeNode extends ActionNodeBase<TaskRefinementFlowContext> {
  readonly id = TASK_REFINEMENT_NODES.FINALIZE_ACTION;
  readonly title = 'Finalizing task refinement';

  private readonly logger = new Logger(TaskRefinementFinalizeNode.name);

  constructor(private taskService: TaskService) {
    super();
  }

  async execute(
    tracker: MutableContext<TaskRefinementFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    try {
      this.logger.debug(`[finalize_action] starting task finalization`, {
        taskId: context.taskId,
      });

      // Update task to ACTIVE status (ready for implementation)
      await this.taskService.update(
        context.core.organizationId,
        context.initiativeId,
        context.taskId,
        { status: 'ACTIVE' },
      );

      const finalizeData: FinalizeActionData = {
        type: 'REFINEMENT_COMPLETE',
        finalizationResult: {
          taskId: context.taskId,
          status: 'ACTIVE',
        },
        conversationId: context.core.conversationId,
      };

      return {
        type: NodeType.ACTION,
        message:
          'Perfect! Your task refinement is now complete. The task is ready for implementation.',
        data: finalizeData,
      };
    } catch (error) {
      this.logger.error(`[finalize_action] Error finalizing task`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        taskId: context.taskId,
      });

      return {
        type: NodeType.ERROR,
        message:
          'Sorry, there was an issue finalizing your task. Please try again.',
        data: {
          errorType: 'finalization_error',
          context: error instanceof Error ? error.message : 'Unknown error',
          temporary: false,
          detectedIntent: 'finalization_error',
          intentConfidence: 1,
        },
      };
    }
  }
}
