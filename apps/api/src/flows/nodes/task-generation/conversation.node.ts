import { Injectable } from '@nestjs/common';
import { LlmQuestionsNodeBase } from '../base/';
import {
  CompensationContext,
  CompensationResult,
  FlowContext,
  FlowUserMessage,
  IntermediateSystemMessageData,
  ProcessLlmResult,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import type { QuestionsSystemMessageData } from '../../../generated';
import {
  ExtendedUIFieldType,
  SecondaryActionHandler,
} from '../../../generated';
import { TASK_GENERATION_NODES } from '../../constants/node-ids';
import { StandardPlaceholders as P } from '../../../services/llm/placeholders';
import { taskGenerationConversationResponseSchema } from '../../utils/shared-schemas';

/**
 * Task Generation Conversation Node - Conversational task discussion
 *
 * LLM_QUESTIONS node that:
 * - Engages in helpful conversation about task generation
 * - Helps users understand their task needs
 * - Always provides "Generate Tasks" UI element
 * - Routes back to classification for next user input
 */
@Injectable()
export class TaskGenerationConversationNode extends LlmQuestionsNodeBase<FlowContext> {
  readonly id = TASK_GENERATION_NODES.CONVERSATION;
  readonly title = 'Task Generation Discussion';

  readonly promptConfig = {
    systemPromptTemplate: `You are a helpful assistant that engages in conversation about task generation and project planning.

${P.CONVERSATION_HISTORY.insert()}

Current initiative:
${P.INITIATIVE.insert()}

Tasks already created:
${P.INITIATIVE_TASKS.insert()}

The user wants to have a conversation to help you understand their needs. When they're ready, they'll click a "Generate Tasks" button - your job right now is pure conversation focused on gathering context.

Your goals in this conversation:
- Deeply understand their project context, goals, scope, and constraints
- Learn about dependencies, priorities, and timeline considerations
- Clarify what types of tasks would be most useful (granularity, format, categories)
- Understand their workflow and how tasks fit into their process
- Gather any domain-specific context that would help generate better tasks

The more context you gather now, the better the tasks will be when they click "Generate Tasks."

Guidelines:
- Be conversational and natural - you're having a dialogue, not conducting an interview
- Ask ONE thoughtful question at a time to avoid overwhelming them
- Build on what they share - reference their previous answers to show you're listening
- If they mention something unclear or interesting, dig deeper
- You don't need to prompt them to generate tasks - they have a button for that

Respond naturally as a collaborative partner helping them think through their project.`,
    responseSchema: taskGenerationConversationResponseSchema,
    temperature: 0.7,
  };

  // Add the task_generation UI element to all responses from this node
  async processLlmResponse(
    systemMessage: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    _tracker: MutableContextHandle<FlowContext>,
  ): Promise<ProcessLlmResult> {
    const baseMessage = systemMessage as QuestionsSystemMessageData;
    return {
      modifiedResult: {
        ...baseMessage,
        uiElements: [
          {
            type: ExtendedUIFieldType.TaskGeneration,
            id: 'generate_tasks_button',
            label: 'Generate Tasks',
            submitText: '✨ Generate Tasks',
            required: false,
            influences: [],
            secondaryAction: {
              id: 'continue-conversation-action',
              type: 'field_action',
              label: 'Continue Conversation',
              presentation: 'INLINE',
              handler: SecondaryActionHandler.ContinueConversation,
              fieldId: 'generate_tasks_button',
              disabled: false,
            },
          },
        ],
      },
    };
  }

  async determineRoutingFromUserMessage(
    _context: FlowContext,
    userMessage: FlowUserMessage,
  ): Promise<string | undefined> {
    if (userMessage?.handler === SecondaryActionHandler.ContinueConversation) {
      return TASK_GENERATION_NODES.CONVERSATION;
    }

    return undefined;
  }

  async compensate(
    _context: FlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    // Simple retry logic for timeouts (up to 2 attempts)
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 5000,
        reason: 'Timeout, retrying with backoff to avoid dead-end conversation',
      };
    }

    // For rate limiting, retry with longer delay
    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 2) {
      return {
        action: 'RETRY',
        retryDelayMs: 5000,
        reason:
          'Rate limited, retrying with backoff to avoid dead-end conversation',
      };
    }

    if (attemptCount >= 2) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: TASK_GENERATION_NODES.WELCOME,
      };
    }

    return { action: 'FAIL' };
  }
}
