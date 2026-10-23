import { Injectable } from '@nestjs/common';
import { TaskService } from '../../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../../services/tasks/work-item-type-registry.service';
import { SystemMessageResponseType } from '../../../generated';
import {
  NodeResult,
  NodeType,
  TaskRefinementFlowContext,
} from '../../../types/flow-internal.types';
import { QuestionsNodeBase } from '../base/';
import { TASK_REFINEMENT_NODES } from '../../constants/node-ids';
import { MutableContext } from 'src/utils/mutable-context';
import { getTaskCurrentRefinementLevel } from 'src/utils/task-refinement-profile.util';

/**
 * Task Refinement Recovery Node
 *
 * Shows the task and reasoning, asks for feedback after error recovery.
 */
@Injectable()
export class TaskRefinementRecoveryNode extends QuestionsNodeBase<TaskRefinementFlowContext> {
  readonly id = TASK_REFINEMENT_NODES.RECOVERY;
  readonly title = 'Task Refinement Recovery';

  constructor(
    private taskService: TaskService,
    private workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {
    super();
  }

  async execute(
    tracker: MutableContext<TaskRefinementFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const task = await this.taskService.findOne(
      context.core.organizationId,
      context.taskId,
    );

    if (!task) {
      return {
        type: NodeType.ERROR,
        message: 'Task data not found. Please try again.',
        data: {
          errorType: 'missing_data',
          context: 'task_not_loaded',
          temporary: true,
          detectedIntent: 'task_missing',
          intentConfidence: 1,
        },
      };
    }

    const levels = this.workItemTypeRegistry.getTaskRefinementLevels(
      task.type,
      context.core.projectId,
    );
    const currentLevel = getTaskCurrentRefinementLevel(task.status, levels);

    // Create level-specific welcome message for tasks
    const levelMessages = {
      description:
        "Let's review and refine the basic description of this task.",
      acceptanceCriteria:
        "Finally, let's define the acceptance criteria and testing requirements for this task.",
    };

    const levelMessage = levelMessages[currentLevel];
    if (!levelMessage) {
      throw new Error(
        `Unknown currentLevel '${currentLevel}' derived from task status '${task.status}' ` +
          `for task ${context.taskId}. Expected: description or acceptanceCriteria.`,
      );
    }

    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements: [
        {
          id: 'task_feedback',
          type: 'textarea',
          label: `Sorry about that! ${levelMessage} What would you like to change or improve?`,
          placeholder:
            currentLevel === 'description'
              ? task.type === 'BUG'
                ? 'Describe the bug clearly, including expected vs actual behavior and constraints...'
                : 'Share your thoughts on the task name, description, priority, or scope...'
              : 'Share your thoughts on the acceptance criteria, testing approach, or completion requirements...',
          required: false,
          influences: [],
        },
      ],
      actions: [],
      data: {
        detectedIntent: 'opener_displayed',
        intentConfidence: 1.0,
        reasoning: 'Task refinement session started',
      },
    };
  }
}
