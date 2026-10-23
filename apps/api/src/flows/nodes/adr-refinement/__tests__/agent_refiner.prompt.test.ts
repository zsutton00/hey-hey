import { AdrRefinementAgentAnalysisNode } from '../agent_refiner.node';
import { AdrRefinementFlowContext } from '../../../../types/flow-internal.types';
import {
  ConversationId,
  DesignDocId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import * as TestUtils from '../../../../utils/testUtils';

describe('AdrRefinementAgentAnalysisNode agent input snapshot', () => {
  const designDocId = 'design-doc-1' as DesignDocId;

  const baseContext: AdrRefinementFlowContext = {
    core: {
      workflowId: 'workflow-adr' as WorkflowId,
      projectId: 'project-adr' as ProjectId,
      organizationId: 'org-adr' as OrganizationId,
      conversationId: 'conversation-adr' as ConversationId,
      workflowAboutId: 'design-doc-1',
      workflowAboutType: 'design-doc',
      user: {
        id: 'user-1' as UserId,
        role: 'architect',
      },
      session: {
        startTime: new Date('2024-01-01T10:00:00Z'),
        interactionCount: 4,
      },
    },
    flowId: 'adr_flow',
    designDocId,
    flowPath: {
      pathTaken: ['welcome', 'agent_analysis'],
      previousNode: 'starting_agent',
      previousTransition: 'continue',
    },
  };

  const latestUserMessage = TestUtils.createMockFlowUserMessage({
    data: {
      comment:
        'We need to revisit the API gateway decision with zero-downtime goals.',
    },
  });

  const mockDesignDocService = {
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: designDocId,
      name: 'Realtime API Platform',
      status: 'ADR_GENERATING_DECISION',
      sections: [
        { key: 'context', materializedMarkdown: 'Context about the platform.' },
        {
          key: 'decision',
          materializedMarkdown: 'Adopt a single API gateway.',
        },
        {
          key: 'consequences',
          materializedMarkdown: 'Potential latency concerns across regions.',
        },
      ],
    }),
    getLinks: jest.fn().mockResolvedValue([
      { entityType: 'initiative', entityId: 'initiative-1' },
      { entityType: 'task', entityId: 'task-1' },
    ]),
  };

  const mockInitiativeService = {
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: 'initiative-1',
      name: 'Gateway modernization',
      description: 'Improve routing and resiliency.',
      details: 'Align gateway rollout with zero-downtime targets.',
      acceptanceCriteria: 'Regional traffic splits validated in staging.',
      status: 'IN_PROGRESS',
    }),
  };

  const mockTaskService = {
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: 'task-1',
      name: 'Implement multi-region routing',
      description: 'Add region-aware routing logic.',
      details: 'Introduce routing rules per region and validate fallbacks.',
      acceptanceCriteria: 'Traffic routes to closest region with fallback.',
      status: 'REFINING_DETAILS',
    }),
  };
  const mockArtifactService = {
    findMany: jest.fn().mockResolvedValue({ data: [] }),
  };

  it('captures agent input snapshot', async () => {
    const node = new AdrRefinementAgentAnalysisNode(
      mockDesignDocService as any,
      mockInitiativeService as any,
      mockTaskService as any,
      mockArtifactService as any,
    );

    const tracker =
      createMutableContextHandle<AdrRefinementFlowContext>(baseContext);
    const agentInput = await node.agentInput(tracker, latestUserMessage);
    expect(mockDesignDocService.findOneForAdapter).toHaveBeenCalled();
    expect(agentInput).toMatchSnapshot();
  });
});
