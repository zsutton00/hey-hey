import { TaskRefinementAgentNextLevelNode } from '../agent_next_level.node';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
  WorkflowId,
} from '../../../../types';
import { TaskRefinementFlowContext } from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';

describe('TaskRefinementAgentNextLevelNode agent input snapshot', () => {
  const initiativeId = 'initiative-1' as InitiativeId;
  const taskId = 'task-1' as TaskId;

  const mockTaskService = {
    findOne: jest.fn().mockResolvedValue({
      id: taskId,
      name: 'Implement workflow builder',
      description: 'Initial implementation of workflow builder UI.',
      details: 'Needs drag-and-drop and validation.',
      acceptanceCriteria: 'User can create workflows with validation.',
      type: 'STANDARD',
      status: 'REFINING_DESCRIPTION',
      sections: [
        {
          key: 'description',
          materializedMarkdown:
            'Initial implementation of workflow builder UI.',
        },
        {
          key: 'details',
          materializedMarkdown: 'Needs drag-and-drop and validation.',
        },
        {
          key: 'acceptanceCriteria',
          materializedMarkdown: 'User can create workflows with validation.',
        },
      ],
    }),
  };

  const mockArtifactService = {
    findMany: jest.fn().mockResolvedValue({ data: [] }),
  };

  // STANDARD uses the canonical two-level refinement set captured by the snapshot.
  const mockWorkItemTypeRegistry = {
    getTaskRefinementLevels: jest
      .fn()
      .mockReturnValue(['description', 'acceptanceCriteria']),
  };

  const mockInitiativeService = {
    findOneForAdapter: jest.fn().mockResolvedValue({
      id: initiativeId,
      name: 'Workflow Studio',
      description: 'Tooling for advanced workflow orchestration.',
      details: 'Phase 1 covers canvas + persistence.',
      acceptanceCriteria: 'Must support 5 node types.',
      sections: [
        {
          key: 'description',
          materializedMarkdown: 'Tooling for advanced workflow orchestration.',
        },
        {
          key: 'details',
          materializedMarkdown: 'Phase 1 covers canvas + persistence.',
        },
        {
          key: 'acceptanceCriteria',
          materializedMarkdown: 'Must support 5 node types.',
        },
      ],
    }),
  };

  const context: TaskRefinementFlowContext = {
    core: {
      workflowId: 'workflow-task' as WorkflowId,
      projectId: 'project-task' as ProjectId,
      organizationId: 'org-task' as OrganizationId,
      conversationId: 'conversation-task' as ConversationId,
      workflowAboutId: taskId,
      workflowAboutType: 'task',
      user: {
        id: 'user-1' as UserId,
        role: 'pm',
      },
      session: {
        startTime: new Date('2024-01-03T11:00:00Z'),
        interactionCount: 6,
      },
    },
    flowId: 'task_flow',
    initiativeId,
    taskId,
    flowPath: {
      pathTaken: ['task-agent-editor', 'task-agent-next'],
      previousNode: 'task-agent-editor',
      previousTransition: 'continue',
    },
  };

  it('captures task agent request snapshot', async () => {
    const node = new TaskRefinementAgentNextLevelNode(
      mockTaskService as any,
      mockArtifactService as any,
      mockInitiativeService as any,
      mockWorkItemTypeRegistry as any,
    );

    const agentInput = await node.agentInput(
      createMutableContextHandle(context),
    );
    expect(mockTaskService.findOne).toHaveBeenCalled();
    expect(agentInput).toMatchSnapshot();
  });
});
