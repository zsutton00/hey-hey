import {
  formatArtifactForPrompt,
  formatArtifactsForPrompt,
  reconstructConversationFromQaPairs,
} from '../artifact-formatting.util';
import { ArtifactResponseDto, QAPairData, InsightData } from '../../generated';

describe('artifact-formatting.util', () => {
  describe('formatArtifactForPrompt', () => {
    it('should format QA_PAIR artifact as two separate JSON objects', () => {
      const qaPairArtifact: ArtifactResponseDto = {
        id: 'd7efaa04-2ccd-404e-b0b1-e184b87777c7',
        projectId: 'cf176bb0-b90d-42dc-9fbb-34eb1a7fac16' as any,
        type: 'QA_PAIR' as any,
        title:
          'Response to "How does this project relate to your organization?"',
        data: {
          type: 'QA_PAIR',
          answer: 'Hobby/Personal project',
          question: 'How does this project relate to your organization?',
          questionField: 'org_context',
          userMessageId: '4827a414-b24b-4d0d-abd8-2b1c706166e7',
          systemMessageId: '8e220a7f-920e-4e77-ad1c-a3b6cf940b22',
        } as QAPairData,
        embeddingModel: undefined,
        hasEmbedding: false,
        parentId: undefined,
        rootId: undefined,
        sourceType: 'CONVERSATION' as any,
        sourceId: '01ad2a49-234c-4974-b880-4e454abc4148',
        contentHash:
          '88585c61b864f364e250bf3dd05719849209f5690d4dfd6616543c86d6df1121',
        wordCount: undefined,
        language: undefined,
        tags: ['qa_pair', 'round-1', 'user-response'],
        tagRelations: [],
        category: 'user_response',
        priority: undefined,
        status: 'ACTIVE' as any,
        isPublic: false,
        createdAt: '2025-09-16T19:38:13.487Z',
        updatedAt: '2025-09-16T19:38:13.529Z',
        archivedAt: '',
      };

      const result = formatArtifactForPrompt(qaPairArtifact);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);

      // First object: system message with question
      expect(parsed[0]).toHaveProperty('role', 'system');
      expect(parsed[0]).toHaveProperty(
        'entityId',
        '8e220a7f-920e-4e77-ad1c-a3b6cf940b22',
      );
      expect(parsed[0]).toHaveProperty(
        'content',
        'How does this project relate to your organization?',
      );
      expect(parsed[0]).toHaveProperty('timestamp', '2025-09-16T19:38:13.487Z');
      expect(parsed[0]).toHaveProperty('type', 'QA_PAIR');

      // Second object: user message with answer
      expect(parsed[1]).toHaveProperty('role', 'user');
      expect(parsed[1]).toHaveProperty(
        'entityId',
        '4827a414-b24b-4d0d-abd8-2b1c706166e7',
      );
      expect(parsed[1]).toHaveProperty('content', 'Hobby/Personal project');
      expect(parsed[1]).toHaveProperty('timestamp', '2025-09-16T19:38:13.487Z');
      expect(parsed[1]).toHaveProperty('type', 'QA_PAIR');
    });

    it('should format INITIATIVE_ORIGINAL artifact as single-element JSON array', () => {
      const initiativeOriginalArtifact: ArtifactResponseDto = {
        id: '669d28cd-f54c-439b-8e40-cfa9b20d6360',
        projectId: 'de09727a-2fdb-44a7-9643-8bcf29b4d244' as any,
        type: 'INITIATIVE_ORIGINAL' as any,
        title: 'Original: Management Dashboard and Reporting',
        data: {
          type: 'INITIATIVE_ORIGINAL',
          content:
            '{"initiativeId":"286c1106-fef2-46e4-be84-cd53aebc2880","generatedAt":"2025-09-05T04:40:21.681Z","generationSource":"onboarding-flow","generationModel":"llm-generated","originalData":{"name":"Management Dashboard and Reporting","description":"Create comprehensive dashboards and ad-hoc reporting capabilities for management visibility into team progress and product status","details":"Design and implement management-focused interfaces that provide high-level summaries of team accomplishments and goals. Create ad-hoc reporting functionality that leverages the RAG system to generate insights from project data. Implement automated status updates and progress tracking across projects and initiatives. Build competitor analysis preparation for future integration. Create role-based access controls and customizable dashboard views. Ensure all reporting is generated in real-time using the existing websocket infrastructure.","acceptanceCriteria":"- Management dashboard with high-level team summaries implemented\\n- Ad-hoc reporting system functional with RAG integration\\n- Automated status updates across projects working\\n- Role-based access controls implemented\\n- Customizable dashboard views available\\n- Real-time updates via websockets\\n- Management user testing shows 80% satisfaction with visibility and insights","priority":"medium","tags":["dashboard","reporting","management","analytics","real-time"],"reasoning":"Addresses specific management user needs and leverages existing real-time infrastructure"}}',
          reasoning:
            'Original LLM-generated data for initiative: Management Dashboard and Reporting',
          confidence: 0.95,
        } as any,
        embeddingModel: undefined,
        hasEmbedding: false,
        parentId: undefined,
        rootId: undefined,
        sourceType: 'INITIATIVE' as any,
        sourceId: '6874f0ce-f84c-4717-8bd8-329100f71fd8',
        contentHash:
          'd5993525d8aef271052dbcfcbefdd474b0031d5bfb5aa292986f895f11321cf7',
        wordCount: undefined,
        language: undefined,
        tags: [
          'analytics',
          'dashboard',
          'initiative-286c1106-fef2-46e4-be84-cd53aebc2880',
          'initiative-original',
          'llm-generated',
          'management',
          'real-time',
          'reporting',
        ],
        tagRelations: [],
        category: 'initiative-generation',
        priority: undefined,
        status: 'ACTIVE' as any,
        isPublic: false,
        createdAt: '2025-09-05T04:40:21.683Z',
        updatedAt: '2025-09-05T04:40:21.750Z',
        archivedAt: '',
      };

      const result = formatArtifactForPrompt(initiativeOriginalArtifact);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toHaveProperty(
        'entityId',
        '6874f0ce-f84c-4717-8bd8-329100f71fd8',
      );
      expect(parsed[0]).toHaveProperty('type', 'INITIATIVE_ORIGINAL');
      expect(parsed[0]).toHaveProperty(
        'title',
        'Original: Management Dashboard and Reporting',
      );
      expect(parsed[0].content).toContain(
        '{"initiativeId":"286c1106-fef2-46e4-be84-cd53aebc2880"',
      );
      expect(parsed[0].content).toContain('Management Dashboard and Reporting');
    });

    it('should handle artifact with content in data but unknown type', () => {
      const genericArtifact: ArtifactResponseDto = {
        id: 'generic-123',
        type: 'NOTE' as any,
        title: 'Generic Note',
        data: {
          type: 'NOTE',
          content: 'This is a generic note content',
        } as any,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        sourceType: 'CONVERSATION' as any,
        sourceId: 'source-123',
        createdAt: '2025-09-16T20:00:00.000Z',
        updatedAt: '2025-09-16T20:00:00.000Z',
      };

      const result = formatArtifactForPrompt(genericArtifact);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toHaveProperty(
        'content',
        'This is a generic note content',
      );
    });

    it('should handle artifact with no content gracefully', () => {
      const emptyArtifact: ArtifactResponseDto = {
        id: 'empty-123',
        type: 'UNKNOWN' as any,
        title: 'Empty Artifact',
        data: {
          type: 'UNKNOWN',
        } as any,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        sourceType: 'CONVERSATION' as any,
        sourceId: 'source-123',
        createdAt: '2025-09-16T20:00:00.000Z',
        updatedAt: '2025-09-16T20:00:00.000Z',
      };

      const result = formatArtifactForPrompt(emptyArtifact);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toHaveProperty('content', 'No content');
    });

    it('should respect formatting options', () => {
      const artifact: ArtifactResponseDto = {
        id: 'test-123',
        type: 'QA_PAIR' as any,
        title: 'Test Artifact',
        data: {
          type: 'QA_PAIR',
          question: 'Test question?',
          answer: 'Test answer',
        } as QAPairData,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        sourceType: 'CONVERSATION' as any,
        sourceId: 'source-123',
        createdAt: '2025-09-16T20:00:00.000Z',
        updatedAt: '2025-09-16T20:00:00.000Z',
      };

      const result = formatArtifactForPrompt(artifact, {
        includeTimestamp: false,
        includeType: false,
      });
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2); // QA_PAIR returns 2 objects
      expect(parsed[0]).not.toHaveProperty('timestamp');
      expect(parsed[0]).not.toHaveProperty('artifactId');
      expect(parsed[0]).not.toHaveProperty('type');
      expect(parsed[0]).toHaveProperty('title', 'Test Artifact');
      expect(parsed[0].content).toBe('Test question?');
    });

    it('should handle missing title gracefully', () => {
      const artifact: ArtifactResponseDto = {
        id: 'no-title-123',
        type: 'QA_PAIR' as any,
        data: {
          type: 'QA_PAIR',
          question: 'Test question?',
          answer: 'Test answer',
        } as QAPairData,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        sourceType: 'CONVERSATION' as any,
        sourceId: 'source-123',
        createdAt: '2025-09-16T20:00:00.000Z',
        updatedAt: '2025-09-16T20:00:00.000Z',
      };

      const result = formatArtifactForPrompt(artifact);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty('title', 'Untitled');
    });

    it('should handle missing createdAt gracefully', () => {
      const artifact: ArtifactResponseDto = {
        id: 'no-date-123',
        type: 'QA_PAIR' as any,
        title: 'Test',
        data: {
          type: 'QA_PAIR',
          question: 'Test question?',
          answer: 'Test answer',
        } as QAPairData,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        sourceType: 'CONVERSATION' as any,
        sourceId: 'source-123',
        createdAt: '',
        updatedAt: '2025-09-16T20:00:00.000Z',
      };

      const result = formatArtifactForPrompt(artifact);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).not.toHaveProperty('timestamp');
      expect(parsed[0]).toHaveProperty('type', 'QA_PAIR');
    });

    it('should format message sourced artifact ids with entityId', () => {
      const artifact: ArtifactResponseDto = {
        id: 'message-artifact',
        type: 'INSIGHT' as any,
        title: 'Message Insight',
        data: {
          type: 'INSIGHT',
          content: 'Insight derived from a message',
        } as InsightData,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        createdAt: '2025-09-16T20:02:00.000Z',
        updatedAt: '2025-09-16T20:02:00.000Z',
        sourceType: 'MESSAGE' as any,
        sourceId: 'message-123',
      };

      const result = formatArtifactForPrompt(artifact);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty('entityId', 'message-123');
    });

    it('should have null entityId when no source metadata is present', () => {
      const artifact: ArtifactResponseDto = {
        id: 'no-source',
        type: 'INSIGHT' as any,
        title: 'No source artifact',
        data: {
          type: 'INSIGHT',
          content: 'No source details available',
        } as InsightData,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        sourceType: 'CONVERSATION' as any,
        sourceId: '',
        createdAt: '2025-09-16T20:03:00.000Z',
        updatedAt: '2025-09-16T20:03:00.000Z',
      };

      const result = formatArtifactForPrompt(artifact);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty('entityId', null);
    });
  });

  describe('formatArtifactsForPrompt', () => {
    it('should format multiple artifacts as JSON array', () => {
      const artifacts: ArtifactResponseDto[] = [
        {
          id: 'first-123',
          type: 'QA_PAIR' as any,
          title: 'First Artifact',
          data: {
            type: 'QA_PAIR',
            question: 'First question?',
            answer: 'First answer',
          } as QAPairData,
          hasEmbedding: false,
          tags: [],
          status: 'ACTIVE' as any,
          isPublic: false,
          sourceType: 'CONVERSATION' as any,
          sourceId: 'source-123',
          createdAt: '2025-09-16T20:00:00.000Z',
          updatedAt: '2025-09-16T20:00:00.000Z',
        },
        {
          id: 'second-123',
          type: 'INSIGHT' as any,
          title: 'Second Artifact',
          data: {
            type: 'INSIGHT',
            confidence: 0.9,
            reasoning: 'Test reasoning',
            content: 'Test insight content',
          } as InsightData,
          hasEmbedding: false,
          tags: [],
          status: 'ACTIVE' as any,
          isPublic: false,
          sourceType: 'CONVERSATION' as any,
          sourceId: 'source-456',
          createdAt: '2025-09-16T20:01:00.000Z',
          updatedAt: '2025-09-16T20:01:00.000Z',
        },
      ];

      const result = formatArtifactsForPrompt(artifacts);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3); // QA_PAIR produces 2 objects + INSIGHT produces 1 = 3 total
      expect(parsed[0]).toHaveProperty('title', 'First Artifact');
      expect(parsed[0]).toHaveProperty('role', 'system'); // First from QA_PAIR
      expect(parsed[1]).toHaveProperty('title', 'First Artifact');
      expect(parsed[1]).toHaveProperty('role', 'user'); // Second from QA_PAIR
      expect(parsed[2]).toHaveProperty('title', 'Second Artifact');
      expect(parsed[0].content).toBe('First question?');
      expect(parsed[1].content).toBe('First answer');
      expect(parsed[2]).toHaveProperty('content', 'Test insight content');
    });

    it('should pass through format options to individual artifacts', () => {
      const artifacts: ArtifactResponseDto[] = [
        {
          id: 'test-123',
          type: 'QA_PAIR' as any,
          title: 'Test',
          data: {
            type: 'QA_PAIR',
            question: 'Test?',
            answer: 'Answer',
          } as QAPairData,
          hasEmbedding: false,
          tags: [],
          status: 'ACTIVE' as any,
          isPublic: false,
          sourceType: 'CONVERSATION' as any,
          sourceId: 'source-123',
          createdAt: '2025-09-16T20:00:00.000Z',
          updatedAt: '2025-09-16T20:00:00.000Z',
        },
      ];

      const result = formatArtifactsForPrompt(artifacts, {
        includeType: false,
        includeTimestamp: false,
      });
      const parsed = JSON.parse(result);

      expect(parsed[0]).not.toHaveProperty('type');
      expect(parsed[0]).not.toHaveProperty('timestamp');
      expect(parsed[0]).toHaveProperty('title', 'Test');
    });

    it('should return empty string for empty array', () => {
      const result = formatArtifactsForPrompt([]);
      expect(result).toBe('');
    });

    it('should return empty string for null/undefined input', () => {
      const result1 = formatArtifactsForPrompt(null as any);
      const result2 = formatArtifactsForPrompt(undefined as any);

      expect(result1).toBe('');
      expect(result2).toBe('');
    });
  });

  describe('reconstructConversationFromQaPairs', () => {
    it('should include system response only once per system message', () => {
      const artifacts: ArtifactResponseDto[] = [
        {
          id: 'artifact-1',
          projectId: 'project-1' as any,
          type: 'QA_PAIR' as any,
          title: 'Response to "Question 1"',
          data: {
            type: 'QA_PAIR',
            question: 'Question 1?',
            answer: 'Answer 1',
            systemResponse: 'Here is the response.',
            systemMessageId: 'system-1',
            userMessageId: 'user-1',
          } as QAPairData,
          hasEmbedding: false,
          tags: [],
          status: 'ACTIVE' as any,
          isPublic: false,
          sourceType: 'CONVERSATION' as any,
          sourceId: 'source-1',
          createdAt: '2025-09-16T20:00:00.000Z',
          updatedAt: '2025-09-16T20:00:00.000Z',
        },
        {
          id: 'artifact-2',
          projectId: 'project-1' as any,
          type: 'QA_PAIR' as any,
          title: 'Response to "Question 2"',
          data: {
            type: 'QA_PAIR',
            question: 'Question 2?',
            answer: 'Answer 2',
            systemResponse: 'Here is the response.',
            systemMessageId: 'system-1',
            userMessageId: 'user-2',
          } as QAPairData,
          hasEmbedding: false,
          tags: [],
          status: 'ACTIVE' as any,
          isPublic: false,
          sourceType: 'CONVERSATION' as any,
          sourceId: 'source-1',
          createdAt: '2025-09-16T20:00:01.000Z',
          updatedAt: '2025-09-16T20:00:01.000Z',
        },
      ];

      const entries = reconstructConversationFromQaPairs(artifacts, {
        includeType: false,
        includeTitle: false,
        includeTimestamp: false,
      });

      expect(entries).toHaveLength(4);
      expect(entries[0]?.content).toContain('Here is the response.');
      expect(entries[0]?.content).toContain('Q: Question 1?');
      expect(entries[2]?.content).toBe('Question 2?');

      const responseCount = entries.filter((entry) =>
        entry.content?.includes('Here is the response.'),
      ).length;
      expect(responseCount).toBe(1);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle QA_PAIR with missing question or answer', () => {
      const incompleteQA: ArtifactResponseDto = {
        id: 'incomplete-qa',
        type: 'QA_PAIR' as any,
        title: 'Incomplete QA',
        data: {
          type: 'QA_PAIR',
          question: 'What is this?',
          // missing answer
        } as any,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        sourceType: 'CONVERSATION' as any,
        sourceId: 'source-123',
        createdAt: '2025-09-16T20:00:00.000Z',
        updatedAt: '2025-09-16T20:00:00.000Z',
      };

      const result = formatArtifactForPrompt(incompleteQA);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].content).toBe('What is this?');
      expect(parsed[1].content).toBe(undefined); // Should gracefully handle missing answer
    });

    it('should handle INSIGHT with missing content', () => {
      const incompleteInsight: ArtifactResponseDto = {
        id: 'incomplete-insight',
        type: 'INSIGHT' as any,
        title: 'Incomplete Insight',
        data: {
          type: 'INSIGHT',
          confidence: 0.8,
          reasoning: 'Some reasoning',
          // missing content
        } as any,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        sourceType: 'CONVERSATION' as any,
        sourceId: 'source-123',
        createdAt: '2025-09-16T20:00:00.000Z',
        updatedAt: '2025-09-16T20:00:00.000Z',
      };

      const result = formatArtifactForPrompt(incompleteInsight);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toHaveProperty('content', 'No insight content');
    });

    it('should handle artifact with null/undefined data', () => {
      const nullDataArtifact: ArtifactResponseDto = {
        id: 'null-data',
        type: 'UNKNOWN' as any,
        title: 'Null Data Artifact',
        data: null as any,
        hasEmbedding: false,
        tags: [],
        status: 'ACTIVE' as any,
        isPublic: false,
        sourceType: 'CONVERSATION' as any,
        sourceId: 'source-123',
        createdAt: '2025-09-16T20:00:00.000Z',
        updatedAt: '2025-09-16T20:00:00.000Z',
      };

      const result = formatArtifactForPrompt(nullDataArtifact);
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toHaveProperty('content', 'No content');
    });
  });
});
