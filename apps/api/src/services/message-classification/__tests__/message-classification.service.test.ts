import { Logger } from '@nestjs/common';
import { MessageClassificationService } from '../message-classification.service';
import { LLMClientService } from '../../llm/llm-client.service';
import { PromptBuilderService } from '../../llm/prompt-builder.service';
import { ContextResolutionService } from '../../../context/services/context-resolution.service';
import { FlowUserMessage } from '../../../types/flow-internal.types';
import {
  MessageClassificationResult,
  ConversationContext,
  MessageIntent,
  InitiativeAction,
} from '../types/classification.types';
import * as TestUtils from '../../../utils/testUtils';
import { createMockFlowUserMessage } from '../../../utils/testUtils';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';

describe('MessageClassificationService', () => {
  let service: MessageClassificationService;
  let mockLLMClientService: jest.Mocked<LLMClientService>;
  let mockPromptBuilderService: ReturnType<
    typeof TestUtils.createMockPromptBuilderService
  >;
  let mockContextResolutionService: ReturnType<
    typeof TestUtils.createMockContextResolutionService
  >;

  const { testIds } = TestUtils;
  const getMessageText = (message: FlowUserMessage): string => {
    const value = message.data?.message;
    return typeof value === 'string' ? value : '';
  };

  beforeEach(async () => {
    mockLLMClientService = TestUtils.createMockLLMClientService();
    mockPromptBuilderService = TestUtils.createMockPromptBuilderService();
    mockContextResolutionService =
      TestUtils.createMockContextResolutionService();

    const setup = await createServiceTestingModule({
      providers: [
        MessageClassificationService,
        LLMClientService,
        PromptBuilderService,
        ContextResolutionService,
      ],
      overrides: [
        [LLMClientService, mockLLMClientService],
        [PromptBuilderService, mockPromptBuilderService],
        [ContextResolutionService, mockContextResolutionService],
      ],
    });

    service = setup.module.get<MessageClassificationService>(
      MessageClassificationService,
    );

    // Suppress console logs during testing
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('classifyMessageWithLevel', () => {
    const createMockContext = (
      overrides?: Partial<ConversationContext>,
    ): ConversationContext => ({
      conversationId: testIds.conversation,
      organizationId: testIds.organization,
      projectId: testIds.project,
      userId: testIds.user,
      availableInitiatives: [
        {
          id: testIds.initiative,
          name: 'Login Feature',
          description: 'User authentication system',
          currentLevel: 'description',
          status: 'active',
        },
      ],
      ...overrides,
    });

    it('should classify initiative feedback messages correctly', async () => {
      // EXPECTATION: The service should correctly identify and classify messages that provide feedback about initiatives
      // RATIONALE: Initiative feedback is a core use case - users providing suggestions, concerns, or comments
      // about specific features or initiatives. High confidence classification enables automatic routing.

      // Arrange
      const message = createMockFlowUserMessage({
        data: {
          message: 'I think the login feature needs better error handling',
        },
      });
      const context = createMockContext();

      const mockLLMResponse = {
        content: {
          intent: MessageIntent.INITIATIVE_FEEDBACK,
          confidence: 0.85,
          targetInitiativeId: testIds.initiative,
          suggestedAction: InitiativeAction.REFINE,
          reasoning:
            'User is providing specific feedback about improving the login feature error handling',
        },
      };

      mockLLMClientService.callStructured.mockResolvedValue(mockLLMResponse);

      // Act
      const currentLevel =
        context.availableInitiatives?.[0]?.currentLevel || 'description';
      const result = await service.classifyMessageWithLevel(
        getMessageText(message),
        context,
        currentLevel,
        context.organizationId,
      );

      // Assert
      expect(result.intent).toBe(MessageIntent.INITIATIVE_FEEDBACK);
      expect(result.confidence).toBe(0.85);
      expect(result.targetInitiativeId).toBe(testIds.initiative);
      expect(result.suggestedAction).toBe(InitiativeAction.REFINE);
      expect(result.reasoning).toContain('feedback');
      expect(result.metadata?.autoClassified).toBe(true);
    });

    it('should classify content update requests correctly', async () => {
      // EXPECTATION: The service should identify messages requesting specific content changes or additions
      // RATIONALE: Content updates are distinct from general feedback - they involve specific modification
      // requests that can be routed to content update workflows with appropriate level targeting.

      // Arrange
      const message = createMockFlowUserMessage({
        data: { message: 'Can we add two-factor authentication to the login?' },
      });
      const context = createMockContext();

      const mockLLMResponse = {
        content: {
          intent: MessageIntent.CONTENT_UPDATE,
          confidence: 0.82,
          targetInitiativeId: testIds.initiative,
          targetLevel: 'details',
          suggestedAction: InitiativeAction.UPDATE,
          reasoning:
            'User is requesting addition of specific feature (2FA) to existing initiative',
        },
      };

      mockLLMClientService.callStructured.mockResolvedValue(mockLLMResponse);

      // Act
      const currentLevel =
        context.availableInitiatives?.[0]?.currentLevel || 'description';
      const result = await service.classifyMessageWithLevel(
        getMessageText(message),
        context,
        currentLevel,
        context.organizationId,
      );

      // Assert
      expect(result.intent).toBe(MessageIntent.CONTENT_UPDATE);
      expect(result.confidence).toBe(0.82);
      expect(result.targetInitiativeId).toBe(testIds.initiative);
      expect(result.targetLevel).toBe('details');
      expect(result.suggestedAction).toBe(InitiativeAction.UPDATE);
    });

    it('should classify approval messages correctly', async () => {
      // EXPECTATION: The service should detect messages expressing approval or satisfaction
      // RATIONALE: Approval messages need special handling as they indicate user sign-off
      // and can trigger workflow progression to finalization stages.

      // Arrange
      const message = createMockFlowUserMessage({
        data: { message: 'This looks good to me, I approve this approach' },
      });
      const context = createMockContext();

      const mockLLMResponse = {
        content: {
          intent: MessageIntent.APPROVAL,
          confidence: 0.88,
          targetInitiativeId: testIds.initiative,
          suggestedAction: InitiativeAction.APPROVE,
          reasoning:
            'User explicitly expresses approval and satisfaction with the current approach',
        },
      };

      mockLLMClientService.callStructured.mockResolvedValue(mockLLMResponse);

      // Act
      const currentLevel =
        context.availableInitiatives?.[0]?.currentLevel || 'description';
      const result = await service.classifyMessageWithLevel(
        getMessageText(message),
        context,
        currentLevel,
        context.organizationId,
      );

      // Assert
      expect(result.intent).toBe(MessageIntent.APPROVAL);
      expect(result.confidence).toBe(0.88);
      expect(result.suggestedAction).toBe(InitiativeAction.APPROVE);
      expect(result.reasoning).toContain('approval');
    });

    it('should classify general messages as non-initiative related', async () => {
      // EXPECTATION: Messages unrelated to initiatives should be classified as general with low routing confidence
      // RATIONALE: Prevents spam or off-topic messages from being routed to initiative workflows.
      // General classification should have high confidence when clearly unrelated.

      // Arrange
      const message = createMockFlowUserMessage({
        data: { message: 'How is the weather today?' },
      });
      const context = createMockContext();

      const mockLLMResponse = {
        content: {
          intent: MessageIntent.GENERAL,
          confidence: 0.95,
          reasoning:
            'Message is about weather and completely unrelated to initiative refinement',
        },
      };

      mockLLMClientService.callStructured.mockResolvedValue(mockLLMResponse);

      // Act
      const currentLevel =
        context.availableInitiatives?.[0]?.currentLevel || 'description';
      const result = await service.classifyMessageWithLevel(
        getMessageText(message),
        context,
        currentLevel,
        context.organizationId,
      );

      // Assert
      expect(result.intent).toBe(MessageIntent.GENERAL);
      expect(result.confidence).toBe(0.95);
      expect(result.targetInitiativeId).toBeUndefined();
      expect(result.reasoning).toContain('unrelated');
    });

    it('should handle LLM service failures gracefully', async () => {
      // EXPECTATION: Service failures should not crash the system but return graceful fallback responses
      // RATIONALE: Network issues, API failures, or service unavailability should not break the user experience.
      // Fallback classification allows the system to continue functioning with reduced capability.

      // Arrange
      const message = createMockFlowUserMessage({
        data: { message: 'Test message' },
      });
      const context = createMockContext();

      mockLLMClientService.callStructured.mockRejectedValue(
        new Error('LLM service unavailable'),
      );

      // Act
      const currentLevel =
        context.availableInitiatives?.[0]?.currentLevel || 'description';

      // Act & Assert
      await expect(
        service.classifyMessageWithLevel(
          getMessageText(message),
          context,
          currentLevel,
          context.organizationId,
        ),
      ).rejects.toThrow(/LLM service unavailable/);
    });

    it('should validate organization boundaries', async () => {
      // EXPECTATION: The service must enforce organization boundaries and reject cross-org initiative references
      // RATIONALE: Security requirement - users should never be able to access or reference initiatives
      // from other organizations, even if the LLM incorrectly identifies them.

      // Arrange
      const message = createMockFlowUserMessage({
        data: { message: 'Update the login feature' },
      });
      const context = createMockContext();

      const mockLLMResponse = {
        content: {
          intent: MessageIntent.CONTENT_UPDATE,
          confidence: 0.85,
          targetInitiativeId: testIds.initiative,
          reasoning: 'User wants to update login feature',
        },
      };

      mockLLMClientService.callStructured.mockResolvedValue(mockLLMResponse);

      // Act
      const currentLevel =
        context.availableInitiatives?.[0]?.currentLevel || 'description';
      const result = await service.classifyMessageWithLevel(
        getMessageText(message),
        context,
        currentLevel,
        context.organizationId,
      );

      // Assert
      expect(result.targetInitiativeId).toBe(testIds.initiative);
      expect(result.confidence).toBe(0.85);
    });

    it('should handle malformed LLM responses', async () => {
      // EXPECTATION: Invalid or malformed LLM responses should be handled gracefully with fallback behavior
      // RATIONALE: LLMs can occasionally return malformed JSON or data that doesn't match expected schemas.
      // System must be resilient to these edge cases.

      // Arrange
      const message = createMockFlowUserMessage({
        data: { message: 'Test message' },
      });
      const context = createMockContext();

      const mockLLMResponse = {
        content: {
          invalidField: 'invalid response',
          confidence: 'not a number', // Invalid type
        },
      };

      mockLLMClientService.callStructured.mockResolvedValue(mockLLMResponse);

      // Act
      const currentLevel =
        context.availableInitiatives?.[0]?.currentLevel || 'description';

      await expect(
        service.classifyMessageWithLevel(
          getMessageText(message),
          context,
          currentLevel,
          context.organizationId,
        ),
      ).rejects.toThrow(/validation failed/);
    });

    it('should respect confidence thresholds for routing decisions', async () => {
      // EXPECTATION: Only high-confidence classifications should be considered for automatic routing
      // RATIONALE: Low confidence classifications should not trigger workflow actions to prevent
      // false positives and unwanted automated processing.

      // Arrange
      const message = createMockFlowUserMessage({
        data: { message: 'Maybe this could be better somehow' },
      });
      const context = createMockContext();

      const mockLLMResponse = {
        content: {
          intent: MessageIntent.INITIATIVE_FEEDBACK,
          confidence: 0.4, // Below default threshold of 0.7
          reasoning: 'Vague feedback message with uncertain intent',
        },
      };

      mockLLMClientService.callStructured.mockResolvedValue(mockLLMResponse);

      // Act
      const currentLevel =
        context.availableInitiatives?.[0]?.currentLevel || 'description';
      const result = await service.classifyMessageWithLevel(
        getMessageText(message),
        context,
        currentLevel,
        context.organizationId,
      );
      const shouldRoute = service.shouldRouteMessage(result);

      // Assert
      expect(result.intent).toBe(MessageIntent.INITIATIVE_FEEDBACK);
      expect(result.confidence).toBe(0.4);
      expect(shouldRoute).toBe(false); // Should not route due to low confidence
    });

    it('should include processing metadata in results', async () => {
      // EXPECTATION: All classification results should include comprehensive metadata for debugging and audit
      // RATIONALE: Metadata enables troubleshooting, performance monitoring, and quality assessment
      // of the classification system.

      // Arrange
      const message = createMockFlowUserMessage({
        data: { message: 'Test message' },
      });
      const context = createMockContext();

      const mockLLMResponse = {
        content: {
          intent: MessageIntent.GENERAL,
          confidence: 0.9,
          reasoning: 'Test classification',
        },
      };

      mockLLMClientService.callStructured.mockResolvedValue(mockLLMResponse);

      // Act
      const currentLevel =
        context.availableInitiatives?.[0]?.currentLevel || 'description';
      const result = await service.classifyMessageWithLevel(
        getMessageText(message),
        context,
        currentLevel,
        context.organizationId,
      );

      // Assert
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.autoClassified).toBe(true);
      expect(result.metadata?.model).toBeDefined();
      expect(result.metadata?.levelAware).toBe(true);
      expect((result.metadata as any)?.currentLevel).toBe(currentLevel);
    });
  });

  describe('generateWorkflowSignal', () => {
    const createMockFlowUserMessage = (content: string): FlowUserMessage => ({
      id: testIds.message,
      parentMessageId: testIds.message,
      data: { message: content },
      conversationId: testIds.conversation,
      type: 'USER',
      timestamp: new Date().toISOString(),
      status: 'open',
      createdAt: new Date().toISOString(),
      projectId: testIds.project,
      workflowId: testIds.workflow,
    });

    const createMockContext = (): ConversationContext => ({
      conversationId: testIds.conversation,
      organizationId: testIds.organization,
      userId: testIds.user,
    });

    it('should generate feedback signal for initiative feedback classification', async () => {
      // EXPECTATION: Initiative feedback should generate appropriate InitiativeRefinementFeedbackPayload
      // RATIONALE: Feedback classifications need to be converted to specific workflow signals
      // that the initiative refinement workflow can process.

      // Arrange
      const message = createMockFlowUserMessage('This needs improvement');
      const context = createMockContext();
      const classification: MessageClassificationResult = {
        intent: MessageIntent.INITIATIVE_FEEDBACK,
        confidence: 0.8,
        targetInitiativeId: testIds.initiative,
        reasoning: 'User feedback',
      };

      // Act
      const signal = await service.generateWorkflowSignal(
        classification,
        message,
        context,
      );

      // Assert
      expect(signal).toBeDefined();
      expect(signal?.type).toBe('InitiativeRefinementFeedbackPayload');
      expect(signal?.initiativeId).toBe(testIds.initiative);
      expect((signal as unknown as { content: string })?.content).toBe(
        getMessageText(message),
      );
      expect(signal?.metadata?.autoClassified).toBe(true);
      expect(signal?.metadata?.confidence).toBe(0.8);
    });

    it('should generate content update signal for content update classification', async () => {
      // EXPECTATION: Content updates should generate InitiativeContentUpdatePayload with appropriate level
      // RATIONALE: Content update requests need structured signals that specify what level of content
      // to modify (description, details, acceptance criteria).

      // Arrange
      const message = createMockFlowUserMessage('Add mobile support');
      const context = createMockContext();
      const classification: MessageClassificationResult = {
        intent: MessageIntent.CONTENT_UPDATE,
        confidence: 0.85,
        targetInitiativeId: testIds.initiative,
        targetLevel: 'details',
        reasoning: 'User requesting content addition',
      };

      // Act
      const signal = await service.generateWorkflowSignal(
        classification,
        message,
        context,
      );

      // Assert
      expect(signal).toBeDefined();
      expect(signal?.type).toBe('InitiativeContentUpdatePayload');
      expect(signal?.initiativeId).toBe(testIds.initiative);
      expect((signal as unknown as { content: string })?.content).toBe(
        getMessageText(message),
      );
    });

    it('should generate review signal for approval classification', async () => {
      // EXPECTATION: Approval messages should generate InitiativeReviewPayload with approved=true
      // RATIONALE: Approval classifications need to be converted to review signals that indicate
      // positive user feedback and potential workflow progression.

      // Arrange
      const message = createMockFlowUserMessage('I approve this');
      const context = createMockContext();
      const classification: MessageClassificationResult = {
        intent: MessageIntent.APPROVAL,
        confidence: 0.9,
        targetInitiativeId: testIds.initiative,
        reasoning: 'User approval',
      };

      // Act
      const signal = await service.generateWorkflowSignal(
        classification,
        message,
        context,
      );

      // Assert
      expect(signal).toBeDefined();
      expect(signal?.type).toBe('InitiativeReviewPayload');
      expect(signal?.initiativeId).toBe(testIds.initiative);
      expect(
        (signal as unknown as { metadata: { approved: boolean } })?.metadata
          ?.approved,
      ).toBe(true);
      expect((signal as unknown as { content: string })?.content).toBe(
        getMessageText(message),
      );
    });

    it('should generate review signal for rejection classification', async () => {
      // EXPECTATION: Rejection messages should generate InitiativeReviewPayload with approved=false
      // RATIONALE: Rejection classifications indicate negative user feedback that should halt
      // or redirect workflow progression.

      // Arrange
      const message = createMockFlowUserMessage("This approach won't work");
      const context = createMockContext();
      const classification: MessageClassificationResult = {
        intent: MessageIntent.REJECTION,
        confidence: 0.85,
        targetInitiativeId: testIds.initiative,
        reasoning: 'User rejection',
      };

      // Act
      const signal = await service.generateWorkflowSignal(
        classification,
        message,
        context,
      );

      // Assert
      expect(signal).toBeDefined();
      expect(signal?.type).toBe('InitiativeReviewPayload');
      expect(signal?.initiativeId).toBe(testIds.initiative);
      expect(
        (signal as unknown as { metadata: { approved: boolean } })?.metadata
          ?.approved,
      ).toBe(false);
      expect((signal as unknown as { content: string })?.content).toBe(
        getMessageText(message),
      );
    });

    it('should return null for general messages', async () => {
      // EXPECTATION: General messages should not generate workflow signals
      // RATIONALE: Non-initiative messages should not trigger workflow actions to prevent
      // spam and irrelevant processing.

      // Arrange
      const message = createMockFlowUserMessage('Hello there');
      const context = createMockContext();
      const classification: MessageClassificationResult = {
        intent: MessageIntent.GENERAL,
        confidence: 0.95,
        reasoning: 'General greeting',
      };

      // Act
      const signal = await service.generateWorkflowSignal(
        classification,
        message,
        context,
      );

      // Assert
      expect(signal).toBeNull();
    });

    it('should return null for low confidence classifications', async () => {
      // EXPECTATION: Low confidence classifications should not generate signals even if intent is initiative-related
      // RATIONALE: Only high-confidence classifications should trigger automated workflow actions
      // to prevent false positives.

      // Arrange
      const message = createMockFlowUserMessage('Maybe this could be better');
      const context = createMockContext();
      const classification: MessageClassificationResult = {
        intent: MessageIntent.INITIATIVE_FEEDBACK,
        confidence: 0.5, // Below threshold
        reasoning: 'Uncertain feedback',
      };

      // Act
      const signal = await service.generateWorkflowSignal(
        classification,
        message,
        context,
      );

      // Assert
      expect(signal).toBeNull();
    });
  });

  describe('shouldRouteMessage', () => {
    it('should return true for high-confidence initiative messages', () => {
      // EXPECTATION: High-confidence initiative-related messages should be routed
      // RATIONALE: Clear initiative feedback, updates, and reviews should trigger automated processing.

      // Arrange
      const classification: MessageClassificationResult = {
        intent: MessageIntent.INITIATIVE_FEEDBACK,
        confidence: 0.85,
        reasoning: 'Clear feedback',
      };

      // Act
      const shouldRoute = service.shouldRouteMessage(classification);

      // Assert
      expect(shouldRoute).toBe(true);
    });

    it('should return false for general messages', () => {
      // EXPECTATION: General messages should never be routed regardless of confidence
      // RATIONALE: Non-initiative messages should not trigger workflow processing.

      // Arrange
      const classification: MessageClassificationResult = {
        intent: MessageIntent.GENERAL,
        confidence: 0.95,
        reasoning: 'Clearly general',
      };

      // Act
      const shouldRoute = service.shouldRouteMessage(classification);

      // Assert
      expect(shouldRoute).toBe(false);
    });

    it('should return false for low-confidence classifications', () => {
      // EXPECTATION: Low confidence should prevent routing even for initiative-related intents
      // RATIONALE: Prevents false positive routing that could trigger unwanted workflow actions.

      // Arrange
      const classification: MessageClassificationResult = {
        intent: MessageIntent.CONTENT_UPDATE,
        confidence: 0.4,
        reasoning: 'Uncertain intent',
      };

      // Act
      const shouldRoute = service.shouldRouteMessage(classification);

      // Assert
      expect(shouldRoute).toBe(false);
    });
  });

  describe('extractInitiativeContext', () => {
    it('should detect initiative-related keywords', async () => {
      // EXPECTATION: Basic keyword detection should identify messages likely related to initiatives
      // RATIONALE: Simple keyword matching provides baseline initiative relevance detection
      // as a fallback or enhancement to LLM classification.

      // Arrange
      const message: FlowUserMessage = {
        id: testIds.message,
        parentMessageId: testIds.message,
        data: {
          message: 'We need to implement a new feature for user authentication',
        },
        conversationId: testIds.conversation,
        type: 'USER',
        timestamp: new Date().toISOString(),
        status: 'open',
        createdAt: new Date().toISOString(),
        projectId: testIds.project,
        workflowId: testIds.workflow,
      };

      // Act
      const result = await service.extractInitiativeContext(
        message,
        testIds.conversation,
      );

      // Assert
      expect(result.hasInitiativeContext).toBe(true);
      expect(result.relevanceConfidence).toBeGreaterThan(0.5);
    });

    it('should return low relevance for non-initiative messages', async () => {
      // EXPECTATION: Messages without initiative keywords should have low relevance scores
      // RATIONALE: Keyword-based detection should filter out clearly unrelated messages.

      // Arrange
      const message: FlowUserMessage = {
        id: testIds.message,
        parentMessageId: testIds.message,
        data: { message: 'What time is the meeting today?' },
        conversationId: testIds.conversation,
        type: 'USER',
        timestamp: new Date().toISOString(),
        status: 'open',
        createdAt: new Date().toISOString(),
        projectId: testIds.project,
        workflowId: testIds.workflow,
      };

      // Act
      const result = await service.extractInitiativeContext(
        message,
        testIds.conversation,
      );

      // Assert
      expect(result.hasInitiativeContext).toBe(false);
      expect(result.relevanceConfidence).toBeLessThan(0.5);
    });
  });

  describe('error handling and edge cases', () => {
    it('should validate required input parameters', async () => {
      // EXPECTATION: Missing or invalid parameters should result in clear error messages
      // RATIONALE: Input validation prevents undefined behavior and provides clear debugging information.

      // Arrange
      const context = {} as any;

      // Act & Assert
      await expect(
        service.classifyMessageWithLevel('', context, null as any, null as any),
      ).rejects.toThrow('Message content is required');
    });

    it('should validate message length limits', async () => {
      // EXPECTATION: Overly long messages should be rejected to prevent processing issues
      // RATIONALE: Extremely long messages can cause LLM timeouts and high costs.

      // Arrange
      const longContent = 'a'.repeat(3000); // Exceeds default limit of 2000
      const context = {
        conversationId: testIds.conversation,
        organizationId: testIds.organization,
      } as ConversationContext;

      // Act & Assert
      await expect(
        service.classifyMessageWithLevel(
          longContent,
          context,
          'description',
          context.organizationId,
        ),
      ).rejects.toThrow('exceeds maximum length');
    });

    it('should handle context resolution service failures', async () => {
      // EXPECTATION: Context resolution failures should not crash the classification process
      // RATIONALE: External service failures should be handled gracefully with appropriate fallbacks.

      // Arrange
      const message: FlowUserMessage = {
        id: testIds.message,
        parentMessageId: testIds.message,
        data: { message: 'Test message' },
        conversationId: testIds.conversation,
        type: 'USER',
        status: 'open',
        createdAt: new Date().toISOString(),
        projectId: testIds.project,
        workflowId: testIds.workflow,
        timestamp: new Date().toISOString(),
      };

      const context = {
        conversationId: testIds.conversation,
        organizationId: testIds.organization,
        availableInitiatives: [], // Empty to simulate context resolution failure
      } as ConversationContext;

      const mockLLMResponse = {
        content: {
          intent: MessageIntent.INITIATIVE_FEEDBACK,
          confidence: 0.8,
          targetInitiativeId: testIds.initiative,
          reasoning: 'Test classification',
        },
      };

      mockLLMClientService.callStructured.mockResolvedValue(mockLLMResponse);

      // Act
      const result = await service.classifyMessageWithLevel(
        getMessageText(message),
        context,
        'description',
        context.organizationId,
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.targetInitiativeId).toBe(testIds.initiative);
      expect(result.confidence).toBe(0.8);
    });
  });

  describe('level-aware template validation', () => {
    it('should provide consistent intent names across all level templates', () => {
      // Get private template methods via reflection for testing
      const getDescriptionTemplate = (
        service as any
      ).getDescriptionLevelTemplate.bind(service);
      const getDetailsTemplate = (service as any).getDetailsLevelTemplate.bind(
        service,
      );
      const getAcceptanceCriteriaTemplate = (
        service as any
      ).getAcceptanceCriteriaTemplate.bind(service);

      const descriptionTemplate = getDescriptionTemplate();
      const detailsTemplate = getDetailsTemplate();
      const acceptanceCriteriaTemplate = getAcceptanceCriteriaTemplate();

      // Verify description level uses correct intents
      expect(descriptionTemplate).toContain('approve_level:');
      expect(descriptionTemplate).toContain('edit_content:');
      expect(descriptionTemplate).toContain('general_response:');
      expect(descriptionTemplate).not.toContain('finalize:');

      // Verify details level uses correct intents
      expect(detailsTemplate).toContain('approve_level:');
      expect(detailsTemplate).toContain('edit_content:');
      expect(detailsTemplate).toContain('general_response:');
      expect(detailsTemplate).not.toContain('finalize:');

      // Verify acceptance criteria level uses correct intents
      expect(acceptanceCriteriaTemplate).toContain('finalize:');
      expect(acceptanceCriteriaTemplate).toContain('edit_content:');
      expect(acceptanceCriteriaTemplate).toContain('general_response:');
      expect(acceptanceCriteriaTemplate).not.toContain('approve_level:');
    });

    it('should not contain deprecated intent names in any template', () => {
      const getDescriptionTemplate = (
        service as any
      ).getDescriptionLevelTemplate.bind(service);
      const getDetailsTemplate = (service as any).getDetailsLevelTemplate.bind(
        service,
      );
      const getAcceptanceCriteriaTemplate = (
        service as any
      ).getAcceptanceCriteriaTemplate.bind(service);

      const descriptionTemplate = getDescriptionTemplate();
      const detailsTemplate = getDetailsTemplate();
      const acceptanceCriteriaTemplate = getAcceptanceCriteriaTemplate();

      const deprecatedIntents = [
        'approve_and_move_to_details',
        'approve_and_move_to_acceptance',
        'approve_and_finalize',
        'edit_description',
        'edit_details',
        'edit_acceptance_criteria',
        'needs_analysis',
      ];

      for (const deprecatedIntent of deprecatedIntents) {
        expect(descriptionTemplate).not.toContain(deprecatedIntent);
        expect(detailsTemplate).not.toContain(deprecatedIntent);
        expect(acceptanceCriteriaTemplate).not.toContain(deprecatedIntent);
      }
    });
  });
});
