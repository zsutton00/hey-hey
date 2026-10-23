import { Test, TestingModule } from '@nestjs/testing';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from 'src/types';
import { FlowContext, Intent } from '../../types/flow-internal.types';
import * as TestUtils from '../../utils/testUtils';
import { IntentDetectorService } from '../intent-detector.service';

describe('IntentDetectorService', () => {
  let service: IntentDetectorService;

  const mockContext: FlowContext = {
    core: {
      workflowId: 'wf-123' as WorkflowId,
      projectId: 'proj-123' as ProjectId,
      organizationId: 'org-123' as OrganizationId,
      conversationId: 'conv-123' as ConversationId,
      workflowAboutId: 'proj-123',
      workflowAboutType: 'project' as WorkflowAboutType,
      user: { id: 'user-123' as UserId, role: 'member' },
      session: { startTime: new Date(), interactionCount: 3 },
    },
    flowId: 'flowId',
    flowPath: {
      pathTaken: [],
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IntentDetectorService],
    }).compile();

    service = module.get<IntentDetectorService>(IntentDetectorService);
  });

  describe('detect', () => {
    it('should detect correction intent', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'Actually, wait, I meant something different' },
      });

      const result = await service.detect(userMessage, mockContext);

      expect(result.type).toBe('correction');
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.userData).toEqual({
        message: 'Actually, wait, I meant something different',
      });
      expect(result.metadata?.source).toBe('pattern_matching');
    });

    it('should detect clarification intent', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'What do you mean by technical architecture?' },
      });

      const result = await service.detect(userMessage, mockContext);

      expect(result.type).toBe('clarification');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect acceptance intent', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'Yes, that looks good to me' },
      });

      const result = await service.detect(userMessage, mockContext);

      expect(result.type).toBe('acceptance');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect skip ahead intent', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'Skip this step and move on' },
      });

      const result = await service.detect(userMessage, mockContext);

      expect(result.type).toBe('skipAhead');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect concerns intent', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: "I'm worried about the complexity of this approach" },
      });

      const result = await service.detect(userMessage, mockContext);

      expect(result.type).toBe('concerns');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should use LLM response hints when available', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'Some ambiguous text' },
      });

      const llmResponse = {
        detectedIntent: 'ready_to_proceed',
        intentConfidence: 0.85,
        reasoning: 'Test reasoning',
      };

      const result = await service.detect(
        userMessage,
        mockContext,
        llmResponse,
      );

      expect(result.type).toBe('ready_to_proceed');
      expect(result.confidence).toBe(0.85);
      expect(result.metadata?.source).toBe('llm_response');
    });

    it('should prioritize valid LLM transitions when available transitions provided', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'Some ambiguous text' },
      });

      const llmResponse = {
        detectedIntent: 'needs_clarification',
        intentConfidence: 0.85,
        reasoning: 'Test reasoning',
      };

      const availableTransitions = [
        'needs_clarification',
        'ready_to_proceed',
        'default',
      ];

      const result = await service.detect(
        userMessage,
        mockContext,
        llmResponse,
        availableTransitions,
      );

      expect(result.type).toBe('needs_clarification');
      expect(result.confidence).toBe(0.85);
      expect(result.metadata?.source).toBe('llm_transition');
      expect(result.metadata?.availableTransitions).toEqual(
        availableTransitions,
      );
    });

    it('should fall back to pattern matching when LLM provides invalid transition', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'Actually, I want to change this' },
      });

      const llmResponse = {
        detectedIntent: 'invalid_transition',
        intentConfidence: 0.85,
        reasoning: 'Test reasoning',
      };

      const availableTransitions = [
        'needs_clarification',
        'ready_to_proceed',
        'default',
      ];

      const result = await service.detect(
        userMessage,
        mockContext,
        llmResponse,
        availableTransitions,
      );

      expect(result.type).toBe('correction'); // Should fall back to pattern matching
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.metadata?.source).toBe('pattern_matching');
    });

    it('should detect context-based readiness from technical depth', async () => {
      const longTechnicalMessage = TestUtils.createMockMessage({
        data: {
          message:
            'I think we should use a microservices architecture with Docker containers, implement OAuth2 for authentication, and use PostgreSQL for the database. The deployment should be automated with CI/CD pipelines.',
        },
      });

      const contextWithMultipleInteractions = {
        ...mockContext,
        core: {
          ...mockContext.core,
          session: { ...mockContext.core.session, interactionCount: 5 },
        },
      };

      const result = await service.detect(
        longTechnicalMessage,
        contextWithMultipleInteractions,
      );

      expect(result.type).toBe('ready_to_proceed');
      expect(result.confidence).toBe(0.7);
      expect(result.metadata?.reason).toBe('technical_depth');
    });

    it('should detect short positive responses as acceptance', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'yes' },
      });

      const result = await service.detect(userMessage, mockContext);

      expect(result.type).toBe('acceptance');
      expect(result.confidence).toBe(0.6);
      expect(result.metadata?.reason).toBe('short_positive');
    });

    it('should detect question format as clarification need', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'How does the authentication system work?' },
      });

      const result = await service.detect(userMessage, mockContext);

      expect(result.type).toBe('moreDetail');
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.metadata?.source).toBe('pattern_matching');
    });

    it('should return default intent when no patterns match', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'This is some neutral text with no clear intent' },
      });

      const result = await service.detect(userMessage, mockContext);

      expect(result.type).toBe('default');
      expect(result.confidence).toBe(0.5);
      expect(result.metadata?.source).toBe('default');
    });

    it('should prioritize high-confidence pattern matches', async () => {
      const userMessage = TestUtils.createMockMessage({
        data: { message: 'Actually, can you explain what you mean?' }, // Both correction and clarification patterns
      });

      const result = await service.detect(userMessage, mockContext);

      // Should return the highest confidence match
      expect(['correction', 'clarification']).toContain(result.type);
      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });

  describe('checkPatterns', () => {
    it('should find multiple pattern matches and sort by confidence', () => {
      const text = 'Actually, I need more details about this';

      const result = (service as any).checkPatterns(text);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].confidence).toBeGreaterThanOrEqual(
        result[result.length - 1]?.confidence || 0,
      );
    });

    it('should return empty array for no matches', () => {
      const text = 'neutral text without patterns';

      const result = (service as any).checkPatterns(text);

      expect(result).toEqual([]);
    });
  });

  describe('calculatePatternConfidence', () => {
    it('should boost confidence for early matches', () => {
      const pattern = /actually/i;
      const earlyText = 'Actually, I want to change this';
      const lateText = 'I want to change this actually';

      const earlyConfidence = (service as any).calculatePatternConfidence(
        pattern,
        earlyText,
      );
      const lateConfidence = (service as any).calculatePatternConfidence(
        pattern,
        lateText,
      );

      expect(earlyConfidence).toBeGreaterThan(lateConfidence);
    });

    it('should boost confidence for shorter texts', () => {
      const pattern = /yes/i;
      const shortText = 'yes';
      const longText =
        'yes, but I need to think about it more and consider all the implications';

      const shortConfidence = (service as any).calculatePatternConfidence(
        pattern,
        shortText,
      );
      const longConfidence = (service as any).calculatePatternConfidence(
        pattern,
        longText,
      );

      expect(shortConfidence).toBeGreaterThan(longConfidence);
    });

    it('should cap confidence at 0.95', () => {
      const pattern = /test/i;
      const text = 'test';

      const confidence = (service as any).calculatePatternConfidence(
        pattern,
        text,
      );

      expect(confidence).toBeLessThanOrEqual(0.95);
    });

    it('should return 0 for no match', () => {
      const pattern = /nomatch/i;
      const text = 'different text';

      const confidence = (service as any).calculatePatternConfidence(
        pattern,
        text,
      );

      expect(confidence).toBe(0);
    });
  });

  describe('mapIntentToTransition', () => {
    it('should map direct intent matches', () => {
      const intent: Intent = {
        type: 'ready_to_proceed',
        confidence: 0.8,
        userData: { message: 'test' },
      };

      const availableTransitions = ['ready_to_proceed', 'needs_clarification'];

      const result = service.mapIntentToTransition(
        intent,
        availableTransitions,
      );

      expect(result).toBe('ready_to_proceed');
    });

    it('should map semantic intent matches', () => {
      const intent: Intent = {
        type: 'acceptance',
        confidence: 0.8,
        userData: { message: 'test' },
      };

      const availableTransitions = ['user_accepts', 'user_rejects'];

      const result = service.mapIntentToTransition(
        intent,
        availableTransitions,
      );

      expect(result).toBe('user_accepts');
    });

    it('should map correction intents to change transitions', () => {
      const intent: Intent = {
        type: 'correction',
        confidence: 0.9,
        userData: { message: 'actually, I meant...' },
      };

      const availableTransitions = ['user_wants_changes', 'continue', 'back'];

      const result = service.mapIntentToTransition(
        intent,
        availableTransitions,
      );

      expect(result).toBe('user_wants_changes');
    });

    it('should map clarification intents to info-seeking transitions', () => {
      const intent: Intent = {
        type: 'clarification',
        confidence: 0.8,
        userData: { message: 'what do you mean?' },
      };

      const availableTransitions = ['needs_clarification', 'continue'];

      const result = service.mapIntentToTransition(
        intent,
        availableTransitions,
      );

      expect(result).toBe('needs_clarification');
    });

    it('should return default when no mapping exists', () => {
      const intent: Intent = {
        type: 'unknown_intent',
        confidence: 0.8,
        userData: { message: 'test' },
      };

      const availableTransitions = ['continue', 'back'];

      const result = service.mapIntentToTransition(
        intent,
        availableTransitions,
      );

      expect(result).toBe('default');
    });

    it('should prioritize exact matches over semantic matches', () => {
      const intent: Intent = {
        type: 'continue',
        confidence: 0.8,
        userData: { message: 'test' },
      };

      const availableTransitions = ['continue', 'user_accepts']; // Both could match acceptance semantic mapping

      const result = service.mapIntentToTransition(
        intent,
        availableTransitions,
      );

      expect(result).toBe('continue'); // Should prefer exact match
    });
  });

  describe('detectFromContext', () => {
    it('should detect readiness from technical terms and interaction count', () => {
      const text =
        "We should use microservices architecture for better scalability also we need some more details about this so we trip the length requirement. Hey, a squirel is running around the tree! Maybe it is looking for a nut. Wait no it's got a gun ";
      const contextWithManyInteractions = {
        ...mockContext,
        core: {
          ...mockContext.core,
          session: { ...mockContext.core.session, interactionCount: 4 },
        },
      };

      const result = service['detectFromContext'](
        text,
        contextWithManyInteractions,
        { message: text },
      );

      expect(result?.type).toBe('ready_to_proceed');
      expect(result?.confidence).toBe(0.7);
      expect(result?.metadata?.reason).toBe('technical_depth');
    });

    it('should detect acceptance from short positive responses', () => {
      const text = 'yes sure';

      const result = (service as any).detectFromContext(text, mockContext);

      expect(result?.type).toBe('acceptance');
      expect(result?.confidence).toBe(0.6);
      expect(result?.metadata?.reason).toBe('short_positive');
    });

    it('should detect clarification from question format', () => {
      const text = 'How does this work?';

      const result = (service as any).detectFromContext(text, mockContext);

      expect(result?.type).toBe('clarification');
      expect(result?.confidence).toBe(0.6);
      expect(result?.metadata?.reason).toBe('question_format');
    });

    it('should return null when no context patterns match', () => {
      const text = 'Just some normal text';

      const result = (service as any).detectFromContext(text, mockContext);

      expect(result).toBeNull();
    });

    it('should not detect technical readiness with low interaction count', () => {
      const text =
        'We should use microservices architecture for better scalability';
      const contextWithFewInteractions = {
        ...mockContext,
        core: {
          ...mockContext.core,
          session: { ...mockContext.core.session, interactionCount: 1 },
        },
      };

      const result = (service as any).detectFromContext(
        text,
        contextWithFewInteractions,
      );

      expect(result).toBeNull();
    });
  });

  describe('pattern coverage', () => {
    it('should have patterns for all major intent types', () => {
      const patterns = (service as any).patterns;

      expect(patterns).toHaveProperty('correction');
      expect(patterns).toHaveProperty('clarification');
      expect(patterns).toHaveProperty('acceptance');
      expect(patterns).toHaveProperty('moreDetail');
      expect(patterns).toHaveProperty('skipAhead');
      expect(patterns).toHaveProperty('needsMoreInfo');
      expect(patterns).toHaveProperty('startOver');
      expect(patterns).toHaveProperty('concerns');
      expect(patterns).toHaveProperty('ready');
      expect(patterns).toHaveProperty('satisfied');

      // Each pattern group should have multiple variations
      expect(patterns.correction.length).toBeGreaterThan(1);
      expect(patterns.clarification.length).toBeGreaterThan(1);
      expect(patterns.acceptance.length).toBeGreaterThan(1);
    });

    it('should handle case-insensitive matching', async () => {
      const testCases = [
        { message: 'ACTUALLY', expectedType: 'correction' },
        { message: 'Actually', expectedType: 'correction' },
        { message: 'actually', expectedType: 'correction' },
        { message: 'WHAT DO YOU MEAN', expectedType: 'clarification' },
        { message: 'YES', expectedType: 'acceptance' },
      ];

      for (const { message, expectedType } of testCases) {
        const userMessage = TestUtils.createMockMessage({
          data: { message },
        });
        const result = await service.detect(userMessage, mockContext);
        expect(result.type).toBe(expectedType);
      }
    });
  });
});
