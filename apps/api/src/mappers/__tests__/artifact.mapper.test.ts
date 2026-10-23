import {
  OrganizationId,
  ProjectId,
  ConversationId,
  MessageId,
} from 'src/types';
import { QuestionAnswerPair } from '../../utils/response-question-matcher.util';
import {
  ArtifactMappingContext,
  mapQuestionAnswerPairToArtifactDto,
  mapQuestionAnswerPairsToArtifactDtos,
} from '../artifact.mapper';
import { isQaPairData } from '../../utils/artifact-formatting.util';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

describe('artifact.mapper', () => {
  const mockContext: ArtifactMappingContext = {
    conversationId: 'conv-456' as ConversationId,
    userMessage: {
      projectId: 'proj-123' as ProjectId,
      conversationId: 'conv-456' as ConversationId,
      type: 'USER' as const,
      data: { concept: 'AI tool' },
    },
    parentMessage: {
      id: 'msg-parent-123' as MessageId,
      projectId: 'proj-123' as ProjectId,
      conversationId: 'conv-456' as ConversationId,
      type: 'SYSTEM' as const,
      status: 'open' as const,
      awaitingResponse: false,
      createdAt: '2023-01-01T00:00:00Z',
      data: {
        type: 'QUESTIONS' as const,
        response: 'Test response',
        detectedIntent: 'project_onboarding',
        intentConfidence: 0.95,
        uiElements: [],
      },
    },
    messageId: 'msg-user-456' as MessageId,
    organizationId: 'org-123' as OrganizationId,
  };

  const mockQuestionAnswerPair: QuestionAnswerPair = {
    uiElement: {
      id: 'concept',
      type: 'textarea',
      label: 'What is your project concept?',
      required: true,
      influences: [],
    },
    round: 1,
    artifactType: 'project_concept',
    question: 'What is your project concept?',
    answer: 'AI-powered project management tool',
    questionField: 'concept',
  };

  describe('mapQuestionAnswerPairToArtifactDto', () => {
    it('should map QuestionAnswerPair to CreateArtifactDto with correct structure', () => {
      const result = mapQuestionAnswerPairToArtifactDto(
        mockQuestionAnswerPair,
        mockContext,
      );

      expect(result.projectId).toBe('proj-123');
      expect(result.type).toBe('project_concept');
      expect(result.title).toBe('Response to "What is your project concept?"');
      expect(result.data?.type).toBe('QA_PAIR');
      if (result.data && isQaPairData(result.data)) {
        expect(result.data.question).toBe('What is your project concept?');
        expect(result.data.answer).toBe('AI-powered project management tool');
      }
      expect(result.sourceType).toBe('CONVERSATION');
      expect(result.sourceId).toBe(mockContext.conversationId);
      expect(result.generateEmbedding).toBe(true);
      expect(result.category).toBe('user_response');
      expect(result.status).toBe('ACTIVE');
    });

    it('should include proper typed data structure', () => {
      const result = mapQuestionAnswerPairToArtifactDto(
        mockQuestionAnswerPair,
        mockContext,
      );

      expect(result.data?.type).toBe('QA_PAIR');
      if (result.data && isQaPairData(result.data)) {
        expect(result.data).toEqual({
          type: 'QA_PAIR',
          question: 'What is your project concept?',
          answer: 'AI-powered project management tool',
          questionField: 'concept',
          systemMessageId: 'msg-parent-123',
          systemResponse: 'Test response',
          userMessageId: 'msg-user-456',
          nodeId: undefined, // nodeId is undefined when not provided in context
        });
      }
    });

    it('should include nodeId in artifact data when provided in context', () => {
      const contextWithNodeId: ArtifactMappingContext = {
        ...mockContext,
        nodeId: 'test-node-id',
      };

      const result = mapQuestionAnswerPairToArtifactDto(
        mockQuestionAnswerPair,
        contextWithNodeId,
      );

      expect(result.data?.type).toBe('QA_PAIR');
      if (result.data && isQaPairData(result.data)) {
        expect(result.data.nodeId).toBe('test-node-id');
        expect(result.data).toEqual({
          type: 'QA_PAIR',
          question: 'What is your project concept?',
          answer: 'AI-powered project management tool',
          questionField: 'concept',
          systemMessageId: 'msg-parent-123',
          systemResponse: 'Test response',
          userMessageId: 'msg-user-456',
          nodeId: 'test-node-id',
        });
      }
    });

    it('should include proper tags', () => {
      const result = mapQuestionAnswerPairToArtifactDto(
        mockQuestionAnswerPair,
        mockContext,
      );

      expect(result.tags).toEqual([
        'round-1',
        'user-response',
        'project_concept',
      ]);
    });

    it('should handle different artifact types', () => {
      const technicalPair: QuestionAnswerPair = {
        ...mockQuestionAnswerPair,
        artifactType: 'technical_specification',
        round: 2,
      };

      const result = mapQuestionAnswerPairToArtifactDto(
        technicalPair,
        mockContext,
      );

      expect(result.type).toBe('technical_specification');
      expect(result.tags).toContain('technical_specification');
      expect(result.tags).toContain('round-2');
    });

    it('should sanitize dangerous question descriptions', () => {
      const pairWithDangerousQuestion: QuestionAnswerPair = {
        ...mockQuestionAnswerPair,
        question: 'Question with <script>alert("xss")</script> content',
      };

      const result = mapQuestionAnswerPairToArtifactDto(
        pairWithDangerousQuestion,
        mockContext,
      );

      expect(result.title).toBe(
        'Response to "Question with alert("xss") content"',
      );
      expect(result.title).not.toContain('<script>');
      expect(result.title).not.toContain('</script>');
    });

    it('should handle null/undefined question descriptions', () => {
      const pairWithNullQuestion: QuestionAnswerPair = {
        ...mockQuestionAnswerPair,
        question: null as any,
      };

      const result = mapQuestionAnswerPairToArtifactDto(
        pairWithNullQuestion,
        mockContext,
      );

      expect(result.title).toBe('Q&A Response');
    });

    it('should handle empty question descriptions', () => {
      const pairWithEmptyQuestion: QuestionAnswerPair = {
        ...mockQuestionAnswerPair,
        question: '',
      };

      const result = mapQuestionAnswerPairToArtifactDto(
        pairWithEmptyQuestion,
        mockContext,
      );

      expect(result.title).toBe('Q&A Response');
    });

    it('should handle very long question descriptions', () => {
      const longQuestion = 'A'.repeat(300) + ' question?';
      const pairWithLongQuestion: QuestionAnswerPair = {
        ...mockQuestionAnswerPair,
        question: longQuestion,
      };

      const result = mapQuestionAnswerPairToArtifactDto(
        pairWithLongQuestion,
        mockContext,
      );

      const title = assertDefined(result.title, 'result title');
      expect(title.length).toBeLessThanOrEqual(220); // Allow for "Response to " prefix
      expect(title).toMatch(/^Response to "/);
      expect(title).toMatch(/"$/);
    });
  });

  describe('mapQuestionAnswerPairsToArtifactDtos', () => {
    it('should map multiple pairs correctly', () => {
      const pairs: QuestionAnswerPair[] = [
        mockQuestionAnswerPair,
        {
          ...mockQuestionAnswerPair,
          questionField: 'requirements',
          answer: 'User auth',
          artifactType: 'requirements',
        },
      ];

      const results = mapQuestionAnswerPairsToArtifactDtos(pairs, mockContext);

      expect(results).toHaveLength(2);
      const firstResult = assertDefined(results[0], 'first artifact result');
      const secondResult = assertDefined(results[1], 'second artifact result');
      expect(firstResult.type).toBe('project_concept');
      expect(secondResult.type).toBe('requirements');
    });

    it('should return empty array for empty input', () => {
      const results = mapQuestionAnswerPairsToArtifactDtos([], mockContext);
      expect(results).toEqual([]);
    });
  });

  describe('ArtifactMappingContext', () => {
    it('should require all necessary context fields', () => {
      // This test ensures our interface is correctly defined
      const context: ArtifactMappingContext = {
        conversationId: 'conv-456' as ConversationId,
        userMessage: mockContext.userMessage,
        parentMessage: mockContext.parentMessage,
        messageId: mockContext.messageId,
        organizationId: 'org-123' as OrganizationId,
      };

      expect(context.userMessage).toBeDefined();
      expect(context.parentMessage).toBeDefined();
      expect(context.messageId).toBeDefined();
    });

    it('should support optional nodeId field', () => {
      const contextWithNodeId: ArtifactMappingContext = {
        conversationId: 'conv-456' as ConversationId,
        userMessage: mockContext.userMessage,
        parentMessage: mockContext.parentMessage,
        messageId: mockContext.messageId,
        organizationId: 'org-123' as OrganizationId,
        nodeId: 'optional-node-id',
      };

      expect(contextWithNodeId.nodeId).toBe('optional-node-id');
    });
  });
});
