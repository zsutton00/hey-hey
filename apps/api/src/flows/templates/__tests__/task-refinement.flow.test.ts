import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import * as TestUtils from '../../../utils/testUtils';
import { taskRefinementFlow } from '../task-refinement.flow';
import {
  TaskRefinementFlowContext,
  NodeResult,
  NodeType,
} from '../../../types/flow-internal.types';
import { TaskService } from '../../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../../services/tasks/work-item-type-registry.service';
import { WorkStatus } from '../../../generated';
import { TASK_REFINEMENT_NODES } from '../../constants';
import { TaskRefinementWelcomeNode } from '../../nodes/task-refinement/welcome.node';
import { createMutableContextHandle } from '../../../utils/mutable-context';
import { createWarmWorkItemTypeRegistry } from '../../../../test/setup/work-item-type-registry.fixture';

const { testIds } = TestUtils;

const assertQuestionsResult = (result: NodeResult) => {
  if (result.type !== NodeType.QUESTIONS) {
    throw new Error(`Expected QUESTIONS node result, got ${result.type}`);
  }

  return result;
};

const assertErrorResult = (result: NodeResult) => {
  if (result.type !== NodeType.ERROR) {
    throw new Error(`Expected ERROR node result, got ${result.type}`);
  }

  return result;
};

const assertDefined = <T>(value: T | undefined, label: string): T => {
  if (!value) {
    throw new Error(`Expected ${label}`);
  }
  return value;
};

describe('Task Refinement Flow - Integration', () => {
  let mockTaskService: jest.Mocked<TaskService>;
  let welcomeNode: TaskRefinementWelcomeNode;
  let context: TaskRefinementFlowContext;

  beforeEach(async () => {
    mockTaskService = TestUtils.createMockTaskService();

    const warmWorkItemTypeRegistry = await createWarmWorkItemTypeRegistry();

    const setup = await createServiceTestingModule({
      providers: [TaskRefinementWelcomeNode, TaskService],
      overrides: [
        [TaskService, mockTaskService],
        [WorkItemTypeRegistryService, warmWorkItemTypeRegistry],
      ],
    });

    welcomeNode = setup.module.get(TaskRefinementWelcomeNode);

    const baseContext = TestUtils.createMockFlowContext({
      flowId: 'task-refinement',
      flowPath: { pathTaken: [TASK_REFINEMENT_NODES.WELCOME] },
    });

    context = {
      ...baseContext,
      taskId: testIds.task,
      initiativeId: testIds.initiative,
    };
  });

  const executeWelcomeNode = async () => {
    const tracker = createMutableContextHandle(context);
    return welcomeNode.execute(tracker);
  };

  describe('flow structure', () => {
    it('should have correct flow metadata', () => {
      expect(taskRefinementFlow.id).toBe('task-refinement');
      expect(taskRefinementFlow.name).toBe('Task Refinement');
      expect(taskRefinementFlow.description).toBe(
        'Agent-driven conversational refinement of tasks with operations-based editing',
      );
      expect(taskRefinementFlow.version).toBe(2);
      expect(taskRefinementFlow.startNode).toBe(TASK_REFINEMENT_NODES.WELCOME);
    });

    it('should have all required nodes', () => {
      const expectedNodes = [
        TASK_REFINEMENT_NODES.WELCOME,
        TASK_REFINEMENT_NODES.RECOVERY,
        TASK_REFINEMENT_NODES.AGENT_EDITOR,
        TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        TASK_REFINEMENT_NODES.FINALIZE_ACTION,
        TASK_REFINEMENT_NODES.PROMPT_INPUT,
        TASK_REFINEMENT_NODES.END,
      ];

      expectedNodes.forEach((nodeId) => {
        expect(taskRefinementFlow.nodes).toHaveProperty(nodeId);
        expect(taskRefinementFlow.nodes[nodeId]).toBeDefined();
      });
    });
  });

  describe('flow transitions', () => {
    it('should have proper transition structure', () => {
      const welcomeNodeConfig = assertDefined(
        taskRefinementFlow.nodes[TASK_REFINEMENT_NODES.WELCOME],
        'welcome node config',
      );
      const recoveryNodeConfig = assertDefined(
        taskRefinementFlow.nodes[TASK_REFINEMENT_NODES.RECOVERY],
        'recovery node config',
      );
      const agentNodeConfig = assertDefined(
        taskRefinementFlow.nodes[TASK_REFINEMENT_NODES.AGENT_EDITOR],
        'agent node config',
      );
      const agentNextLevelConfig = assertDefined(
        taskRefinementFlow.nodes[TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL],
        'agent next level config',
      );
      const finalizeNodeConfig = assertDefined(
        taskRefinementFlow.nodes[TASK_REFINEMENT_NODES.FINALIZE_ACTION],
        'finalize node config',
      );
      const promptInputConfig = assertDefined(
        taskRefinementFlow.nodes[TASK_REFINEMENT_NODES.PROMPT_INPUT],
        'prompt input config',
      );

      expect(welcomeNodeConfig.nextNode).toBe(
        TASK_REFINEMENT_NODES.AGENT_EDITOR,
      );
      expect(recoveryNodeConfig.nextNode).toBe(
        TASK_REFINEMENT_NODES.AGENT_EDITOR,
      );

      const agentTransitions = assertDefined(
        agentNodeConfig.transitions,
        'agent node transitions',
      );
      const agentReadyToFinalize = assertDefined(
        agentTransitions.ready_to_finalize,
        'agent ready_to_finalize transition',
      );
      const agentDefault = assertDefined(
        agentTransitions.default,
        'agent default transition',
      );
      expect(agentReadyToFinalize.nextNodeId).toBe(
        TASK_REFINEMENT_NODES.FINALIZE_ACTION,
      );
      expect(agentDefault.nextNodeId).toBe(TASK_REFINEMENT_NODES.AGENT_EDITOR);

      const nextLevelTransitions = assertDefined(
        agentNextLevelConfig.transitions,
        'agent next level transitions',
      );
      const nextLevelReadyToFinalize = assertDefined(
        nextLevelTransitions.ready_to_finalize,
        'agent next level ready_to_finalize transition',
      );
      const nextLevelDefault = assertDefined(
        nextLevelTransitions.default,
        'agent next level default transition',
      );
      const nextLevelSkipToNode = assertDefined(
        agentNextLevelConfig.skipToNode,
        'agent next level skipToNode',
      );
      expect(nextLevelReadyToFinalize.nextNodeId).toBe(
        TASK_REFINEMENT_NODES.FINALIZE_ACTION,
      );
      expect(nextLevelDefault.nextNodeId).toBe(
        TASK_REFINEMENT_NODES.AGENT_EDITOR,
      );
      expect(nextLevelSkipToNode.allowed).toBe(true);

      const finalizeTransitions = assertDefined(
        finalizeNodeConfig.transitions,
        'finalize node transitions',
      );
      const finalizeDefault = assertDefined(
        finalizeTransitions.default,
        'finalize default transition',
      );
      expect(finalizeDefault.nextNodeId).toBe(TASK_REFINEMENT_NODES.END);

      expect(promptInputConfig.nextNode).toBe(
        TASK_REFINEMENT_NODES.AGENT_EDITOR,
      );
      const promptSkipToNode = assertDefined(
        promptInputConfig.skipToNode,
        'prompt input skipToNode',
      );
      expect(promptSkipToNode.allowed).toBe(true);
    });

    it('should have end node as final node', () => {
      const endNode = assertDefined(
        taskRefinementFlow.nodes[TASK_REFINEMENT_NODES.END],
        'end node config',
      );
      expect(Object.keys(endNode)).toHaveLength(0);
    });
  });

  describe('welcome node execution', () => {
    it('should execute welcome node and return proper structure', async () => {
      const mockTaskData = TestUtils.createMockTaskResponseDto({
        status: WorkStatus.RefiningDescription,
        name: 'Test Task',
        sections: TestUtils.createMockMaterializedTaskSections({
          description: 'Test task description',
          acceptanceCriteria: 'Test acceptance criteria',
        }),
      });

      mockTaskService.findOne.mockResolvedValue(mockTaskData);

      const result = assertQuestionsResult(await executeWelcomeNode());

      expect(result.type).toBe(NodeType.QUESTIONS);
      expect(result.data.detectedIntent).toBe('opener_displayed');
      expect(result.data.intentConfidence).toBe(1);
      expect(result.data.reasoning).toBe('Task refinement session started');
      const uiElements = assertDefined(result.uiElements, 'result uiElements');
      expect(uiElements).toHaveLength(1);
      const uiElement = assertDefined(uiElements[0], 'result uiElement');
      expect(uiElement.type).toBe('textarea');
    });

    it('should handle missing task gracefully', async () => {
      mockTaskService.findOne.mockResolvedValue(null);

      const result = assertErrorResult(await executeWelcomeNode());

      expect(result.type).toBe(NodeType.ERROR);
      expect(result.data.errorType).toBe('missing_data');
      expect(result.data.context).toBe('task_not_loaded');
      expect(result.message).toContain('Task data not found');
    });
  });

  describe('status level detection', () => {
    it('should determine UI messaging based on task status', async () => {
      const testCases = [
        {
          status: WorkStatus.RefiningDescription,
          expectedLabel: 'basic description',
          expectedPlaceholder: 'task name',
        },
        {
          status: WorkStatus.RefiningDetails,
          expectedLabel: 'acceptance criteria',
          expectedPlaceholder: 'acceptance criteria',
        },
        {
          status: WorkStatus.RefiningAcceptanceCriteria,
          expectedLabel: 'acceptance criteria',
          expectedPlaceholder: 'acceptance criteria',
        },
      ];

      for (const { status, expectedLabel, expectedPlaceholder } of testCases) {
        const mockTaskData = TestUtils.createMockTaskResponseDto({
          status,
          name: 'Test Task',
        });

        mockTaskService.findOne.mockResolvedValue(mockTaskData);

        const result = assertQuestionsResult(await executeWelcomeNode());
        const uiElements = assertDefined(
          result.uiElements,
          'result uiElements',
        );
        const uiElement = assertDefined(uiElements[0], 'result uiElement');
        expect(uiElement.label).toContain(expectedLabel);
        expect(uiElement.placeholder).toContain(expectedPlaceholder);
      }
    });
  });

  describe('task service integration', () => {
    it('should call task service with correct parameters', async () => {
      const mockTaskData = TestUtils.createMockTaskResponseDto({
        status: WorkStatus.RefiningDescription,
      });

      mockTaskService.findOne.mockResolvedValue(mockTaskData);

      await executeWelcomeNode();

      expect(mockTaskService.findOne).toHaveBeenCalledWith(
        context.core.organizationId,
        context.taskId,
      );
    });
  });

  describe('error handling', () => {
    it('should surface task service errors', async () => {
      mockTaskService.findOne.mockRejectedValue(new Error('Database error'));

      await expect(executeWelcomeNode()).rejects.toThrow('Database error');
    });
  });

  describe('UI element structure', () => {
    it('should generate proper UI elements for task refinement', async () => {
      const mockTaskData = TestUtils.createMockTaskResponseDto({
        status: WorkStatus.RefiningDescription,
        name: 'Test Task',
        sections: TestUtils.createMockMaterializedTaskSections({
          description: 'Test description',
        }),
      });

      mockTaskService.findOne.mockResolvedValue(mockTaskData);

      const result = assertQuestionsResult(await executeWelcomeNode());

      const uiElements = assertDefined(result.uiElements, 'result uiElements');
      expect(uiElements).toHaveLength(1);
      expect(uiElements[0]).toMatchObject({
        id: 'task_feedback',
        type: 'textarea',
        required: false,
        influences: [],
      });
    });
  });

  describe('data consistency', () => {
    it('should include expected metadata in response data', async () => {
      const mockTaskData = TestUtils.createMockTaskResponseDto({
        status: WorkStatus.RefiningDescription,
      });

      mockTaskService.findOne.mockResolvedValue(mockTaskData);

      const result = assertQuestionsResult(await executeWelcomeNode());

      expect(result.data.detectedIntent).toBe('opener_displayed');
      expect(result.data.intentConfidence).toBe(1);
      expect(result.data.reasoning).toBe('Task refinement session started');
    });
  });
});
