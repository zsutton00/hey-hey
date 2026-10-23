import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Influence,
  ProposalEdgeTargetType,
  ProposalEdgeType,
  SupersedeTaskDto,
  UpdateTaskResponseDto,
  WorkStatus,
} from 'src/generated';
import type { RequestorContext } from 'src/mcp/tools/requestor-context';
import { OrganizationId, ProjectId, TaskId, UserId } from 'src/types';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProposalService } from '../proposal/proposal.service';
import type { StampedCreateProposalDto } from '../proposal/proposal.types';
import { TaskService } from './task.service';
import { WorkItemTypeRegistryService } from './work-item-type-registry.service';

/**
 * The supersede transition.
 *
 * Superseding a task is two changes that must travel together: the task's
 * status flips to SUPERSEDED and a SUPERSEDES edge is written to the
 * successor task. Rather than two direct writes, the transition authors a
 * single proposal carrying both — `updates.status = SUPERSEDED` plus a
 * declared SUPERSEDES edge to the successor.
 *
 * The proposal is the atomic, reviewable unit. `ProposalService.create`
 * enforces the supersede invariant (see evaluateSupersedeInvariant): a
 * SUPERSEDED status with no edge — or an edge with no status change — is
 * rejected, so the plain status-edit path can never produce a SUPERSEDED
 * task. When the proposal is approved (or auto-applies) the status update
 * and the edge materialization run through the standard proposal pipeline.
 *
 * The pre-checks here (successor required, task type permits SUPERSEDED,
 * both tasks exist, task not already superseded) run before the proposal is
 * authored so the caller gets an immediate 400/404 rather than a doomed
 * proposal.
 */
@Injectable()
export class TaskSupersedeService {
  private readonly logger = new Logger(TaskSupersedeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
    private readonly proposalService: ProposalService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  async supersedeTask(
    organizationId: OrganizationId,
    projectId: ProjectId,
    taskId: TaskId,
    dto: SupersedeTaskDto,
    userId: UserId,
    requestorContext: RequestorContext,
  ): Promise<UpdateTaskResponseDto> {
    this.logger.log('supersedeTask called', {
      organizationId,
      projectId,
      taskId,
      successorTaskId: dto.successorTaskId,
    });

    const successorTaskId = dto.successorTaskId;
    if (!successorTaskId) {
      throw new BadRequestException(
        'supersedeTask requires a successorTaskId — a task is superseded by ' +
          'a successor, never into a void. Use CANCELLED for work that is ' +
          'dead with no replacement.',
      );
    }
    if (successorTaskId === taskId) {
      throw new BadRequestException('A task cannot supersede itself.');
    }

    const task = await this.prisma.db.task.findFirst({
      where: { id: taskId, organizationId, archivedAt: null },
      select: { id: true, name: true, type: true, status: true },
    });
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }
    if (task.status === WorkStatus.Superseded) {
      throw new BadRequestException(`Task ${taskId} is already superseded.`);
    }

    const taskType = task.type as WorkItemTypeKey;
    if (!this.workItemTypeRegistry.isSupersedable(taskType, projectId)) {
      throw new BadRequestException(
        `Task type ${taskType} cannot be superseded. SUPERSEDED is valid ` +
          'only for FEATURE and STANDARD tasks; a BUG or GOAL is resolved or ' +
          'cancelled, never replaced by a successor.',
      );
    }

    const successor = await this.prisma.db.task.findFirst({
      where: { id: successorTaskId, organizationId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (!successor) {
      throw new NotFoundException(
        `Successor task with ID ${successorTaskId} not found.`,
      );
    }

    // One proposal carries both halves of the transition: the status change
    // and the SUPERSEDES edge from the displaced task to its successor. The
    // edge runs source → target, so an outbound SUPERSEDES reads as
    // "superseded-by".
    const userInfluence: Influence = {
      entityId: userId,
      entityType: 'USER',
      reasonType: 'user_reason',
      reasoning: `Superseded by "${successor.name}".`,
    };

    const proposalDto: StampedCreateProposalDto = {
      type: 'SINGLE',
      action: 'UPDATE',
      eli5: 'Replaces this task with the selected successor.',
      targetEntityId: taskId,
      targetEntityType: 'TASK',
      updates: { status: WorkStatus.Superseded },
      requestorContext,
      influences: [userInfluence],
      edges: [
        {
          targetEntityId: successorTaskId,
          targetEntityType: ProposalEdgeTargetType.Task,
          edgeType: ProposalEdgeType.Supersedes,
          description: `Task "${task.name}" is superseded by "${successor.name}".`,
        },
      ],
    };

    const proposal = await this.proposalService.create(
      organizationId,
      projectId,
      userId,
      proposalDto,
    );

    this.logger.log('supersedeTask authored proposal', {
      taskId,
      successorTaskId,
      proposalId: proposal.id,
      proposalStatus: proposal.status,
    });

    const updatedTask = await this.taskService.findOneByOrganization(
      organizationId,
      taskId,
    );
    if (!updatedTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    if (proposal.status === 'APPROVED') {
      return { status: 'APPLIED', task: updatedTask };
    }
    return { status: 'PENDING', task: updatedTask, proposal };
  }
}
