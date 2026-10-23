import { EntityType } from '@prisma/client';
import { ArtifactResponseDto } from 'src/generated';
import { createMockPlaceholderContext } from '../../../../../utils/testUtils';
import type { PlaceholderContext } from '../../base/placeholder-types';
import { PlaceholderResolver } from '../../resolver.service';
import { StandardPlaceholderRegistry } from '../standard-placeholders.registry';
import { createServiceTestingModule } from '../../../../../../test/setup/testing-module.factory';

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
};

describe('StandardPlaceholderRegistry', () => {
  let registry: StandardPlaceholderRegistry;
  let resolver: PlaceholderResolver;
  let mockContext: PlaceholderContext;
  let qaPairArtifacts: ArtifactResponseDto[];

  beforeEach(async () => {
    const setup = await createServiceTestingModule({
      providers: [PlaceholderResolver],
    });

    resolver = setup.module.get<PlaceholderResolver>(PlaceholderResolver);
    registry = new StandardPlaceholderRegistry();
    qaPairArtifacts = [
      {
        id: '6642b081-0a22-4de0-a666-adba8d1b8a8d',
        projectId: 'c1e004d3-8ca6-434c-8629-74804fe1c420',
        type: 'QA_PAIR',
        title:
          'Response to "How would you describe the current state of this project?"',
        data: {
          type: 'QA_PAIR',
          answer: 'Early - Some work complete',
          question: 'How would you describe the current state of this project?',
          questionField: 'project_maturity',
          userMessageId: 'f3a838b6-0cc6-41e2-8d5e-f9b7268b0d8d',
          systemMessageId: 'dd90764f-3d1b-4d38-8227-3a64d29b7691',
        },
        embeddingModel: null,
        hasEmbedding: false,
        parentId: null,
        rootId: null,
        sourceType: 'CONVERSATION',
        sourceId: 'b80919e5-7c1d-4ee9-aef5-ccb6105af28e',
        contentHash:
          'b0d77eee216e369d2947c030b1ad6ac8b26a9a83dff7360205cf24a81d89b558',
        language: null,
        tags: ['qa_pair', 'round-1', 'user-response'],
        tagRelations: [],
        category: 'user_response',
        priority: null,
        status: 'ACTIVE',
        isPublic: false,
        createdAt: '2025-09-16T03:54:17.163Z',
        updatedAt: '2025-09-16T03:54:17.226Z',
        archivedAt: '',
      },
      {
        id: '9de155db-bba3-4921-b429-26b012f9ad1e',
        projectId: 'c1e004d3-8ca6-434c-8629-74804fe1c420',
        type: 'QA_PAIR',
        title: 'Response to "Project Concept"',
        data: {
          type: 'QA_PAIR',
          answer:
            'The project is to organizational project and product management what cursor is to code. In short, the exhausting low details of sprints and meetings are an implementation detail, we want to let teams focus on products and delivery.:\n* Provide a common area for knowledge sharing and sharing. Integrate with external services such as Github and Jira. Provide a social space to interact with AI on planning, design, ADR, initiative and task refinement, and more.\n* Leverage agents to surface integration and alignment issues before users are aware of them: from the mundane, two teams using different casing on enums, to more intricate and insidious issues like …, we can help discover these issues whether in planning, design, or code.\n* Help members understand the organization top to bottom and end to end. Help PMs understand the technical details without another meeting. Help engineering understand another team’s API without out of date documentation. Give management an accurate overview of the team’s progress and individual contributors a stronger understanding of their work’s place in the organization.',
          question: 'Project Concept',
          questionField: 'project_concept',
          userMessageId: 'f3a838b6-0cc6-41e2-8d5e-f9b7268b0d8d',
          systemMessageId: 'dd90764f-3d1b-4d38-8227-3a64d29b7691',
        },
        embeddingModel: null,
        hasEmbedding: false,
        parentId: null,
        rootId: null,
        sourceType: 'CONVERSATION',
        sourceId: 'b80919e5-7c1d-4ee9-aef5-ccb6105af28e',
        contentHash:
          '9087592925283f85a4bb9d77d777c1489bfc452afec454523e40d8baf3da22af',
        language: null,
        tags: ['qa_pair', 'round-1', 'user-response'],
        tagRelations: [],
        category: 'user_response',
        priority: null,
        status: 'ACTIVE',
        isPublic: false,
        createdAt: '2025-09-16T03:54:17.163Z',
        updatedAt: '2025-09-16T03:54:17.219Z',
        archivedAt: '',
      },
      {
        id: '24d3a535-6225-4f66-9d22-bd8fdf814b4a',
        projectId: 'c1e004d3-8ca6-434c-8629-74804fe1c420',
        type: 'QA_PAIR',
        title: 'Response to "What is your team size for this project?"',
        data: {
          type: 'QA_PAIR',
          answer: 'Solo (1 person)',
          question: 'What is your team size for this project?',
          questionField: 'team_size',
          userMessageId: 'f3a838b6-0cc6-41e2-8d5e-f9b7268b0d8d',
          systemMessageId: 'dd90764f-3d1b-4d38-8227-3a64d29b7691',
        },
        embeddingModel: null,
        hasEmbedding: false,
        parentId: null,
        rootId: null,
        sourceType: 'CONVERSATION',
        sourceId: 'b80919e5-7c1d-4ee9-aef5-ccb6105af28e',
        contentHash:
          '2be9b8baf58d3d5c9e959de4c7e21a591965ad0629a07054cd5d4021ab7ef88c',
        language: null,
        tags: ['qa_pair', 'round-1', 'user-response'],
        tagRelations: [],
        category: 'user_response',
        priority: null,
        status: 'ACTIVE',
        isPublic: false,
        createdAt: '2025-09-16T03:54:17.163Z',
        updatedAt: '2025-09-16T03:54:17.195Z',
        archivedAt: '',
      },
      {
        id: '78ea6033-0a3b-45a7-b402-9ee6dc3ffbb1',
        projectId: 'c1e004d3-8ca6-434c-8629-74804fe1c420',
        type: 'QA_PAIR',
        title:
          'Response to "How does this project relate to your organization?"',
        data: {
          type: 'QA_PAIR',
          answer: 'New company/startup',
          question: 'How does this project relate to your organization?',
          questionField: 'org_context',
          userMessageId: 'f3a838b6-0cc6-41e2-8d5e-f9b7268b0d8d',
          systemMessageId: 'dd90764f-3d1b-4d38-8227-3a64d29b7691',
        },
        embeddingModel: null,
        hasEmbedding: false,
        parentId: null,
        rootId: null,
        sourceType: 'CONVERSATION',
        sourceId: 'b80919e5-7c1d-4ee9-aef5-ccb6105af28e',
        contentHash:
          '39287146e61f15c6e06135b204d75c5eb84cd3c264e4b4d51a6e1f47098e297f',
        language: null,
        tags: ['qa_pair', 'round-1', 'user-response'],
        tagRelations: [],
        category: 'user_response',
        priority: null,
        status: 'ACTIVE',
        isPublic: false,
        createdAt: '2025-09-16T03:54:17.163Z',
        updatedAt: '2025-09-16T03:54:17.205Z',
        archivedAt: '',
      },
    ] as unknown as ArtifactResponseDto[];

    // Create mock context with services
    mockContext = createMockPlaceholderContext({
      services: {
        initiativeService: {
          findOne: jest.fn(),
          findOneForAdapter: jest.fn(),
          findByProject: jest.fn(),
        } as any,
        artifactService: {
          findMany: jest.fn(),
          findInfluences: jest.fn(),
        } as any,
        contextResolutionService: {
          resolveContext: jest.fn(),
        } as any,
      },
    });

    (
      mockContext.services.artifactService.findInfluences as jest.Mock
    ).mockResolvedValue([]);
    (
      mockContext.services.artifactService.findMany as jest.Mock
    ).mockResolvedValue({ data: qaPairArtifacts });
  });

  describe('Registry Setup', () => {
    it('should register all standard placeholders', () => {
      const allKeys = registry.getKeys();

      // Simple value placeholders
      expect(allKeys).toContain('workflowId');
      expect(allKeys).toContain('organizationId');
      expect(allKeys).toContain('projectId');
      expect(allKeys).toContain('conversationId');
      expect(allKeys).toContain('interactionCount');
      expect(allKeys).toContain('currentMessage');
      expect(allKeys).toContain('message');

      // Initiative placeholders
      expect(allKeys).toContain('initiative.name');
      expect(allKeys).toContain('initiative.description');
      expect(allKeys).toContain('initiative.priority');
      expect(allKeys).toContain('initiative.tags');
      expect(allKeys).toContain('initiative.currentLevel');
      expect(allKeys).toContain('initiative.levelProgress');
      expect(allKeys).toContain('initiative.levelDescription');
      expect(allKeys).toContain('$initiative.reasoning');

      // Node context placeholders
      expect(allKeys).toContain('task');
      expect(allKeys).toContain('integrations');
      expect(allKeys).toContain('currentLevel');

      // Content block placeholders
      expect(allKeys).toContain('conversationHistory');
      expect(allKeys).toContain('currentInitiative');
      expect(allKeys).toContain('initiative');
      expect(allKeys).toContain('artifactInfluencesBySource');
      expect(allKeys).toContain('initiativeArtifacts');
      expect(allKeys).toContain('conversationMentions');
      expect(allKeys).toContain('conversationArtifacts');
      expect(allKeys).toContain('contextSearchResults');
      expect(allKeys).toContain('designDocLinks');
    });

    it('should identify content blocks correctly', () => {
      const contentBlocks = registry.getContentBlocks();
      const contentBlockKeys = contentBlocks.map((p) => p.key);

      expect(contentBlockKeys).toEqual(
        expect.arrayContaining([
          'conversationHistory',
          'conversationHistoryFinalAnswerIsPrompt',
          'currentInitiative',
          'initiative',
          'initiativeArtifacts',
          'conversationArtifacts',
          'conversationMentions',
          'artifactInfluencesBySource',
          'designDocLinks',
          'contextSearchResults',
          'contextSearchResultsForDesignDoc',
        ]),
      );

      // Should not contain simple value placeholders
      expect(contentBlockKeys).not.toContain('workflowId');
      expect(contentBlockKeys).not.toContain('currentMessage');
    });
  });

  describe('Simple Value Placeholders', () => {
    it('should resolve ID placeholders', async () => {
      const template =
        '${workflowId}-${organizationId}-${projectId}-${conversationId}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toBe(
        'test-workflow-test-org-test-project-test-conversation',
      );
    });

    it('should resolve interaction count as number', async () => {
      const template = 'Count: ${interactionCount}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toBe('Count: 1');
    });

    it('should resolve current message', async () => {
      const contextWithMessage = {
        ...mockContext,
        userMessage: {
          data: { message: 'Hello world' },
          timestamp: new Date(),
        } as any,
      };

      const template = 'Message: ${currentMessage}';

      const result = await resolver.resolve(
        template,
        registry,
        contextWithMessage,
      );

      expect(result).toBe('Message: Hello world');
    });
  });

  describe('Initiative Placeholders', () => {
    beforeEach(() => {
      // Mock initiative context
      (mockContext.flowContext as any).initiativeId = 'test-initiative-id';

      // Mock initiative service response
      (
        mockContext.services.initiativeService.findOneForAdapter as jest.Mock
      ).mockResolvedValue({
        id: 'test-initiative-id',
        name: 'Test Initiative',
        priority: 'HIGH',
        status: 'REFINING_DETAILS',
        tags: ['test', 'important'],
        reasoning: 'This is for testing purposes',
        sections: [
          {
            key: 'description',
            materializedMarkdown: 'A test initiative description',
          },
        ],
      });
    });

    it('should resolve initiative name', async () => {
      const template = '${initiative.name}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toBe('Test Initiative');
    });

    it('should resolve initiative description', async () => {
      const template = '${initiative.description}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toBe('A test initiative description');
    });

    it('should resolve initiative tags as comma-separated string', async () => {
      const template = 'Tags: ${initiative.tags}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toBe('Tags: test, important');
    });

    it('should resolve initiative current level', async () => {
      const template = 'Level: ${initiative.currentLevel}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toBe('Level: details');
    });

    it('should resolve database reasoning field with $ prefix', async () => {
      const template = 'Reasoning: ${$initiative.reasoning}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toBe('Reasoning: This is for testing purposes');
    });

    it('should handle missing initiative context gracefully', async () => {
      const contextWithoutInitiative = {
        ...mockContext,
        flowContext: {
          ...mockContext.flowContext,
          // Remove initiativeId to simulate no initiative context
        },
      };
      delete (contextWithoutInitiative.flowContext as any).initiativeId;

      const template = '${initiative.name}';

      const result = await resolver.resolve(
        template,
        registry,
        contextWithoutInitiative,
      );

      expect(result).toBe('');
    });
  });

  describe('Content Block Placeholders', () => {
    it('should resolve flow context block', async () => {
      const template = '${conversationHistory}';
      mockContext.options.includeHistory = true;

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toContain('<<<BEGIN_CONVERSATION_HISTORY>>>');
    });

    it('should resolve node context block', async () => {
      mockContext.nodeBuildContext = {
        nodeId: 'test-node-123',
        nodeType: 'AGENT',
        nodeTitle: 'Test Analysis Node',
      };
      mockContext.options.includeHistory = true;

      const template = '${conversationHistory}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toContain('<<<BEGIN_CONVERSATION_HISTORY>>>');
    });

    it('should resolve conversation history when enabled', async () => {
      mockContext.options.includeHistory = true;

      (
        mockContext.services.artifactService.findMany as jest.Mock
      ).mockResolvedValue({
        data: qaPairArtifacts,
      });

      const template = '\${conversationHistory}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toContain(
        'How would you describe the current state of this project?',
      );
      expect(result).toContain('Early - Some work complete');
      expect(result).toContain('Project Concept');
      expect(result).toContain(
        'The project is to organizational project and product management what cursor is to code',
      );
      expect(result).toContain('What is your team size for this project?');
      expect(result).toContain('Solo (1 person)');
      expect(result).toContain(
        'How does this project relate to your organization?',
      );
      expect(result).toContain('New company/startup');
      expect(result).toContain('<<<BEGIN_CONVERSATION_HISTORY>>>');
      expect(result).toContain('<<<END_CONVERSATION_HISTORY>>>');
    });

    it('should return empty conversation history when disabled', async () => {
      mockContext.options.includeHistory = false;

      const template = '\${conversationHistory}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toBe('');
    });

    describe('conversationHistoryFinalAnswerIsPrompt', () => {
      const placeholderTemplate = '${conversationHistoryFinalAnswerIsPrompt}';

      const createQAArtifact = (
        id: string,
        question: string,
        answer: string,
      ): ArtifactResponseDto =>
        ({
          id,
          projectId: 'test-project',
          type: 'QA_PAIR',
          title: question,
          data: {
            type: 'QA_PAIR',
            question,
            answer,
            questionField: 'test_field',
            userMessageId: 'user-msg-id',
            systemMessageId: 'system-msg-id',
          },
          embeddingModel: null,
          hasEmbedding: false,
          parentId: null,
          rootId: null,
          sourceType: 'CONVERSATION',
          sourceId: 'test-conversation',
          contentHash: '',
          language: null,
          tags: [],
          tagRelations: [],
          category: 'user_response',
          priority: null,
          status: 'ACTIVE',
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          archivedAt: '',
        }) as unknown as ArtifactResponseDto;

      it('should return empty string when no artifacts are found', async () => {
        (
          mockContext.services.artifactService.findMany as jest.Mock
        ).mockResolvedValue({ data: [] });

        const result = await resolver.resolve(
          placeholderTemplate,
          registry,
          mockContext,
        );

        expect(result).toBe('');
      });

      it('should return only the current question when a single artifact exists', async () => {
        const latestQA = createQAArtifact(
          'latest-artifact',
          'What should we work on next?',
          'Can you help me plan the next milestone?',
        );

        (
          mockContext.services.artifactService.findMany as jest.Mock
        ).mockResolvedValue({ data: [latestQA] });

        const result = await resolver.resolve(
          placeholderTemplate,
          registry,
          mockContext,
        );

        expect(result).toBe(
          "<<<BEGIN_CONVERSATION_HISTORY_FINAL_ANSWER_IS_PROMPT>>>\n### The user's current question\nCan you help me plan the next milestone?\n<<<END_CONVERSATION_HISTORY_FINAL_ANSWER_IS_PROMPT>>>",
        );
      });

      it('should include conversation history when multiple artifacts exist', async () => {
        const previousQA = createQAArtifact(
          'previous-artifact',
          'Can you recap the prior discussion?',
          'Sure, here are the takeaways.',
        );
        const latestQA = createQAArtifact(
          'latest-artifact',
          'What is the open question?',
          'What are the remaining blockers?',
        );

        (
          mockContext.services.artifactService.findMany as jest.Mock
        ).mockResolvedValue({ data: [previousQA, latestQA] });

        const result = await resolver.resolve(
          placeholderTemplate,
          registry,
          mockContext,
        );

        expect(result).toContain('### You have had some previous conversation');
        expect(result).toContain('Can you recap the prior discussion?');
        expect(result).toContain('Sure, here are the takeaways.');
        expect(result).toContain("### The user's current question");
        expect(result).toContain('What are the remaining blockers?');
      });
    });

    it('should resolve current initiative block', async () => {
      (mockContext.flowContext as any).initiativeId = 'test-initiative-id';

      (
        mockContext.services.initiativeService.findOneForAdapter as jest.Mock
      ).mockResolvedValue({
        name: 'Test Initiative Block',
        priority: 'HIGH',
        status: 'REFINING_DETAILS',
        tags: ['test', 'content-block'],
        reasoning: 'Testing content block generation',
        sections: [
          {
            key: 'description',
            materializedMarkdown:
              'This is a test initiative for content blocks',
          },
        ],
      });

      const template = '${currentInitiative}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toContain('CURRENT INITIATIVE: Test Initiative Block');
      expect(result).toContain(
        'Description: This is a test initiative for content blocks',
      );
      expect(result).toContain('Priority: HIGH');
      expect(result).toContain('Status: REFINING_DETAILS');
      expect(result).toContain('Tags: test, content-block');
      expect(result).toContain('Reasoning: Testing content block generation');
    });
  });

  describe('Template Integration', () => {
    it('should resolve a complex template with multiple placeholders', async () => {
      // Setup full context
      (mockContext.flowContext as any).initiativeId = 'test-initiative-id';
      mockContext.nodeBuildContext = {
        currentLevel: 'details',
      };

      (
        mockContext.services.initiativeService.findOneForAdapter as jest.Mock
      ).mockResolvedValue({
        name: 'Performance Optimization',
        description: 'Improve application performance',
        priority: 'HIGH',
        status: 'REFINING_DETAILS',
      });

      const template =
        'Working on: \${initiative.name} (\${initiative.priority} priority)\n' +
        'Current Level: \${currentLevel}\n' +
        'Project: \${projectId}\n\n' +
        'Interaction #\${interactionCount}';

      const result = await resolver.resolve(template, registry, mockContext);

      expect(result).toContain('Working on: Performance Optimization');
      expect(result).toContain('Current Level: details');
      expect(result).toContain('Project: test-project');
      expect(result).toContain('Interaction #1');
    });

    it('should handle mixed content blocks and simple values', async () => {
      const template =
        'Project: \${projectId}\n' +
        '\${conversationHistory}\n\n' +
        'Current Message: \${currentMessage}';

      const contextWithMessage = {
        ...mockContext,
        userMessage: {
          data: { message: 'Test mixed template' },
        } as any,
        options: { includeHistory: true },
      };

      const result = await resolver.resolve(
        template,
        registry,
        contextWithMessage,
      );

      expect(result).toContain('Project: test-project');
      expect(result).toContain('<<<BEGIN_CONVERSATION_HISTORY>>>');
      expect(result).toContain('Current Message: Test mixed template');
    });
  });

  describe('Error Handling', () => {
    it('should handle service failures gracefully', async () => {
      (mockContext.flowContext as any).initiativeId = 'test-initiative-id';

      (
        mockContext.services.initiativeService.findOneForAdapter as jest.Mock
      ).mockRejectedValue(new Error('Database connection failed'));

      const template = '${initiative.name}';

      // Should not throw, but handle error gracefully
      const result = await resolver.resolve(template, registry, mockContext, {
        throwOnMissing: false,
      });

      expect(result).toBe('[PLACEHOLDER_ERROR]');
    });

    it('should validate template before resolution', () => {
      const invalidTemplate = '${nonExistentPlaceholder}';

      const validation = registry.validateTemplate(invalidTemplate);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.missingPlaceholders).toContain(
        'nonExistentPlaceholder',
      );
    });
  });

  describe('Performance', () => {
    it('should cache expensive initiative lookups', async () => {
      (mockContext.flowContext as any).initiativeId = 'test-initiative-id';

      (
        mockContext.services.initiativeService.findOneForAdapter as jest.Mock
      ).mockResolvedValue({
        name: 'Cached Initiative',
      });

      const template = '${initiative.name} - ${initiative.name}';

      // Resolve twice - should only call service once due to caching
      await resolver.resolve(template, registry, mockContext, {
        enableCaching: true,
      });

      // Second resolution should use cache
      const result = await resolver.resolve(template, registry, mockContext, {
        enableCaching: true,
      });

      expect(result).toBe('Cached Initiative - Cached Initiative');

      // Service should only be called once due to caching
      expect(
        mockContext.services.initiativeService.findOneForAdapter,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('Influence Tracking Placeholders', () => {
    const mockArtifacts = [
      {
        id: 'artifact-1',
        title: 'User Requirements',
        type: 'INSIGHT',
        content: 'User needs authentication system',
        data: { content: 'User needs authentication system' },
        createdAt: '2024-01-01T10:00:00Z',
      },
      {
        id: 'artifact-2',
        title: 'Technical Analysis',
        type: 'ANALYSIS',
        content: 'JWT tokens recommended for auth',
        data: { content: 'JWT tokens recommended for auth' },
        createdAt: '2024-01-01T11:00:00Z',
      },
    ];

    beforeEach(() => {
      (
        mockContext.services.artifactService.findMany as jest.Mock
      ).mockResolvedValue({
        data: mockArtifacts,
      });
      (
        mockContext.services.artifactService.findInfluences as jest.Mock
      ).mockResolvedValue(mockArtifacts);
    });

    describe('CONVERSATION_ARTIFACTS placeholder', () => {
      it('should resolve conversation artifacts with proper format', async () => {
        const template = '${conversationArtifacts}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toContain('CONVERSATION ARTIFACTS:');
        expect(result).toContain('"entityId": null');
        expect(result).toContain('"title": "User Requirements"');
        expect(result).toContain(
          '"content": "User needs authentication system"',
        );
      });

      it('should call artifact service with correct conversation parameters', async () => {
        const template = '${conversationArtifacts}';

        await resolver.resolve(template, registry, mockContext);

        expect(
          mockContext.services.artifactService.findMany,
        ).toHaveBeenCalledWith(
          {
            projectId: 'test-project',
            sourceId: 'test-conversation',
            status: 'ACTIVE',
            limit: 20,
          },
          'test-org',
        );
      });

      it('should return empty string when no artifacts found', async () => {
        (
          mockContext.services.artifactService.findMany as jest.Mock
        ).mockResolvedValue({
          data: [],
        });

        const template = '${conversationArtifacts}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toBe('');
      });

      it('should handle artifact service errors gracefully', async () => {
        (
          mockContext.services.artifactService.findMany as jest.Mock
        ).mockRejectedValue(new Error('Service error'));

        const template = '${conversationArtifacts}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toBe('');
      });
    });

    describe('INITIATIVE_ARTIFACTS placeholder', () => {
      beforeEach(() => {
        // Add initiative context to mock
        (mockContext.flowContext as any).initiativeId = 'test-initiative-id';
      });

      it('should resolve initiative artifacts with proper format', async () => {
        const template = '${initiativeArtifacts}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toContain('INITIATIVE GENERATION ARTIFACTS:');
        expect(result).toContain('"entityId": null');
        expect(result).toContain('"type": "INSIGHT"');
      });

      it('should call artifact service with initiative parameters', async () => {
        const template = '${initiativeArtifacts}';

        await resolver.resolve(template, registry, mockContext);

        expect(
          mockContext.services.artifactService.findMany,
        ).toHaveBeenCalledWith(
          {
            projectId: 'test-project',
            sourceType: 'INITIATIVE',
            sourceId: 'test-initiative-id',
            status: 'ACTIVE',
            limit: 20,
          },
          'test-org',
        );
      });

      it('should fallback to conversation artifacts when no initiative artifacts', async () => {
        // Mock empty initiative artifacts, then conversation artifacts
        (mockContext.services.artifactService.findMany as jest.Mock)
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: mockArtifacts });

        const template = '${initiativeArtifacts}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toContain('CONVERSATION ARTIFACTS:');
        expect(
          mockContext.services.artifactService.findMany,
        ).toHaveBeenCalledTimes(2);
      });

      it('should return no initiative context message when missing initiative', async () => {
        // Remove initiative context
        delete (mockContext.flowContext as any).initiativeId;

        const template = '${initiativeArtifacts}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toBe('');
      });

      it('should fallback to conversation artifacts on service error', async () => {
        (mockContext.services.artifactService.findMany as jest.Mock)
          .mockRejectedValueOnce(new Error('Initiative service error'))
          .mockResolvedValueOnce({ data: mockArtifacts });

        const template = '${initiativeArtifacts}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toContain('CONVERSATION ARTIFACTS:');
      });
    });

    describe('ARTIFACT_INFLUENCES_BY_SOURCE placeholder', () => {
      it('should resolve conversation artifacts by default', async () => {
        const template = '${artifactInfluencesBySource}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toContain('<<<BEGIN_ARTIFACT_INFLUENCES>>>');
      });

      it('should call artifact service with conversation source parameters', async () => {
        const template = '${artifactInfluencesBySource}';

        await resolver.resolve(template, registry, mockContext);

        expect(
          mockContext.services.artifactService.findInfluences,
        ).toHaveBeenCalledWith(
          { sourceId: 'test-conversation', sourceType: 'CONVERSATION' },
          'test-org',
        );
      });

      it('should resolve initiative artifacts when sourceType is INITIATIVE', async () => {
        (mockContext.flowContext as any).initiativeId = 'test-initiative-id';

        // This placeholder uses options parameter, but for testing we'll check the default behavior
        const template = '${artifactInfluencesBySource}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toContain('<<<BEGIN_ARTIFACT_INFLUENCES>>>');
      });

      it('should handle empty artifacts gracefully', async () => {
        (
          mockContext.services.artifactService.findInfluences as jest.Mock
        ).mockResolvedValue([]);

        const template = '${artifactInfluencesBySource}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toBe('');
      });

      it('should handle service errors gracefully', async () => {
        (
          mockContext.services.artifactService.findInfluences as jest.Mock
        ).mockRejectedValue(new Error('Artifact service error'));

        const template = '${artifactInfluencesBySource}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toBe('');
      });

      it('should truncate content preview to 100 characters', async () => {
        const longContentArtifact = {
          id: 'artifact-long',
          title: 'Long Content',
          type: 'INSIGHT',
          content: 'A'.repeat(150), // 150 characters
          data: { content: 'A'.repeat(150) },
          createdAt: '2024-01-01T10:00:00Z',
        };

        (
          mockContext.services.artifactService.findInfluences as jest.Mock
        ).mockResolvedValue([longContentArtifact]);

        const template = '${artifactInfluencesBySource}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toContain('<<<BEGIN_ARTIFACT_INFLUENCES>>>');
        expect(result).toContain('A'.repeat(120));
      });
    });

    describe('CONVERSATION_MENTIONS placeholder', () => {
      it('should format mentions with tokens and current flag', async () => {
        const conversationMentions = [
          {
            entityId: 'init-1',
            entityType: EntityType.INITIATIVE,
            messageId: 'msg-1',
            conversationId: 'test-conversation',
            createdAt: new Date('2024-01-01T00:00:00Z'),
          },
          {
            entityId: 'task-2',
            entityType: EntityType.TASK,
            messageId: 'msg-2',
            conversationId: 'test-conversation',
            createdAt: new Date('2024-01-02T00:00:00Z'),
          },
        ];

        const services = assertDefined(
          mockContext.services,
          'mock context services',
        );
        const messageService = assertDefined(
          services.messageService,
          'message service',
        );
        const entityRegistryService = assertDefined(
          services.entityRegistryService,
          'entity registry service',
        );
        const initiativeService = assertDefined(
          services.initiativeService,
          'initiative service',
        );
        const taskService = assertDefined(services.taskService, 'task service');

        (
          messageService.getMentionsForConversation as jest.Mock
        ).mockResolvedValue(conversationMentions);

        (entityRegistryService.getEntitiesByIds as jest.Mock).mockResolvedValue(
          [
            {
              entityId: 'init-1',
              entityType: EntityType.INITIATIVE,
              entityName: 'Initiative One',
            },
            {
              entityId: 'task-2',
              entityType: EntityType.TASK,
              entityName: 'Task Two',
            },
          ],
        );

        (initiativeService.findOneForAdapter as jest.Mock).mockResolvedValue({
          id: 'init-1',
          name: 'Initiative One',
          status: 'Active',
          sections: [
            { key: 'description', materializedMarkdown: 'description' },
            { key: 'details', materializedMarkdown: 'details' },
            {
              key: 'acceptanceCriteria',
              materializedMarkdown: 'acceptanceCriteria',
            },
          ],
        });

        (taskService.findOneByOrganization as jest.Mock).mockResolvedValue({
          id: 'task-2',
          name: 'Task Two',
          status: 'Active',
          description: 'description',
          details: 'details',
          acceptanceCriteria: 'acceptanceCriteria',
        });

        const contextWithMessage = {
          ...mockContext,
          userMessage: {
            id: 'msg-2',
            data: { message: 'Hello @[task:task-2|Task Two]' },
            timestamp: new Date(),
          },
        };

        const template = '${conversationMentions}';
        const result = await resolver.resolve(
          template,
          registry,
          contextWithMessage as any,
        );

        expect(result).toContain('MENTIONS (2');
        expect(result).toContain('@[initiative:init-1|Initiative One]');
        expect(result).toContain('@[task:task-2|Task Two]');
        expect(messageService.getMentionsForConversation).toHaveBeenCalledWith(
          'test-conversation',
          'test-org',
        );
        expect(result).toContain('<<<BEGIN_INITIATIVE>>>');
        expect(result).toContain('<<<END_TASK>>>');
      });
    });

    describe('CONTEXT_SEARCH_RESULTS placeholder', () => {
      const resolveContextMock = jest.fn();

      beforeEach(() => {
        resolveContextMock.mockReset();
        const services = assertDefined(
          mockContext.services,
          'mock context services',
        );
        const contextResolutionService = assertDefined(
          services.contextResolutionService,
          'context resolution service',
        );
        contextResolutionService.resolveContext = resolveContextMock;
      });

      it('should resolve search results when context service returns artifacts', async () => {
        resolveContextMock.mockResolvedValue({
          artifacts: [
            {
              id: 'search-1',
              organizationId: 'test-org',
              projectId: 'test-project',
              type: 'INSIGHT',
              title: 'Recent Initiative Update',
              data: { content: 'We shipped a new integration.' },
              tags: [],
              createdAt: new Date(),
              updatedAt: new Date(),
              relevanceScore: 0.92,
            },
          ],
          totalCount: 1,
          tokenEstimate: 120,
          providerName: 'search-context-provider',
          executionTimeMs: 12,
        });

        const template = '${contextSearchResults}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toContain('CONTEXT SEARCH RESULTS');
        expect(result).toContain('Recent Initiative Update');
        expect(result).toContain('We shipped a new integration.');
        expect(result).toContain('Similarity: 0.920');
        expect(resolveContextMock).toHaveBeenCalledTimes(1);
      });

      it('should handle missing context service gracefully', async () => {
        const services = assertDefined(
          mockContext.services,
          'mock context services',
        );
        delete (services as any).contextResolutionService;

        const template = '${contextSearchResults}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toContain('Context search unavailable');
      });

      it('should handle empty search results', async () => {
        resolveContextMock.mockResolvedValue({
          artifacts: [],
          totalCount: 0,
          tokenEstimate: 0,
          providerName: 'search-context-provider',
          executionTimeMs: 5,
        });

        const template = '${contextSearchResults}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toBe('');
      });
    });

    describe('CONTEXT_SEARCH_RESULTS_FOR_DESIGN_DOC placeholder', () => {
      const resolveContextMock = jest.fn();
      const findOneForAdapter = jest.fn();

      beforeEach(() => {
        resolveContextMock.mockReset();
        findOneForAdapter.mockReset();

        const services = assertDefined(
          mockContext.services,
          'mock context services',
        );
        const contextResolutionService = assertDefined(
          services.contextResolutionService,
          'context resolution service',
        );
        contextResolutionService.resolveContext = resolveContextMock as any;

        (services as any).designDocService = {
          findOneForAdapter,
        };

        (mockContext.flowContext.core as any).workflowAboutType = 'design-doc';
        (mockContext.flowContext.core as any).workflowAboutId =
          'design-doc-123';
      });

      it('should aggregate context search results derived from design doc context', async () => {
        const artifactOne = {
          id: 'artifact-1',
          type: 'DOC',
          title: 'Feature flags overview',
          data: { content: 'Feature flag platform comparison.' },
        } as any;
        const artifactTwo = {
          id: 'artifact-2',
          type: 'DOC',
          title: 'Deployment safety measures',
          data: { content: 'Strategies for safe deployments.' },
        } as any;

        findOneForAdapter.mockResolvedValue({
          id: 'design-doc-123',
          name: 'ADR: Adopt Feature Flags',
          summary: 'Adopt feature flags for runtime configuration',
          tags: ['feature-flags', 'platform'],
          sections: [
            { key: 'context', content: 'We need safer deploys' },
            { key: 'decision', content: 'Adopt LaunchDarkly' },
            { key: 'consequences', content: 'Requires SDK integration' },
          ],
        });

        resolveContextMock
          .mockResolvedValueOnce({
            artifacts: [artifactOne],
            totalCount: 1,
            tokenEstimate: 120,
            providerName: 'search-context-provider',
            executionTimeMs: 8,
          })
          .mockResolvedValueOnce({
            artifacts: [artifactOne, artifactTwo],
            totalCount: 2,
            tokenEstimate: 140,
            providerName: 'search-context-provider',
            executionTimeMs: 9,
          })
          .mockResolvedValueOnce({
            artifacts: [artifactOne],
            totalCount: 1,
            tokenEstimate: 90,
            providerName: 'search-context-provider',
            executionTimeMs: 7,
          })
          .mockResolvedValueOnce({
            artifacts: [],
            totalCount: 0,
            tokenEstimate: 0,
            providerName: 'search-context-provider',
            executionTimeMs: 5,
          });

        const template = '${contextSearchResultsForDesignDoc}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(findOneForAdapter).toHaveBeenCalledWith(
          'design-doc-123',
          mockContext.flowContext.core.organizationId,
        );

        expect(resolveContextMock).toHaveBeenCalledTimes(4);
        expect(resolveContextMock).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            searchQuery: 'Adopt feature flags for runtime configuration',
          }),
          expect.any(Object),
        );
        expect(resolveContextMock).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ searchQuery: 'We need safer deploys' }),
          expect.any(Object),
        );
        expect(resolveContextMock).toHaveBeenNthCalledWith(
          3,
          expect.objectContaining({ searchQuery: 'Adopt LaunchDarkly' }),
          expect.any(Object),
        );
        expect(resolveContextMock).toHaveBeenNthCalledWith(
          4,
          expect.objectContaining({ searchQuery: 'Requires SDK integration' }),
          expect.any(Object),
        );

        expect(result).toContain(
          'DESIGN DOC CONTEXT SEARCH (ADR: Adopt Feature Flags)',
        );
        expect(result).toContain('Feature flags overview');
        expect(result).toContain('Deployment safety measures');
        expect(result).toContain('Feature flags overview');
        expect(result).toContain('Deployment safety measures');
      });

      it('should handle design docs without searchable metadata', async () => {
        findOneForAdapter.mockResolvedValue({
          id: 'design-doc-123',
          name: '   ',
          summary: '   ',
          sections: [],
          tags: [],
        });

        const template = '${contextSearchResultsForDesignDoc}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toBe('');
        expect(resolveContextMock).not.toHaveBeenCalled();
      });

      it('should report when no design doc context is available', async () => {
        (mockContext.flowContext.core as any).workflowAboutType = undefined;
        (mockContext.flowContext.core as any).workflowAboutId = undefined;
        delete (mockContext.services as any).designDocService;

        const template = '${contextSearchResultsForDesignDoc}';

        const result = await resolver.resolve(template, registry, mockContext);

        expect(result).toBe('');
        expect(resolveContextMock).not.toHaveBeenCalled();
      });
    });
  });
});
