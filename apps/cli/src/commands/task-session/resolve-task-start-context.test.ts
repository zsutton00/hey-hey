import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TaskStartContextResolver,
  type GeneratedTaskStartContextClient,
} from './resolve-task-start-context';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const STAGE_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';

type TaskResponseDto = NonNullable<
  Awaited<ReturnType<GeneratedTaskStartContextClient['readTask']>>
>;
type TaskHierarchyResponseDto = NonNullable<
  Awaited<ReturnType<GeneratedTaskStartContextClient['readTaskHierarchy']>>
>;

const makeTask = (id: string, type: string, parentTaskId?: string): TaskResponseDto => ({
  id,
  name: `${type} ${id}`,
  type,
  source: 'user',
  organizationId: 'org-1',
  projectId: 'project-1',
  ...(parentTaskId ? { parentTaskId } : {}),
  status: 'ACTIVE',
});

const makeHierarchy = (
  task: TaskResponseDto,
  parent?: TaskResponseDto,
): TaskHierarchyResponseDto => ({
  task,
  ...(parent ? { parent } : {}),
  children: [],
});

interface TaskStartContextResolverTestOwners {
  client: GeneratedTaskStartContextClient;
}

const createTestResolver = (): {
  resolver: TaskStartContextResolver;
  client: GeneratedTaskStartContextClient;
} => {
  const resolver = new TaskStartContextResolver();
  const { client } = resolver as unknown as TaskStartContextResolverTestOwners;
  return { resolver, client };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TaskStartContextResolver', () => {
  it('resolves canonical PLAN and PLAN_STAGE ancestry for a selected Task', async () => {
    const task = makeTask(TASK_ID, 'STANDARD', STAGE_ID);
    const stage = makeTask(STAGE_ID, 'PLAN_STAGE', PLAN_ID);
    const plan = makeTask(PLAN_ID, 'PLAN');
    const { resolver, client } = createTestResolver();
    vi.spyOn(client, 'readTask').mockResolvedValue(task);
    vi.spyOn(client, 'readTaskHierarchy')
      .mockResolvedValueOnce(makeHierarchy(task, stage))
      .mockResolvedValueOnce(makeHierarchy(stage, plan));

    await expect(
      resolver.resolve({
        organizationId: 'org-1',
        projectId: 'project-1',
        taskId: TASK_ID,
      }),
    ).resolves.toEqual({
      status: 'resolved',
      context: {
        projectId: 'project-1',
        planId: PLAN_ID,
        stepId: TASK_ID,
      },
    });
  });

  it('keeps project-only context when the selected Task has no stage parent', async () => {
    const task = makeTask(TASK_ID, 'STANDARD');
    const { resolver, client } = createTestResolver();
    vi.spyOn(client, 'readTask').mockResolvedValue(task);
    vi.spyOn(client, 'readTaskHierarchy').mockResolvedValue(makeHierarchy(task));

    await expect(
      resolver.resolve({
        organizationId: 'org-1',
        projectId: 'project-1',
        taskId: TASK_ID,
      }),
    ).resolves.toEqual({
      status: 'resolved',
      context: { projectId: 'project-1' },
    });
  });

  it('keeps project-only context when the parent is not a PLAN_STAGE Task', async () => {
    const task = makeTask(TASK_ID, 'STANDARD', STAGE_ID);
    const unrelatedParent = makeTask(STAGE_ID, 'FEATURE');
    const { resolver, client } = createTestResolver();
    vi.spyOn(client, 'readTask').mockResolvedValue(task);
    vi.spyOn(client, 'readTaskHierarchy').mockResolvedValue(makeHierarchy(task, unrelatedParent));

    await expect(
      resolver.resolve({
        organizationId: 'org-1',
        projectId: 'project-1',
        taskId: TASK_ID,
      }),
    ).resolves.toEqual({
      status: 'resolved',
      context: { projectId: 'project-1' },
    });
  });
});
