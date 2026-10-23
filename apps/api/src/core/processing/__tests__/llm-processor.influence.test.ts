/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { LlmProcessor } from '../llm-processor.service';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { IntentDetectorService } from '../../../services/intent-detector.service';
import { LLMClientService } from '../../../services/llm/llm-client.service';
import { NodeExecutionService } from '../../../services/workflows/node-execution.service';
import { MessageService } from '../../../services/message.service';
import { DomainEventPublisher } from '../../events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../events/tokens';
import { LlmCompleteEvent } from '../../events/types/domain-events';
import {
  Influence,
  ArtifactSourceType,
  ArtifactType,
  ArtifactStatus,
} from '../../../generated';
import { ArtifactInsight } from '../../../flows/utils/shared-schemas';
import * as TestUtils from '../../../utils/testUtils';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (!value) {
    throw new Error(`Expected ${label}`);
  }
  return value;
};

describe('LlmProcessor - Influence Handling', () => {
  let processor: LlmProcessor;
  let mockArtifactService: jest.Mocked<ArtifactService>;
  let mockEventPublisher: jest.Mocked<DomainEventPublisher>;

  const { testIds } = TestUtils;
  const RelationshipType = {
    References: 'references',
    DependsOn: 'depends_on',
    SimilarTo: 'similar_to',
    Blocks: 'blocks',
  } as const satisfies Record<string, Influence['reasonType']>;

  beforeEach(async () => {
    const mockArtifactServiceInstance = TestUtils.createMockArtifactService();
    const mockIntentDetectorService =
      TestUtils.createMockIntentDetectorService();
    const mockLLMClientService = TestUtils.createMockLLMClientService();
    const mockFlowEngineService = TestUtils.createMockFlowEngineService();
    const mockMessageService = TestUtils.createMockMessageService();
    const mockEventPublisherInstance: jest.Mocked<DomainEventPublisher> = {
      publish: jest.fn(),
    } as unknown as jest.Mocked<DomainEventPublisher>;
    const mockLogger: jest.Mocked<Logger> = {
      log: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    const mockModule: TestingModule = await Test.createTestingModule({
      providers: [
        LlmProcessor,
        { provide: ArtifactService, useValue: mockArtifactServiceInstance },
        { provide: IntentDetectorService, useValue: mockIntentDetectorService },
        { provide: LLMClientService, useValue: mockLLMClientService },
        { provide: NodeExecutionService, useValue: mockFlowEngineService },
        { provide: MessageService, useValue: mockMessageService },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: mockEventPublisherInstance,
        },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    processor = mockModule.get<LlmProcessor>(LlmProcessor);
    mockArtifactService = mockModule.get(ArtifactService);
    mockEventPublisher = mockModule.get(DOMAIN_EVENT_PUBLISHER_TOKEN);

    // Mock the created artifact response using TestUtils
    const mockArtifactResponse = TestUtils.createMockArtifact({
      id: 'created-artifact-123',
      projectId: testIds.project,
      type: ArtifactType.Insight,
      title: 'Test Insight',
      status: ArtifactStatus.Active,
    });
    mockArtifactService.create.mockResolvedValue(mockArtifactResponse);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe.skip('processArtifactGeneration with influences', () => {
    it('should filter and transform influences correctly when creating artifacts', async () => {
      // Arrange
      const mockEvent: LlmCompleteEvent = {
        id: 'event-123',
        type: 'llm.complete',
        aggregateId: testIds.request,
        payload: {
          payloadType: 'llm.complete',
          requestId: testIds.request,
          conversationId: testIds.conversation,
          projectId: testIds.project,
          organizationId: testIds.organization,
          messageId: testIds.message,
          userId: testIds.user,
          workflowId: testIds.workflow,
          status: 'success',
          systemMessageData: {
            insights: [
              {
                category: 'userGoals',
                title: 'Test Insight',
                content: 'Test content',
                confidence: 0.9,
                reasoning: 'Test reasoning',
                influences: [
                  {
                    entityId: 'valid-artifact-1',
                    reasoning: 'Valid reasoning',
                    reasonType: RelationshipType.References,
                    confidence: 0.8,
                  },
                  {
                    entityId: '', // Invalid - empty entityId
                    reasoning: 'Invalid reasoning',
                    reasonType: RelationshipType.SimilarTo,
                  },
                  {
                    entityId: 'valid-artifact-2',
                    reasoning: 'Another valid reasoning',
                    reasonType: RelationshipType.DependsOn,
                    // no confidence - should be undefined
                  },
                  {
                    entityId: 'valid-artifact-3',
                    reasoning: '', // Invalid - empty reasoning
                    reasonType: RelationshipType.Blocks,
                  },
                ],
              } as ArtifactInsight,
            ],
          } as any,
        },
      };

      // Act
      await (processor as any).handleLLMCompletionEvent(mockEvent);

      // Assert
      expect(mockArtifactService.create).toHaveBeenCalledWith({
        type: 'INSIGHT',
        title: 'Test Insight',
        data: expect.objectContaining({
          type: 'INSIGHT',
          category: 'userGoals',
          title: 'Test Insight',
          content: 'Test content',
        }),
        category: 'userGoals',
        tags: undefined,
        sourceId: testIds.conversation,
        sourceType: ArtifactSourceType.Conversation,
        projectId: testIds.project,
        organizationId: testIds.organization,
        status: 'ACTIVE',
        generateEmbedding: false,
        influences: [
          {
            entityId: 'valid-artifact-1',
            reasoning: 'Valid reasoning',
            reasonType: RelationshipType.References,
            confidence: 0.8,
          },
          {
            entityId: 'valid-artifact-2',
            reasoning: 'Another valid reasoning',
            reasonType: RelationshipType.DependsOn,
            confidence: undefined,
          },
        ],
      });
    });

    it('should handle missing or invalid influences gracefully', async () => {
      // Test case 1: influences is undefined
      const eventWithoutInfluences: LlmCompleteEvent = {
        id: 'event-124',
        type: 'llm.complete',
        aggregateId: testIds.request,
        payload: {
          payloadType: 'llm.complete',

          requestId: testIds.request,
          conversationId: testIds.conversation,
          projectId: testIds.project,
          organizationId: testIds.organization,
          messageId: testIds.message,
          userId: testIds.user,
          workflowId: testIds.workflow,
          status: 'success',
          systemMessageData: {
            insights: [
              {
                category: 'userGoals',
                title: 'Test Insight',
                content: 'Test content',
                confidence: 0.9,
                reasoning: 'Test reasoning',
                // influences is undefined
              } as ArtifactInsight,
            ],
          } as any,
        },
      };

      await (processor as any).handleLLMCompletionEvent(eventWithoutInfluences);

      expect(mockArtifactService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          influences: undefined,
        }),
      );

      // Test case 2: influences is empty array
      const eventWithEmptyInfluences: LlmCompleteEvent = {
        ...eventWithoutInfluences,
        payload: {
          ...eventWithoutInfluences.payload,
          systemMessageData: {
            insights: [
              {
                category: 'userGoals',
                title: 'Test Insight',
                content: 'Test content',
                confidence: 0.9,
                reasoning: 'Test reasoning',
                influences: [],
              } as ArtifactInsight,
            ],
          } as any,
        },
      };

      await (processor as any).handleLLMCompletionEvent(
        eventWithEmptyInfluences,
      );

      expect(mockArtifactService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          influences: [],
        }),
      );

      // Test case 3: All influences are invalid
      const eventWithInvalidInfluences: LlmCompleteEvent = {
        ...eventWithoutInfluences,
        payload: {
          ...eventWithoutInfluences.payload,
          systemMessageData: {
            insights: [
              {
                category: 'userGoals',
                title: 'Test Insight',
                content: 'Test content',
                confidence: 0.9,
                reasoning: 'Test reasoning',
                influences: [
                  {
                    entityId: '',
                    reasoning: '',
                    reasonType: '',
                  },
                  {
                    entityId: 'valid-id',
                    reasoning: '', // Invalid - empty reasoning
                    reasonType: RelationshipType.SimilarTo,
                  },
                ],
              } as ArtifactInsight,
            ],
          } as any,
        },
      };

      await (processor as any).handleLLMCompletionEvent(
        eventWithInvalidInfluences,
      );

      expect(mockArtifactService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          influences: [],
        }),
      );

      // Verify no errors thrown and artifact still created
      expect(mockArtifactService.create).toHaveBeenCalledTimes(3);
    });

    it('should preserve confidence scores and transform reasonType correctly', async () => {
      const mockEvent: LlmCompleteEvent = {
        id: 'event-125',
        type: 'llm.complete',
        aggregateId: testIds.request,
        payload: {
          payloadType: 'llm.complete',

          requestId: testIds.request,
          conversationId: testIds.conversation,
          projectId: testIds.project,
          organizationId: testIds.organization,
          messageId: testIds.message,
          userId: testIds.user,
          workflowId: testIds.workflow,
          status: 'success',
          systemMessageData: {
            insights: [
              {
                category: 'requirements',
                title: 'Test Requirements',
                content: 'Requirements content',
                confidence: 0.95,
                reasoning: 'Analysis reasoning',
                influences: [
                  {
                    entityId: 'artifact-with-confidence',
                    reasoning: 'Has confidence score',
                    reasonType: RelationshipType.References,
                    confidence: 0.75,
                  },
                  {
                    entityId: 'artifact-without-confidence',
                    reasoning: 'No confidence score',
                    reasonType: RelationshipType.SimilarTo,
                    // confidence not provided
                  },
                  {
                    entityId: 'artifact-zero-confidence',
                    reasoning: 'Zero confidence',
                    reasonType: RelationshipType.Blocks,
                    confidence: 0,
                  },
                ],
              } as ArtifactInsight,
            ],
          } as any,
        },
      };

      await (processor as any).handleLLMCompletionEvent(mockEvent);

      const createCall = mockArtifactService.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      if (!createCall) {
        throw new Error('Expected ArtifactService.create to be called');
      }
      const influences = createCall.influences;
      expect(influences).toBeDefined();
      if (!influences) {
        throw new Error('Expected influences to be set');
      }

      expect(influences).toHaveLength(3);

      // Test confidence preservation
      expect(influences[0]).toMatchObject({
        entityId: 'artifact-with-confidence',
        confidence: 0.75,
        reasonType: RelationshipType.References,
      });

      expect(influences[1]).toMatchObject({
        entityId: 'artifact-without-confidence',
        confidence: undefined,
        reasonType: RelationshipType.SimilarTo,
      });

      expect(influences[2]).toMatchObject({
        entityId: 'artifact-zero-confidence',
        confidence: 0,
        reasonType: RelationshipType.Blocks,
      });

      // Test reasonType string → RelationshipType enum conversion
      influences.forEach((influence) => {
        expect(Object.values(RelationshipType)).toContain(influence.reasonType);
      });
    });

    it('should handle reasonType enum conversion edge cases', async () => {
      const mockEvent: LlmCompleteEvent = {
        id: 'event-126',
        type: 'llm.complete',
        aggregateId: testIds.request,
        payload: {
          payloadType: 'llm.complete',

          requestId: testIds.request,
          conversationId: testIds.conversation,
          projectId: testIds.project,
          organizationId: testIds.organization,
          messageId: testIds.message,
          userId: testIds.user,
          workflowId: testIds.workflow,
          status: 'success',
          systemMessageData: {
            insights: [
              {
                category: 'analysis',
                title: 'Test Analysis',
                content: 'Analysis content',
                influences: [
                  {
                    entityId: 'test-artifact',
                    reasoning: 'Valid reasoning',
                    reasonType: RelationshipType.DependsOn,
                  },
                ],
              } as ArtifactInsight,
            ],
          } as any,
        },
      };

      await (processor as any).handleLLMCompletionEvent(mockEvent);

      const createCall = mockArtifactService.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      if (!createCall) {
        throw new Error('Expected ArtifactService.create to be called');
      }
      const influences = createCall.influences;
      expect(influences).toBeDefined();
      if (!influences) {
        throw new Error('Expected influences to be set');
      }

      const firstInfluence = assertDefined(influences[0], 'first influence');
      expect(firstInfluence.reasonType).toBe(RelationshipType.DependsOn);
    });
  });
});
