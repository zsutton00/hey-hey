import { PlaceholderResolver } from 'src/services/llm/placeholders/resolver.service';
import { PromptBuilderService } from 'src/services/llm/prompt-builder.service';
import { StandardPromptBuilderStrategy } from 'src/services/llm/strategies/standard-prompt-builder.strategy';
import { RfcGenerateNode } from '../generate.node';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';
import { FlowContext } from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';

describe('RfcGenerateNode prompt building', () => {
  const mockConversationArtifacts = [
    {
      id: 'artifact-1',
      type: 'QA_PAIR',
      title: 'Project goals',
      data: {
        type: 'QA_PAIR',
        question: 'What are we building?',
        answer:
          'A knowledge base that uses AI summarization to turn call transcripts into ADRs.',
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
          'Must ship an initial RFC describing scope, risks, and rollout plan by end of week.',
      },
      createdAt: '2024-01-01T10:05:00Z',
    },
  ];

  const mockArtifactService = {
    findMany: jest.fn().mockResolvedValue({ data: mockConversationArtifacts }),
  };

  const mockFlowContext: FlowContext = {
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
        interactionCount: 2,
      },
    },
    flowId: 'rfc_flow',
    flowPath: {
      pathTaken: ['rfc_generate'],
      previousNode: 'rfc_open',
      previousTransition: 'rfc_ready',
    },
  };

  it('builds a resolved prompt snapshot for RFC generation', async () => {
    const promptBuilder = new PromptBuilderService(
      mockArtifactService as any,
      {} as any,
      new StandardPromptBuilderStrategy(mockArtifactService as any),
      {} as any,
      new PlaceholderResolver(),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const node = new RfcGenerateNode();
    const result = await promptBuilder.buildPrompt(
      node,
      createMutableContextHandle<FlowContext>(mockFlowContext),
    );

    expect(result.systemPrompt).toMatchSnapshot();
    expect(mockArtifactService.findMany).toHaveBeenCalled();
  });
});
