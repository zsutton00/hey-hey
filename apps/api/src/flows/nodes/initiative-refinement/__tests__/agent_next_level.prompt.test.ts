import { InitiativeRefinementAgentNextLevelNode } from '../agent_next_level.node';
import {
  InitiativeId,
  ConversationId,
  OrganizationId,
  ProjectId,
  WorkflowId,
  UserId,
} from '../../../../types';
import { InitiativeRefinementFlowContext } from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';

describe('InitiativeRefinementAgentNextLevelNode agent input snapshot', () => {
  const initiativeId = 'initiative-1' as InitiativeId;

  const mockInitiativeService = {
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: initiativeId,
      name: 'Developer Enablement',
      status: 'REFINING_DESCRIPTION',
      sections: [
        {
          key: 'description',
          materializedMarkdown: 'Improve onboarding and documentation.',
        },
        {
          key: 'details',
          materializedMarkdown: 'Phase 1 focuses on portal foundations.',
        },
        { key: 'acceptanceCriteria', materializedMarkdown: '' },
      ],
    }),
  };

  const mockArtifactService = {
    findMany: jest.fn().mockResolvedValue({ data: [] }),
  };

  const context: InitiativeRefinementFlowContext = {
    core: {
      workflowId: 'workflow-initiative' as WorkflowId,
      projectId: 'project-initiative' as ProjectId,
      organizationId: 'org-initiative' as OrganizationId,
      conversationId: 'conversation-initiative' as ConversationId,
      workflowAboutId: initiativeId,
      workflowAboutType: 'initiative',
      user: {
        id: 'user-1' as UserId,
        role: 'pm',
      },
      session: {
        startTime: new Date('2024-01-02T09:00:00Z'),
        interactionCount: 5,
      },
    },
    flowId: 'initiative_flow',
    initiativeId,
    flowPath: {
      pathTaken: ['initiative-agent-editor', 'initiative-agent-next'],
      previousNode: 'initiative-agent-editor',
      previousTransition: 'continue',
    },
  };

  it('captures initiative agent request snapshot', async () => {
    const node = new InitiativeRefinementAgentNextLevelNode(
      mockInitiativeService as any,
      mockArtifactService as any,
    );

    const agentInput = await node.agentInput(
      createMutableContextHandle(context),
    );
    expect(mockInitiativeService.findOneForAdapter).toHaveBeenCalled();
    expect(agentInput).toMatchSnapshot();
  });
});
