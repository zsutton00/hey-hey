import { PlaceholderResolver } from 'src/services/llm/placeholders/resolver.service';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { StandardPromptBuilderStrategy } from 'src/services/llm/strategies/standard-prompt-builder.strategy';
import { InitiativeRefinementPromptBuilderStrategy } from 'src/services/llm/strategies/initiative-refinement-prompt-builder.strategy';
import { OnboardingGenerateInitiativesNode } from '../onboarding-generate-initiatives.node';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';
import { OnboardingFlowContext } from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';

describe('OnboardingGenerateInitiativesNode prompt building', () => {
  const mockArtifactService = {
    findMany: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'artifact-1',
          type: 'INSIGHT',
          title: 'Primary goals',
          data: {
            type: 'INSIGHT',
            summary:
              'Need to provide a developer experience portal with docs search and workflow automation.',
            detectedIntent: 'project_overview',
          },
          createdAt: '2024-01-01T10:00:00Z',
        },
        {
          id: 'artifact-2',
          type: 'QA_PAIR',
          title: 'Constraints',
          data: {
            type: 'QA_PAIR',
            question: 'Any constraints?',
            answer:
              'Must integrate with GitHub and support SSO during the first release.',
          },
          createdAt: '2024-01-01T10:05:00Z',
        },
      ],
    }),
  };

  const mockFlowContext: OnboardingFlowContext = {
    core: {
      workflowId: 'workflow-1' as WorkflowId,
      projectId: 'project-1' as ProjectId,
      organizationId: 'org-1' as OrganizationId,
      conversationId: 'conversation-1' as ConversationId,
      workflowAboutId: 'project-1',
      workflowAboutType: 'project',
      user: {
        id: 'user-1' as UserId,
        role: 'admin',
      },
      session: {
        startTime: new Date('2024-01-01T09:00:00Z'),
        interactionCount: 3,
      },
    },
    flowId: 'onboarding_flow',
    flowPath: {
      pathTaken: ['welcome', 'onboarding-generate-initiatives'],
      previousNode: 'onboarding-analyze',
      previousTransition: 'ready_to_generate',
    },
  };

  it('builds a resolved prompt snapshot for onboarding initiative generation', async () => {
    const promptBuilder = new PromptBuilderService(
      mockArtifactService as any,
      {} as any,
      new StandardPromptBuilderStrategy(mockArtifactService as any),
      new InitiativeRefinementPromptBuilderStrategy(mockArtifactService as any),
      new PlaceholderResolver(),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const node = new OnboardingGenerateInitiativesNode({} as any, {} as any);
    const result = await promptBuilder.buildPrompt(
      node,
      createMutableContextHandle<OnboardingFlowContext>(mockFlowContext),
    );

    expect(result.systemPrompt).toMatchSnapshot();
    expect(mockArtifactService.findMany).toHaveBeenCalled();
  });
});
