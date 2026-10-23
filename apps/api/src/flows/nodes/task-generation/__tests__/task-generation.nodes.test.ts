import { TestingModule } from '@nestjs/testing';
import * as TestUtils from '../../../../utils/testUtils';
import { TaskGenerationGenerateNode } from '../generate.node';
import { TaskService } from '../../../../services/tasks/task.service';
import { DesignDocService } from '../../../../services/design-doc/design-doc.service';
import { createServiceTestingModule } from '../../../../../test/setup/testing-module.factory';
import {
  NodeType,
  TaskGenerationFlowContext,
} from '../../../../types/flow-internal.types';
import { TasksSystemMessageData } from '../../../../generated';
import { DesignDocId, TaskId } from '../../../../types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';

const createTaskGenerationContext = (): TaskGenerationFlowContext => {
  const baseContext = TestUtils.createMockFlowContext({
    core: {
      ...TestUtils.createMockFlowContext().core,
      organizationId: TestUtils.testIds.organization,
      conversationId: TestUtils.testIds.conversation,
      workflowAboutType: 'design-doc',
      workflowAboutId: 'design-doc-1',
    },
  });
  return {
    ...baseContext,
    initiativeId: TestUtils.testIds.initiative,
    designDocId: 'design-doc-1' as DesignDocId,
  };
};

describe('TaskGenerationGenerateNode', () => {
  let module: TestingModule;
  let node: TaskGenerationGenerateNode;
  let taskService: ReturnType<typeof TestUtils.createMockTaskService>;
  const designDocService = {
    getLinksForAdapter: jest.fn(),
    createLinksForAdapter: jest.fn(),
  };

  beforeEach(async () => {
    taskService = TestUtils.createMockTaskService();
    taskService.createFromDrafts.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Add login form',
        description: 'Implement UI for login form',
      },
    ] as any);
    taskService.findOneForAdapter.mockImplementation(
      async (taskId: string, _orgId: string) =>
        ({
          id: taskId,
          parentTaskId:
            taskId === 'task-child' ? ('task-root' as TaskId) : null,
        }) as any,
    );

    designDocService.getLinksForAdapter.mockResolvedValue([
      {
        entityType: 'task',
        entityId: 'task-root',
      },
      {
        entityType: 'task',
        entityId: 'task-child',
      },
    ]);
    designDocService.createLinksForAdapter.mockResolvedValue([]);

    const setup = await createServiceTestingModule({
      providers: [TaskGenerationGenerateNode],
      overrides: [
        [TaskService, taskService],
        [DesignDocService, designDocService as any],
      ],
    });

    module = setup.module;
    node = module.get(TaskGenerationGenerateNode);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('returns action payload with created tasks', async () => {
    const context = createTaskGenerationContext();
    const tracker = createMutableContextHandle(context as any);

    const { modifiedResult } = await node.processLlmResponse(
      {
        tasks: [
          {
            title: 'Add login form',
            description: 'Build UI for logging in',
            details: 'Use existing design system components',
            acceptanceCriteria: 'Users can log in successfully',
            priority: 'high',
            estimatedEffort: 'medium',
            category: 'frontend',
            reasoning: 'Core authentication flow',
          },
        ],
        response: 'Generated tasks for your initiative.',
      } as any,
      undefined,
      tracker,
    );

    expect(designDocService.getLinksForAdapter).toHaveBeenCalledWith(
      context.designDocId,
      context.core.organizationId,
    );
    expect(taskService.createFromDrafts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ parentTaskId: 'task-root' }),
      ]),
      context.core.organizationId,
      context.initiativeId,
      context.core.conversationId,
      expect.objectContaining({
        projectId: context.core.projectId,
        generationModel: expect.any(String),
        generationPrompt: expect.any(String),
      }),
    );
    expect(designDocService.createLinksForAdapter).toHaveBeenCalledWith(
      context.designDocId,
      [
        {
          entityType: 'task',
          entityId: 'task-1',
          relationType: 'TASK_CREATED_FROM_DOC',
        },
      ],
      context.core.organizationId,
    );
    if (!modifiedResult) {
      throw new Error('Expected modifiedResult');
    }
    expect(modifiedResult.type).toBe('TASKS');
    if (modifiedResult.type !== 'TASKS') {
      throw new Error('Expected TASKS system message');
    }
    const tasksResult = modifiedResult as TasksSystemMessageData;
    expect(tasksResult.generatedTaskIds).toEqual(['task-1']);
  });

  it('exposes generate node metadata', () => {
    expect(node.id).toBe('task-generation-generate');
    expect(node.type).toBe(NodeType.GENERATE);
    expect(node.promptConfig?.responseSchema).toBeDefined();
  });
});
