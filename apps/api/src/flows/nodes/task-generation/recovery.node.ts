import { Injectable } from '@nestjs/common';
import { QuestionsNodeBase } from '../base/';
import {
  FlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { TASK_GENERATION_NODES } from '../../constants/node-ids';

/**
 * Task Generation Recovery Node - Flow recovery after errors
 *
 * QUESTIONS node that:
 * - Provides a recovery message after errors
 * - Offers "Generate Tasks" button to continue
 * - Routes back to classification
 */
@Injectable()
export class TaskGenerationRecoveryNode extends QuestionsNodeBase<FlowContext> {
  readonly id = TASK_GENERATION_NODES.RECOVERY;
  readonly title = 'Task Generation';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message:
        'Sorry about that, let me try again. You can either generate tasks immediately or discuss your task generation needs with me.',
      uiElements: [
        {
          type: 'task_generation' as const,
          id: 'generate_tasks_button',
          label: 'Generate Tasks',
          required: false,
          influences: [],
        },
      ],
      data: {
        detectedIntent: '',
        intentConfidence: 0,
      },
    };
  }
}
