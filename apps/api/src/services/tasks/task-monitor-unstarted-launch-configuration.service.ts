import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  WorkStatus,
  type ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto,
  type TaskMonitorExecutionDefinition,
  type TaskMonitorExecutionNodeLaunchConfiguration,
} from '@hey-hey/contracts/api/models';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';
import { TaskService } from './task.service';
import {
  TASK_MONITOR_EXECUTION_DEFINITION_SECTION_KEY,
  TASK_MONITOR_TYPE_KEY,
  validateTaskMonitorExecutionDefinitionContent,
} from './task-monitor-execution-definition.validator';

/** A monitor in one of these states runs no further tasks, so nothing is left to configure. */
const FINISHED_MONITOR_STATUSES: ReadonlySet<string> = new Set([
  WorkStatus.Completed,
  WorkStatus.Cancelled,
  WorkStatus.Superseded,
  WorkStatus.Archived,
]);

/**
 * Replaces the launch configuration on every Task Monitor task that has no
 * Agent Session yet, in one transaction that holds the monitor row. Session
 * existence at write time, not monitor status, decides which tasks change.
 */
@Injectable()
export class TaskMonitorUnstartedLaunchConfigurationService {
  private readonly logger = new Logger(
    TaskMonitorUnstartedLaunchConfigurationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskService: TaskService,
  ) {}

  async apply(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    monitorId: TaskId;
    userId: UserId;
    launchConfiguration: TaskMonitorExecutionNodeLaunchConfiguration;
  }): Promise<ApplyTaskMonitorUnstartedLaunchConfigurationResponseDto> {
    const { organizationId, projectId, monitorId, userId } = params;

    const { result, postCommit } = await this.prisma.$transaction(
      async (tx) => {
        // Holding the row serializes this read-modify-write with every other
        // write of the monitor, so the unstarted set cannot shift underneath it.
        await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${monitorId} AND organization_id = ${organizationId} AND project_id = ${projectId} FOR UPDATE`;

        const monitor = await tx.task.findFirst({
          where: { id: monitorId, organizationId, projectId },
          select: {
            id: true,
            type: true,
            status: true,
            archivedAt: true,
            initiativeId: true,
          },
        });
        if (!monitor || monitor.type !== TASK_MONITOR_TYPE_KEY) {
          this.reject(monitorId, 'MONITOR_NOT_FOUND', {
            found: Boolean(monitor),
            type: monitor?.type ?? null,
          });
          throw new NotFoundException(`Task Monitor ${monitorId} not found.`);
        }
        if (
          monitor.archivedAt ||
          FINISHED_MONITOR_STATUSES.has(monitor.status)
        ) {
          this.reject(monitorId, 'MONITOR_FINISHED', {
            status: monitor.status,
            archived: Boolean(monitor.archivedAt),
          });
          throw new ConflictException(
            `Task Monitor ${monitorId} has finished (${monitor.archivedAt ? 'ARCHIVED' : monitor.status}); its tasks can no longer be configured.`,
          );
        }

        const definition = await this.readStoredDefinition(tx, monitorId);
        const updatedTaskIds: string[] = [];
        const skippedTaskIds: string[] = [];
        const executionPlan = definition.executionPlan.map((node) => {
          if (node.agentSessionId) {
            skippedTaskIds.push(node.taskId);
            return node;
          }
          updatedTaskIds.push(node.taskId);
          return { ...node, launchConfiguration: params.launchConfiguration };
        });
        if (updatedTaskIds.length === 0) {
          this.reject(monitorId, 'NO_UNSTARTED_TASKS', {
            taskCount: definition.executionPlan.length,
          });
          throw new ConflictException(
            `Every task in Task Monitor ${monitorId} already has an Agent Session; there are no unstarted tasks to configure.`,
          );
        }

        const nextDefinition: TaskMonitorExecutionDefinition = {
          ...definition,
          executionPlan,
        };
        // The shared update path re-validates structure and the monitor kind's
        // allowed values, and rejects the whole write if any node fails.
        const updated = await this.taskService
          .updateInTransaction(
            tx,
            organizationId,
            monitor.initiativeId as InitiativeId | null,
            monitorId,
            {
              sections: [
                {
                  key: TASK_MONITOR_EXECUTION_DEFINITION_SECTION_KEY,
                  content: nextDefinition,
                },
              ],
            },
            userId,
          )
          .catch((error: unknown) => {
            this.reject(monitorId, 'INVALID_LAUNCH_CONFIGURATION', {
              cause: error instanceof Error ? error.message : String(error),
            });
            throw error;
          });

        return {
          result: { updatedTaskIds, skippedTaskIds },
          postCommit: updated.postCommit,
        };
      },
    );

    await this.taskService.runUpdatePostCommit(
      organizationId,
      monitorId,
      postCommit,
    );
    this.logger.log(
      'Applied launch configuration to unstarted Task Monitor tasks',
      {
        organizationId,
        projectId,
        monitorId,
        updatedTaskCount: result.updatedTaskIds.length,
        skippedTaskCount: result.skippedTaskIds.length,
      },
    );
    return result;
  }

  private async readStoredDefinition(
    tx: Prisma.TransactionClient,
    monitorId: TaskId,
  ): Promise<TaskMonitorExecutionDefinition> {
    const section = await tx.taskSection.findFirst({
      where: {
        taskId: monitorId,
        key: TASK_MONITOR_EXECUTION_DEFINITION_SECTION_KEY,
      },
      select: { materializedMarkdown: true },
    });
    const parsed = validateTaskMonitorExecutionDefinitionContent(
      section?.materializedMarkdown ?? null,
    );
    if (!parsed.success) {
      this.reject(monitorId, 'STORED_DEFINITION_UNREADABLE', {
        hasSection: Boolean(section),
        cause: parsed.message,
      });
      throw new BadRequestException(
        `Task Monitor ${monitorId} has no readable execution definition: ${parsed.message}`,
      );
    }
    return parsed.value;
  }

  private reject(
    monitorId: TaskId,
    code: string,
    detail: Record<string, unknown>,
  ): void {
    this.logger.warn(
      'Rejected applying launch configuration to unstarted tasks',
      {
        monitorId,
        code,
        ...detail,
      },
    );
  }
}
