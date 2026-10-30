import type { TaskResponseDto } from '../../generated/model/taskResponseDto';
import { WorkStatus } from '../../generated/model/workStatus';
import { PlanDependenciesService } from '../plan/plan-dependencies.service';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WORK_ITEM_TYPE_KEYS } from './work-item-type-keys';

export interface PlanHierarchyStatusTransition {
  taskId: string;
  previousStatus: TaskResponseDto['status'];
  newStatus: TaskResponseDto['status'];
  organizationId: string;
  projectId: string;
  initiativeId: string | null;
}

const TERMINAL_STATUSES = new Set<TaskResponseDto['status']>([
  WorkStatus.Completed,
  WorkStatus.Cancelled,
]);

/**
 * Synchronous lifecycle projection for the canonical Task hierarchy:
 * STANDARD -> PLAN_STAGE -> PLAN. The caller owns the transaction and publishes
 * the returned generic task status events before committing it.
 */
@Injectable()
export class PlanHierarchyRollupService {
  private readonly logger = new Logger(PlanHierarchyRollupService.name);

  constructor(private readonly planDependencies: PlanDependenciesService) {}

  /**
   * Rolls up the canonical hierarchy after one mutation: the task's current
   * position and, on re-parent or archive, its former parent. Stages are
   * recalculated first and each affected Plan exactly once afterwards, so a
   * step moving between stages of one Plan reads both stage writes. A
   * PLAN_STAGE itself recalculates only its Plan, because its own status is
   * the input being changed.
   */
  async rollUp(
    tx: Prisma.TransactionClient,
    params: { taskId?: string | null; formerParentTaskId?: string | null },
  ): Promise<PlanHierarchyStatusTransition[]> {
    const stageIds = new Set<string>();
    const planIds = new Set<string>();
    const addParent = (parent: { id: string; type: string } | null) => {
      if (parent?.type === WORK_ITEM_TYPE_KEYS.PlanStage)
        stageIds.add(parent.id);
      if (parent?.type === WORK_ITEM_TYPE_KEYS.Plan) planIds.add(parent.id);
    };

    if (params.formerParentTaskId) {
      const former = await tx.task.findUnique({
        where: { id: params.formerParentTaskId },
        select: { id: true, type: true },
      });
      addParent(former);
    }
    if (params.taskId) {
      const task = await tx.task.findUnique({
        where: { id: params.taskId },
        select: {
          type: true,
          parentTask: { select: { id: true, type: true } },
        },
      });
      if (task?.type === WORK_ITEM_TYPE_KEYS.PlanStage && task.parentTask) {
        this.logger.debug('[rollUp] stage-level change; rolling up plan', {
          stageId: params.taskId,
          planId: task.parentTask.id,
        });
        planIds.add(task.parentTask.id);
      } else {
        addParent(task?.parentTask ?? null);
      }
    }

    const transitions: PlanHierarchyStatusTransition[] = [];
    for (const stageId of stageIds) {
      const result = await this.recalculateStage(tx, stageId);
      transitions.push(...result.transitions);
      planIds.add(result.planId);
    }
    for (const planId of planIds) {
      transitions.push(...(await this.rollUpPlan(tx, planId)));
    }
    return transitions;
  }

  rollUpFrom(
    tx: Prisma.TransactionClient,
    taskId: string,
  ): Promise<PlanHierarchyStatusTransition[]> {
    return this.rollUp(tx, { taskId });
  }

  /**
   * Rolls up a (former) parent after a child joined, left, or was archived.
   * Non-canonical parents are ignored.
   */
  rollUpParent(
    tx: Prisma.TransactionClient,
    parentTaskId: string | null,
  ): Promise<PlanHierarchyStatusTransition[]> {
    return this.rollUp(tx, { formerParentTaskId: parentTaskId });
  }

  async rollUpStage(
    tx: Prisma.TransactionClient,
    stageId: string,
  ): Promise<PlanHierarchyStatusTransition[]> {
    const { transitions, planId } = await this.recalculateStage(tx, stageId);
    return [...transitions, ...(await this.rollUpPlan(tx, planId))];
  }

  private async recalculateStage(
    tx: Prisma.TransactionClient,
    stageId: string,
  ): Promise<{ transitions: PlanHierarchyStatusTransition[]; planId: string }> {
    const stage = await tx.task.findUnique({
      where: { id: stageId },
      select: {
        id: true,
        type: true,
        status: true,
        parentTaskId: true,
        organizationId: true,
        projectId: true,
        initiativeId: true,
        subTasks: { where: { archivedAt: null }, select: { status: true } },
      },
    });
    if (!stage || stage.type !== WORK_ITEM_TYPE_KEYS.PlanStage) {
      throw new Error(
        `Canonical Plan Stage ${stageId} disappeared during rollup.`,
      );
    }

    let desiredStageStatus = this.computeStageStatus(
      stage.status,
      stage.subTasks.map(({ status }) => status),
    );
    const dependencies = await this.planDependencies.outgoing(
      stage.organizationId,
      stage.projectId,
      [stage.id],
    );
    const prerequisiteIds = [
      ...new Set(dependencies.map((edge) => edge.targetNodeId)),
    ];
    const prerequisites =
      prerequisiteIds.length === 0
        ? []
        : await tx.task.findMany({
            where: {
              id: { in: prerequisiteIds },
              organizationId: stage.organizationId,
              projectId: stage.projectId,
            },
            select: { id: true, type: true, status: true },
          });
    if (prerequisites.length !== prerequisiteIds.length) {
      throw new Error(
        'Canonical Plan dependency references a missing work item.',
      );
    }
    const hasIncompleteStageDependency = prerequisites.some(
      (task) =>
        task.type === WORK_ITEM_TYPE_KEYS.PlanStage &&
        !TERMINAL_STATUSES.has(task.status),
    );
    if (
      desiredStageStatus === WorkStatus.Active &&
      hasIncompleteStageDependency
    ) {
      desiredStageStatus = WorkStatus.Backlog;
    }

    const transitions: PlanHierarchyStatusTransition[] = [];
    if (desiredStageStatus !== stage.status) {
      await tx.task.update({
        where: { id: stage.id },
        data: { status: desiredStageStatus },
      });
      this.logger.log('[rollUpStage] stage status rolled up', {
        stageId: stage.id,
        previousStatus: stage.status,
        newStatus: desiredStageStatus,
      });
      transitions.push({
        taskId: stage.id,
        previousStatus: stage.status,
        newStatus: desiredStageStatus,
        organizationId: stage.organizationId,
        projectId: stage.projectId,
        initiativeId: stage.initiativeId,
      });
    }

    if (!stage.parentTaskId) {
      throw new Error(
        `Canonical Plan Stage ${stage.id} is missing its PLAN parent.`,
      );
    }
    return { transitions, planId: stage.parentTaskId };
  }

  async rollUpPlan(
    tx: Prisma.TransactionClient,
    planId: string,
  ): Promise<PlanHierarchyStatusTransition[]> {
    const plan = await tx.task.findUnique({
      where: { id: planId },
      select: {
        id: true,
        type: true,
        status: true,
        organizationId: true,
        projectId: true,
        initiativeId: true,
        subTasks: {
          where: { archivedAt: null },
          select: { type: true, status: true },
        },
      },
    });
    if (!plan || plan.type !== WORK_ITEM_TYPE_KEYS.Plan) {
      throw new Error(`Canonical Plan Stage parent ${planId} is not a PLAN.`);
    }

    const stageStatuses = plan.subTasks
      .filter(({ type }) => type === WORK_ITEM_TYPE_KEYS.PlanStage)
      .map(({ status }) => status);
    const desiredPlanStatus = this.computePlanStatus(
      plan.status,
      stageStatuses,
    );
    if (desiredPlanStatus === plan.status) return [];

    await tx.task.update({
      where: { id: plan.id },
      data: { status: desiredPlanStatus },
    });
    this.logger.log('[rollUpPlan] plan status rolled up', {
      planId: plan.id,
      previousStatus: plan.status,
      newStatus: desiredPlanStatus,
    });
    return [
      {
        taskId: plan.id,
        previousStatus: plan.status,
        newStatus: desiredPlanStatus,
        organizationId: plan.organizationId,
        projectId: plan.projectId,
        initiativeId: plan.initiativeId,
      },
    ];
  }

  computeStageStatus(
    currentStatus: TaskResponseDto['status'],
    childStatuses: readonly TaskResponseDto['status'][],
  ): TaskResponseDto['status'] {
    if (currentStatus === WorkStatus.Refining) return currentStatus;
    if (childStatuses.length === 0) return WorkStatus.Backlog;
    if (childStatuses.every((status) => TERMINAL_STATUSES.has(status))) {
      return WorkStatus.Completed;
    }
    if (childStatuses.includes(WorkStatus.Blocked)) return WorkStatus.Blocked;
    if (childStatuses.every((status) => status === WorkStatus.Backlog)) {
      return currentStatus === WorkStatus.Completed
        ? WorkStatus.Active
        : WorkStatus.Backlog;
    }
    return WorkStatus.Active;
  }

  computePlanStatus(
    currentStatus: TaskResponseDto['status'],
    stageStatuses: readonly TaskResponseDto['status'][],
  ): TaskResponseDto['status'] {
    if (stageStatuses.length === 0) return currentStatus;
    if (stageStatuses.every((status) => status === WorkStatus.Completed)) {
      // Keep this VERIFYING checkpoint when merging plan lifecycle changes:
      // only the explicit, guarded completion action may move a Plan to COMPLETED.
      return WorkStatus.Verifying;
    }
    if (stageStatuses.includes(WorkStatus.Blocked)) return WorkStatus.Blocked;
    if (
      stageStatuses.some(
        (status) =>
          status === WorkStatus.Active || status === WorkStatus.Refining,
      ) ||
      stageStatuses.some((status) => status === WorkStatus.Completed)
    ) {
      return WorkStatus.Active;
    }
    return currentStatus === WorkStatus.Completed ||
      currentStatus === WorkStatus.Verifying
      ? WorkStatus.Active
      : currentStatus;
  }
}
