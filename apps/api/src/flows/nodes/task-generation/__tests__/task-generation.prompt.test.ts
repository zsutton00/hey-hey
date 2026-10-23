import { PlaceholderResolver } from 'src/services/llm/placeholders/resolver.service';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { StandardPromptBuilderStrategy } from 'src/services/llm/strategies/standard-prompt-builder.strategy';
import { TaskGenerationGenerateNode } from '../generate.node';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';
import { TaskGenerationFlowContext } from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';

describe('TaskGenerationGenerateNode prompt building', () => {
  const initiativeId = 'initiative-1' as InitiativeId;

  const mockArtifactService = {
    findMany: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'artifact-1',
          type: 'QA_PAIR',
          title: 'Initiative goal',
          data: {
            type: 'QA_PAIR',
            question: 'What are we trying to achieve?',
            answer:
              'Launch a developer portal with docs search and onboarding tasks.',
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
            answer: 'Must support SSO and have an analytics dashboard v1.',
          },
          createdAt: '2024-01-01T10:05:00Z',
        },
      ],
    }),
  };

  const mockInitiativeService = {
    findOne: jest.fn().mockResolvedValue({
      id: initiativeId,
      name: 'Developer Portal MVP',
      description:
        'Create a portal for engineers with docs, onboarding flows, and auth integrations.',
      priority: 'HIGH',
      organizationId: 'org-1',
      projectId: 'project-1',
    }),
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: initiativeId,
      name: 'Developer Portal MVP',
      priority: 'HIGH',
      status: 'REFINING_DESCRIPTION',
      sections: [
        {
          key: 'description',
          materializedMarkdown:
            'Create a portal for engineers with docs, onboarding flows, and auth integrations.',
        },
        {
          key: 'details',
          materializedMarkdown: 'Docs search, onboarding tasks, and SSO.',
        },
        {
          key: 'acceptanceCriteria',
          materializedMarkdown: 'Portal launched with SSO and analytics v1.',
        },
      ],
    }),
  };

  const mockTaskService = {
    findAll: jest.fn().mockResolvedValue([]),
  };

  const mockFlowContext: TaskGenerationFlowContext = {
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
    flowId: 'task_generation_flow',
    flowPath: {
      pathTaken: ['welcome', 'task-generation-generate'],
      previousNode: 'welcome',
      previousTransition: 'start',
    },
    initiativeId,
    stubSession: {
      round: 1,
      stubs: [
        {
          id: 'stub-1',
          title: 'Catalog APIs',
          shortDescription: 'List all service endpoints for discovery',
          sourceType: 'initiative',
          round: 1,
          status: 'approved',
        },
        {
          id: 'stub-2',
          title: 'Analytics baseline',
          shortDescription: 'Instrument dashboard events',
          sourceType: 'initiative',
          round: 1,
          status: 'suggested',
        },
      ],
    },
  };

  it('builds a resolved prompt snapshot for task generation', async () => {
    const promptBuilder = new PromptBuilderService(
      mockArtifactService as any,
      mockInitiativeService as any,
      new StandardPromptBuilderStrategy(mockArtifactService as any),
      {} as any,
      new PlaceholderResolver(),
      mockTaskService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const node = new TaskGenerationGenerateNode({} as any, {} as any);
    const result = await promptBuilder.buildPrompt(
      node,
      createMutableContextHandle<TaskGenerationFlowContext>(mockFlowContext),
    );

    expect(result.systemPrompt).toMatchSnapshot();
    expect(mockArtifactService.findMany).toHaveBeenCalled();
    expect(mockInitiativeService.findOneForAdapter).toHaveBeenCalledWith(
      initiativeId,
      mockFlowContext.core.organizationId,
    );
  });
});
