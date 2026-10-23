import { TaskDependencyInferenceService } from '../task-dependency-inference.service';
import { taskDependencyInferenceWorkflow } from 'src/workflows/task-dependency-inference.workflow';
import { TaskId } from 'src/types';

describe('TaskDependencyInferenceService', () => {
  let temporalClient: { workflow: { start: jest.Mock } };
  let service: TaskDependencyInferenceService;

  beforeEach(() => {
    jest.useFakeTimers();
    temporalClient = {
      workflow: {
        start: jest.fn().mockResolvedValue('workflow-id'),
      },
    };

    service = new TaskDependencyInferenceService(temporalClient as any);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('debounces inference and merges target tasks', async () => {
    service.queueInference({
      organizationId: 'org-1' as any,
      initiativeId: 'init-1' as any,
      projectId: 'proj-1' as any,
      taskId: 'task-1' as TaskId,
    });

    service.queueInference({
      organizationId: 'org-1' as any,
      initiativeId: 'init-1' as any,
      projectId: 'proj-1' as any,
      taskId: 'task-2' as TaskId,
    });

    jest.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(temporalClient.workflow.start).toHaveBeenCalledWith(
      taskDependencyInferenceWorkflow,
      expect.objectContaining({
        taskQueue: 'conversation-queue',
        args: [
          expect.objectContaining({
            initiativeId: 'init-1',
            targetTaskIds: expect.arrayContaining(['task-1', 'task-2']),
          }),
        ],
      }),
    );
  });
});
