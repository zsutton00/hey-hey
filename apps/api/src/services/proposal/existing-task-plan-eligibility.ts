import type { Task } from '@prisma/client';
import type {
  PlanFromExistingTasksUpdatesPayload,
  ProposalValidationIssue,
} from '@hey-hey/contracts/api/models';
import type { AnyTransactionClient } from '../../prisma/prisma.service';
import type { OrganizationId, ProjectId } from '../../types';

/** Admission checks current eligibility; approval repeats these under the task-write lock. */
export async function existingTaskPlanEligibilityIssues(
  tx: AnyTransactionClient,
  payload: PlanFromExistingTasksUpdatesPayload,
  organizationId: OrganizationId,
  projectId: ProjectId,
): Promise<ProposalValidationIssue[]> {
  const scope = { organizationId, projectId };
  const parent: Task | null = await tx.task.findFirst({
    where: { id: payload.parentFeatureId, ...scope },
  });
  function reject(
    field: string,
    code: string,
    reason: string,
  ): ProposalValidationIssue[] {
    return [{ field, code, reason, layer: 'referential' }];
  }
  if (
    !parent ||
    parent.type !== 'FEATURE' ||
    parent.archivedAt ||
    ['ARCHIVED', 'SUPERSEDED'].includes(parent.status)
  ) {
    return reject(
      'updates.parentFeatureId',
      'FEATURE_UNAVAILABLE',
      'The parent Feature is no longer available.',
    );
  }
  const taskIds = payload.stages.flatMap((stage) => stage.taskIds);
  const rows: Task[] = await tx.task.findMany({
    where: { ...scope, id: { in: taskIds } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [stageIndex, stage] of payload.stages.entries()) {
    for (const [taskIndex, id] of stage.taskIds.entries()) {
      const field = `updates.stages[${stageIndex}].taskIds[${taskIndex}]`;
      const task = byId.get(id);
      if (!task) {
        return reject(
          field,
          'TASK_NOT_FOUND',
          `Task ${id} no longer exists in this project.`,
        );
      }
      if (task.archivedAt || ['ARCHIVED', 'SUPERSEDED'].includes(task.status)) {
        return reject(
          field,
          'TASK_UNAVAILABLE',
          `Task ${id} is archived or superseded.`,
        );
      }
      if (task.type !== 'STANDARD') {
        return reject(
          field,
          'TASK_TYPE_INVALID',
          `Task ${id} is not a Standard Task.`,
        );
      }
      let ancestorId = task.parentTaskId;
      const visited = new Set<string>();
      while (ancestorId) {
        if (visited.has(ancestorId)) {
          return reject(
            field,
            'TASK_HIERARCHY_CYCLE',
            `Task ${id} has a cyclic parent hierarchy.`,
          );
        }
        visited.add(ancestorId);
        const ancestor: Task | null = await tx.task.findFirst({
          where: { id: ancestorId, ...scope },
        });
        if (!ancestor) {
          return reject(
            field,
            'TASK_PARENT_UNAVAILABLE',
            `Task ${id} has an unavailable parent.`,
          );
        }
        if (ancestor.type === 'PLAN' || ancestor.type === 'PLAN_STAGE') {
          return reject(
            field,
            'TASK_ALREADY_IN_PLAN',
            `Task ${id} is already inside another Plan.`,
          );
        }
        ancestorId = ancestor.parentTaskId;
      }
    }
  }

  return [];
}
