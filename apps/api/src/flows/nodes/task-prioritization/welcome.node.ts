import { Injectable } from '@nestjs/common';
import { OpenerNodeBase } from '../base/';
import {
  FlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { TASK_PRIORITIZATION_NODES } from '../../constants';

@Injectable()
export class TaskPrioritizationWelcomeNode extends OpenerNodeBase<FlowContext> {
  readonly id = TASK_PRIORITIZATION_NODES.WELCOME;
  readonly title = 'Task Prioritization';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message:
        "I'll fetch all initiatives and their tasks, then generate a single priority queue of the next 10 tasks with rationale. No action needed from you—I'll start now.",
      data: {
        detectedIntent: 'task_prioritization_start',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  }
}
