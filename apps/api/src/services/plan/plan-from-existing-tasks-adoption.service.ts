import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v5 as uuidv5 } from 'uuid';
import { CreateTaskDto, WorkStatus } from '@hey-hey/contracts/api/models';
import { AnyTransactionClient } from '../../prisma/prisma.service';
import { AgentEdgeEndpointEntityType } from '../../generated/graphs/model/agentEdgeEndpointEntityType';
import {
  DesignDocId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';
import { DesignDocService } from '../design-doc/design-doc.service';
import type { MaterializableEdge } from '../proposal/pending-edge.service';
import { TaskService, type TaskUpdatePostCommit } from '../tasks/task.service';
import { WORK_ITEM_TYPE_KEYS } from '../tasks/work-item-type-keys';
import {
  isPlanFromExistingTasksPayload,
  planFromExistingTasksPayloadSchema,
  type PlanFromExistingTasksPayload,
} from './plan-from-existing-tasks.schema';

export type AdoptionRejectionCode =
  | 'INVALID_PAYLOAD'
  | 'PARENT_FEATURE_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'TASK_NOT_STANDARD'
  | 'TASK_ARCHIVED'
  | 'TASK_SUPERSEDED'
  | 'TASK_ALREADY_IN_PLAN'
  | 'DUPLICATE_TASK_ASSIGNMENT'
  | 'PREREQUISITE_NOT_FOUND'
  | 'PREREQUISITE_TASK_NOT_ADOPTED'
  | 'SELF_DEPENDENCY'
  | 'CYCLIC_DEPENDENCY';

export interface AdoptionRejection {
  code: AdoptionRejectionCode;
  message: string;
  taskId?: string;
}

export interface AdoptionResult {
  planId: string;
  designDocId: string;
  stageIds: string[];
  edges: MaterializableEdge[];
  taskPostCommits: Array<{ taskId: string; postCommit: TaskUpdatePostCommit }>;
}

// Fixed namespace so graph edge identities are stable across approval retries.
const ADOPTION_EDGE_NAMESPACE = 'b0f7a3c2-5d1e-4c6a-9e0b-2f4d8a7c1e35';

/** The design doc identity follows the proposal so a retry can find it. */
function adoptionDesignDocId(proposalId: string): DesignDocId {
  return uuidv5(
    `${proposalId}:design-doc`,
    ADOPTION_EDGE_NAMESPACE,
  ) as DesignDocId;
}

const PLAN_CONTAINER_TYPES = new Set<string>([
  WORK_ITEM_TYPE_KEYS.Plan,
  WORK_ITEM_TYPE_KEYS.PlanStage,
]);

@Injectable()
export class PlanFromExistingTasksAdoptionService {
  private readonly logger = new Logger(
    PlanFromExistingTasksAdoptionService.name,
  );

  constructor(
    private readonly taskService: TaskService,
    private readonly designDocService: DesignDocService,
  ) {}

  isAdoptionPayload(updates: unknown): boolean {
    return isPlanFromExistingTasksPayload(updates);
  }

  /**
   * Creates the Plan, its design doc and stages and moves the listed existing
   * Tasks under them, all inside the caller's transaction. Any rejection
   * throws before anything is written.
   */
  async adoptInTransaction(
    tx: AnyTransactionClient,
    params: {
      proposalId: string;
      updates: Record<string, unknown>;
      requestorId: UserId;
      organizationId: OrganizationId;
      projectId: ProjectId;
      /** Plan identity reserved by grouped authoring, when present. */
      reservedPlanId?: string;
    },
  ): Promise<AdoptionResult> {
    const { proposalId, organizationId, projectId, requestorId } = params;
    const parsed = planFromExistingTasksPayloadSchema.safeParse(params.updates);
    if (!parsed.success) {
      this.reject(proposalId, [
        {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        },
      ]);
    }
    const payload = parsed.data;

    const taskIds = payload.stages.flatMap((stage) => stage.taskIds);
    const prerequisites = payload.taskPrerequisites ?? [];
    const prerequisiteTaskIds = prerequisites.flatMap((p) => [
      p.taskId,
      p.dependsOnTaskId,
    ]);

    // Serialize competing adoptions of the same Tasks, then validate current
    // state inside this transaction.
    const lockIds = [...new Set([...taskIds, ...prerequisiteTaskIds])].sort();
    await (tx as Prisma.TransactionClient).$queryRaw`
      SELECT "id" FROM "tasks" WHERE "id" IN (${Prisma.join(lockIds)}) ORDER BY "id" FOR UPDATE
    `;

    const rejections = await this.validate(tx as Prisma.TransactionClient, {
      payload,
      taskIds,
      prerequisites,
      organizationId,
      projectId,
    });
    if (rejections.length > 0) {
      this.reject(proposalId, rejections);
    }

    const designDoc = await this.designDocService.createInTransaction(
      tx,
      {
        name: payload.planTitle,
        template: 'PLAN_DOCUMENT',
        status: 'READY',
        projectId,
        organizationId,
        sections: [
          { key: 'content', order: 0, content: payload.designDocMarkdown },
        ],
        parentEntityType: 'TASK',
        parentEntityId: payload.parentFeatureId,
      },
      adoptionDesignDocId(proposalId),
    );

    const plan = await this.taskService.createInTransaction(
      tx,
      organizationId,
      null,
      {
        name: payload.planTitle,
        type: 'PLAN',
        parentTaskId: payload.parentFeatureId,
        assigneeId: requestorId,
        status: WorkStatus.Backlog,
        sections: [
          { key: 'outcome', content: payload.planTitle },
          { key: 'description', content: payload.designDocMarkdown },
          {
            key: 'planConfiguration',
            content: {
              schemaVersion: 'plan-configuration.v1',
              planType: 'STANDARD',
              worktreeBranch: null,
            },
          },
        ],
      } satisfies CreateTaskDto,
      projectId,
      params.reservedPlanId as TaskId | undefined,
    );

    const stageIds: string[] = [];
    for (const stage of payload.stages) {
      const created = await this.taskService.createInTransaction(
        tx,
        organizationId,
        null,
        {
          name: stage.title,
          type: 'PLAN_STAGE',
          parentTaskId: plan.id,
          status: WorkStatus.Backlog,
        } satisfies CreateTaskDto,
        projectId,
      );
      stageIds.push(created.id);
    }

    const taskPostCommits: AdoptionResult['taskPostCommits'] = [];
    for (const [index, stage] of payload.stages.entries()) {
      for (const taskId of stage.taskIds) {
        const { postCommit } = await this.taskService.updateInTransaction(
          tx as Prisma.TransactionClient,
          organizationId,
          null,
          taskId as TaskId,
          { parentTaskId: stageIds[index] },
          requestorId,
        );
        taskPostCommits.push({ taskId, postCommit });
      }
    }

    const edges = this.buildEdges(proposalId, {
      planId: plan.id,
      designDocId: designDoc.id,
      stageIds,
      prerequisites,
    });

    this.logger.log('Adopted existing tasks into a new Plan', {
      proposalId,
      planId: plan.id,
      stageCount: stageIds.length,
      taskCount: taskIds.length,
    });

    return {
      planId: plan.id,
      designDocId: designDoc.id,
      stageIds,
      edges,
      taskPostCommits,
    };
  }

  /**
   * Rebuilds the dependency edges of an already-approved adoption from its
   * committed state, so a failed graph publication can be retried with the same
   * stable edge identities. Stage i is the parent of the first Task assigned
   * to it.
   */
  async rebuildPublicationEdges(params: {
    proposalId: string;
    planId: string;
    updates: Record<string, unknown>;
    organizationId: OrganizationId;
    projectId: ProjectId;
    db: Prisma.TransactionClient;
  }): Promise<MaterializableEdge[]> {
    const payload = planFromExistingTasksPayloadSchema.parse(params.updates);
    const firstTaskIds = payload.stages.map((stage) => stage.taskIds[0]!);
    const rows = await params.db.task.findMany({
      where: {
        id: { in: firstTaskIds },
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
      select: { id: true, parentTaskId: true },
    });
    const parentByTask = new Map(rows.map((r) => [r.id, r.parentTaskId]));
    const stageIds = firstTaskIds.map((taskId) => parentByTask.get(taskId));
    const stages = await params.db.task.findMany({
      where: {
        id: { in: stageIds.filter((id): id is string => !!id) },
        parentTaskId: params.planId,
        type: WORK_ITEM_TYPE_KEYS.PlanStage,
      },
      select: { id: true },
    });
    if (
      stageIds.some((id) => !id) ||
      stages.length !== new Set(stageIds).size
    ) {
      throw new ConflictException(
        `Plan ${params.planId} no longer holds the adopted stage structure, so its dependencies cannot be republished.`,
      );
    }

    return this.buildEdges(params.proposalId, {
      planId: params.planId,
      designDocId: adoptionDesignDocId(params.proposalId),
      stageIds: stageIds as string[],
      prerequisites: payload.taskPrerequisites ?? [],
    });
  }

  private async validate(
    tx: Prisma.TransactionClient,
    params: {
      payload: PlanFromExistingTasksPayload;
      taskIds: string[];
      prerequisites: Array<{ taskId: string; dependsOnTaskId: string }>;
      organizationId: OrganizationId;
      projectId: ProjectId;
    },
  ): Promise<AdoptionRejection[]> {
    const { payload, taskIds, prerequisites, organizationId, projectId } =
      params;
    const rejections: AdoptionRejection[] = [];

    const seen = new Set<string>();
    for (const taskId of taskIds) {
      if (seen.has(taskId)) {
        rejections.push({
          code: 'DUPLICATE_TASK_ASSIGNMENT',
          taskId,
          message: `Task ${taskId} is assigned to more than one stage position.`,
        });
      }
      seen.add(taskId);
    }

    const feature = await tx.task.findFirst({
      where: {
        id: payload.parentFeatureId,
        organizationId,
        projectId,
        type: WORK_ITEM_TYPE_KEYS.Feature,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!feature) {
      rejections.push({
        code: 'PARENT_FEATURE_NOT_FOUND',
        taskId: payload.parentFeatureId,
        message: `Parent Feature ${payload.parentFeatureId} was not found in this project.`,
      });
    }

    const adopted = new Set(taskIds);
    const endpointIds = [
      ...new Set([
        ...taskIds,
        ...prerequisites.flatMap((p) => [p.taskId, p.dependsOnTaskId]),
      ]),
    ];
    const rows = await tx.task.findMany({
      where: { id: { in: endpointIds } },
      select: {
        id: true,
        type: true,
        status: true,
        archivedAt: true,
        organizationId: true,
        projectId: true,
        parentTaskId: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const inScope = (id: string) => {
      const row = byId.get(id);
      return row &&
        row.organizationId === organizationId &&
        row.projectId === projectId
        ? row
        : undefined;
    };

    for (const taskId of adopted) {
      const row = inScope(taskId);
      if (!row) {
        rejections.push({
          code: 'TASK_NOT_FOUND',
          taskId,
          message: `Task ${taskId} no longer exists in this project.`,
        });
        continue;
      }
      if (row.archivedAt !== null) {
        rejections.push({
          code: 'TASK_ARCHIVED',
          taskId,
          message: `Task ${taskId} is archived and cannot be adopted.`,
        });
        continue;
      }
      if (row.status === WorkStatus.Superseded) {
        rejections.push({
          code: 'TASK_SUPERSEDED',
          taskId,
          message: `Task ${taskId} is superseded and cannot be adopted.`,
        });
        continue;
      }
      if (row.type !== WORK_ITEM_TYPE_KEYS.Standard) {
        rejections.push({
          code: 'TASK_NOT_STANDARD',
          taskId,
          message: `Work item ${taskId} is a ${row.type}, not a Task, and cannot be adopted.`,
        });
        continue;
      }
      const container = await this.findContainingPlanContainer(
        tx,
        row.parentTaskId,
      );
      if (container) {
        rejections.push({
          code: 'TASK_ALREADY_IN_PLAN',
          taskId,
          message: `Task ${taskId} is already inside Plan work item ${container}.`,
        });
      }
    }

    for (const { taskId, dependsOnTaskId } of prerequisites) {
      if (taskId === dependsOnTaskId) {
        rejections.push({
          code: 'SELF_DEPENDENCY',
          taskId,
          message: `Task ${taskId} cannot depend on itself.`,
        });
        continue;
      }
      if (!adopted.has(taskId)) {
        rejections.push({
          code: 'PREREQUISITE_TASK_NOT_ADOPTED',
          taskId,
          message: `Prerequisite names Task ${taskId}, which is not one of the adopted Tasks.`,
        });
      }
      const target = inScope(dependsOnTaskId);
      if (!target || target.archivedAt !== null) {
        rejections.push({
          code: 'PREREQUISITE_NOT_FOUND',
          taskId: dependsOnTaskId,
          message: `Prerequisite ${dependsOnTaskId} was not found in this project.`,
        });
      }
    }

    if (this.hasCycle(prerequisites)) {
      rejections.push({
        code: 'CYCLIC_DEPENDENCY',
        message: 'The proposed task prerequisites contain a dependency cycle.',
      });
    }

    return rejections;
  }

  private async findContainingPlanContainer(
    tx: Prisma.TransactionClient,
    parentTaskId: string | null,
  ): Promise<string | null> {
    const visited = new Set<string>();
    let currentId = parentTaskId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const parent = await tx.task.findUnique({
        where: { id: currentId },
        select: { id: true, type: true, parentTaskId: true },
      });
      if (!parent) {
        return null;
      }
      if (PLAN_CONTAINER_TYPES.has(parent.type)) {
        return parent.id;
      }
      currentId = parent.parentTaskId;
    }
    return null;
  }

  private hasCycle(
    prerequisites: Array<{ taskId: string; dependsOnTaskId: string }>,
  ): boolean {
    const next = new Map<string, string[]>();
    for (const { taskId, dependsOnTaskId } of prerequisites) {
      if (taskId === dependsOnTaskId) {
        continue;
      }
      next.set(taskId, [...(next.get(taskId) ?? []), dependsOnTaskId]);
    }
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string): boolean => {
      if (state.get(id) === 'done') {
        return false;
      }
      if (state.get(id) === 'visiting') {
        return true;
      }
      state.set(id, 'visiting');
      const cyclic = (next.get(id) ?? []).some(visit);
      state.set(id, 'done');
      return cyclic;
    };
    return [...next.keys()].some(visit);
  }

  private buildEdges(
    proposalId: string,
    params: {
      planId: string;
      designDocId: string;
      stageIds: string[];
      prerequisites: Array<{ taskId: string; dependsOnTaskId: string }>;
    },
  ): MaterializableEdge[] {
    const task = AgentEdgeEndpointEntityType.Task;
    const edge = (
      sourceEntityId: string,
      targetEntityId: string,
      edgeType: string,
      targetEntityType = task,
    ): MaterializableEdge => ({
      id: uuidv5(
        `${proposalId}:${edgeType}:${sourceEntityId}:${targetEntityId}`,
        ADOPTION_EDGE_NAMESPACE,
      ),
      sourceEntityId,
      sourceEntityType: task,
      targetEntityId,
      targetEntityType,
      edgeType,
    });

    const edges: MaterializableEdge[] = [
      edge(
        params.planId,
        params.designDocId,
        'DERIVES_FROM',
        AgentEdgeEndpointEntityType.DesignDoc,
      ),
    ];
    for (let i = 1; i < params.stageIds.length; i++) {
      edges.push(
        edge(params.stageIds[i]!, params.stageIds[i - 1]!, 'DEPENDS_ON'),
      );
    }
    const declared = new Set<string>();
    for (const { taskId, dependsOnTaskId } of params.prerequisites) {
      const key = `${taskId}>${dependsOnTaskId}`;
      if (declared.has(key)) {
        continue;
      }
      declared.add(key);
      edges.push(edge(taskId, dependsOnTaskId, 'DEPENDS_ON'));
    }
    return edges;
  }

  private reject(proposalId: string, rejections: AdoptionRejection[]): never {
    for (const rejection of rejections) {
      this.logger.warn('Plan adoption rejected', {
        proposalId,
        code: rejection.code,
        taskId: rejection.taskId,
        message: rejection.message,
      });
    }
    throw new BadRequestException({
      message: `Cannot create a Plan from the selected tasks: ${rejections
        .map((r) => r.message)
        .join(' ')}`,
      reasons: rejections,
    });
  }
}
