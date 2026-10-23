import { Injectable, Logger } from '@nestjs/common';
import { StandardPlaceholders as P } from 'src/services/llm/placeholders';
import {
  CompensationContext,
  CompensationResult,
  FlowContext,
  FlowUserMessage,
  IntermediateSystemMessageData,
  NonInteractiveNodeBase,
  ProcessLlmResult,
  SuggestedDesignDocFlowContext,
} from 'src/types/flow-internal.types';
import { DesignDocParentEntityType } from 'src/generated';
import type {
  DesignDocResponseDto,
  MessageResponseDto,
  SystemMessageData,
} from 'src/generated';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { ConversationService } from 'src/services/conversation.service';
import { MessageService } from 'src/services/message.service';
import { MessageContentExtractor } from 'src/utils/message-content-extractor';
import { designDocGenerationResponseSchema } from 'src/flows/utils/shared-schemas';
import { ClaudeModel, LLMProviderName } from 'src/services/llm/llm-shared';
import { SUGGESTED_DESIGN_DOC_NODES } from 'src/flows/constants';
import {
  MutableContext,
  MutableContextHandle,
} from 'src/utils/mutable-context';
import { z } from 'zod';
import {
  TEMPLATE_SECTION_SPECS,
  isSupportedDesignDocTemplate,
} from 'src/types/design-doc.types';

type LLMDesignDocResponse = z.infer<
  typeof designDocGenerationResponseSchema
>['designDoc'];

type SuggestedDesignDocContextMetadata = {
  selectedMessageContent?: string;
  conversationContext?: string;
};

type DesignDocSystemMessageData = SystemMessageData & {
  generatedDesignDocId: string;
};

function createDesignDocGenerationActionData(data: {
  designDoc: DesignDocResponseDto;
  response: string;
}): DesignDocSystemMessageData {
  return {
    type: 'ANALYSIS',
    response: data.response,
    detectedIntent: 'design_doc_generation_complete',
    intentConfidence: 1.0,
    generatedDesignDocId: data.designDoc.id,
    actions: [
      {
        type: 'design_doc_created',
        payload: {
          entityId: data.designDoc.id,
        },
      },
    ],
  };
}

@Injectable()
export class CreateSuggestedDesignDocNode extends NonInteractiveNodeBase<SuggestedDesignDocFlowContext> {
  private readonly logger = new Logger(CreateSuggestedDesignDocNode.name);
  readonly id = SUGGESTED_DESIGN_DOC_NODES.GENERATE;

  constructor(
    private readonly designDocService: DesignDocService,
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
      const typedContext = context as SuggestedDesignDocFlowContext;
      const sections: string[] = [];
      const metadata = (typedContext.metadata ||
        {}) as SuggestedDesignDocContextMetadata;
      const template = typedContext.template;
      if (!isSupportedDesignDocTemplate(template)) {
        throw new Error(`Unsupported design doc template: ${template}`);
      }

      const templateSections = TEMPLATE_SECTION_SPECS[
        template as keyof typeof TEMPLATE_SECTION_SPECS
      ] as string[];

      sections.push(
        'You are a design document generation assistant that creates one complete design doc based on a user-selected message.',
      );

      sections.push(`DESIGN DOC SELECTION (CRITICAL):
- Create exactly ONE design document
- Base the document on the selected message and the conversation context leading up to it
- If the selected message is vague, infer the most reasonable scope and assumptions, and state them in the doc`);

      sections.push(`SELECTED MESSAGE:
The user selected "Generate design doc" from this message. Create a design doc that addresses:
${metadata.selectedMessageContent ?? '[missing selected message content]'}`);

      sections.push(`REQUESTED DESIGN DOC NAME:
Use this exact title for the design document:
${typedContext.designDocName}`);

      if (typedContext.designDocDescription) {
        sections.push(`USER DESIGN DOC DESCRIPTION:
The user has added their own description. Consider it when scoping and writing the document:
${typedContext.designDocDescription}`);
      }

      sections.push(`DESIGN DOC TEMPLATE:
Template: ${template}
Sections to include (use these keys and include order indexes):
${templateSections.length > 0 ? templateSections.join(', ') : '[choose appropriate sections for this template]'}`);

      sections.push(`CONVERSATION CONTEXT (last 5 messages up to the selection):
${metadata.conversationContext ?? '[missing conversation context]'}`);

      if (typedContext.initiativeId) {
        sections.push('INITIATIVE CONTEXT:');
        sections.push(P.INITIATIVE.insert());
      }

      if (typedContext.taskId) {
        sections.push('TASK CONTEXT:');
        sections.push(P.TASK.insert());
      }

      sections.push(`DOCUMENT GUIDELINES:
- Create a complete, actionable document aligned with the selected message
- Include clear scope, assumptions, and next steps
- Keep content grounded in conversation context and provided metadata`);

      sections.push(`RESPONSE FORMAT: Return an object with these fields:
- designDoc: Object with:
  - summary: Optional short summary
  - sections: Array of sections, each including:
    - key: Section key (match the template section list)
    - order: Integer ordering index
    - content: Markdown content for the section
- response: Brief acknowledgement to the user about the generated design doc`);

      return sections.join('\n\n');
    },
    responseSchema: designDocGenerationResponseSchema,
    temperature: 0.6,
  };

  async beforeGeneration(
    tracker: MutableContextHandle<SuggestedDesignDocFlowContext>,
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
        `Conversation ${context.sourceConversationId} not found for suggested design doc generation`,
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
        `Message ${context.sourceMessageId} not found for suggested design doc generation`,
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

    tracker.mutate((draft) => {
      draft.metadata = {
        ...(draft.metadata ?? {}),
        selectedMessageContent,
        conversationContext,
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

  private requireResponse(
    data: Pick<SystemMessageData, 'response'>,
    label: string,
  ): string {
    if (typeof data.response !== 'string') {
      throw new Error(`Missing required response for ${label}`);
    }
    return data.response;
  }

  private mapSectionsToDrafts(
    sections: LLMDesignDocResponse['sections'],
  ): LLMDesignDocResponse['sections'] {
    return sections.map((section) => ({
      key: section.key,
      content: section.content,
      order: section.order,
    }));
  }

  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContext<SuggestedDesignDocFlowContext>,
  ): Promise<ProcessLlmResult> {
    const context = tracker.getContext();
    const typedData = systemMessageData as {
      designDoc?: LLMDesignDocResponse;
      response?: string;
    };
    const response = this.requireResponse(
      typedData as SystemMessageData,
      'suggested design doc generation',
    );

    if (!typedData.designDoc) {
      throw new Error('Missing generated design doc payload');
    }

    if (!typedData.designDoc.sections?.length) {
      throw new Error('Generated design doc requires at least one section');
    }

    const draftSections = this.mapSectionsToDrafts(
      typedData.designDoc.sections,
    );

    const designDoc = await this.designDocService.createForAdapter(
      {
        name: context.designDocName,
        template: context.template,
        summary: typedData.designDoc.summary ?? undefined,
        sections: draftSections,
        projectId: context.core.projectId,
        ...(context.taskId
          ? {
              parentEntityId: context.taskId,
              parentEntityType: DesignDocParentEntityType.Task,
            }
          : {}),
      },
      context.core.organizationId,
    );

    this.logger.log(
      '[processLlmResponse] Suggested design doc created successfully',
      {
        designDocId: designDoc.id,
        organizationId: context.core.organizationId,
        template: designDoc.template,
      },
    );

    const modifiedResult = createDesignDocGenerationActionData({
      designDoc,
      response,
    });

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
