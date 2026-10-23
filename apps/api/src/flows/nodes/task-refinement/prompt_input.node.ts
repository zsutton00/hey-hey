import { Injectable } from '@nestjs/common';
import {
  NodeResult,
  NodeType,
  TaskRefinementFlowContext,
} from '../../../types/flow-internal.types';
import { QuestionsNodeBase } from '../base/';
import { TASK_REFINEMENT_NODES } from '../../constants/node-ids';

/**
 * Task Refinement Prompt Next Input Node
 *
 * Prompts user for their next input or action.
 */
@Injectable()
export class TaskRefinementPromptNextInputNode extends QuestionsNodeBase<TaskRefinementFlowContext> {
  readonly id = TASK_REFINEMENT_NODES.PROMPT_INPUT;
  readonly title = 'Waiting for your input';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements: [
        {
          id: `task_next_input_${Date.now()}`,
          type: 'textarea' as const,
          label: 'What would you like to do next?',
          placeholder:
            "Share your thoughts, request changes, or let me know if you're ready to proceed...",
          required: false,
          influences: [],
        },
      ],
      actions: [],
      data: {
        detectedIntent: 'prompt_next_input',
        intentConfidence: 1.0,
      },
    };
  }
}
