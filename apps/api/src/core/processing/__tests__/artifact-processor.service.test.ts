import { Test, TestingModule } from '@nestjs/testing';
import { ArtifactProcessor } from '../artifact-processor.service';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { MessageService } from '../../../services/message.service';
import {
  AnalysisSystemMessageData,
  CreateArtifactDto,
  MessageCreatedUserMessage,
  MessageResponseDto,
  SystemMessageResponseType,
} from '../../../generated';
import { FlowUserMessage } from '../../../types/flow-internal.types';
import {
  ArtifactGenerationRequestedEvent,
  MessageCreatedEvent,
} from '../../events/types/domain-events';
import { EVENT_TYPES } from '../../events/types/event.types';
import { MessageId, WorkflowId } from '../../../types';
import * as TestUtils from '../../../utils/testUtils';
const { testIds } = TestUtils;

describe('ArtifactProcessor', () => {
  let artifactProcessor: ArtifactProcessor;
  let mockArtifactService: jest.Mocked<ArtifactService>;
  let mockMessageService: jest.Mocked<MessageService>;

  const mockUserMessage = TestUtils.createMockFlowUserMessage({
    data: {
      round1_concept: 'AI-powered project management tool',
      round1_requirements:
        'User authentication, task management, real-time collaboration',
      round2_technical_architecture: 'Microservices with React frontend',
    },
  });

  const mockParentMessage = TestUtils.createMockMessage({
    type: 'SYSTEM',
    data: {
      type: 'QUESTIONS',
      response: 'I need more details about your project.',
      detectedIntent: 'test_intent',
      intentConfidence: 0.9,
      nodeId: 'test-node-id',
      uiElements: [
        {
          id: 'concept',
          label: 'What is your project concept?',
          type: 'textarea',
          required: true,
        },
        {
          id: 'requirements',
          label: 'What are your key requirements?',
          type: 'textarea',
          required: true,
        },
        {
          id: 'technical_architecture',
          label: 'What is your preferred technical architecture?',
          type: 'textarea',
          required: true,
        },
      ],
      actions: [],
    },
    status: 'open',
    awaitingResponse: true,
  });

  const expectCreateManyCall = (): CreateArtifactDto[] => {
    const call = mockArtifactService.createMany.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error('Expected ArtifactService.createMany to be called');
    }
    return call;
  };

  beforeEach(async () => {
    mockArtifactService = TestUtils.createMockArtifactService();
    mockMessageService = TestUtils.createMockMessageService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArtifactProcessor,
        {
          provide: ArtifactService,
          useValue: mockArtifactService,
        },
        {
          provide: MessageService,
          useValue: mockMessageService,
        },
      ],
    }).compile();

    artifactProcessor = module.get<ArtifactProcessor>(ArtifactProcessor);

    jest.clearAllMocks();
  });

  describe('maybeGenerateArtifactsForUserAnswers', () => {
    it('should not call ArtifactService when parent message has no questions', async () => {
      const parentWithoutQuestions = {
        ...mockParentMessage,
        data: {
          type: SystemMessageResponseType.Analysis,
          response: 'Just some feedback without questions',
          detectedIntent: 'analysis',
          intentConfidence: 0.5,
          analysis: {
            identifiedTechnologies: [],
            integrationComplexity: 'low',
            potentialChallenges: [],
            recommendations: [],
          },
          uiElements: [],
          // Empty uiElements to confirm no question handling
        } as AnalysisSystemMessageData,
      } as MessageResponseDto;

      await artifactProcessor.maybeGenerateArtifactsForUserAnswers({
        conversationId: testIds.conversation,
        messageId: testIds.message,
        userMessage: mockUserMessage,
        parentMessage: parentWithoutQuestions,
        organizationId: testIds.organization,
      });

      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should not call ArtifactService when parent message has empty questions array', async () => {
      const parentWithEmptyQuestions = {
        ...mockParentMessage,
        data: {
          type: 'QUESTIONS',
          response: 'Just some feedback without questions',
          detectedIntent: 'questions',
          intentConfidence: 0.5,
          uiElements: [], // Empty questions array
        },
      } as MessageResponseDto;

      await artifactProcessor.maybeGenerateArtifactsForUserAnswers({
        conversationId: testIds.conversation,
        messageId: testIds.message,
        userMessage: mockUserMessage,
        parentMessage: parentWithEmptyQuestions,
        organizationId: testIds.organization,
      });

      // Since there are no questions in the parent message, it should not create artifacts
      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should process short responses if they are valid strings', async () => {
      const messageWithShortResponses: FlowUserMessage = {
        ...mockUserMessage,
        data: {
          round1_concept: 'AI', // Short but valid
          round1_requirements: 'Auth', // Short but valid
        },
      };

      mockArtifactService.createMany.mockResolvedValue(2);

      await artifactProcessor.maybeGenerateArtifactsForUserAnswers({
        conversationId: testIds.conversation,
        messageId: testIds.message,
        userMessage: messageWithShortResponses,
        parentMessage: mockParentMessage,
        organizationId: testIds.organization,
      });

      // Should create artifacts even for short responses as long as they are not empty
      expect(mockArtifactService.createMany).toHaveBeenCalledTimes(1);

      const calledDtos = expectCreateManyCall();
      expect(calledDtos).toHaveLength(2); // Both short responses should be processed
    });

    it('should handle ArtifactService errors gracefully', async () => {
      mockArtifactService.createMany.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw
      await expect(
        artifactProcessor.maybeGenerateArtifactsForUserAnswers({
          conversationId: testIds.conversation,
          messageId: testIds.message,
          userMessage: mockUserMessage,
          parentMessage: mockParentMessage,
          organizationId: testIds.organization,
        }),
      ).resolves.not.toThrow();

      expect(mockArtifactService.createMany).toHaveBeenCalledTimes(1);
    });

    it('should skip artifacts when user responds with empty values', async () => {
      const messageWithEmptyResponses: FlowUserMessage = {
        ...mockUserMessage,
        data: {
          round1_concept: 'AI-powered project management tool',
          round1_requirements: '', // Empty string
          round1_empty_field: undefined, // Undefined value
          round2_technical_architecture: 'Microservices with React frontend',
        },
      };

      mockArtifactService.createMany.mockResolvedValue(2);

      await artifactProcessor.maybeGenerateArtifactsForUserAnswers({
        conversationId: testIds.conversation,
        messageId: testIds.message,
        userMessage: messageWithEmptyResponses,
        parentMessage: mockParentMessage,
        organizationId: testIds.organization,
      });

      // Should only create artifacts for valid responses (concept and technical_architecture)
      expect(mockArtifactService.createMany).toHaveBeenCalledTimes(1);

      const calledDtos = expectCreateManyCall();
      expect(calledDtos).toHaveLength(2); // Only 2 valid responses

      // Verify the correct fields were processed
      const firstDto = calledDtos[0];
      const secondDto = calledDtos[1];
      expect(firstDto).toBeDefined();
      expect(secondDto).toBeDefined();
      if (!firstDto || !secondDto) {
        throw new Error('Expected two artifacts to be created');
      }
      expect(firstDto.data?.type).toBe('QA_PAIR');
      expect(secondDto.data?.type).toBe('QA_PAIR');
    });

    it('should not process when parent message is null', async () => {
      await artifactProcessor.maybeGenerateArtifactsForUserAnswers({
        conversationId: testIds.conversation,
        messageId: testIds.message,
        userMessage: mockUserMessage,
        parentMessage: null,
        organizationId: testIds.organization,
      });

      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should not process when parent message is not SYSTEM type', async () => {
      const userParentMessage = {
        ...mockParentMessage,
        type: 'USER',
      } as MessageResponseDto;

      await artifactProcessor.maybeGenerateArtifactsForUserAnswers({
        conversationId: testIds.conversation,
        messageId: testIds.message,
        userMessage: mockUserMessage,
        parentMessage: userParentMessage,
        organizationId: testIds.organization,
      });

      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should not process when system message is not Questions type', async () => {
      const feedbackParentMessage = {
        ...mockParentMessage,
        data: {
          type: 'ANALYSIS',
          response: 'This is analysis, not questions',
          detectedIntent: 'analysis',
          intentConfidence: 0.9,
        },
      } as MessageResponseDto;

      await artifactProcessor.maybeGenerateArtifactsForUserAnswers({
        conversationId: testIds.conversation,
        messageId: testIds.message,
        userMessage: mockUserMessage,
        parentMessage: feedbackParentMessage,
        organizationId: testIds.organization,
      });

      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });
  });

  describe('handleArtifactGenerationRequestedEvent', () => {
    const createArtifactGenerationEvent = (
      overrides: Partial<ArtifactGenerationRequestedEvent> = {},
    ): ArtifactGenerationRequestedEvent => {
      const baseEvent: ArtifactGenerationRequestedEvent = {
        id: testIds.event,
        type: EVENT_TYPES.ARTIFACT.GENERATION_REQUESTED,
        aggregateId: testIds.message,
        payload: {
          payloadType: EVENT_TYPES.ARTIFACT.GENERATION_REQUESTED,
          // ExecutionContext fields
          organizationId: testIds.organization,
          projectId: testIds.project,
          conversationId: testIds.conversation,
          messageId: testIds.message,
          correlationId: 'test-correlation-id',
          causationId: testIds.message,
          timestamp: new Date().toISOString(),
          // Event-specific fields
          userMessage: {
            ...mockUserMessage,
            timestamp: new Date().toISOString(),
          },
          parentMessage: mockParentMessage,
          generationContext: {
            trigger: 'user_response_to_questions',
            systemMessageType: SystemMessageResponseType.Questions,
            validResponseCount: 2,
            skippedResponseCount: 0,
          },
        },
      };
      return { ...baseEvent, ...overrides };
    };

    it('should process artifact generation request event successfully', async () => {
      const event = createArtifactGenerationEvent();
      mockArtifactService.createMany.mockResolvedValue(2);

      await artifactProcessor.handleArtifactGenerationRequestedEvent(event);

      expect(mockArtifactService.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            organizationId: testIds.organization,
            projectId: testIds.project,
            type: 'QA_PAIR',
          }),
        ]),
        expect.anything(),
      );
    });

    it('should handle event with no parent message', async () => {
      const event = createArtifactGenerationEvent({
        payload: {
          ...createArtifactGenerationEvent().payload,
          parentMessage: undefined as unknown as MessageResponseDto,
        },
      });

      await artifactProcessor.handleArtifactGenerationRequestedEvent(event);

      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should handle event with non-SYSTEM parent message', async () => {
      const event = createArtifactGenerationEvent({
        payload: {
          ...createArtifactGenerationEvent().payload,
          parentMessage: TestUtils.createMockMessage({
            type: 'USER',
          }),
        },
      });

      await artifactProcessor.handleArtifactGenerationRequestedEvent(event);

      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should handle errors during artifact generation gracefully', async () => {
      const event = createArtifactGenerationEvent();
      const artifactError = new Error('Database connection failed');
      mockArtifactService.createMany.mockRejectedValue(artifactError);

      // Should not throw - errors are logged but don't propagate
      await expect(
        artifactProcessor.handleArtifactGenerationRequestedEvent(event),
      ).resolves.not.toThrow();

      expect(mockArtifactService.createMany).toHaveBeenCalled();
    });

    it('should log event processing details', async () => {
      const event = createArtifactGenerationEvent();
      mockArtifactService.createMany.mockResolvedValue(2);

      const loggerSpy = jest.spyOn(artifactProcessor['logger'], 'log');

      await artifactProcessor.handleArtifactGenerationRequestedEvent(event);

      expect(loggerSpy).toHaveBeenCalledWith(
        'Processing artifact generation request from event',
        expect.objectContaining({
          eventId: event.id,
          messageId: testIds.message,
          conversationId: testIds.conversation,
          trigger: 'user_response_to_questions',
        }),
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        'Successfully processed artifact generation request',
        expect.objectContaining({
          eventId: event.id,
          messageId: testIds.message,
          conversationId: testIds.conversation,
        }),
      );
    });

    it('should log errors when artifact service fails', async () => {
      const event = createArtifactGenerationEvent();
      const artifactError = new Error('Processing failed');
      mockArtifactService.createMany.mockRejectedValue(artifactError);

      const loggerSpy = jest.spyOn(artifactProcessor['logger'], 'error');

      await artifactProcessor.handleArtifactGenerationRequestedEvent(event);

      // The underlying method catches and logs the error without re-throwing
      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to create artifacts for user responses:',
        expect.any(Error),
      );

      // Since the underlying method doesn't throw, the event handler's catch block is not triggered
      // Only the underlying method's error log should be called
      expect(loggerSpy).toHaveBeenCalledTimes(1);
    });

    it('should log errors when event handler processing fails', async () => {
      const event = createArtifactGenerationEvent();

      // Mock the underlying method to throw an error (simulating event handler level error)
      jest
        .spyOn(artifactProcessor as any, 'generateArtifactsForUserAnswers')
        .mockRejectedValue(new Error('Event handler error'));

      const loggerSpy = jest.spyOn(artifactProcessor['logger'], 'error');

      await artifactProcessor.handleArtifactGenerationRequestedEvent(event);

      // The event handler's catch block should be triggered and log the error
      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to process artifact generation request',
        expect.objectContaining({
          error: 'Event handler error',
          eventId: event.id,
          messageId: testIds.message,
          conversationId: testIds.conversation,
        }),
      );

      expect(loggerSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleUserMessageCreated', () => {
    const createMessageCreatedEvent = (
      overrides: Partial<MessageCreatedEvent> = {},
    ): MessageCreatedEvent => {
      const baseEvent: MessageCreatedEvent = {
        id: testIds.event,
        type: EVENT_TYPES.MESSAGE.CREATED,
        aggregateId: testIds.message,
        payload: {
          payloadType: EVENT_TYPES.MESSAGE.CREATED,

          organizationId: testIds.organization,
          projectId: testIds.project,
          conversationId: testIds.conversation,
          messageId: testIds.message,
          workflowId: testIds.workflow,
          correlationId: 'test-correlation-id',
          causationId: testIds.message,
          timestamp: new Date().toISOString(),
          message: {
            type: 'USER',
            projectId: testIds.project,
            workflowId: testIds.workflow,
            conversationId: testIds.conversation,
            parentMessageId: 'parent-message-id' as MessageId,
            parentMessage: {
              id: 'parent-message-id' as MessageId,
              content: 'Parent message content',
            },
            shouldProcess: true,
          } as unknown as MessageCreatedUserMessage,
        },
      };
      return { ...baseEvent, ...overrides };
    };

    it('should generate artifacts for USER message with SYSTEM parent containing questions', async () => {
      const event = createMessageCreatedEvent();
      const mockUserMessageResponse = TestUtils.createMockMessage({
        type: 'USER',
        parentMessageId: 'parent-message-id' as MessageId,
        data: {
          round1_concept: 'AI-powered project management tool',
          round1_requirements: 'User authentication, task management',
        },
      });

      // Setup mocks
      mockMessageService.getMessage
        .mockResolvedValueOnce(mockUserMessageResponse) // User message
        .mockResolvedValueOnce(mockParentMessage); // Parent message

      mockArtifactService.createMany.mockResolvedValue(2);

      await artifactProcessor.handleUserMessageCreated(event);

      expect(mockMessageService.getMessage).toHaveBeenCalledTimes(2);
      expect(mockMessageService.getMessage).toHaveBeenNthCalledWith(
        1,
        testIds.message,
        testIds.organization,
      );
      expect(mockMessageService.getMessage).toHaveBeenNthCalledWith(
        2,
        'parent-message-id',
        testIds.organization,
      );
      expect(mockArtifactService.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'QA_PAIR',
            category: 'user_response',
            data: expect.objectContaining({
              answer: 'AI-powered project management tool',
              questionField: 'round1_concept',
              type: 'QA_PAIR',
            }),
          }),
        ]),
        expect.anything(),
      );
    });

    it('should skip artifact generation for non-USER messages', async () => {
      const event = createMessageCreatedEvent({
        payload: {
          payloadType: EVENT_TYPES.MESSAGE.CREATED,
          organizationId: testIds.organization,
          projectId: testIds.project,
          conversationId: testIds.conversation,
          messageId: testIds.message,
          correlationId: 'test-correlation-id',
          causationId: testIds.message,
          timestamp: new Date().toISOString(),
          message: {
            type: 'SYSTEM',
            projectId: testIds.project,
            workflowId: testIds.workflow,
            conversationId: testIds.conversation,
            parentMessageId: undefined,
            shouldProcess: false,
          } as unknown as MessageCreatedUserMessage,
        },
      });

      await artifactProcessor.handleUserMessageCreated(event);

      expect(mockMessageService.getMessage).not.toHaveBeenCalled();
      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should skip artifact generation for USER messages without workflowId', async () => {
      const event = createMessageCreatedEvent({
        payload: {
          payloadType: EVENT_TYPES.MESSAGE.CREATED,
          organizationId: testIds.organization,
          projectId: testIds.project,
          conversationId: testIds.conversation,
          messageId: testIds.message,
          correlationId: 'test-correlation-id',
          causationId: testIds.message,
          timestamp: new Date().toISOString(),
          message: {
            type: 'USER',
            projectId: testIds.project,
            workflowId: undefined as unknown as WorkflowId,
            conversationId: testIds.conversation,
            parentMessageId: 'parent-message-id' as MessageId,
            parentMessage: {
              id: 'parent-message-id' as MessageId,
              content: 'Parent message content',
            },
            shouldProcess: false,
          } as unknown as MessageCreatedUserMessage,
        },
      });

      await artifactProcessor.handleUserMessageCreated(event);

      expect(mockMessageService.getMessage).not.toHaveBeenCalled();
      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should handle user message not found gracefully', async () => {
      const event = createMessageCreatedEvent();
      mockMessageService.getMessage.mockResolvedValueOnce(null);

      const loggerSpy = jest.spyOn(artifactProcessor['logger'], 'error');

      await artifactProcessor.handleUserMessageCreated(event);

      expect(loggerSpy).toHaveBeenCalledWith(
        'UserMessage not found',
        expect.objectContaining({
          messageId: testIds.message,
          workflowId: testIds.workflow,
        }),
      );
      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should skip artifact generation when no parent message', async () => {
      const event = createMessageCreatedEvent();
      const mockUserMessageResponse = TestUtils.createMockMessage({
        type: 'USER',
        parentMessageId: undefined,
      });

      mockMessageService.getMessage.mockResolvedValueOnce(
        mockUserMessageResponse,
      );

      await artifactProcessor.handleUserMessageCreated(event);

      expect(mockMessageService.getMessage).toHaveBeenCalledTimes(1);
      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should skip artifact generation when parent is not SYSTEM message', async () => {
      const event = createMessageCreatedEvent();
      const mockUserMessageResponse = TestUtils.createMockMessage({
        type: 'USER',
        parentMessageId: 'parent-message-id' as MessageId,
      });
      const mockNonSystemParent = TestUtils.createMockMessage({
        type: 'USER',
      });

      mockMessageService.getMessage
        .mockResolvedValueOnce(mockUserMessageResponse)
        .mockResolvedValueOnce(mockNonSystemParent);

      await artifactProcessor.handleUserMessageCreated(event);

      expect(mockMessageService.getMessage).toHaveBeenCalledTimes(2);
      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should skip artifact generation when SYSTEM parent has no questions', async () => {
      const event = createMessageCreatedEvent();
      const mockUserMessageResponse = TestUtils.createMockMessage({
        type: 'USER',
        parentMessageId: 'parent-message-id' as MessageId,
      });
      const mockSystemParentWithoutQuestions = TestUtils.createMockMessage({
        type: 'SYSTEM',
        data: {
          type: SystemMessageResponseType.Analysis,
          response: 'This is analysis, not questions',
          detectedIntent: 'analysis',
          intentConfidence: 0.9,
          analysis: {
            identifiedTechnologies: [],
            integrationComplexity: 'low',
            potentialChallenges: [],
            recommendations: [],
          },
          uiElements: [],
        } as AnalysisSystemMessageData,
      });

      mockMessageService.getMessage
        .mockResolvedValueOnce(mockUserMessageResponse)
        .mockResolvedValueOnce(mockSystemParentWithoutQuestions);

      await artifactProcessor.handleUserMessageCreated(event);

      expect(mockMessageService.getMessage).toHaveBeenCalledTimes(2);
      expect(mockArtifactService.createMany).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully without throwing', async () => {
      const event = createMessageCreatedEvent();
      mockMessageService.getMessage.mockRejectedValue(
        new Error('Database error'),
      );

      const loggerSpy = jest.spyOn(artifactProcessor['logger'], 'error');

      // Should not throw
      await expect(
        artifactProcessor.handleUserMessageCreated(event),
      ).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('FAILED TO GENERATE ARTIFACTS'),
        expect.any(Error),
      );
    });
  });
});
