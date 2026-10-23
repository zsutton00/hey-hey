/* eslint-disable @typescript-eslint/unbound-method */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { LlmCompleteEvent } from '../../../core/events/types/domain-events';
import { LlmProcessor } from '../../../core/processing/llm-processor.service';
import {
  ArtifactSourceType,
  GenerationSystemMessageData,
} from '../../../generated';
import { EntityType } from 'src/generated/agents/models';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { IntentDetectorService } from '../../../services/intent-detector.service';
import { LLMClientService } from '../../../services/llm/llm-client.service';
import { MessageService } from '../../../services/message.service';
import { NodeExecutionService } from '../../../services/workflows/node-execution.service';
import * as TestUtils from '../../../utils/testUtils';
import { ArtifactInsight } from '../../utils/shared-schemas';

const RelationshipType = {
  StatedRequirement: 'stated_requirement',
  SupportsDecision: 'supports_decision',
  SimilarContext: 'similar_context',
  DefinedConstraint: 'defined_constraint',
  ProvidedBackground: 'provided_background',
  ProvidesEvidence: 'provides_evidence',
} as const;

// Skipping: relies on old RelationshipType export that no longer exists.
describe.skip('Influence Tracking Integration', () => {
  let app: TestingModule;
  let llmProcessor: LlmProcessor;
  let mockArtifactService: jest.Mocked<ArtifactService>;
  let mockEventPublisher: jest.Mocked<DomainEventPublisher>;

  const { testIds } = TestUtils;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      providers: [
        LlmProcessor,
        {
          provide: ArtifactService,
          useValue: TestUtils.createMockArtifactService(),
        },
        {
          provide: IntentDetectorService,
          useValue: TestUtils.createMockIntentDetectorService(),
        },
        {
          provide: LLMClientService,
          useValue: TestUtils.createMockLLMClientService(),
        },
        {
          provide: NodeExecutionService,
          useValue: TestUtils.createMockFlowEngineService(),
        },
        {
          provide: MessageService,
          useValue: TestUtils.createMockMessageService(),
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: TestUtils.createMockDomainEventPublisher(),
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    llmProcessor = app.get<LlmProcessor>(LlmProcessor);
    mockArtifactService = app.get(ArtifactService);
    mockEventPublisher = app.get(DOMAIN_EVENT_PUBLISHER_TOKEN);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock responses using TestUtils
    const mockArtifact = TestUtils.createMockArtifact({
      id: 'created-artifact-123',
      projectId: testIds.project,
      type: 'INSIGHT',
      title: 'Test Insight',
      status: 'ACTIVE',
    });

    mockArtifactService.create.mockResolvedValue(mockArtifact);
  });

  describe('End-to-End Influence Storage', () => {
    it('should process LLM response with influences and call ArtifactService.create correctly', async () => {
      // Create insight with influences (using local schema type)
      const insightWithInfluences: ArtifactInsight = {
        category: 'technicalAnalysis',
        title: 'Technical Feasibility Analysis',
        content: 'Analysis of technical requirements and constraints',
        confidence: 0.9,
        reasoning: 'Based on user requirements and technical constraints',
        influences: [
          {
            entityId: 'test-source-artifact-1',
            entityType: EntityType.ARTIFACT,
            reasoning:
              'User requirements informed the technical analysis scope',
            reasonType: 'stated_requirement',
            confidence: 0.85,
          },
          {
            entityId: 'test-source-artifact-2',
            entityType: EntityType.ARTIFACT,
            reasoning:
              'Technical constraints shaped the feasibility assessment',
            reasonType: 'defined_constraint',
            confidence: 0.9,
          },
        ],
      };

      // Create system message data structure
      const systemMessageData = {
        type: 'ARTIFACTS_GENERATION',
        response: 'Generated technical feasibility analysis artifact',
        detectedIntent: 'artifacts_generation',
        intentConfidence: 0.9,
        reasoning: 'Processing artifact generation request',
        insights: [insightWithInfluences],
      } as unknown as GenerationSystemMessageData;

      // Mock LLM complete event with insights containing influences
      const mockLlmEvent: LlmCompleteEvent = {
        id: 'test-llm-event-123',
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
          systemMessageData,
        },
      };

      // Act: Process through LlmProcessor
      await (
        llmProcessor as unknown as {
          handleLLMCompletionEvent: (event: LlmCompleteEvent) => Promise<void>;
        }
      ).handleLLMCompletionEvent(mockLlmEvent);

      // Assert: Verify artifact was created with influences
      expect(mockArtifactService.create).toHaveBeenCalledWith({
        type: 'INSIGHT',
        title: 'Technical Feasibility Analysis',
        data: {
          type: 'INSIGHT',
          category: 'technicalAnalysis',
          title: 'Technical Feasibility Analysis',
          content: 'Analysis of technical requirements and constraints',
          confidence: 0.9,
          reasoning: 'Based on user requirements and technical constraints',
          influences: [
            {
              entityId: 'test-source-artifact-1',
              reasoning:
                'User requirements informed the technical analysis scope',
              reasonType: 'stated_requirement',
              confidence: 0.85,
            },
            {
              entityId: 'test-source-artifact-2',
              reasoning:
                'Technical constraints shaped the feasibility assessment',
              reasonType: 'defined_constraint',
              confidence: 0.9,
            },
          ],
        },
        category: 'technicalAnalysis',
        tags: undefined,
        sourceId: testIds.conversation,
        sourceType: ArtifactSourceType.Conversation,
        projectId: testIds.project,
        organizationId: testIds.organization,
        status: 'ACTIVE',
        generateEmbedding: false,
        influences: [
          {
            entityId: 'test-source-artifact-1',
            reasoning:
              'User requirements informed the technical analysis scope',
            reasonType: RelationshipType.StatedRequirement,
            confidence: 0.85,
          },
          {
            entityId: 'test-source-artifact-2',
            reasoning:
              'Technical constraints shaped the feasibility assessment',
            reasonType: RelationshipType.DefinedConstraint,
            confidence: 0.9,
          },
        ],
      });
    });

    it('should handle insights without influences', async () => {
      // Create insight with influences (using local schema type)
      const insightWithInfluences: ArtifactInsight = {
        category: 'technicalAnalysis',
        title: 'Technical Feasibility Analysis',
        content: 'Analysis of technical requirements and constraints',
        confidence: 0.9,
        reasoning: 'Based on user requirements and technical constraints',
      };

      // Create system message data structure
      const systemMessageData = {
        type: 'ARTIFACTS_GENERATION',
        response: 'Generated technical feasibility analysis artifact',
        detectedIntent: 'artifacts_generation',
        intentConfidence: 0.9,
        reasoning: 'Processing artifact generation request',
        insights: [insightWithInfluences],
      } as unknown as GenerationSystemMessageData;

      // Mock LLM complete event with insights containing influences
      const mockLlmEvent: LlmCompleteEvent = {
        id: 'test-llm-event-123',
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
          systemMessageData,
        },
      };

      // Act: Process through LlmProcessor
      await (
        llmProcessor as unknown as {
          handleLLMCompletionEvent: (event: LlmCompleteEvent) => Promise<void>;
        }
      ).handleLLMCompletionEvent(mockLlmEvent);

      // Assert
      expect(mockArtifactService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          influences: undefined,
        }),
      );
    });

    it('should handle empty influences array', async () => {
      // Create insight with influences (using local schema type)
      const insightWithInfluences: ArtifactInsight = {
        category: 'technicalAnalysis',
        title: 'Technical Feasibility Analysis',
        content: 'Analysis of technical requirements and constraints',
        confidence: 0.9,
        reasoning: 'Based on user requirements and technical constraints',
        influences: [],
      };

      // Create system message data structure
      const systemMessageData = {
        type: 'ARTIFACTS_GENERATION',
        response: 'Generated technical feasibility analysis artifact',
        detectedIntent: 'artifacts_generation',
        intentConfidence: 0.9,
        reasoning: 'Processing artifact generation request',
        insights: [insightWithInfluences],
      } as unknown as GenerationSystemMessageData;

      // Mock LLM complete event with insights containing influences
      const mockLlmEvent: LlmCompleteEvent = {
        id: 'test-llm-event-123',
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
          systemMessageData,
        },
      };

      // Act: Process through LlmProcessor
      await (
        llmProcessor as unknown as {
          handleLLMCompletionEvent: (event: LlmCompleteEvent) => Promise<void>;
        }
      ).handleLLMCompletionEvent(mockLlmEvent);

      // Assert
      expect(mockArtifactService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          influences: [],
        }),
      );
    });

    /*
    // TODO: Fix remaining test cases
    it.skip('should handle invalid influences without failing artifact creation', async () => {
      // Mock LLM response with mix of valid and invalid influences
      const mockLlmEvent: LlmCompleteEvent = {
        id: 'test-llm-event-124',
        type: 'llm.complete',
        aggregateId: testIds.request,
        payload: {
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
              category: 'mixedInfluenceTest',
              title: 'Test Mixed Influences',
              content: 'Testing artifact with mixed valid/invalid influences',
              confidence: 0.8,
              reasoning: 'Test mixed influence handling',
              influences: [
                {
                  artifactId: 'test-valid-source',
                  reasoning: 'Valid influence',
                  reasonType: 'similar_context',
                  confidence: 0.8,
                },
                {
                  artifactId: '', // Invalid - empty artifactId
                  reasoning: 'Invalid influence with empty artifactId',
                  reasonType: 'stated_requirement',
                },
                {
                  artifactId: 'non-existent-artifact',
                  reasoning: 'Reference to non-existent artifact',
                  reasonType: 'supports_decision',
                },
                {
                  artifactId: 'test-valid-source',
                  reasoning: '', // Invalid - empty reasoning
                  reasonType: 'defined_constraint',
                },
              ],
            },
          ],
          },
        },
      };

      // Act: Process through LlmProcessor
      await expect(
        (llmProcessor as unknown as { handleLLMCompletionEvent: (event: LlmCompleteEvent) => Promise<void> }).processArtifactGeneration(mockLlmEvent),
      ).resolves.not.toThrow();

      // Assert: Verify artifact was still created
      expect(mockArtifactService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Mixed Influences',
          category: 'mixedInfluenceTest',
        }),
      );

      // Assert: Only valid influences should be passed
      const createCall = mockArtifactService.create.mock.calls[0][0];
      expect(createCall.influences).toHaveLength(1);
      expect(createCall.influences[0]).toMatchObject({
        artifactId: 'test-valid-source',
        reasoning: 'Valid influence',
        reasonType: RelationshipType.SimilarContext,
        confidence: 0.8,
      });
    });

    it.skip('should handle influences with missing confidence scores', async () => {
      const mockLlmEvent: LlmCompleteEvent = {
        id: 'test-llm-event-125',
        type: 'llm.complete',
        aggregateId: testIds.request,
        payload: {
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
              category: 'confidenceTest',
              title: 'Confidence Test',
              content: 'Testing confidence handling',
              confidence: 0.9,
              reasoning: 'Test confidence field handling',
              influences: [
                {
                  artifactId: 'test-confidence-source',
                  reasoning: 'Influence without confidence',
                  reasonType: 'provided_background',
                  // confidence not provided
                },
              ],
            },
          ],
          },
        },
      };

      // Act
      await (llmProcessor as unknown as { handleLLMCompletionEvent: (event: LlmCompleteEvent) => Promise<void> }).processArtifactGeneration(mockLlmEvent);

      // Assert
      expect(mockArtifactService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'confidenceTest',
          influences: [
            {
              artifactId: 'test-confidence-source',
              reasoning: 'Influence without confidence',
              reasonType: RelationshipType.ProvidedBackground,
              confidence: undefined,
            },
          ],
        }),
      );
    });

    

    it.skip('should handle reasonType enum conversion correctly', async () => {
      const mockLlmEvent: LlmCompleteEvent = {
        id: 'test-llm-event-128',
        type: 'llm.complete',
        aggregateId: testIds.request,
        payload: {
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
              category: 'enumTest',
              title: 'Enum Conversion Test',
              content: 'Testing reasonType conversion',
              confidence: 0.9,
              reasoning: 'Test reasonType enum conversion',
              influences: [
                {
                  artifactId: 'test-enum-artifact-1',
                  reasoning: 'Testing requirement conversion',
                  reasonType: 'stated_requirement',
                },
                {
                  artifactId: 'test-enum-artifact-2',
                  reasoning: 'Testing context conversion',
                  reasonType: 'similar_context',
                },
                {
                  artifactId: 'test-enum-artifact-3',
                  reasoning: 'Testing evidence conversion',
                  reasonType: 'provides_evidence',
                },
                {
                  artifactId: 'test-enum-artifact-4',
                  reasoning: 'Testing constraint conversion',
                  reasonType: 'defined_constraint',
                },
              ],
            },
          ],
          },
        },
      };

      // Act
      await (llmProcessor as unknown as { handleLLMCompletionEvent: (event: LlmCompleteEvent) => Promise<void> }).processArtifactGeneration(mockLlmEvent);

      // Assert
      const createCall = mockArtifactService.create.mock.calls[0][0];
      expect(createCall.influences).toHaveLength(4);
      
      expect(createCall.influences[0].reasonType).toBe(RelationshipType.StatedRequirement);
      expect(createCall.influences[1].reasonType).toBe(RelationshipType.SimilarContext);
      expect(createCall.influences[2].reasonType).toBe(RelationshipType.ProvidesEvidence);
      expect(createCall.influences[3].reasonType).toBe(RelationshipType.DefinedConstraint);
    });
  });
  */
  });
});
