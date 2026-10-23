import { Injectable } from '@nestjs/common';

import {
  ArtifactGenerationRequestedEvent,
  MessageCreatedEvent,
} from 'src/core/events/types/domain-events';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  WorkflowId,
} from 'src/types';
import { isQuestionSystemMessageData } from 'src/utils/type-checks';
import {
  MessageResponseDto,
  QuestionsSystemMessage,
  QuestionsSystemMessageData,
} from '../../generated';
import {
  ArtifactMappingContext,
  mapQuestionAnswerPairsToArtifactDtos,
} from '../../mappers';
import { ArtifactService } from '../../services/artifacts/artifact.service';
import { MessageService } from '../../services/message.service';
import { FlowUserMessage } from '../../types/flow-internal.types';
import { processUserResponsesWithQuestions } from '../../utils/response-question-matcher.util';
import { WithWorkflowContext } from '../events/observable-event.context';
import { ContextAwareLogger } from '../logging/context-aware-logger.service';
import { QueueJob } from '../queue/interfaces/queue.interface';
import { ArtifactGenerationJobData } from './types';
import { isTimelineMessage } from 'src/mappers/message.mapper';

/**
 * Job Processor handles the actual processing of jobs and related events.
 * This service should only be initialized in the main application context,
 * not in the worker context to avoid duplication.
 */

const ArtifactProcessorSet = new Set<ArtifactProcessor>();

type ArtifactGenerationRequestedPayload =
  ArtifactGenerationRequestedEvent['payload'];

@Injectable()
export class ArtifactProcessor {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(ArtifactProcessor.name);

  constructor(
    private artifactTypedService: ArtifactService,
    private messageService: MessageService,
  ) {
    ArtifactProcessorSet.add(this);
    if (process.env.NODE_ENV !== 'test' && ArtifactProcessorSet.size > 1) {
      throw new Error(
        'Duplicate ArtifactProcessor instance detected. Ensure a single instance exists across the application.',
      );
    }
  }

  @WithWorkflowContext((...args) => {
    const [job] = args as [QueueJob<ArtifactGenerationJobData>];
    return {
      sourceService: 'ArtifactProcessor',
      sourceMethod: 'processArtifactGeneration',
      context: job,
      metadata: {
        nodeId: job.data.nodeId,
        operationType: 'artifactGeneration',
        requestId: job.requestId,
      },
    };
  })
  async processArtifactGeneration(
    job: QueueJob<ArtifactGenerationJobData>,
  ): Promise<void> {
    this.logger.log(`Processing artifact generation job ${job.id}`);

    try {
      // Simulate artifact generation work
    } catch (error) {
      this.logger.error(`Artifact generation job ${job.id} failed:`, error);
      throw error;
    }
  }

  private async getMessages(
    messageId: MessageId,
    organizationId: OrganizationId,
    workflowId: WorkflowId,
  ) {
    const userMessage = await this.messageService.getMessage(
      messageId,
      organizationId,
    );

    if (!userMessage) {
      this.logger.error('UserMessage not found', {
        messageId,
        workflowId,
      });
      return;
    }

    // Answers to question forms are written dated; an undated queued input
    // is free-form chat and produces no artifacts.
    if (!isTimelineMessage(userMessage)) {
      return;
    }

    // Ensure this is actually a USER message before proceeding
    if (userMessage.type !== 'USER') {
      this.logger.warn('MESSAGE IS NOT USER TYPE', {
        messageId,
        messageType: userMessage.type,
      });
      return;
    }

    // Only generate artifacts if this is a response to a SYSTEM message with questions
    if (!userMessage.parentMessageId) {
      return;
    }

    const parentMessage = await this.messageService.getMessage(
      userMessage.parentMessageId,
      organizationId,
    );

    if (
      !parentMessage ||
      parentMessage.type !== 'SYSTEM' ||
      !isTimelineMessage(parentMessage)
    ) {
      return;
    }

    return {
      parentMessage,
      userMessage,
    };
  }

  /**
   * Handle user message creation - synchronous artifact generation
   * Generates QA_PAIR artifacts immediately for workflow availability
   *
   * @param event - MessageCreatedEvent
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [MessageCreatedEvent];
    return {
      sourceService: 'ArtifactProcessor',
      sourceMethod: 'handleUserMessageCreated',
      context: event.payload,
      metadata: {
        nodeId: event.payload.nodeId,
        operationType: 'userMessageArtifactGeneration',
        requestId: event.payload.requestId,
      },
    };
  })
  async handleUserMessageCreated(event: MessageCreatedEvent): Promise<void> {
    const messageCreateData = event.payload?.message;
    const workflowId = event.payload?.workflowId;

    if (messageCreateData.type !== 'USER' || !workflowId) {
      return;
    }

    const messageId = event.aggregateId;

    this.logger.log('[handleUserMessageCreated] starting artifact generation', {
      messageId: event.aggregateId,
      workflowId,
      conversationId: messageCreateData.conversationId,
      parentMessageId: messageCreateData.parentMessageId,
    });

    try {
      const organizationId = event.payload.organizationId;

      // Fetch the user message from database
      const messagesResult = await this.getMessages(
        messageId,
        organizationId,
        workflowId,
      );

      if (!messagesResult) {
        return; // getMessages already logs the error
      }

      const { userMessage, parentMessage } = messagesResult;

      // Check if the parent message has questions (indicates this is a structured response)
      const systemData = parentMessage.data;

      // Use type guard to ensure we have QuestionsSystemMessageData
      if (!isQuestionSystemMessageData(systemData)) {
        return;
      }

      // Now TypeScript knows systemData is QuestionsSystemMessageData
      if (
        !Array.isArray(systemData.uiElements) ||
        systemData.uiElements.length === 0
      ) {
        this.logger.warn(
          `No UI elements found in system data for parent message ${parentMessage.id}`,
        );
        return;
      }

      // Transform to FlowUserMessage and generate artifacts
      const flowUserMessage: FlowUserMessage = {
        ...userMessage,
        timestamp: userMessage.createdAt,
        workflowId,
      };

      await this.generateArtifactsForUserAnswers({
        conversationId: messageCreateData.conversationId,
        messageId,
        userMessage: flowUserMessage,
        parentMessage,
        organizationId,
        systemData, // No longer needs unsafe casting - TypeScript knows the type
        workflowId,
      });

      this.logger.log(
        '[handleUserMessageCreated] completed artifact generation',
        {
          messageId,
          conversationId: messageCreateData.conversationId,
        },
      );
    } catch (error) {
      this.logger.error(
        `[handleUserMessageCreated] FAILED TO GENERATE ARTIFACTS ${messageId}:`,
        error,
      );
      // Don't throw - artifact generation failure shouldn't block message processing
    }
  }

  /**
   * Generate artifacts when user submits answers to system questions
   * @deprecated keeping this for tests only, we will need to refactor those
   */
  @WithWorkflowContext((...args) => {
    const [params] = args as [
      {
        conversationId: ConversationId;
        messageId: MessageId;
        organizationId: OrganizationId;
      },
    ];
    return {
      sourceService: 'ArtifactProcessor',
      sourceMethod: 'maybeGenerateArtifactsForUserAnswers',
      context: {
        conversationId: params.conversationId,
        organizationId: params.organizationId,
        messageId: params.messageId,
      },
      workflowId: undefined, // Legacy method doesn't have workflowId
      nodeId: undefined,
      metadata: {
        operationType: 'legacyArtifactGeneration',
      },
    };
  })
  async maybeGenerateArtifactsForUserAnswers({
    conversationId,
    messageId,
    userMessage,
    parentMessage,
    organizationId,
  }: {
    conversationId: ConversationId;
    messageId: MessageId;
    userMessage: FlowUserMessage;
    parentMessage: MessageResponseDto | null;
    organizationId: OrganizationId;
  }): Promise<void> {
    // Only generate artifacts if this is a response to a SYSTEM message with questions
    if (!parentMessage || parentMessage.type !== 'SYSTEM') {
      return;
    }

    // Check if the parent message has questions (indicates this is a structured response)
    const systemData = parentMessage.data;

    // Use type guard to ensure we have QuestionsSystemMessageData
    if (!isQuestionSystemMessageData(systemData)) {
      return;
    }

    // Now TypeScript knows systemData is QuestionsSystemMessageData
    if (
      !Array.isArray(systemData.uiElements) ||
      systemData.uiElements.length === 0
    ) {
      this.logger.warn(
        `No UI elements found in system data for parent message ${parentMessage.id}`,
      );
      return;
    }

    await this.generateArtifactsForUserAnswers({
      conversationId,
      messageId,
      userMessage,
      parentMessage,
      organizationId,
      systemData, // No longer needs unsafe casting
      workflowId: undefined,
    });
  }

  private async generateArtifactsForUserAnswers({
    conversationId,
    messageId,
    userMessage,
    parentMessage,
    organizationId,
    systemData,
    workflowId,
  }: {
    conversationId: ConversationId;
    messageId: MessageId;
    userMessage: FlowUserMessage;
    parentMessage: MessageResponseDto | null;
    organizationId: OrganizationId;
    systemData: QuestionsSystemMessageData;
    workflowId: WorkflowId | undefined;
  }): Promise<void> {
    if (
      !Array.isArray(systemData.uiElements) ||
      systemData.uiElements.length === 0
    ) {
      this.logger.warn(
        `No UI elements found in system data for parent message ${parentMessage?.id}`,
      );
      return;
    }

    if (!parentMessage) {
      this.logger.warn(
        `Missing parent message for artifact generation on ${messageId}`,
      );
      return;
    }

    if ((parentMessage as QuestionsSystemMessage).archive === false) {
      this.logger.debug(
        `Parent message "archive" was set to false ${parentMessage.id}`,
      );
      return;
    }

    // Process user responses against system questions
    const { validResponses, skippedResponses } =
      processUserResponsesWithQuestions(
        userMessage.data,
        systemData,
        this.logger,
      );

    this.logger.debug(`[generateArtifactsForUserAnswers] processed responses`, {
      skippedResponses,
      validResponses,
    });

    if (validResponses.length === 0) {
      this.logger.debug(
        `No valid user responses found, skipping artifact generation. Skipped: ${skippedResponses.length}`,
        { skippedResponses },
      );
      return;
    }

    this.logger.log(
      `Generating artifacts for ${validResponses.length} user responses`,
      {
        messageId,
        parentMessageId: parentMessage.id,
        validCount: validResponses.length,
        skippedCount: skippedResponses.length,
        responseKeys: validResponses.map((r) => r.questionField),
      },
    );

    if (!systemData.nodeId) {
      throw new Error(
        `Missing nodeId in system message data for message ${messageId}. SystemMessageData must include nodeId for artifact processing.`,
      );
    }

    // Create mapping context for artifact generation
    const mappingContext: ArtifactMappingContext = {
      userMessage,
      conversationId,
      parentMessage,
      messageId,
      organizationId,
      nodeId: systemData.nodeId, // Extract nodeId from parent system message
    };

    // Generate artifact DTOs
    const artifactDtos = mapQuestionAnswerPairsToArtifactDtos(
      validResponses,
      mappingContext,
    );

    this.logger.debug(
      `[generateArtifactsForUserAnswers] calling artifactTypedService to create...`,
      {
        artifactDtos,
      },
    );

    // Create artifacts in batch using typed service
    try {
      const createdCount = await this.artifactTypedService.createMany(
        artifactDtos,
        {
          nodeId: systemData.nodeId,
          workflowId,
        },
      );

      this.logger.log(`Created ${createdCount} artifacts for user responses`, {
        responseKeys: validResponses.map((response) => response.questionField),
        createdCount,
        totalCount: artifactDtos.length,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create artifacts for user responses:`,
        error,
      );
      // Don't throw - this shouldn't break the message processing flow
    }
  }

  @WithWorkflowContext((...args) => {
    const [payload] = args as [ArtifactGenerationRequestedPayload];
    return {
      sourceService: 'ArtifactProcessor',
      sourceMethod: 'handleSystemParentMessages',
      context: {
        conversationId: payload.conversationId,
        organizationId: payload.organizationId,
        messageId: payload.messageId,
      },
      workflowId: payload.workflowId,
      nodeId: payload.parentMessage?.data?.nodeId ?? payload.nodeId,
      metadata: {
        operationType: 'systemParentMessageArtifacts',
      },
    };
  })
  async handleSystemParentMessages(
    payload: ArtifactGenerationRequestedPayload,
  ) {
    if (payload.conversationId && payload.messageId && payload.parentMessage) {
      // Ensure parent message is a system message before accessing its data
      if (payload.parentMessage.type !== 'SYSTEM') {
        return;
      }

      // Now we can safely access the system message data
      const systemData = payload.parentMessage.data;

      if (isQuestionSystemMessageData(systemData)) {
        await this.generateArtifactsForUserAnswers({
          ...payload,
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          systemData,
          workflowId: payload.workflowId,
        });
      }
    } else {
      this.logger.debug(
        `[handleSystemParentMessages] payload missing required data`,
        {
          payload,
        },
      );
    }
  }

  /**
   * Handle artifact generation requests from domain events
   * This replaces the direct method call from MessageProcessor
   */
  @WithWorkflowContext((...args) => {
    const [event] = args as [ArtifactGenerationRequestedEvent];
    return {
      sourceService: 'ArtifactProcessor',
      sourceMethod: 'handleArtifactGenerationRequestedEvent',
      context: {
        conversationId: event.payload.conversationId,
        organizationId: event.payload.organizationId,
        messageId: event.payload.messageId,
        workflowId: event.payload.workflowId,
      },
      nodeId: event.payload.parentMessage?.data?.nodeId ?? event.payload.nodeId,
      metadata: {
        operationType: 'artifactGenerationRequested',
        trigger: event.payload.generationContext.trigger,
      },
    };
  })
  async handleArtifactGenerationRequestedEvent(
    event: ArtifactGenerationRequestedEvent,
  ): Promise<void> {
    const { payload } = event;

    this.logger.log('Processing artifact generation request from event', {
      eventId: event.id,
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      trigger: payload.generationContext.trigger,
    });

    try {
      if (event.payload.parentMessage?.type === 'SYSTEM') {
        await this.handleSystemParentMessages(payload);
      }

      this.logger.log('Successfully processed artifact generation request', {
        eventId: event.id,
        messageId: payload.messageId,
        conversationId: payload.conversationId,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error('Failed to process artifact generation request', {
        error: errorMessage,
        stack: errorStack,
        eventId: event.id,
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        trigger: payload.generationContext.trigger,
        parentMessageType: payload.parentMessage?.type,
        parentMessageId: payload.parentMessage?.id,
        organizationId: payload.organizationId,
      });

      // For critical artifact generation failures, we should consider:
      // 1. Creating a failed artifact record for tracking
      // 2. Publishing an error event for monitoring
      // 3. Potentially retrying if it's a transient error

      // For now, we log comprehensively but don't throw to avoid
      // breaking the event processing pipeline
      // TODO: Consider implementing artifact generation retry mechanism
      // TODO: Consider publishing ARTIFACT.GENERATION_FAILED event for monitoring
    }
  }
}
