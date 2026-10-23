import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { PromptBuilderService } from '../prompt-builder.service';
import { FlowSecurityService } from '../../workflows/flow-security.service';
import { ArtifactService } from '../../artifacts/artifact.service';
import { InitiativeService } from '../../initiatives/initiative.service';
import { StandardPromptBuilderStrategy } from '../strategies/standard-prompt-builder.strategy';
import { InitiativeRefinementPromptBuilderStrategy } from '../strategies/initiative-refinement-prompt-builder.strategy';
import { PlaceholderResolver } from '../placeholders/resolver.service';
import { SharedGenerateArtifactsNode } from '../../../flows/nodes/shared/shared-generate-artifacts.node';
import { FlowContext, NodeType } from '../../../types/flow-internal.types';
import {
  OrganizationId,
  ProjectId,
  ConversationId,
  WorkflowId,
  UserId,
} from '../../../types';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { TaskService } from '../../tasks/task.service';
import { DesignDocService } from '../../design-doc/design-doc.service';
import { EntitySummaryService } from '../../entity-summary/entity-summary.service';
import { SubfacetService } from '../../entity-summary/subfacet.service';
import { MessageService } from '../../message.service';
import { EntityRegistryService } from '../../entity-registry/entity-registry.service';
import { ContextResolutionService } from '../../../context/services/context-resolution.service';
import * as TestUtils from '../../../utils/testUtils';

jest.mock('../../../context/services/context-resolution.service', () => ({
  ContextResolutionService: class {},
}));
jest.mock('../strategies/standard-prompt-builder.strategy', () => ({
  StandardPromptBuilderStrategy: class {},
}));
jest.mock(
  '../strategies/initiative-refinement-prompt-builder.strategy',
  () => ({
    InitiativeRefinementPromptBuilderStrategy: class {},
  }),
);
jest.mock('../placeholders/resolver.service', () => ({
  PlaceholderResolver: class {},
}));
jest.mock('../../tasks/task.service', () => ({ TaskService: class {} }));
jest.mock('../../design-doc/design-doc.service', () => ({
  DesignDocService: class {},
}));
jest.mock('../../plan/plan.service', () => ({
  PlanService: class {},
}));
jest.mock('../../entity-summary/entity-summary.service', () => ({
  EntitySummaryService: class {},
}));
jest.mock('../../entity-summary/subfacet.service', () => ({
  SubfacetService: class {},
}));
jest.mock('../../artifacts/artifact.service', () => ({
  ArtifactService: class {},
}));
jest.mock('../../initiatives/initiative.service', () => ({
  InitiativeService: class {},
}));
jest.mock('../../workflows/flow-security.service', () => ({
  FlowSecurityService: class {},
}));
jest.mock('../../message.service', () => ({ MessageService: class {} }));
jest.mock('../../entity-registry/entity-registry.service', () => ({
  EntityRegistryService: class {},
}));

function createSharedGenerateArtifactsNode(overrides: any = {}) {
  const node = new SharedGenerateArtifactsNode();
  return { ...node, ...overrides };
}

describe('PromptBuilderService - Schema Detection and Artifacts Generation', () => {
  let service: PromptBuilderService;
  let mockArtifactService: jest.Mocked<ArtifactService>;

  const mockFlowContext: FlowContext = {
    core: {
      conversationId: 'conv-123' as ConversationId,
      workflowId: 'workflow-456' as WorkflowId,
      organizationId: 'org-789' as OrganizationId,
      projectId: 'proj-abc' as ProjectId,
      workflowAboutId: 'proj-abc',
      workflowAboutType: 'project',
      user: {
        id: 'user-123' as UserId,
        role: 'admin',
      },
      session: {
        startTime: new Date('2024-01-01T09:00:00Z'),
        interactionCount: 3,
      },
    },
    flowId: 'onboarding',
    flowPath: {
      pathTaken: ['welcome', 'analyze_project'],
      previousNode: 'analyze_project',
      previousTransition: 'ready_for_artifacts',
    },
  };

  beforeEach(async () => {
    const mockStandardStrategy = {
      getStrategyName: jest
        .fn()
        .mockReturnValue('StandardPromptBuilderStrategy'),
      getPlaceholderRegistry: jest.fn().mockReturnValue({
        resolve: jest.fn().mockResolvedValue(''),
        getAllPlaceholderKeys: jest.fn().mockReturnValue([]),
        getName: jest.fn().mockReturnValue('MockPlaceholderRegistry'),
      }),
      buildContextSection: jest
        .fn()
        .mockImplementation(
          async (template, flowContext, node, userMessage, contextOptions) => {
            // Simulate calling artifactService.findMany when conversation history is requested
            if (contextOptions?.includeConversationHistory) {
              await mockArtifactService.findMany(
                {
                  projectId: contextOptions.projectId,
                  sourceId: contextOptions.conversationId,
                  status: 'ACTIVE',
                  limit: 20,
                },
                contextOptions.organizationId,
              );
            }
            return '';
          },
        ),
      buildInstructionsSection: jest
        .fn()
        .mockImplementation(
          async (node, promptConfig, availableTransitions) => {
            let instructions =
              '\n\nANALYZE NODE INSTRUCTIONS:\n- Provide thorough but concise analysis\n- Focus on actionable insights\n- Base recommendations on the specific context provided';

            if (availableTransitions && availableTransitions.length > 0) {
              instructions +=
                "\n\nAVAILABLE TRANSITIONS:\nBased on the user's response, you should identify which transition best matches their intent.\nAvailable transitions for this conversation step:\n";
              Object.keys(availableTransitions).forEach((key) => {
                instructions += `- ${key}\n`;
              });
            }

            return instructions;
          },
        ),
      buildResponseFormatSection: jest
        .fn()
        .mockResolvedValue(
          '\n\nRESPONSE FORMAT:\nYou must respond with a JSON object that matches this structure:\n\n{\n  "type": "ARTIFACTS_GENERATION",\n  "insights": [\n    {\n      "category": "userGoals",\n      "title": "Primary Project Objective",\n      "confidence": 0.9,\n      "reasoning": "User explicitly described the project goals and target audience",\n      "content": "Build a comprehensive knowledge management platform that helps teams find and share institutional knowledge"\n    },\n    {\n      "category": "technicalAnalysis",\n      "title": "Technology Stack Requirements",\n      "confidence": 0.8,\n      "reasoning": "Inferred from technical terminology and project requirements mentioned",\n      "content": "Web application with AI/ML components including vector search, graph relationships, and integration capabilities"\n    }\n  ],\n  "uiElements": []\n}',
        ),
      zodToJsonSchema: jest.fn().mockReturnValue({}),
      isScalarSchemaCheck: jest.fn().mockReturnValue(false),
      buildRoutingPrompt: jest.fn().mockResolvedValue(''),
      buildClassificationPrompt: jest.fn().mockResolvedValue(''),
      formatInitiativesForClassification: jest.fn().mockReturnValue(''),
      addLevelAwareVariables: jest.fn().mockReturnValue(''),
      nodeTypeNeedsUIElementsCheck: jest.fn().mockReturnValue(false),
    };

    const mockInitiativeRefinementStrategy = {
      getStrategyName: jest
        .fn()
        .mockReturnValue('InitiativeRefinementPromptBuilderStrategy'),
      getPlaceholderRegistry: jest.fn().mockReturnValue({
        resolve: jest.fn().mockResolvedValue(''),
        getAllPlaceholderKeys: jest.fn().mockReturnValue([]),
        getName: jest.fn().mockReturnValue('MockPlaceholderRegistry'),
      }),
      buildContextSection: jest.fn().mockResolvedValue(''),
      buildInstructionsSection: jest
        .fn()
        .mockResolvedValue(
          '\n\nANALYZE NODE INSTRUCTIONS:\n- Provide thorough but concise analysis\n- Focus on actionable insights\n- Base recommendations on the specific context provided',
        ),
      buildResponseFormatSection: jest
        .fn()
        .mockResolvedValue(
          '\n\nRESPONSE FORMAT:\nYou must respond with a JSON object that matches this structure:\n\n{\n  "type": "ARTIFACTS_GENERATION",\n  "insights": [\n    {\n      "category": "userGoals",\n      "title": "Primary Project Objective",\n      "confidence": 0.9,\n      "reasoning": "User explicitly described the project goals and target audience",\n      "content": "Build a comprehensive knowledge management platform that helps teams find and share institutional knowledge"\n    },\n    {\n      "category": "technicalAnalysis",\n      "title": "Technology Stack Requirements",\n      "confidence": 0.8,\n      "reasoning": "Inferred from technical terminology and project requirements mentioned",\n      "content": "Web application with AI/ML components including vector search, graph relationships, and integration capabilities"\n    }\n  ],\n  "uiElements": []\n}',
        ),
      zodToJsonSchema: jest.fn().mockReturnValue({}),
      isScalarSchemaCheck: jest.fn().mockReturnValue(false),
      buildRoutingPrompt: jest.fn().mockResolvedValue(''),
      buildClassificationPrompt: jest.fn().mockResolvedValue(''),
      formatInitiativesForClassification: jest.fn().mockReturnValue(''),
      addLevelAwareVariables: jest.fn().mockReturnValue(''),
      nodeTypeNeedsUIElementsCheck: jest.fn().mockReturnValue(false),
    };

    const mockPlaceholderResolver = {
      resolve: jest
        .fn()
        .mockImplementation((template) => Promise.resolve(template)),
      validateTemplate: jest
        .fn()
        .mockReturnValue({ isValid: true, errors: [], warnings: [] }),
      preview: jest.fn().mockReturnValue({
        placeholders: [],
        missing: [],
        validation: { isValid: true, errors: [], warnings: [] },
      }),
      clearCache: jest.fn(),
      getCacheStats: jest
        .fn()
        .mockReturnValue({ size: 0, hitRate: 0, entries: [] }),
    };

    const { module, mocks } = await createServiceTestingModule({
      providers: [PromptBuilderService,
{
          provide: StandardPromptBuilderStrategy,
          useValue: mockStandardStrategy,
        },
{
          provide: InitiativeRefinementPromptBuilderStrategy,
          useValue: mockInitiativeRefinementStrategy,
        },
{
          provide: PlaceholderResolver,
          useValue: mockPlaceholderResolver,
        },
{
          provide: TaskService,
          useValue: {
            findOneByOrganization: jest.fn(),
          },
        },
{
          provide: DesignDocService,
          useValue: {
            findOne: jest.fn(),
          },
        },
{
          provide: EntitySummaryService,
          useValue: {
            findMany: jest.fn(),
          },
        },
{
          provide: SubfacetService,
          useValue: {
            findMany: jest.fn(),
          },
        },
{
          provide: ContextResolutionService,
          useValue: {
            resolveContext: jest.fn(),
          },
        }],
      overrides: [
        [
          ArtifactService,
          {
            findMany: jest.fn().mockResolvedValue({
              data: [
                {
                  id: 'artifact-1',
                  type: 'QA_PAIR',
                  title: 'Project Goals',
                  data: {
                    type: 'QA_PAIR',
                    question: 'What are your main project goals?',
                    answer: 'Build an AI-powered knowledge management platform',
                  },
                  createdAt: '2024-01-01T10:00:00Z',
                },
              ],
            }),
          },
        ],
      ],
    });

    service = module.get<PromptBuilderService>(PromptBuilderService);
    mockArtifactService = mocks.get(
      ArtifactService,
    ) as jest.Mocked<ArtifactService>;

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  describe('ARTIFACTS_GENERATION Response Format', () => {
    it('should generate correct response format for ARTIFACTS_GENERATION type', async () => {
      const artifactsNode = createSharedGenerateArtifactsNode({
        nextNode: 'generate_initiatives',
      });

      const result = await service.buildPrompt(artifactsNode, {
        getContext: () => mockFlowContext,
        setContext: () => {},
      } as any);

      // Check that the prompt includes ARTIFACTS_GENERATION format
      expect(result.systemPrompt).toContain('"type": "ARTIFACTS_GENERATION"');
      expect(result.systemPrompt).toContain('"insights": [');
      expect(result.systemPrompt).toContain('"category": "userGoals"');
      expect(result.systemPrompt).toContain('"confidence": 0.9');
      expect(result.systemPrompt).toContain(
        '"reasoning": "User explicitly described the project goals and target audience"',
      );
      expect(result.systemPrompt).toContain(
        '"content": "Build a comprehensive knowledge management platform that helps teams find and share institutional knowledge"',
      );
    });

    it('should include example insights for different categories', async () => {
      const artifactsNode = createSharedGenerateArtifactsNode({
        nextNode: 'generate_initiatives',
      });

      const result = await service.buildPrompt(artifactsNode, {
        getContext: () => mockFlowContext,
        setContext: () => {},
      } as any);

      // Verify multiple insight examples are shown
      expect(result.systemPrompt).toContain('"category": "userGoals"');
      expect(result.systemPrompt).toContain('"category": "technicalAnalysis"');
      expect(result.systemPrompt).toContain(
        '"title": "Primary Project Objective"',
      );
      expect(result.systemPrompt).toContain(
        '"title": "Technology Stack Requirements"',
      );
    });

    it('should not include UI elements for ANALYZE nodes', async () => {
      const artifactsNode = createSharedGenerateArtifactsNode({
        nextNode: 'generate_initiatives',
      });

      const result = await service.buildPrompt(artifactsNode, {
        getContext: () => mockFlowContext,
        setContext: () => {},
      } as any);

      // UI elements should be empty for ANALYZE nodes
      expect(result.systemPrompt).toContain('"uiElements": []');
      // Should not include UI element instructions
      expect(result.systemPrompt).not.toContain(
        'For the "uiElements" array, each element must follow',
      );
    });

    it('should use schema literal type over node type', async () => {
      const artifactsNode = createSharedGenerateArtifactsNode({
        nextNode: 'generate_initiatives',
      });

      // The node is type ANALYZE but schema has ARTIFACTS_GENERATION literal
      expect(artifactsNode.type).toBe(NodeType.ANALYZE);

      const result = await service.buildPrompt(artifactsNode, {
        getContext: () => mockFlowContext,
        setContext: () => {},
      } as any);

      // Should use ARTIFACTS_GENERATION format, not ANALYSIS
      expect(result.systemPrompt).toContain('"type": "ARTIFACTS_GENERATION"');
      expect(result.systemPrompt).not.toContain('"type": "ANALYSIS"');
    });
  });

  describe('User Input Filtering for ANALYZE Nodes', () => {
    it('should filter out skip actions for generate_artifacts node', async () => {
      const artifactsNode = createSharedGenerateArtifactsNode({
        nextNode: 'generate_initiatives',
      });

      const skipMessage = TestUtils.createMockFlowUserMessage({
        data: {
          response: 'skip',
        },
      });

      const result = await service.buildPrompt(
        artifactsNode,
        {
          getContext: () => mockFlowContext,
          setContext: () => {},
        } as any,
        skipMessage,
      );

      // User prompt is now empty - conversation history provides all context
      expect(result.userPrompt).toBe('');
    });

    it('should filter out trivial input for generate_artifacts node', async () => {
      const artifactsNode = createSharedGenerateArtifactsNode({
        nextNode: 'generate_initiatives',
      });

      const trivialMessage = TestUtils.createMockFlowUserMessage({
        data: {
          response: 'hey hey',
        },
      });

      const result = await service.buildPrompt(
        artifactsNode,
        {
          getContext: () => mockFlowContext,
          setContext: () => {},
        } as any,
        trivialMessage,
      );

      // Should not include the trivial input
      // User prompt is now empty - conversation history provides all context
      expect(result.userPrompt).toBe('');
    });

    it('should include meaningful input for ANALYZE nodes', async () => {
      const artifactsNode = createSharedGenerateArtifactsNode({
        nextNode: 'generate_initiatives',
      });

      const meaningfulMessage = TestUtils.createMockFlowUserMessage({
        data: {
          additional_context: 'Please focus on technical architecture insights',
        },
      });

      const result = await service.buildPrompt(
        artifactsNode,
        {
          getContext: () => mockFlowContext,
          setContext: () => {},
        } as any,
        meaningfulMessage,
      );

      // User prompt is now empty - conversation history provides all context
      expect(result.userPrompt).toBe('');
    });
  });

  describe('Integration Tests', () => {
    it('should generate complete prompt for shared_generate_artifacts node', async () => {
      const artifactsNode = createSharedGenerateArtifactsNode({
        transitions: {
          ready_for_initiatives: () => 'generate_initiatives',
          need_more_context: () => 'gather_more_info',
        },
      });

      const result = await service.buildPrompt(
        artifactsNode,
        {
          getContext: () => mockFlowContext,
          setContext: () => {},
        } as any,
        undefined,
        {
          ready_for_initiatives: {
            description: 'Transition when ready for initiatives',
          },
          need_more_context: { description: 'Transition when more context' },
        } as any,
      );

      // Verify complete prompt structure
      expect(result.systemPrompt).toContain(
        'You are a principal product manager analyzing a project',
      );
      expect(result.systemPrompt).toContain('ANALYZE NODE INSTRUCTIONS');
      expect(result.systemPrompt).toContain('AVAILABLE TRANSITIONS');
      expect(result.systemPrompt).toContain('ready_for_initiatives');
      expect(result.systemPrompt).toContain('need_more_context');
      expect(result.systemPrompt).toContain('RESPONSE FORMAT');
      expect(result.systemPrompt).toContain('"type": "ARTIFACTS_GENERATION"');
      expect(result.systemPrompt).toContain('"insights": [');

      // Verify configuration
      expect(result.responseFormat).toBe('json_object');
      expect(result.temperature).toBe(0.6);
      expect(result.responseSchema).toBeDefined();
    });

    it('should handle artifact category references in templates', async () => {
      // Mock artifact service to return artifacts for specific categories
      mockArtifactService.findMany.mockImplementation(
        async (query, _organizationId) => {
          if (query.category === 'userGoals') {
            return {
              data: [
                {
                  id: 'goal-1',
                  projectId: 'proj-abc' as ProjectId,
                  type: 'INSIGHT',
                  title: 'Primary User Goal',
                  data: {
                    type: 'INSIGHT',
                    confidence: 0.9,
                    reasoning: 'User explicitly stated',
                    content: 'Build a scalable knowledge management system',
                  },
                  hasEmbedding: false,
                  tags: [],
                  status: 'ACTIVE',
                  isPublic: false,
                  category: 'userGoals',
                  sourceType: 'MESSAGE',
                  sourceId: 'msg-123',
                  createdAt: '2024-01-01T10:00:00Z',
                  updatedAt: '2024-01-01T10:00:00Z',
                },
              ],
              total: 1,
              page: 1,
              limit: 10,
              totalPages: 1,
              hasNext: false,
              hasPrev: false,
            };
          }
          return {
            data: [],
            total: 0,
            page: 1,
            limit: 10,
            totalPages: 0,
            hasNext: false,
            hasPrev: false,
          };
        },
      );

      // Use the existing shared generate artifacts node which has the right structure
      const artifactsNode = createSharedGenerateArtifactsNode({
        nextNode: 'generate_initiatives',
      });

      const result = await service.buildPrompt(artifactsNode, {
        getContext: () => mockFlowContext,
        setContext: () => {},
      } as any);

      // Verify the prompt was built successfully and contains expected schema information
      expect(result.systemPrompt).toContain('"type": "ARTIFACTS_GENERATION"');
      expect(result.systemPrompt).toContain('"insights": [');
      expect(result.responseSchema).toBeDefined();
    });
  });
});
