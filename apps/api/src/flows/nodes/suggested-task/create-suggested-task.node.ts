import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { StandardPlaceholders as P } from 'src/services/llm/placeholders';
import {
  CompensationContext,
  CompensationResult,
  FlowContext,
  FlowUserMessage,
  IntermediateSystemMessageData,
  NonInteractiveNodeBase,
  ProcessLlmResult,
  SuggestedTaskFlowContext,
} from 'src/types/flow-internal.types';
import type {
  Influence,
  MessageResponseDto,
  SystemMessageData,
  TaskResponseDto,
  TasksSystemMessageData,
} from 'src/generated';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';
import { TaskService } from 'src/services/tasks/task.service';
import { TaskDraft } from 'src/services/tasks/types';
import { taskGenerationResponseSchema } from 'src/flows/utils/shared-schemas';
import { ClaudeModel, LLMProviderName } from 'src/services/llm/llm-shared';
import { ConversationService } from 'src/services/conversation.service';
import { MessageService } from 'src/services/message.service';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { z } from 'zod';
import { SUGGESTED_TASK_NODES } from 'src/flows/constants';
import {
  MutableContext,
  MutableContextHandle,
} from 'src/utils/mutable-context';

/**
 * Task item shape from taskGenerationResponseSchema
 * Includes fields beyond the OpenAPI GeneratedTask type
 */
type LLMTaskResponse = z.infer<
  typeof taskGenerationResponseSchema
>['tasks'][number];

type SuggestedTaskContextMetadata = {
  selectedMessageContent?: string;
  conversationContext?: string;
  parentTaskContext?: string;
};

// Helper function to create properly typed task generation data
function createTaskGenerationActionData(data: {
  tasks: TaskResponseDto[];
  response: string;
}) {
  return {
    type: 'TASKS',
    response: data.response,
    detectedIntent: 'task_generation_complete',
    intentConfidence: 1.0,
    generatedTaskIds: data.tasks.map((t) => t.id),
    tasks: data.tasks,
    uiElements: [
      {
        id: 'task-list',
        type: 'task_list',
        label: 'Generated Tasks',
        required: true,
      },
    ],
    actions: [
      {
        type: 'task_management',
        payload: {
          payloadType: 'task_management',
          taskCount: data.tasks.length,
          categories: [] as string[],
        },
      },
    ],
  };
}

@Injectable()
export class CreateSuggestedTaskNode extends NonInteractiveNodeBase<SuggestedTaskFlowContext> {
  private readonly logger = new Logger(CreateSuggestedTaskNode.name);
  readonly id = SUGGESTED_TASK_NODES.GENERATE;

  constructor(
    private readonly taskService: TaskService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
  ) {
    super();
  }

  readonly promptConfig = {
    modelCriteria: {
      model: ClaudeModel.CLAUDE_4_HAIKU_5,
      provider: LLMProviderName.CLAUDE,
    },
    maxTokens: 20000,
    timeout: 240000,

    systemPromptTemplate: (context: FlowContext) => {
      const typedContext = context as SuggestedTaskFlowContext;
      const sections: string[] = [];
      const metadata = (typedContext.metadata ||
        {}) as SuggestedTaskContextMetadata;

      sections.push(
        'You are a task generation assistant that creates one actionable, well-structured task based on a user-selected message.',
      );

      sections.push(`TASK SELECTION (CRITICAL):
- You MUST create exactly ONE task
- Base the task on the selected message and the conversation context leading up to it
- If the selected message is vague, infer the most reasonable specific task that fulfills it
- Do NOT create multiple tasks or split into subtasks`);

      sections.push(`SELECTED MESSAGE:
The user selected "Generate task" from this message. Create a task that does:
${metadata.selectedMessageContent ?? '[missing selected message content]'}`);

      sections.push(`REQUESTED TASK NAME:
Use this exact title for the task:
${typedContext.taskName}`);
      sections.push(
        'Do not add any proper names, project names, or org names beyond the provided task title.',
      );

      if (typedContext.taskDescription) {
        sections.push(`USER TASK DESCRIPTION:
The user has added their own description. We can expand upon it but consider it when scoping and writing the task:
          ${typedContext.taskDescription}`);
      }

      sections.push(`CONVERSATION CONTEXT (last 5 messages up to the selection):
${metadata.conversationContext ?? '[missing conversation context]'}`);

      sections.push('INITIATIVE CONTEXT:');
      sections.push(P.INITIATIVE.insert());

      if (metadata.parentTaskContext) {
        sections.push(metadata.parentTaskContext);
      }

      sections.push(`TASK STRUCTURE GUIDELINES:
- Create one task that is specific and actionable
- Ensure the task directly supports the initiative
- Use clear, concrete descriptions and acceptance criteria
- Include assumptions and implementation details only when grounded in context`);

      sections.push(`RESPONSE FORMAT: Return an object with these fields:
- tasks: Array with exactly one task. The task must include:
  - taskType: STANDARD or BUG
  - title: A clear, concise title for the task
  - description: High-level explanation of what needs to be done
  - acceptanceCriteria: Required for STANDARD tasks; omitted for BUG tasks
  - influences: Optional array of references to prior entities informing the task
- response: Brief acknowledgement to the user about the generated task and next steps`);

      return sections.join('\n\n');
    },
    responseSchema: taskGenerationResponseSchema,
    temperature: 0.6,
  };

  async beforeGeneration(
    tracker: MutableContextHandle<SuggestedTaskFlowContext>,
    _previousUserMessage?: FlowUserMessage,
  ): Promise<void> {
    const context = tracker.getContext();
    const { organizationId, projectId } = context.core;

    const conversation = await this.conversationService.getConversation(
      context.sourceConversationId,
      organizationId,
    );
    if (!conversation) {
      throw new Error(
        `Conversation ${context.sourceConversationId} not found for suggested task generation`,
      );
    }

    if (conversation.projectId !== projectId) {
      throw new Error(
        `Conversation ${context.sourceConversationId} does not belong to project ${projectId}`,
      );
    }

    const selectedMessage = await this.messageService.getMessageForAdapter(
      context.sourceMessageId,
      organizationId,
      true,
    );
    if (!selectedMessage) {
      throw new Error(
        `Message ${context.sourceMessageId} not found for suggested task generation`,
      );
    }

    if (selectedMessage.conversationId !== context.sourceConversationId) {
      throw new Error(
        `Message ${context.sourceMessageId} does not belong to conversation ${context.sourceConversationId}`,
      );
    }

    const windowMessages = await this.messageService.getContextWindowForMessage(
      context.sourceConversationId,
      context.sourceMessageId,
      organizationId,
      5,
    );
    if (windowMessages.length === 0) {
      throw new Error(
        `No message context found for message ${context.sourceMessageId} in conversation ${context.sourceConversationId}`,
      );
    }

    const conversationContext = this.formatConversationContext(windowMessages);
    const selectedMessageContent = this.formatMessageContent(selectedMessage);

    let parentTaskContext: string | undefined;
    if (context.parentTaskId) {
      const parentTask = await this.taskService.findOneForAdapter(
        context.parentTaskId,
        organizationId,
      );
      if (!parentTask) {
        throw new Error(`Parent task ${context.parentTaskId} not found`);
      }

      const parentTaskContent = materializedSectionsToContentMap(
        parentTask.sections,
      );
      parentTaskContext = [
        'PARENT TASK CONTEXT:',
        `Title: ${parentTask.name}`,
        `Type: ${parentTask.type}`,
        `Description: ${parentTaskContent.description || 'n/a'}`,
        `Acceptance Criteria: ${parentTaskContent.acceptanceCriteria || 'n/a'}`,
      ].join('\n');
    }

    tracker.mutate((draft) => {
      draft.metadata = {
        ...(draft.metadata ?? {}),
        selectedMessageContent,
        conversationContext,
        ...(parentTaskContext ? { parentTaskContext } : {}),
      };
    });
  }

  private formatMessageContent(message: {
    type: MessageResponseDto['type'];
    data: MessageResponseDto['data'];
  }): string {
    if (message.type === 'SYSTEM') {
      const data = message.data as SystemMessageData | undefined;
      const response = data?.response;
      if (typeof response === 'string' && response.trim().length > 0) {
        return response.trim();
      }
      return '[system message without response]';
    }

    return MessageContentExtractor.extractMessageContent(
      message as unknown as MessageResponseDto,
    );
  }

  private formatConversationContext(messages: MessageResponseDto[]): string {
    return messages
      .map((message) => {
        const role = message.type === 'USER' ? 'USER' : 'ASSISTANT';
        const content = this.formatMessageContent(message).replace(/\s+/g, ' ');
        return `${role}: ${content}`;
      })
      .join('\n');
  }

  /**
   * Convert LLM task response to TaskDraft format
   */
  private convertLLMTasksToDrafts(llmTasks: LLMTaskResponse[]): TaskDraft[] {
    return llmTasks.map((task) => ({
      id: uuidv4(),
      title: task.title,
      description: task.description,
      taskType: task.taskType,
      acceptanceCriteria: task.acceptanceCriteria,
      priority: 'medium',
      influences: this.normalizeInfluences(task.influences),
    }));
  }

  private normalizeInfluences(
    influences: LLMTaskResponse['influences'],
  ): Influence[] {
    if (!influences) {
      return [];
    }

    return influences
      .filter(
        (influence): influence is NonNullable<typeof influences>[number] =>
          Boolean(influence?.entityId),
      )
      .map((influence) => ({
        entityId: influence.entityId,
        entityType: influence.entityType,
        reasoning: influence.reasoning ?? '',
        reasonType: influence.reasonType,
        confidence: influence.confidence ?? undefined,
      }));
  }

  private requireResponse(
    data: Pick<SystemMessageData, 'response'>,
    label: string,
  ): string {
    if (typeof data.response !== 'string') {
      throw new Error(`Missing required response for ${label}`);
    }
    return data.response;
  }

  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContext<SuggestedTaskFlowContext>,
  ): Promise<ProcessLlmResult> {
    const context = tracker.getContext();
    const typedData = systemMessageData as TasksSystemMessageData;
    const response = this.requireResponse(
      typedData,
      'suggested task generation',
    );
    const { tasks, response: _response, ...remainingData } = typedData;

    if (!tasks || tasks.length !== 1) {
      throw new Error(
        `Expected exactly one task from suggested task generation, received ${tasks?.length ?? 0}`,
      );
    }

    const taskDrafts = this.convertLLMTasksToDrafts(
      tasks as unknown as LLMTaskResponse[],
    ).map((draft) => {
      return {
        ...draft,
        title: context.taskName ?? draft.title,
        parentTaskId: context.parentTaskId ?? undefined,
      };
    });

    const realTasks = await this.taskService.createFromDrafts(
      taskDrafts,
      context.core.organizationId,
      context.initiativeId,
      context.sourceConversationId,
      {
        projectId: context.core.projectId,
        generationModel: 'claude-haiku-4-5',
        generationPrompt: 'create-suggested-task',
      },
    );

    this.logger.log(
      '[processLlmResponse] Suggested task created successfully',
      {
        taskCount: realTasks.length,
        taskIds: realTasks.map((t) => t.id),
        organizationId: context.core.organizationId,
        initiativeId: context.initiativeId,
      },
    );

    const modifiedResult = {
      ...remainingData,
      ...createTaskGenerationActionData({
        tasks: realTasks,
        response,
      }),
    } as SystemMessageData;

    return { modifiedResult };
  }

  async compensate(
    _context: FlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 8000 + attemptCount * 2000;
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `Generation timeout, retry ${attemptCount + 1}/3 with ${delay}ms delay`,
      };
    }

    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 3) {
      return {
        action: 'RETRY',
        retryDelayMs: 12000,
        reason: 'Generation rate limited, extended delay before retry',
      };
    }

    return { action: 'FAIL' };
  }
}
