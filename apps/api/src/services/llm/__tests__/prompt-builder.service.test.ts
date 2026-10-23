import { PromptBuilderService } from '../prompt-builder.service';
import { FlowSecurityService } from '../../workflows/flow-security.service';
import { ArtifactService } from '../../artifacts/artifact.service';
import { InitiativeService } from '../../initiatives/initiative.service';
import { StandardPromptBuilderStrategy } from '../strategies/standard-prompt-builder.strategy';
import { InitiativeRefinementPromptBuilderStrategy } from '../strategies/initiative-refinement-prompt-builder.strategy';
import { PlaceholderResolver } from '../placeholders/resolver.service';
import { TaskService } from '../../tasks/task.service';
import { DesignDocService } from '../../design-doc/design-doc.service';
import { ContextResolutionService } from '../../../context/services/context-resolution.service';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import * as TestUtils from '../../../utils/testUtils';
import {
  NodeType,
  type FlowContext,
  type LlmQuestionsNodeBase,
} from '../../../types/flow-internal.types';

const simpleStrategy = {
  getStrategyName: jest.fn().mockReturnValue('mock'),
  buildContextSection: jest.fn().mockResolvedValue('context'),
  buildInstructionsSection: jest.fn().mockResolvedValue('instructions'),
  buildResponseFormatSection: jest.fn().mockResolvedValue('response'),
  buildRoutingPrompt: jest.fn().mockResolvedValue('routing'),
  buildClassificationPrompt: jest.fn().mockResolvedValue('classification'),
  formatInitiativesForClassification: jest.fn().mockReturnValue('initiatives'),
  addLevelAwareVariables: jest.fn().mockImplementation((p) => p),
  zodToJsonSchema: jest.fn().mockReturnValue({ type: 'object' }),
  isScalarSchemaCheck: jest.fn().mockReturnValue(false),
  nodeTypeNeedsUIElementsCheck: jest.fn().mockReturnValue(false),
  getPlaceholderRegistry: jest.fn().mockReturnValue({
    getName: jest.fn().mockReturnValue('mock'),
    findUsedPlaceholders: jest.fn().mockReturnValue({ found: [], missing: [] }),
  }),
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
  getCacheStats: jest.fn().mockReturnValue({
    size: 0,
    hitRate: 0,
    entries: [],
  }),
};

const mockFlowSecurityService = {
  validateFlowExecution: jest.fn(),
  validateUserMessage: jest.fn(),
  checkNodeAccess: jest.fn(),
  sanitizePrompt: jest.fn((prompt: string) => prompt),
};

const createTracker = (context: any) =>
  ({
    getContext: jest.fn().mockReturnValue(context),
  }) as any;

describe('PromptBuilderService', () => {
  let service: PromptBuilderService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const setup = await createServiceTestingModule({
      providers: [PromptBuilderService,
FlowSecurityService,
ArtifactService,
InitiativeService,
StandardPromptBuilderStrategy,
InitiativeRefinementPromptBuilderStrategy,
PlaceholderResolver,
TaskService,
DesignDocService,
ContextResolutionService],
      overrides: [[FlowSecurityService, mockFlowSecurityService],
[ArtifactService, TestUtils.createMockArtifactService()],
[InitiativeService, TestUtils.createMockInitiativeService()],
[StandardPromptBuilderStrategy, simpleStrategy],
[InitiativeRefinementPromptBuilderStrategy, simpleStrategy],
[PlaceholderResolver, mockPlaceholderResolver],
[TaskService, TestUtils.createMockTaskService()],
[DesignDocService, TestUtils.createMockDesignDocService()],
[ContextResolutionService, { resolveContext: jest.fn() }]],
    });

    service = setup.module.get(PromptBuilderService);
  });

  it('throws for nodes without prompt configuration', async () => {
    const execute: LlmQuestionsNodeBase<FlowContext>['execute'] = jest.fn(
      async () => TestUtils.createMockNodeResult(),
    );
    const node = {
      id: 'test-node',
      type: NodeType.LLM_QUESTIONS,
      twoPhase: true,
      execute,
    } as LlmQuestionsNodeBase<FlowContext>;

    const tracker = createTracker(
      TestUtils.createMockFlowContext({
        core: {
          workflowId: TestUtils.testIds.workflow,
          projectId: TestUtils.testIds.project,
          organizationId: TestUtils.testIds.organization,
          conversationId: TestUtils.testIds.conversation,
          workflowAboutId: TestUtils.testIds.project,
          workflowAboutType: 'project',
          user: { id: TestUtils.testIds.user, role: 'member' },
          session: { startTime: new Date(), interactionCount: 1 },
        },
        flowId: 'flow-123',
      }),
    );

    await expect(
      service.buildPrompt(node, tracker, TestUtils.createMockFlowUserMessage()),
    ).rejects.toThrow(/does not have prompt configuration/);
  });

  it('builds prompt using strategies when configuration exists', async () => {
    const execute: LlmQuestionsNodeBase<FlowContext>['execute'] = jest.fn(
      async () => TestUtils.createMockNodeResult(),
    );
    const node = {
      id: 'test-node',
      type: NodeType.LLM_QUESTIONS,
      twoPhase: true,
      execute,
      promptConfig: {
        systemPromptTemplate: 'Hello {{user}}',
        responseSchema: undefined as any,
        temperature: 0.5,
      },
      transitions: {},
    } as LlmQuestionsNodeBase<FlowContext>;

    const tracker = createTracker(
      TestUtils.createMockFlowContext({
        core: {
          workflowId: TestUtils.testIds.workflow,
          projectId: TestUtils.testIds.project,
          organizationId: TestUtils.testIds.organization,
          conversationId: TestUtils.testIds.conversation,
          workflowAboutId: TestUtils.testIds.project,
          workflowAboutType: 'project',
          user: { id: TestUtils.testIds.user, role: 'member' },
          session: { startTime: new Date(), interactionCount: 1 },
        },
        flowId: 'flow-123',
      }),
    );

    const result = await service.buildPrompt(
      node,
      tracker,
      TestUtils.createMockFlowUserMessage(),
    );

    expect(result.systemPrompt).toContain('Hello');
    expect(result.temperature).toBe(0.5);
    expect(mockPlaceholderResolver.resolve).toHaveBeenCalled();
  });
});
