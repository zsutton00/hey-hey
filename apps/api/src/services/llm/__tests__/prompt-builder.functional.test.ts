import { Test } from '@nestjs/testing';
import { PromptBuilderService } from '../prompt-builder.service';
import { FlowSecurityService } from '../../workflows/flow-security.service';
import { ArtifactService } from '../../artifacts/artifact.service';
import { InitiativeService } from '../../initiatives/initiative.service';
import { StandardPromptBuilderStrategy } from '../strategies/standard-prompt-builder.strategy';
import { InitiativeRefinementPromptBuilderStrategy } from '../strategies/initiative-refinement-prompt-builder.strategy';
import { PlaceholderResolver } from '../placeholders/resolver.service';
import { TaskService } from '../../tasks/task.service';
import { DesignDocService } from '../../design-doc/design-doc.service';
import * as TestUtils from '../../../utils/testUtils';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { NodeType } from '../../../types/flow-internal.types';

describe('PromptBuilderService - Functional Smoke Tests', () => {
  let service: PromptBuilderService;
  const mockFlowSecurity = {
    validateFlowExecution: jest.fn(),
    validateUserMessage: jest.fn(),
    checkNodeAccess: jest.fn(),
    sanitizePrompt: jest.fn((p: string) => p),
  };

  beforeEach(async () => {
    const simpleStrategy = {
      getStrategyName: jest.fn().mockReturnValue('mock'),
      buildContextSection: jest.fn().mockResolvedValue('context'),
      buildInstructionsSection: jest.fn().mockResolvedValue('instructions'),
      buildResponseFormatSection: jest.fn().mockResolvedValue('response'),
      buildRoutingPrompt: jest.fn().mockResolvedValue('routing'),
      buildClassificationPrompt: jest.fn().mockResolvedValue('classification'),
      formatInitiativesForClassification: jest
        .fn()
        .mockReturnValue('initiatives'),
      addLevelAwareVariables: jest.fn().mockImplementation((p) => p),
      zodToJsonSchema: jest.fn().mockReturnValue({ type: 'object' }),
      isScalarSchemaCheck: jest.fn().mockReturnValue(false),
      nodeTypeNeedsUIElementsCheck: jest.fn().mockReturnValue(false),
      getPlaceholderRegistry: jest.fn().mockReturnValue({
        getName: jest.fn().mockReturnValue('mock'),
        findUsedPlaceholders: jest
          .fn()
          .mockReturnValue({ found: [], missing: [] }),
      }),
    };

    const setup = await createServiceTestingModule({
      providers: [PromptBuilderService,
FlowSecurityService,
ArtifactService,
InitiativeService,
StandardPromptBuilderStrategy,
InitiativeRefinementPromptBuilderStrategy,
PlaceholderResolver,
TaskService,
DesignDocService],
      overrides: [[FlowSecurityService, mockFlowSecurity],
[ArtifactService, TestUtils.createMockArtifactService()],
[InitiativeService, TestUtils.createMockInitiativeService()],
[StandardPromptBuilderStrategy, simpleStrategy],
[InitiativeRefinementPromptBuilderStrategy, simpleStrategy],
[
          PlaceholderResolver,
          {
            resolve: jest.fn().mockResolvedValue('resolved'),
            validateTemplate: jest.fn().mockReturnValue({
              isValid: true,
              errors: [],
              warnings: [],
            }),
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
          },
        ],
[TaskService, TestUtils.createMockTaskService()],
[DesignDocService, TestUtils.createMockDesignDocService()]],
    });

    service = setup.module.get(PromptBuilderService);
  });

  it('throws on nodes without prompt configuration', async () => {
    const tracker: any = {
      getContext: jest.fn().mockReturnValue(
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
      ),
    };

    await expect(
      service.buildPrompt(
        {
          id: 'node-1',
          type: NodeType.LLM_QUESTIONS,
          twoPhase: true,
          execute: jest.fn(),
        },
        tracker,
      ),
    ).rejects.toThrow(/does not have prompt configuration/);
  });
});
