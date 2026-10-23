import { Injectable, Logger } from '@nestjs/common';
import type { TaskStubReview } from 'src/generated/model/taskStubReview';
import { LLMProviderName } from 'src/services/llm/llm-shared';
import type {
  PromptConfig,
  TaskGenerationFlowContext,
} from 'src/types/flow-internal.types';
import type { TaskStubStatus } from 'src/types/task-generation.types';
import { MutableContext } from 'src/utils/mutable-context';
import { v4 as uuidv4 } from 'uuid';
import {
  ExtendedUIFieldType,
  Influence,
  TaskStub,
  TaskStubSystemMessageData,
  TaskStubUserMessage,
} from '../../../generated';
import { SecondaryActionHandler } from '../../../generated';
import {
  FlowUserMessage,
  GenerateNodeBase,
  IntermediateSystemMessageData,
  ProcessLlmResult,
} from '../../../types/flow-internal.types';
import { TASK_GENERATION_NODES } from '../../constants/node-ids';
import { taskStubGenerationResponseSchema } from '../../utils/shared-schemas';
import { buildTaskGenerationContextSection } from './utils/prompt-context.util';

type LlmStubResponse = {
  stubs: Array<{
    title: string;
    shortDescription: string;
    reasoning?: string;
    sourceType?: TaskStub.SourceTypeEnum;
    influences?: Influence[];
  }>;
  response: string;
};

@Injectable()
export class TaskGenerationGenerateStubsNode extends GenerateNodeBase<TaskGenerationFlowContext> {
  private readonly logger = new Logger(TaskGenerationGenerateStubsNode.name);
  readonly id = TASK_GENERATION_NODES.STUBS;
  readonly title = 'Task Stub Generation';

  readonly promptConfig: PromptConfig<TaskGenerationFlowContext> = {
    systemPromptTemplate: (
      context: TaskGenerationFlowContext,
      _userMessage?: FlowUserMessage,
    ) => {
      const sections: string[] = [];

      sections.push(
        `You are a fast ideation assistant that produces concise task stubs (title + 1-2 sentence description).`,
      );

      sections.push(
        buildTaskGenerationContextSection(context, {
          suppressExpansionMode: true, // This node generates stubs, doesn't expand them
        }),
      );

      sections.push(`Guidelines:
Pay close attention to the user's specific requests in the conversation history. Their requests override all defaults:
- If the user specifies an exact number of tasks (e.g., "six tasks"), generate EXACTLY that number and no more.
- If they ask for tasks on a SPECIFIC SUBJECT (e.g., "tasks for authentication"), focus exclusively on that subject
- If they specify priorities or effort levels, honor those preferences
- If they mention specific technologies or approaches, incorporate those into the tasks
- The user's explicit requests take precedence over general initiative scope
- Each stub MUST have a unique title and short description (1-2 sentences)
- Stub titles must use minimal, generic wording; do NOT include proper names, project names, or org names unless the user explicitly used them
- Use source context (initiative, parent task, design doc, prior rounds) to ensure alignment
- Call out dependencies or focus areas in the short description where relevant
- DO NOT include implementation details or acceptance criteria
- Task stubs should describe WHAT needs to be done, not HOW it will be implemented.
- Avoid terms like "state machine", "contracts", "rules", "schemas", or "logic" unless already present in the parent task title.
- Respect prior feedback: avoid ALL rejected ideas from any round and build upon approved direction

Response shape:
- stubs array with title, shortDescription, reasoning (optional)
- response: a brief, casual message about the stubs you're suggesting (e.g., "Here are some tasks that seem like the next logical steps" or "These build on what we discussed earlier")`);

      return sections.join('\n\n');
    },
    responseSchema: taskStubGenerationResponseSchema,
    temperature: 0.4,
    modelCriteria: {
      anthropicTier: 'haiku',
      provider: LLMProviderName.CLAUDE,
    },
  };

  private mergeNewStubs(
    context: TaskGenerationFlowContext,
    llmResponse: LlmStubResponse,
  ): { round: number; stubs: TaskStub[] } {
    const session = context.stubSession ?? { round: 0, stubs: [] };
    const nextRound = session.round + 1;
    const existingKeys = new Set(
      session.stubs.map(
        (stub) =>
          `${stub.title.toLowerCase()}|${stub.shortDescription.toLowerCase()}`,
      ),
    );

    const newStubs: TaskStub[] = [];
    for (const stub of llmResponse.stubs) {
      const key = `${stub.title.toLowerCase()}|${stub.shortDescription.toLowerCase()}`;
      if (existingKeys.has(key)) {
        continue;
      }

      existingKeys.add(key);
      newStubs.push({
        id: uuidv4(),
        title: stub.title,
        shortDescription: stub.shortDescription,
        round: nextRound,
        status: 'suggested',
        sourceType: stub.sourceType || 'initiative',
        reasoning: stub.reasoning,
        influences: stub.influences || [],
      });
    }

    context.stubSession = {
      round: nextRound,
      stubs: [...session.stubs, ...newStubs],
    };

    return {
      round: nextRound,
      stubs: context.stubSession.stubs,
    };
  }

  private isTaskStubUserMessage(
    data: unknown,
  ): data is TaskStubUserMessage & { stubReviews?: TaskStubReview[] } {
    return (
      !!data &&
      typeof data === 'object' &&
      (data as TaskStubUserMessage).type === 'TASK_STUBS' &&
      Array.isArray((data as TaskStubUserMessage).stubReviews)
    );
  }

  private getTaskStubUserMessage(
    userMessage?: FlowUserMessage,
  ): TaskStubUserMessage | undefined {
    const userMessageData = userMessage?.data;
    const data = (
      userMessageData ? Object.values(userMessageData)[0] : undefined
    ) as TaskStubUserMessage | undefined;
    if (!this.isTaskStubUserMessage(data)) {
      return undefined;
    }
    return data;
  }

  private applyUserStubFeedback(
    context: TaskGenerationFlowContext,
    userMessage?: FlowUserMessage,
  ): void {
    const data = this.getTaskStubUserMessage(userMessage);

    if (!data) {
      return;
    }

    const session = context.stubSession ?? { round: 0, stubs: [] };
    const round = Math.max(session.round || 0, data.round || 0);
    const stubsById = new Map<string, TaskStub>();

    for (const stub of session.stubs) {
      stubsById.set(stub.id, { ...stub });
    }

    for (const stub of data.stubs || []) {
      stubsById.set(stub.id, {
        ...stub,
        round: stub.round ?? round,
        status: (stub.status as TaskStubStatus | undefined) || 'suggested',
      });
    }

    for (const review of data.stubReviews || []) {
      const stub = stubsById.get(review.stubId);
      if (!stub) continue;

      if (review.action === 'accept') {
        stub.status = 'approved';
      } else if (review.action === 'reject') {
        stub.status = 'rejected';
      } else if (review.action === 'pending') {
        stub.status = 'suggested';
      }
      stubsById.set(review.stubId, stub);
    }

    for (const manual of data.manuallyAdded || []) {
      const manualId = uuidv4();
      stubsById.set(manualId, {
        id: manualId,
        title: manual.title,
        shortDescription: manual.shortDescription,
        round: round || 1,
        status: 'user_added',
        sourceType: 'user',
        influences: [],
      });
    }

    context.stubSession = {
      round,
      stubs: Array.from(stubsById.values()),
      latestSourceSummary: session.latestSourceSummary,
    };
  }

  private requireStubResponse(
    data: IntermediateSystemMessageData,
  ): LlmStubResponse {
    if (
      !data ||
      typeof data !== 'object' ||
      !('stubs' in data) ||
      !('response' in data)
    ) {
      throw new Error('Missing required stub response fields');
    }
    return data as LlmStubResponse;
  }

  async beforeGeneration(
    tracker: MutableContext<TaskGenerationFlowContext>,
    previousUserMessage?: FlowUserMessage,
  ): Promise<void> {
    this.applyUserStubFeedback(tracker.getContext(), previousUserMessage);
  }

  async processLlmResponse(
    systemMessage: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContext<TaskGenerationFlowContext>,
  ): Promise<ProcessLlmResult> {
    const context = tracker.getContext();
    const llmResponse = this.requireStubResponse(systemMessage);
    const { round, stubs } = this.mergeNewStubs(context, llmResponse);

    const uiElementId = uuidv4();
    const stubMessage: TaskStubSystemMessageData = {
      type: 'TASK_STUBS',
      response: llmResponse.response,
      detectedIntent: 'task_stub_iteration',
      intentConfidence: 1,
      stubs,
      round,
      uiElements: [
        {
          id: uiElementId,
          type: ExtendedUIFieldType.TaskStub,
          label: 'Let us know what you think...',
          placeholder: 'Can you add a task for ...',
          required: false,
          submitText: '✨ Generate Tasks',
          influences: [],
          secondaryAction: {
            id: 'continue-conversation-action',
            type: 'field_action',
            label: '✨ Regnerate',
            handler: SecondaryActionHandler.TaskStubGenerationGenerate,
            fieldId: uiElementId,
            presentation: 'BUTTON',
            disabled: false,
          },
        },
      ],
    };

    this.logger.debug('Generated task stubs', {
      round,
      stubCount: stubs.length,
    });

    return {
      modifiedResult: stubMessage,
    };
  }

  async determineRoutingFromUserMessage(
    _context: TaskGenerationFlowContext,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    if (
      userMessage?.handler === SecondaryActionHandler.TaskStubGenerationGenerate
    ) {
      return TASK_GENERATION_NODES.STUBS;
    }
    return TASK_GENERATION_NODES.GENERATE;
  }
}
