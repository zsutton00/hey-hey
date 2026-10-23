import { tasksClient } from '../../../../../packages/ui-common/src/clients/shared';
import type { LocalPendingRunContext } from '../../shared/agent-bridge-contract/contract';

type TaskResponseDto = NonNullable<
  Awaited<
    ReturnType<typeof tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet>
  >['data']['data']
>;

type TaskHierarchyResponseDto = NonNullable<
  Awaited<
    ReturnType<
      typeof tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdHierarchyGet
    >
  >['data']['data']
>;

export type ResolveTaskStartContextResult =
  | { status: 'resolved'; context: LocalPendingRunContext }
  | {
      status: 'error';
      code: 'TASK_NOT_FOUND' | 'INITIATIVE_NOT_FOUND' | 'PROJECT_NOT_FOUND';
      message: string;
    };

export interface ResolveTaskStartContextArgs {
  organizationId: string;
  projectId: string;
  taskId: string;
}

/** Owns the generated-client boundary and projects only the fields task startup needs. */
export class GeneratedTaskStartContextClient {
  public async readTask(
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskResponseDto | null> {
    const response = await tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet({
      organizationId,
      projectId,
      taskId,
    });
    const task = response.data.data;
    return task ?? null;
  }

  public async readTaskHierarchy(
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskHierarchyResponseDto | null> {
    const response =
      await tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdHierarchyGet({
        organizationId,
        projectId,
        taskId,
        includeDesignDocCounts: false,
        includeAgentSessionCounts: false,
        includeServiceRelations: false,
      });
    return response.data.data ?? null;
  }
}

/** Resolves the durable project/plan/step context for a task-backed local run. */
export class TaskStartContextResolver {
  private readonly client = new GeneratedTaskStartContextClient();

  public async resolve({
    organizationId,
    projectId,
    taskId,
  }: ResolveTaskStartContextArgs): Promise<ResolveTaskStartContextResult> {
    const task = await this.client.readTask(organizationId, projectId, taskId);
    if (!task) {
      return {
        status: 'error',
        code: 'TASK_NOT_FOUND',
        message: `Task ${taskId} was not found in organization ${organizationId}.`,
      };
    }

    const taskHierarchy = await this.client.readTaskHierarchy(
      organizationId,
      task.projectId,
      task.id,
    );
    const stage = taskHierarchy?.parent;
    if (!stage || stage.type !== 'PLAN_STAGE') {
      return { status: 'resolved', context: { projectId: task.projectId } };
    }

    const stageHierarchy = await this.client.readTaskHierarchy(
      organizationId,
      task.projectId,
      stage.id,
    );
    const plan = stageHierarchy?.parent;
    if (!plan || plan.type !== 'PLAN') {
      return { status: 'resolved', context: { projectId: task.projectId } };
    }

    return {
      status: 'resolved',
      context: {
        projectId: task.projectId,
        planId: plan.id,
        // The bridge still calls this field stepId; its canonical value is the
        // selected execution Task identity.
        stepId: task.id,
      },
    };
  }
}
