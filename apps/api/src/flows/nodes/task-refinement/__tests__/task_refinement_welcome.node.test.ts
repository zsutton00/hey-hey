import { TestingModule } from '@nestjs/testing';
import * as TestUtils from '../../../../utils/testUtils';
import { TaskRefinementWelcomeNode } from '../welcome.node';
import { TaskService } from '../../../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../../../services/tasks/work-item-type-registry.service';
import { createWarmWorkItemTypeRegistry } from '../../../../../test/setup/work-item-type-registry.fixture';
import {
  NodeType,
  TaskRefinementFlowContext,
} from '../../../../types/flow-internal.types';
import { SystemMessageResponseType } from '../../../../generated';
import { createServiceTestingModule } from '../../../../../test/setup/testing-module.factory';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { WORK_ITEM_TYPE_KEYS } from '../../../../services/tasks/work-item-type-keys';

describe('TaskRefinementWelcomeNode', () => {
  let module: TestingModule;
  let node: TaskRefinementWelcomeNode;
  let taskService: ReturnType<typeof TestUtils.createMockTaskService>;
  const baseContext = TestUtils.createMockFlowContext({
    core: {
      ...TestUtils.createMockFlowContext().core,
      organizationId: TestUtils.testIds.organization,
    },
  });
  const context: TaskRefinementFlowContext = {
    ...baseContext,
    initiativeId: TestUtils.testIds.initiative,
    taskId: TestUtils.testIds.task,
  };

  beforeEach(async () => {
    taskService = TestUtils.createMockTaskService();

    const warmWorkItemTypeRegistry = await createWarmWorkItemTypeRegistry();

    const setup = await createServiceTestingModule({
      providers: [TaskRefinementWelcomeNode],
      overrides: [
        [TaskService, taskService],
        [WorkItemTypeRegistryService, warmWorkItemTypeRegistry],
      ],
    });

    module = setup.module;
    node = module.get(TaskRefinementWelcomeNode);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('returns level-specific questions when task exists', async () => {
    taskService.findOne.mockResolvedValue({
      type: WORK_ITEM_TYPE_KEYS.Standard,
      status: 'REFINING_DETAILS',
      reasoning: 'needs refinement',
    } as any);

    const result = await node.execute(createMutableContextHandle(context));

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.uiElements?.[0]?.label).toContain('acceptance criteria');
  });

  it('returns error when task is missing', async () => {
    taskService.findOne.mockResolvedValue(null);

    const result = await node.execute(createMutableContextHandle(context));

    expect(result).toEqual({
      type: NodeType.ERROR,
      message: 'Task data not found. Please try again.',
      data: {
        errorType: 'missing_data',
        context: 'task_not_loaded',
        temporary: true,
        detectedIntent: 'task_missing',
        intentConfidence: 1,
      },
    });
  });
});
