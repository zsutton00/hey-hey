import { Injectable } from '@nestjs/common';
import {
  FlowContext,
  FlowUserMessage,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { SecondaryActionHandler } from '../../../generated';
import { TASK_GENERATION_NODES } from '../../constants/node-ids';
import { OpenerNodeBase } from '../base/';

/**
 * Task Generation Welcome Node - Initiates task generation flow
 *
 * OPENER node that:
 * - Welcomes users to task generation
 * - Presents initial options (generate immediately or discuss)
 * - Always transitions to classification node
 */
@Injectable()
export class TaskGenerationWelcomeNode extends OpenerNodeBase<FlowContext> {
  readonly id = TASK_GENERATION_NODES.WELCOME;
  readonly title = 'Task Generation';

  twoPhase = true;

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.QUESTIONS,
      message:
        "Welcome! I'm here to help you generate and manage tasks. You can either generate tasks immediately or discuss your task generation needs with me.",
      uiElements: [
        {
          type: 'task_generation',
          id: 'generate_tasks_button',
          label: 'Generate Tasks',
          submitText: '✨ Generate Tasks',
          required: false,
          influences: [],
          secondaryAction: {
            id: 'continue-conversation-action',
            type: 'field_action',
            label: 'Continue Conversation',
            handler: SecondaryActionHandler.ContinueConversation,
            fieldId: 'generate_tasks_button',
            presentation: 'BUTTON',
            disabled: false,
          },
        },
      ],
      data: {
        detectedIntent: '',
        intentConfidence: 0,
        ragEnabled: false,
      },
    };
  }

  async determineRoutingFromUserMessage(
    _context: FlowContext,
    userMessage: FlowUserMessage,
  ): Promise<string | undefined> {
    console.log(
      '\n\n\n Welcome determineRoutingFromUserMessage!!! \n\n\n',
      userMessage?.handler,
    );
    if (userMessage?.handler === SecondaryActionHandler.ContinueConversation) {
      return TASK_GENERATION_NODES.CONVERSATION;
    }

    return undefined;
  }
}
