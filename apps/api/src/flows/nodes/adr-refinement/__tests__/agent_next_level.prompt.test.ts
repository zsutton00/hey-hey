import { AdrRefinementAgentNextLevelNode } from '../agent_next_level.node';
import { AdrRefinementFlowContext } from '../../../../types/flow-internal.types';
import {
  ConversationId,
  DesignDocId,
  OrganizationId,
  ProjectId,
  WorkflowId,
  UserId,
} from '../../../../types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';

describe('AdrRefinementAgentNextLevelNode agent input snapshot', () => {
  const designDocId = 'design-doc-1' as DesignDocId;
  const mockDesignDocService = {
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: designDocId,
      name: 'Payments ADR',
      status: 'ADR_GENERATING_DECISION',
      sections: [
        {
          key: 'context',
          materializedMarkdown: 'Existing payment flow context.',
        },
        { key: 'decision', materializedMarkdown: '' },
        { key: 'consequences', materializedMarkdown: '' },
        {
          key: 'statusNotes',
          materializedMarkdown: 'Pending stakeholder review.',
        },
      ],
    }),
  };

  const context: AdrRefinementFlowContext = {
    core: {
      workflowId: 'workflow-adr' as WorkflowId,
      projectId: 'project-adr' as ProjectId,
      organizationId: 'org-adr' as OrganizationId,
      conversationId: 'conversation-adr' as ConversationId,
      workflowAboutId: designDocId,
      workflowAboutType: 'design-doc',
      user: {
        id: 'user-1' as UserId,
        role: 'architect',
      },
      session: {
        startTime: new Date('2024-01-01T10:00:00Z'),
        interactionCount: 2,
      },
    },
    flowId: 'adr_flow',
    designDocId,
    flowPath: {
      pathTaken: ['welcome', 'agent_next_level'],
      previousNode: 'agent_analysis',
      previousTransition: 'continue',
    },
  };

  it('captures structured agent request snapshot', async () => {
    const node = new AdrRefinementAgentNextLevelNode(
      mockDesignDocService as any,
    );

    const agentInput = await node.agentInput(
      createMutableContextHandle(context),
    );
    expect(mockDesignDocService.findOneForAdapter).toHaveBeenCalled();
    expect(agentInput).toMatchSnapshot();
  });
});
