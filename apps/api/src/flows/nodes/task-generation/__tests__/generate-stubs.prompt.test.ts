import { PlaceholderResolver } from 'src/services/llm/placeholders/resolver.service';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { StandardPromptBuilderStrategy } from 'src/services/llm/strategies/standard-prompt-builder.strategy';
import { TaskGenerationGenerateStubsNode } from '../generate-stubs.node';
import {
  ConversationId,
  DesignDocId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
  WorkflowId,
} from '../../../../types';
import { TaskGenerationFlowContext } from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';

describe('TaskGenerationGenerateStubsNode prompt building', () => {
  const initiativeId = 'initiative-1' as InitiativeId;
  const parentTaskId = 'parent-task-1' as TaskId;
  const designDocId = 'design-doc-1' as DesignDocId;

  const mockArtifactService = {
    findMany: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'conversation-qa-1',
          type: 'QA_PAIR',
          title: 'Earlier chat',
          data: {
            type: 'QA_PAIR',
            question: 'What are we focusing on?',
            answer: 'Reducing auth friction for onboarding.',
          },
          createdAt: '2024-02-01T09:00:00Z',
        },
      ],
    }),
  };

  const mockInitiativeService = {
    findOne: jest.fn().mockResolvedValue({
      id: initiativeId,
      name: 'Authentication polish',
      description: 'Tighten auth, SSO, and onboarding analytics.',
      priority: 'HIGH',
      organizationId: 'org-1',
      projectId: 'project-1',
    }),
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: initiativeId,
      name: 'Authentication polish',
      priority: 'HIGH',
      status: 'REFINING_DESCRIPTION',
      sections: [
        {
          key: 'description',
          materializedMarkdown: 'Tighten auth, SSO, and onboarding analytics.',
        },
        {
          key: 'details',
          materializedMarkdown: 'Focus on onboarding analytics.',
        },
        {
          key: 'acceptanceCriteria',
          materializedMarkdown: 'SSO + analytics ready.',
        },
      ],
    }),
  };

  const mockTaskService = {
    findAll: jest.fn().mockResolvedValue([]),
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: parentTaskId,
      name: 'Parent auth task',
      description: 'Parent task description',
      details: 'Expand auth coverage',
      acceptanceCriteria: 'Auth works for all teams',
      status: 'in_progress',
      priority: 'HIGH',
      assigneeId: 'user-99',
      dueDate: '2024-03-01',
    }),
  };

  const mockDesignDocService = {
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: designDocId,
      name: 'Auth hardening',
      summary: 'Notes on auth scope, risk, and rollout.',
      sections: [
        { key: 'context', materializedMarkdown: 'Context content' },
        { key: 'decision', materializedMarkdown: 'Decision content' },
        { key: 'consequences', materializedMarkdown: 'Consequences content' },
      ],
    }),
  };

  const mockFlowContext: TaskGenerationFlowContext = {
    core: {
      workflowId: 'workflow-1' as WorkflowId,
      projectId: 'project-1' as ProjectId,
      organizationId: 'org-1' as OrganizationId,
      conversationId: 'conversation-1' as ConversationId,
      workflowAboutId: parentTaskId,
      workflowAboutType: 'task',
      user: {
        id: 'user-1' as UserId,
        role: 'admin',
      },
      session: {
        startTime: new Date('2024-02-01T08:00:00Z'),
        interactionCount: 4,
      },
    },
    flowId: 'task_generation_flow',
    flowPath: {
      pathTaken: ['welcome', 'task-generation-generate-stubs'],
      previousNode: 'welcome',
      previousTransition: 'start',
    },
    initiativeId,
    parentTaskId,
    designDocId,
    stubSession: {
      round: 2,
      stubs: [
        {
          id: 'stub-1',
          title: 'Enable SSO audit',
          shortDescription: 'Track SSO provider events',
          sourceType: 'initiative',
          round: 1,
          status: 'approved',
          influences: [],
        },
        {
          id: 'stub-2',
          title: 'Legacy cleanup',
          shortDescription: 'Remove unused auth flows',
          sourceType: 'initiative',
          round: 1,
          status: 'rejected',
          influences: [],
        },
        {
          id: 'stub-3',
          title: 'Session hardening',
          shortDescription: 'Audit session lifetime',
          sourceType: 'initiative',
          round: 2,
          status: 'suggested',
          influences: [],
        },
      ],
      latestSourceSummary: 'Stay focused on auth risk and onboarding.',
    },
  };

  it('builds a resolved prompt snapshot for stub generation', async () => {
    const promptBuilder = new PromptBuilderService(
      mockArtifactService as any,
      mockInitiativeService as any,
      new StandardPromptBuilderStrategy(mockArtifactService as any),
      {} as any,
      new PlaceholderResolver(),
      mockTaskService as any,
      mockDesignDocService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const node = new TaskGenerationGenerateStubsNode();
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
    expect(mockTaskService.findOneForAdapter).toHaveBeenCalledWith(
      parentTaskId,
      mockFlowContext.core.organizationId,
    );
    expect(mockDesignDocService.findOneForAdapter).toHaveBeenCalledWith(
      designDocId,
      mockFlowContext.core.organizationId,
    );
  });
});
