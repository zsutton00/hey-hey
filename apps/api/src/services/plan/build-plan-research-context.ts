import { PlanDependenciesService } from './plan-dependencies.service';
import type { Prisma } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AnyTransactionClient } from '../../prisma/prisma.service';
import { orderPlanStages } from './order-plan-stages';

/** Research context follows the target's actual work-item parentage. */
export async function buildPlanResearchContext(
  db: AnyTransactionClient,
  graph: PlanDependenciesService,
  organizationId: string,
  planId: string,
  target: { taskId?: string; designDocId?: string },
) {
  const plan: Prisma.TaskGetPayload<{ include: { sections: true } }> | null =
    await db.task.findFirst({
      where: { id: planId, organizationId, type: 'PLAN', archivedAt: null },
      include: { sections: true },
    });
  if (!plan) throw new NotFoundException('Plan work item not found');
  let taskId = target.taskId;
  if (target.designDocId) {
    const doc = await db.designDoc.findFirst({
      where: {
        id: target.designDocId,
        organizationId,
        projectId: plan.projectId,
      },
      select: { parentEntityType: true, parentEntityId: true },
    });
    if (!doc || doc.parentEntityType !== 'TASK' || !doc.parentEntityId) {
      throw new BadRequestException(
        'Research document must have a work-item parent',
      );
    }
    taskId = doc.parentEntityId;
  }
  if (!taskId) throw new BadRequestException('Research target is required');
  const task = await db.task.findFirst({
    where: {
      id: taskId,
      organizationId,
      projectId: plan.projectId,
      archivedAt: null,
    },
    select: { id: true, type: true, parentTaskId: true },
  });
  if (!task) throw new NotFoundException('Research work item not found');
  const stageId = task.type === 'PLAN_STAGE' ? task.id : task.parentTaskId;
  const stages = await orderPlanStages<
    Prisma.TaskGetPayload<{ include: { sections: true } }>
  >(
    graph,
    organizationId,
    plan.projectId,
    await db.task.findMany({
      where: {
        organizationId,
        projectId: plan.projectId,
        parentTaskId: plan.id,
        type: 'PLAN_STAGE',
        archivedAt: null,
      },
      include: { sections: true },
    }),
  );
  const stageIndex = stages.findIndex((stage) => stage.id === stageId);
  const stage = stages[stageIndex];
  if (!stage)
    throw new BadRequestException(
      'Research target is not a child of this Plan’s stages',
    );
  const outcome = plan.sections.find(
    (section) => section.key === 'outcome',
  )?.materializedMarkdown;
  if (!outcome?.trim())
    throw new BadRequestException(
      'Plan work item is missing its outcome section',
    );
  return {
    plan: {
      id: plan.id,
      title: plan.name,
      outcome,
      description: plan.sections.find(
        (section) => section.key === 'description',
      )?.materializedMarkdown,
      status: plan.status,
    },
    planStage: {
      id: stage.id,
      title: stage.name,
      description: stage.sections.find(
        (section) => section.key === 'description',
      )?.materializedMarkdown,
      sequenceOrder: stageIndex + 1,
      status: stage.status,
    },
  };
}
