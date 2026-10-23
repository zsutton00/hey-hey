import { AdminGuard } from '../auth/guards/admin.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Patch,
  Param,
  ParseArrayPipe,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Client } from '@temporalio/client';
import {
  EntityType,
  Prisma,
  SubfacetStatus,
  SummaryCategory,
  TopologyConsolidationSchedule,
  TopologyConsolidationScheduleStatus,
  WorkStatus,
} from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InjectTemporalClient } from '../prisma/temporal.module';
import {
  AuthToken,
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  TopologyCategorySummarizationRunDto,
  TopologyCategorySummaryDto,
  TopologyEntitySummaryDto,
  TopologySubfacetConsolidationRunDto,
  TopologySubfacetDto,
  TopologySubfacetSummarizationRunDto,
  UnifiedGraphSearchResponse,
} from '../generated';
import { TopologyGraphResponse } from '../generated/graphs';
import {
  OrganizationId,
  ProjectId,
  SubfacetId,
  WorkflowId,
  WorkflowAboutType,
  InitiativeId,
  DesignDocId,
  TaskId,
} from '../types';
import { PrismaService } from '../prisma/prisma.service';
import { GraphsClientService } from '../services/graphs-client.service';
import { TopologyAuditService } from '../services/audit/topology-audit.service';
import { EntitySummaryService } from '../services/entity-summary/entity-summary.service';
import { SubfacetCandidateService } from '../services/entity-summary/subfacet-candidate.service';
import { SubfacetService } from '../services/entity-summary/subfacet.service';
import { SummarizationTriggerType } from '../services/summarization/summarization.types';
import {
  CategorySummarizationAuditMap,
  CategorySummarizationJobInput,
  ConsolidationAuditMap,
  SubfacetConsolidationJobInput,
  SubfacetSummarizationAuditMap,
  SubfacetSummarizationJobInput,
} from '../services/topology/consolidation.types';
import { TopologyCategorySummaryService } from '../services/topology/topology-category-summary.service';
import { TopologyConsolidationSchedulerService } from '../services/topology/topology-consolidation-scheduler.service';

class StartSubfacetConsolidationDto {
  organizationId?: OrganizationId;
  projectId!: ProjectId;
  since!: string;
  categories?: SummaryCategory[];
  threshold?: number;
  maxIterations?: number;
  maxEntitiesPerRun?: number;
  maxEntitiesPerSubfacet?: number;
  trigger?: SummarizationTriggerType;
  workflowAboutType?: WorkflowAboutType;
  workflowAboutId?: string;
  workflowId?: WorkflowId;
  auditByCategory?: ConsolidationAuditMap;
}

class StartCategorySummarizationDto {
  organizationId?: OrganizationId;
  projectId!: ProjectId;
  since!: string;
  categories?: SummaryCategory[];
  maxPerCategory?: number;
  maxPerSubfacet?: number;
  trigger?: SummarizationTriggerType;
  workflowAboutType?: WorkflowAboutType;
  workflowAboutId?: string;
  workflowId?: WorkflowId;
  auditByCategory?: CategorySummarizationAuditMap;
}

class StartSubfacetSummarizationDto {
  organizationId?: OrganizationId;
  projectId!: ProjectId;
  since!: string;
  categories?: SummaryCategory[];
  subfacetIds?: string[];
  maxEntities?: number;
  trigger?: SummarizationTriggerType;
  workflowAboutType?: WorkflowAboutType;
  workflowAboutId?: string;
  workflowId?: WorkflowId;
  auditBySubfacet?: SubfacetSummarizationAuditMap;
}

class StartEntitySummarizationDto {
  taskId?: string;
  planId?: string;
  organizationId?: OrganizationId;
  projectId?: ProjectId;
  since?: string;
  trigger?: SummarizationTriggerType;
  workflowId?: WorkflowId;
}

class StartResetDto {
  organizationId?: OrganizationId;
  projectId!: ProjectId;
}

class StartEntityValidationDto {
  organizationId?: OrganizationId;
  projectId!: ProjectId;
  maxSamples?: number;
}

class UpsertTopologyScheduleDto {
  organizationId?: OrganizationId;
  projectId!: ProjectId;
  cadenceHours?: number;
  status?: TopologyConsolidationScheduleStatus;
  maxEntitiesPerRun?: number;
  maxEntitiesPerSubfacet?: number;
  maxEntitiesPerSubfacetSummary?: number;
  maxPerCategory?: number;
  maxPerSubfacet?: number;
  threshold?: number;
  maxIterations?: number;
  retryMaxAttempts?: number;
  retryBackoffSeconds?: number;
}

class PatchTopologyScheduleDto {
  organizationId?: OrganizationId;
  projectId!: ProjectId;
  cadenceHours?: number;
  status?: TopologyConsolidationScheduleStatus;
  maxEntitiesPerRun?: number;
  maxEntitiesPerSubfacet?: number;
  maxEntitiesPerSubfacetSummary?: number;
  maxPerCategory?: number;
  maxPerSubfacet?: number;
  threshold?: number;
  maxIterations?: number;
  retryMaxAttempts?: number;
  retryBackoffSeconds?: number;
  nextRunAt?: string | null;
}

class TriggerTopologyScheduleDto {
  organizationId?: OrganizationId;
  projectId!: ProjectId;
}

@ApiTags('Debug/Admin')
@UseGuards(AdminGuard)
@Controller('api/v1/debug/topology')
export class TopologyController {
  private readonly logger = new Logger(TopologyController.name);

  constructor(
    @InjectTemporalClient() private readonly temporalClient: Client,
    private readonly prisma: PrismaService,
    private readonly graphsClientService: GraphsClientService,
    private readonly topologyScheduler: TopologyConsolidationSchedulerService,
    private readonly subfacetCandidateService: SubfacetCandidateService,
  ) {}

  private mapScheduleToResponse(schedule: TopologyConsolidationSchedule) {
    return {
      ...schedule,
      nextRunAt: schedule.nextRunAt?.toISOString(),
      lastRunAt: schedule.lastRunAt?.toISOString(),
      lastSuccessAt: schedule.lastSuccessAt?.toISOString(),
      leaseExpiresAt: schedule.leaseExpiresAt?.toISOString(),
      runningSince: schedule.runningSince?.toISOString(),
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
    };
  }

  private parseOptionalIsoDate(
    value: string | null | undefined,
    fieldName: string,
  ): Date | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO date`);
    }

    return parsedDate;
  }

  private assertEntitySummarizationEnabled(): void {
    throw new ServiceUnavailableException('Entity summarization is disabled');
  }

  @Post('reset')
  @ApiOperation({
    summary:
      'Reset entity/topology state for an org: clears summaries/subfacets and re-triggers entity summarization',
  })
  async reset(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartResetDto,
  ): Promise<{
    cleared: {
      entitySummaries: number;
      subfacets: number;
      categorySummaries: number;
    };
    started: { tasks: number; initiatives: number; designDocs: number };
    skipped: { tasks: number; initiatives: number; designDocs: number };
  }> {
    this.assertEntitySummarizationEnabled();

    const organizationId =
      body.organizationId ??
      organizationIdFromParams ??
      user?.currentOrgId ??
      undefined;

    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }
    const projectId = body.projectId;

    // Collect entities to re-summarize.
    const targetStatuses = [
      WorkStatus.BACKLOG,
      WorkStatus.ACTIVE,
      WorkStatus.COMPLETED,
    ];

    const tasks = await this.prisma.db.task.findMany({
      where: {
        organizationId,
        status: { in: targetStatuses },
        OR: [
          { projectId },
          { projectRelations: { some: { projectId } } },
          {
            initiative: {
              OR: [
                { projects: { some: { projectId } } },
                { originatingProjectId: projectId },
              ],
            },
          },
        ],
      },
      include: {
        projectRelations: true,
      },
    });

    const initiatives = await this.prisma.db.initiative.findMany({
      where: {
        organizationId,
        status: { in: targetStatuses },
        OR: [
          { projects: { some: { projectId } } },
          { originatingProjectId: projectId },
        ],
      },
      include: { projects: true },
    });

    const designDocs = await this.prisma.db.designDoc.findMany({
      where: {
        organizationId,
        projectId,
        status: { equals: 'Ready', mode: 'insensitive' },
      },
    });

    const targetEntities: Array<{
      entityType: EntityType;
      entityId: string;
      projectId: ProjectId;
    }> = [];

    for (const task of tasks) {
      const projectId =
        task.projectId ?? task.projectRelations?.[0]?.projectId ?? null;
      if (projectId) {
        targetEntities.push({
          entityType: EntityType.TASK,
          entityId: task.id,
          projectId: projectId as ProjectId,
        });
      }
    }

    for (const initiative of initiatives) {
      const projectId = initiative.projects?.[0]?.projectId ?? null;
      if (projectId) {
        targetEntities.push({
          entityType: EntityType.INITIATIVE,
          entityId: initiative.id,
          projectId: projectId as ProjectId,
        });
      }
    }

    for (const doc of designDocs) {
      const projectId = doc.projectId ?? null;
      if (projectId) {
        targetEntities.push({
          entityType: EntityType.DESIGN_DOC,
          entityId: doc.id,
          projectId: projectId as ProjectId,
        });
      }
    }

    const entityFilters = targetEntities.map((entity) => ({
      entityType: entity.entityType,
      entityId: entity.entityId,
      projectId: entity.projectId,
    }));

    // Wipe summaries/subfacets only for the entities/projects we are re-summarizing.
    const clearedEntitySummaries =
      entityFilters.length > 0
        ? await this.prisma.db.entitySummary.deleteMany({
            where: {
              organizationId,
              OR: entityFilters,
            },
          })
        : { count: 0 };
    if (entityFilters.length > 0) {
      await this.prisma.db.entitySubfacet.deleteMany({
        where: {
          organizationId,
          OR: entityFilters,
        },
      });
    }
    const clearedSubfacets = await this.prisma.db.subfacet.deleteMany({
      where: {
        organizationId,
        projectId,
      },
    });
    const resetCategories =
      await this.prisma.db.topologyCategorySummary.updateMany({
        where: {
          organizationId,
          projectId,
        },
        data: { summary: '', briefSummary: null },
      });

    let startedTasks = 0;
    let startedInitiatives = 0;
    let startedDesignDocs = 0;
    let skippedTasks = 0;
    let skippedInitiatives = 0;
    let skippedDesignDocs = 0;

    const startEntityWorkflow = async (params: {
      projectId?: ProjectId;
      workflowAboutId: string;
      workflowAboutType: WorkflowAboutType;
    }) => {
      if (!params.projectId) {
        return false;
      }

      const workflowId =
        `reset-entity-summary-${params.workflowAboutType}-${params.workflowAboutId}-${Date.now()}` as WorkflowId;

      await this.temporalClient.workflow.start('entitySummarizationWorkflow', {
        args: [
          {
            organizationId,
            projectId: params.projectId,
            workflowAboutType: params.workflowAboutType,
            workflowAboutId: params.workflowAboutId,
            trigger: 'on_demand' as SummarizationTriggerType,
          },
        ],
        taskQueue: 'conversation-queue',
        workflowId,
      });

      this.logger.debug('[reset] started entitySummarizationWorkflow', {
        organizationId,
        projectId: params.projectId,
        workflowAboutType: params.workflowAboutType,
        workflowAboutId: params.workflowAboutId,
        workflowId,
      });

      return true;
    };

    for (const task of tasks) {
      const projectId =
        task.projectId ?? task.projectRelations?.[0]?.projectId ?? null;
      const started = await startEntityWorkflow({
        projectId: projectId as ProjectId | undefined,
        workflowAboutId: task.id,
        workflowAboutType: 'task',
      });
      started ? startedTasks++ : skippedTasks++;
    }

    for (const initiative of initiatives) {
      const projectId = initiative.projects?.[0]?.projectId ?? null;
      const started = await startEntityWorkflow({
        projectId: projectId as ProjectId | undefined,
        workflowAboutId: initiative.id,
        workflowAboutType: 'initiative',
      });
      started ? startedInitiatives++ : skippedInitiatives++;
    }

    for (const doc of designDocs) {
      const projectId = doc.projectId ?? null;
      const started = await startEntityWorkflow({
        projectId: projectId as ProjectId | undefined,
        workflowAboutId: doc.id,
        workflowAboutType: 'design-doc',
      });
      started ? startedDesignDocs++ : skippedDesignDocs++;
    }

    return {
      cleared: {
        entitySummaries: clearedEntitySummaries.count,
        subfacets: clearedSubfacets.count,
        categorySummaries: resetCategories.count,
      },
      started: {
        tasks: startedTasks,
        initiatives: startedInitiatives,
        designDocs: startedDesignDocs,
      },
      skipped: {
        tasks: skippedTasks,
        initiatives: skippedInitiatives,
        designDocs: skippedDesignDocs,
      },
    };
  }

  @Post('entity-summarization/run')
  @ApiOperation({
    summary: 'Trigger a single entity (task or plan) summarization workflow',
  })
  async runSingleEntitySummarization(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartEntitySummarizationDto,
  ): Promise<{
    workflowId: WorkflowId;
    taskId?: string;
    planId?: string;
    projectId: ProjectId;
  }> {
    this.assertEntitySummarizationEnabled();

    const organizationId =
      body.organizationId ??
      organizationIdFromParams ??
      user?.currentOrgId ??
      undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.taskId && !body.planId) {
      throw new BadRequestException('taskId or planId is required');
    }
    if (body.taskId && body.planId) {
      throw new BadRequestException('provide only one of taskId or planId');
    }

    if (body.planId) {
      const plan = await this.prisma.db.task.findFirst({
        where: { id: body.planId, organizationId, type: 'PLAN' },
        select: { id: true, projectId: true },
      });

      if (!plan) {
        throw new BadRequestException('plan not found for organization');
      }

      const resolvedProjectId = body.projectId ?? plan.projectId ?? null;

      if (!resolvedProjectId) {
        throw new BadRequestException(
          'projectId is required (provide explicitly or ensure plan has originatingProjectId)',
        );
      }
      const projectId = resolvedProjectId as ProjectId;

      const workflowId =
        body.workflowId ??
        (`entity-summarization-plan-${plan.id}-${Date.now()}` as WorkflowId);

      await this.temporalClient.workflow.start('entitySummarizationWorkflow', {
        args: [
          {
            organizationId,
            projectId,
            workflowAboutType: 'task' as WorkflowAboutType,
            workflowAboutId: plan.id,
            trigger: body.trigger ?? ('on_demand' as SummarizationTriggerType),
            since: body.since,
          },
        ],
        taskQueue: 'conversation-queue',
        workflowId,
      });

      this.logger.debug('[runSingleEntitySummarization] started workflow', {
        organizationId,
        planId: plan.id,
        projectId,
        workflowId,
      });

      return { workflowId, planId: plan.id, projectId };
    }

    const task = await this.prisma.db.task.findFirst({
      where: { id: body.taskId, organizationId },
      include: {
        projectRelations: true,
      },
    });

    if (!task) {
      throw new BadRequestException('task not found for organization');
    }

    const resolvedProjectId =
      body.projectId ??
      task.projectId ??
      task.projectRelations?.[0]?.projectId ??
      null;

    if (!resolvedProjectId) {
      throw new BadRequestException(
        'projectId is required (provide explicitly or ensure task is linked to a project)',
      );
    }
    const projectId = resolvedProjectId as ProjectId;

    const workflowId =
      body.workflowId ??
      (`entity-summarization-task-${task.id}-${Date.now()}` as WorkflowId);

    await this.temporalClient.workflow.start('entitySummarizationWorkflow', {
      args: [
        {
          organizationId,
          projectId,
          workflowAboutType: 'task' as WorkflowAboutType,
          workflowAboutId: task.id,
          trigger: body.trigger ?? ('on_demand' as SummarizationTriggerType),
          since: body.since,
        },
      ],
      taskQueue: 'conversation-queue',
      workflowId,
    });

    this.logger.debug('[runSingleEntitySummarization] started workflow', {
      organizationId,
      taskId: task.id,
      projectId,
      workflowId,
    });

    return { workflowId, taskId: task.id, projectId };
  }

  @Post('subfacet-consolidate/run')
  @ApiOperation({
    summary: 'Start subfacet consolidation workflow (temporary debug endpoint)',
  })
  async runConsolidation(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartSubfacetConsolidationDto,
  ): Promise<{ workflowId: WorkflowId }> {
    const organizationId =
      body.organizationId ??
      organizationIdFromParams ??
      user?.currentOrgId ??
      undefined;

    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }
    if (!body.since) {
      throw new BadRequestException('since is required');
    }

    const workflowId =
      body.workflowId ??
      (`subfacet-consolidation-${organizationId}-${Date.now()}` as WorkflowId);

    const input: SubfacetConsolidationJobInput = {
      organizationId,
      projectId: body.projectId,
      workflowAboutId: body.workflowAboutId ?? body.projectId,
      workflowAboutType:
        body.workflowAboutType ?? ('project' as WorkflowAboutType),
      trigger: body.trigger ?? ('on_demand' as SummarizationTriggerType),
      since: body.since,
      categories: body.categories,
      threshold: body.threshold,
      maxIterations: body.maxIterations,
      maxEntitiesPerRun: body.maxEntitiesPerRun,
      maxEntitiesPerSubfacet: body.maxEntitiesPerSubfacet,
      auditByCategory: body.auditByCategory,
    };

    this.logger.debug('[runConsolidation] starting workflow', {
      organizationId,
      projectId: body.projectId,
      categories: body.categories,
      threshold: body.threshold,
      workflowId,
    });

    await this.temporalClient.workflow.start('subfacetConsolidationWorkflow', {
      args: [input],
      taskQueue: 'conversation-queue',
      workflowId,
    });

    return { workflowId };
  }

  @Post('category/run')
  @ApiOperation({
    summary: 'Start category summarization workflow (temporary debug endpoint)',
  })
  async runCategorySummarization(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartCategorySummarizationDto,
  ): Promise<{ workflowId: WorkflowId }> {
    const organizationId =
      body.organizationId ??
      organizationIdFromParams ??
      user?.currentOrgId ??
      undefined;

    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }
    if (!body.since) {
      throw new BadRequestException('since is required');
    }

    const workflowId =
      body.workflowId ??
      (`category-summarization-${organizationId}-${Date.now()}` as WorkflowId);

    const input: CategorySummarizationJobInput = {
      organizationId,
      projectId: body.projectId,
      workflowAboutId: body.workflowAboutId ?? body.projectId,
      workflowAboutType:
        body.workflowAboutType ?? ('project' as WorkflowAboutType),
      trigger: body.trigger ?? ('on_demand' as SummarizationTriggerType),
      since: body.since,
      categories: body.categories,
      maxPerCategory: body.maxPerCategory,
      maxPerSubfacet: body.maxPerSubfacet,
      auditByCategory: body.auditByCategory,
    };

    this.logger.debug('[runCategorySummarization] starting workflow', {
      organizationId,
      projectId: body.projectId,
      categories: body.categories,
      workflowId,
    });

    await this.temporalClient.workflow.start('categorySummarizationWorkflow', {
      args: [input],
      taskQueue: 'conversation-queue',
      workflowId,
    });

    return { workflowId };
  }

  @Post('subfacet-summarization/run')
  @ApiOperation({
    summary: 'Start subfacet summarization workflow (temporary debug endpoint)',
  })
  async runSubfacetSummarization(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartSubfacetSummarizationDto,
  ): Promise<{ workflowId: WorkflowId }> {
    const organizationId =
      body.organizationId ??
      organizationIdFromParams ??
      user?.currentOrgId ??
      undefined;

    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }
    if (!body.since) {
      throw new BadRequestException('since is required');
    }

    const workflowId =
      body.workflowId ??
      (`subfacet-summarization-${organizationId}-${Date.now()}` as WorkflowId);

    const input: SubfacetSummarizationJobInput = {
      organizationId,
      projectId: body.projectId,
      workflowAboutId: body.workflowAboutId ?? body.projectId,
      workflowAboutType:
        body.workflowAboutType ?? ('project' as WorkflowAboutType),
      trigger: body.trigger ?? ('on_demand' as SummarizationTriggerType),
      since: body.since,
      categories: body.categories,
      subfacetIds: body.subfacetIds,
      maxEntities: body.maxEntities,
      auditBySubfacet: body.auditBySubfacet,
    };

    this.logger.debug('[runSubfacetSummarization] starting workflow', {
      organizationId,
      projectId: body.projectId,
      categories: body.categories,
      subfacetIds: body.subfacetIds,
      workflowId,
    });

    await this.temporalClient.workflow.start('subfacetSummarizationWorkflow', {
      args: [input],
      taskQueue: 'conversation-queue',
      workflowId,
    });

    return { workflowId };
  }

  @Post(['schedule', 'schedule/upsert'])
  @ApiOperation({
    summary:
      'Create or update scheduled topology consolidation config for an organization/project',
  })
  async upsertSchedule(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpsertTopologyScheduleDto,
  ) {
    const organizationId =
      body.organizationId ??
      organizationIdFromParams ??
      user?.currentOrgId ??
      undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }

    const schedule = await this.topologyScheduler.upsertSchedule({
      organizationId,
      projectId: body.projectId,
      cadenceHours: body.cadenceHours,
      status: body.status,
      maxEntitiesPerRun: body.maxEntitiesPerRun,
      maxEntitiesPerSubfacet: body.maxEntitiesPerSubfacet,
      maxEntitiesPerSubfacetSummary: body.maxEntitiesPerSubfacetSummary,
      maxPerCategory: body.maxPerCategory,
      maxPerSubfacet: body.maxPerSubfacet,
      threshold: body.threshold,
      maxIterations: body.maxIterations,
      retryMaxAttempts: body.retryMaxAttempts,
      retryBackoffSeconds: body.retryBackoffSeconds,
    });

    return this.mapScheduleToResponse(schedule);
  }

  @Patch('schedule')
  @ApiOperation({
    summary:
      'Patch scheduled topology consolidation config for an organization/project',
  })
  async patchSchedule(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PatchTopologyScheduleDto,
  ) {
    const organizationId =
      body.organizationId ??
      organizationIdFromParams ??
      user?.currentOrgId ??
      undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }

    const hasPatchField =
      body.cadenceHours !== undefined ||
      body.status !== undefined ||
      body.maxEntitiesPerRun !== undefined ||
      body.maxEntitiesPerSubfacet !== undefined ||
      body.maxEntitiesPerSubfacetSummary !== undefined ||
      body.maxPerCategory !== undefined ||
      body.maxPerSubfacet !== undefined ||
      body.threshold !== undefined ||
      body.maxIterations !== undefined ||
      body.retryMaxAttempts !== undefined ||
      body.retryBackoffSeconds !== undefined ||
      body.nextRunAt !== undefined;

    if (!hasPatchField) {
      throw new BadRequestException('at least one schedule field must be set');
    }

    const nextRunAt = this.parseOptionalIsoDate(body.nextRunAt, 'nextRunAt');
    const schedule = await this.topologyScheduler.patchSchedule({
      organizationId,
      projectId: body.projectId,
      cadenceHours: body.cadenceHours,
      status: body.status,
      maxEntitiesPerRun: body.maxEntitiesPerRun,
      maxEntitiesPerSubfacet: body.maxEntitiesPerSubfacet,
      maxEntitiesPerSubfacetSummary: body.maxEntitiesPerSubfacetSummary,
      maxPerCategory: body.maxPerCategory,
      maxPerSubfacet: body.maxPerSubfacet,
      threshold: body.threshold,
      maxIterations: body.maxIterations,
      retryMaxAttempts: body.retryMaxAttempts,
      retryBackoffSeconds: body.retryBackoffSeconds,
      nextRunAt,
    });

    return this.mapScheduleToResponse(schedule);
  }

  @Get('schedule')
  @ApiOperation({
    summary:
      'Get scheduled topology consolidation config for an organization/project',
  })
  async getSchedule(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId: ProjectId,
  ) {
    const organizationId =
      organizationIdFromParams ?? user?.currentOrgId ?? undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }

    const schedule = await this.topologyScheduler.getSchedule(
      organizationId,
      projectId,
    );
    if (!schedule) {
      return null;
    }

    return this.mapScheduleToResponse(schedule);
  }

  @Get('schedule/runs')
  @ApiOperation({
    summary: 'List recent scheduled topology consolidation runs',
  })
  async listScheduleRuns(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId: ProjectId,
    @Query('limit') limit?: string,
  ) {
    const organizationId =
      organizationIdFromParams ?? user?.currentOrgId ?? undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }

    const parsedLimit =
      limit && !Number.isNaN(Number(limit)) ? Number(limit) : undefined;
    const runs = await this.topologyScheduler.listRuns({
      organizationId,
      projectId,
      limit: parsedLimit,
    });

    return runs.map((run) => ({
      ...run,
      since: run.since.toISOString(),
      until: run.until.toISOString(),
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString(),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    }));
  }

  @Get('subfacet-candidates')
  @ApiOperation({
    summary:
      'List pending subfacet candidates observed from entity summarization proposals',
  })
  @ApiQuery({
    name: 'projectId',
    required: true,
    description: 'Project id for candidate listing',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['technology', 'product', 'process', 'people'],
    description: 'Optional category filter',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Max candidate rows to return (default 100, max 500)',
  })
  @ApiQuery({
    name: 'includePromoted',
    required: false,
    description: 'Include already promoted candidates (default false)',
  })
  async listSubfacetCandidates(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId: ProjectId,
    @Query('category') category?: SummaryCategory,
    @Query('limit') limit?: string,
    @Query('includePromoted') includePromoted?: string,
  ) {
    const organizationId =
      organizationIdFromParams ?? user?.currentOrgId ?? undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }

    const parsedLimit =
      limit && !Number.isNaN(Number(limit)) ? Number(limit) : undefined;
    const candidates = await this.subfacetCandidateService.listCandidates({
      organizationId,
      projectId,
      category,
      limit: parsedLimit,
      includePromoted:
        typeof includePromoted === 'string'
          ? includePromoted.toLowerCase() === 'true'
          : false,
    });

    return candidates.map((candidate) => ({
      id: candidate.id,
      organizationId: candidate.organizationId,
      projectId: candidate.projectId,
      category: candidate.category,
      name: candidate.name,
      normalizedSlug: candidate.normalizedSlug,
      proposalCount: candidate.proposalCount,
      latestConfidence: candidate.latestConfidence ?? undefined,
      latestRationale: candidate.latestRationale ?? undefined,
      lastSourceEntityType: candidate.lastSourceEntityType ?? undefined,
      lastSourceEntityId: candidate.lastSourceEntityId ?? undefined,
      firstSeenAt: candidate.firstSeenAt.toISOString(),
      lastSeenAt: candidate.lastSeenAt.toISOString(),
      promotedAt: candidate.promotedAt?.toISOString(),
      promotedSubfacetId: candidate.promotedSubfacetId ?? undefined,
      createdAt: candidate.createdAt.toISOString(),
      updatedAt: candidate.updatedAt.toISOString(),
    }));
  }

  @Get('lifecycle-summary')
  @ApiOperation({
    summary:
      'Get subfacet lifecycle summary by category with promotion indicators',
  })
  @ApiQuery({
    name: 'projectId',
    required: true,
    description: 'Project id for lifecycle summary',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['technology', 'product', 'process', 'people'],
    description: 'Optional single category filter',
  })
  async getSubfacetLifecycleSummary(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId: ProjectId,
    @Query('category') category?: SummaryCategory,
  ) {
    const organizationId =
      organizationIdFromParams ?? user?.currentOrgId ?? undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }
    if (
      category &&
      !Object.values(SummaryCategory).includes(category as SummaryCategory)
    ) {
      throw new BadRequestException(
        `category must be one of ${Object.values(SummaryCategory).join(', ')}`,
      );
    }

    const where = {
      organizationId,
      projectId,
      ...(category ? { category } : {}),
    } satisfies Prisma.SubfacetWhereInput;

    const [subfacets, promotableCandidates] = await Promise.all([
      this.prisma.db.subfacet.findMany({
        where,
        select: {
          id: true,
          name: true,
          category: true,
          status: true,
          survivalCount: true,
          lastSeenInConsolidationAt: true,
        },
      }),
      this.prisma.db.topologySubfacetCandidate.findMany({
        where: {
          organizationId,
          projectId,
          promotedAt: null,
          ...(category ? { category } : {}),
        },
        orderBy: [{ proposalCount: 'desc' }, { lastSeenAt: 'desc' }],
        take: 50,
        select: {
          id: true,
          category: true,
          name: true,
          proposalCount: true,
          lastSeenAt: true,
        },
      }),
    ]);

    const countsByCategory = subfacets.reduce<
      Record<
        SummaryCategory,
        { ACTIVE: number; PROVISIONAL: number; DEPRECATED: number }
      >
    >(
      (acc, subfacet) => {
        if (!acc[subfacet.category]) {
          acc[subfacet.category] = {
            ACTIVE: 0,
            PROVISIONAL: 0,
            DEPRECATED: 0,
          };
        }
        acc[subfacet.category][subfacet.status] += 1;
        return acc;
      },
      {
        [SummaryCategory.technology]: {
          ACTIVE: 0,
          PROVISIONAL: 0,
          DEPRECATED: 0,
        },
        [SummaryCategory.product]: { ACTIVE: 0, PROVISIONAL: 0, DEPRECATED: 0 },
        [SummaryCategory.process]: { ACTIVE: 0, PROVISIONAL: 0, DEPRECATED: 0 },
        [SummaryCategory.people]: { ACTIVE: 0, PROVISIONAL: 0, DEPRECATED: 0 },
      },
    );

    const nearPromotionProvisionals = subfacets
      .filter(
        (subfacet) =>
          subfacet.status === SubfacetStatus.PROVISIONAL &&
          subfacet.survivalCount >= 2 &&
          subfacet.survivalCount < 3,
      )
      .sort((a, b) => b.survivalCount - a.survivalCount)
      .slice(0, 50)
      .map((subfacet) => ({
        id: subfacet.id,
        name: subfacet.name,
        category: subfacet.category,
        survivalCount: subfacet.survivalCount,
        lastSeenInConsolidationAt:
          subfacet.lastSeenInConsolidationAt?.toISOString(),
      }));

    return {
      organizationId,
      projectId,
      countsByCategory,
      nearPromotionProvisionals,
      promotableCandidates: promotableCandidates.map((candidate) => ({
        id: candidate.id,
        category: candidate.category,
        name: candidate.name,
        proposalCount: candidate.proposalCount,
        lastSeenAt: candidate.lastSeenAt.toISOString(),
      })),
    };
  }

  @Post('schedule/run-now')
  @ApiOperation({
    summary:
      'Force next scheduled topology consolidation run to execute immediately',
  })
  async triggerScheduleNow(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: TriggerTopologyScheduleDto,
  ) {
    const organizationId =
      body.organizationId ??
      organizationIdFromParams ??
      user?.currentOrgId ??
      undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }

    const schedule = await this.topologyScheduler.triggerNow(
      organizationId,
      body.projectId,
    );

    return this.mapScheduleToResponse(schedule);
  }

  @Post('entity-validation/run')
  @ApiOperation({
    summary:
      'Validate that all entities in a project have subfacets referencing active subfacets',
  })
  async runEntityValidation(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartEntityValidationDto,
    @AuthToken() userToken: string | null,
  ): Promise<{
    organizationId: OrganizationId;
    projectId: ProjectId;
    activeSubfacets: number;
    entitySubfacets: number;
    invalidEntitySubfacets: number;
    entitiesMissingValidSubfacet: number;
    graphComparison: {
      subfacetsMissingInGraph: number;
      subfacetsExtraInGraph: number;
      entityMismatches: number;
      samples: {
        subfacetsMissingInGraph: Array<{
          category: string;
          subfacet: string;
        }>;
        subfacetsExtraInGraph: Array<{
          category: string;
          subfacet: string;
        }>;
        entitiesMissingInGraph: Array<{
          category: string;
          subfacet: string;
          entityType: EntityType;
          entityId: string;
        }>;
        entitiesExtraInGraph: Array<{
          category: string;
          subfacet: string;
          entityType: EntityType;
          entityId: string;
        }>;
      };
    };
    samples: {
      invalidEntitySubfacets: Array<{
        entityType: EntityType;
        entityId: string;
        subfacetId: string;
      }>;
      entitiesMissingValidSubfacet: Array<{
        entityType: EntityType;
        entityId: string;
      }>;
    };
  }> {
    const organizationId =
      body.organizationId ??
      organizationIdFromParams ??
      user?.currentOrgId ??
      undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }
    if (!userToken) {
      throw new BadRequestException(
        'user token is required to validate against graph service',
      );
    }
    const projectId = body.projectId;
    const maxSamples = Math.max(body.maxSamples ?? 50, 0);

    const activeSubfacets = await this.prisma.db.subfacet.findMany({
      where: {
        organizationId,
        projectId,
        status: SubfacetStatus.ACTIVE,
      },
      select: { id: true, name: true, category: true },
    });
    const activeSubfacetIds = new Set<SubfacetId>(
      activeSubfacets.map((subfacet) => subfacet.id as SubfacetId),
    );
    const activeSubfacetById = new Map<
      SubfacetId,
      { name: string; category: SummaryCategory }
    >(
      activeSubfacets.map((subfacet) => [
        subfacet.id as SubfacetId,
        { name: subfacet.name, category: subfacet.category },
      ]),
    );

    const entitySubfacets = await this.prisma.db.entitySubfacet.findMany({
      where: {
        organizationId,
        projectId,
        summary: { isCurrent: true },
      },
      select: { entityType: true, entityId: true, subfacetId: true },
    });

    const [activeTaskIds, activeInitiativeIds, activeDesignDocIds] =
      await Promise.all([
        this.prisma.db.task.findMany({
          where: {
            organizationId,
            archivedAt: null,
            OR: [{ projectId }, { projectRelations: { some: { projectId } } }],
          },
          select: { id: true },
        }),
        this.prisma.db.initiative.findMany({
          where: {
            organizationId,
            archivedAt: null,
            OR: [
              { projects: { some: { projectId } } },
              { originatingProjectId: projectId },
            ],
          },
          select: { id: true },
        }),
        this.prisma.db.designDoc.findMany({
          where: {
            organizationId,
            projectId,
            archivedAt: null,
          },
          select: { id: true },
        }),
      ]);

    const activeTaskIdSet = new Set(activeTaskIds.map((task) => task.id));
    const activeInitiativeIdSet = new Set(
      activeInitiativeIds.map((initiative) => initiative.id),
    );
    const activeDesignDocIdSet = new Set(
      activeDesignDocIds.map((doc) => doc.id),
    );

    const isActiveEntity = (entityType: EntityType, entityId: string) => {
      if (entityType === EntityType.TASK) {
        return activeTaskIdSet.has(entityId as TaskId);
      }
      if (entityType === EntityType.INITIATIVE) {
        return activeInitiativeIdSet.has(entityId as InitiativeId);
      }
      if (entityType === EntityType.DESIGN_DOC) {
        return activeDesignDocIdSet.has(entityId as DesignDocId);
      }
      return false;
    };

    const invalidEntitySubfacets: Array<{
      entityType: EntityType;
      entityId: string;
      subfacetId: string;
    }> = [];
    const entitiesWithValidSubfacets = new Set<string>();
    const localEntitiesBySubfacet = new Map<string, Set<string>>();

    const buildSubfacetKey = (category: SummaryCategory, name: string) =>
      `${category}::${name}`;

    for (const subfacet of activeSubfacets) {
      const key = buildSubfacetKey(subfacet.category, subfacet.name);
      if (!localEntitiesBySubfacet.has(key)) {
        localEntitiesBySubfacet.set(key, new Set());
      }
    }

    for (const entitySubfacet of entitySubfacets) {
      if (!isActiveEntity(entitySubfacet.entityType, entitySubfacet.entityId)) {
        continue;
      }

      const subfacetId = entitySubfacet.subfacetId as SubfacetId;
      if (!activeSubfacetIds.has(subfacetId)) {
        invalidEntitySubfacets.push({
          entityType: entitySubfacet.entityType,
          entityId: entitySubfacet.entityId,
          subfacetId: entitySubfacet.subfacetId,
        });
        continue;
      }

      const entityKey = `${entitySubfacet.entityType}:${entitySubfacet.entityId}`;
      entitiesWithValidSubfacets.add(entityKey);

      const subfacetInfo = activeSubfacetById.get(subfacetId);
      if (!subfacetInfo) {
        continue;
      }

      const subfacetKey = buildSubfacetKey(
        subfacetInfo.category,
        subfacetInfo.name,
      );
      const existing = localEntitiesBySubfacet.get(subfacetKey);
      if (existing) {
        existing.add(entityKey);
      } else {
        localEntitiesBySubfacet.set(subfacetKey, new Set([entityKey]));
      }
    }

    const entitySummaries = await this.prisma.db.entitySummary.findMany({
      where: { organizationId, projectId, isCurrent: true },
      select: { entityType: true, entityId: true },
    });

    const entityKeys = new Set<string>();
    const entities: Array<{ entityType: EntityType; entityId: string }> = [];
    for (const entity of entitySummaries) {
      if (!isActiveEntity(entity.entityType, entity.entityId)) {
        continue;
      }
      const key = `${entity.entityType}:${entity.entityId}`;
      if (!entityKeys.has(key)) {
        entityKeys.add(key);
        entities.push(entity);
      }
    }

    const entitiesMissingValidSubfacet = entities.filter((entity) => {
      const key = `${entity.entityType}:${entity.entityId}`;
      return !entitiesWithValidSubfacets.has(key);
    });

    const graphTopology = await this.graphsClientService.getTopologyGraph(
      organizationId,
      projectId,
      userToken,
    );

    const graphEntitiesBySubfacet = new Map<string, Set<string>>();

    for (const category of graphTopology.categories) {
      for (const subfacet of category.subfacets) {
        const subfacetKey = `${category.name}::${subfacet.name}`;
        const existing =
          graphEntitiesBySubfacet.get(subfacetKey) ?? new Set<string>();
        for (const entity of subfacet.entities) {
          if (
            entity.type !== EntityType.TASK &&
            entity.type !== EntityType.INITIATIVE &&
            entity.type !== EntityType.DESIGN_DOC
          ) {
            continue;
          }
          if (!isActiveEntity(entity.type as EntityType, entity.id)) {
            continue;
          }
          existing.add(`${entity.type}:${entity.id}`);
        }
        graphEntitiesBySubfacet.set(subfacetKey, existing);
      }
    }

    let subfacetsMissingInGraphCount = 0;
    let subfacetsExtraInGraphCount = 0;
    let entityMismatches = 0;

    const subfacetsMissingInGraph: Array<{
      category: string;
      subfacet: string;
    }> = [];
    const subfacetsExtraInGraph: Array<{
      category: string;
      subfacet: string;
    }> = [];
    const entitiesMissingInGraph: Array<{
      category: string;
      subfacet: string;
      entityType: EntityType;
      entityId: string;
    }> = [];
    const entitiesExtraInGraph: Array<{
      category: string;
      subfacet: string;
      entityType: EntityType;
      entityId: string;
    }> = [];

    const localSubfacetKeys = new Set(localEntitiesBySubfacet.keys());
    const graphSubfacetKeys = new Set(graphEntitiesBySubfacet.keys());

    for (const key of localSubfacetKeys) {
      if (!graphSubfacetKeys.has(key)) {
        subfacetsMissingInGraphCount += 1;
        if (subfacetsMissingInGraph.length < maxSamples) {
          const [category, subfacet] = key.split('::');
          if (!category || !subfacet) {
            continue;
          }
          subfacetsMissingInGraph.push({ category, subfacet });
        }
      }
    }

    for (const key of graphSubfacetKeys) {
      if (!localSubfacetKeys.has(key)) {
        subfacetsExtraInGraphCount += 1;
        if (subfacetsExtraInGraph.length < maxSamples) {
          const [category, subfacet] = key.split('::');
          if (!category || !subfacet) {
            continue;
          }
          subfacetsExtraInGraph.push({ category, subfacet });
        }
      }
    }

    for (const key of localSubfacetKeys) {
      const localEntities = localEntitiesBySubfacet.get(key);
      const graphEntities = graphEntitiesBySubfacet.get(key);
      if (!localEntities || !graphEntities) {
        continue;
      }

      for (const entityKey of localEntities) {
        if (!graphEntities.has(entityKey)) {
          entityMismatches += 1;
          if (entitiesMissingInGraph.length < maxSamples) {
            const [category, subfacet] = key.split('::');
            const [entityType, entityId] = entityKey.split(':');
            if (!category || !subfacet || !entityType || !entityId) {
              continue;
            }
            entitiesMissingInGraph.push({
              category,
              subfacet,
              entityType: entityType as EntityType,
              entityId,
            });
          }
        }
      }

      for (const entityKey of graphEntities) {
        if (!localEntities.has(entityKey)) {
          entityMismatches += 1;
          if (entitiesExtraInGraph.length < maxSamples) {
            const [category, subfacet] = key.split('::');
            const [entityType, entityId] = entityKey.split(':');
            if (!category || !subfacet || !entityType || !entityId) {
              continue;
            }
            entitiesExtraInGraph.push({
              category,
              subfacet,
              entityType: entityType as EntityType,
              entityId,
            });
          }
        }
      }
    }

    return {
      organizationId,
      projectId,
      activeSubfacets: activeSubfacets.length,
      entitySubfacets: entitySubfacets.length,
      invalidEntitySubfacets: invalidEntitySubfacets.length,
      entitiesMissingValidSubfacet: entitiesMissingValidSubfacet.length,
      graphComparison: {
        subfacetsMissingInGraph: subfacetsMissingInGraphCount,
        subfacetsExtraInGraph: subfacetsExtraInGraphCount,
        entityMismatches,
        samples: {
          subfacetsMissingInGraph,
          subfacetsExtraInGraph,
          entitiesMissingInGraph,
          entitiesExtraInGraph,
        },
      },
      samples: {
        invalidEntitySubfacets: invalidEntitySubfacets.slice(0, maxSamples),
        entitiesMissingValidSubfacet: entitiesMissingValidSubfacet.slice(
          0,
          maxSamples,
        ),
      },
    };
  }
}

type TopologyJsonBlob =
  TopologySubfacetConsolidationRunDto['accumulatedSnapshot'];

@ApiTags('Topology')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/projects/:projectId/topology')
export class TopologyQueryController {
  private readonly logger = new Logger(TopologyQueryController.name);

  constructor(
    private readonly entitySummaryService: EntitySummaryService,
    private readonly subfacetService: SubfacetService,
    private readonly categorySummaryService: TopologyCategorySummaryService,
    private readonly auditService: TopologyAuditService,
    private readonly graphsClientService: GraphsClientService,
  ) {}

  @Get('entity-summaries')
  @ApiOperation({
    summary: 'List entity topology summaries',
    description:
      'Returns current entity summaries for topology navigation with optional filters.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: Object.values(SummaryCategory),
    description: 'Filter to a single topology category',
  })
  @ApiQuery({
    name: 'subfacetId',
    required: false,
    type: String,
    isArray: true,
    description: 'Filter summaries to specific subfacet ids (comma-separated)',
  })
  @ApiQuery({
    name: 'entities',
    required: false,
    type: String,
    isArray: true,
    description:
      'Filter summaries to specific entities formatted as ENTITY_TYPE:ENTITY_ID (comma-separated)',
  })
  @ApiQuery({
    name: 'since',
    required: false,
    description: 'Return summaries updated since this ISO timestamp',
    example: '2025-01-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'limitPerSubfacet',
    required: false,
    type: Number,
    description: 'Maximum summaries per subfacet (min 1)',
  })
  async listEntitySummaries(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('category') category?: string,
    @Query(
      'subfacetId',
      new ParseArrayPipe({
        items: String,
        separator: ',',
        optional: true,
      }),
    )
    subfacetIds?: string[],
    @Query(
      'entities',
      new ParseArrayPipe({
        items: String,
        separator: ',',
        optional: true,
      }),
    )
    entities?: string[],
    @Query('since') since?: string,
    @Query('limitPerSubfacet') limitPerSubfacet?: string,
  ): Promise<TopologyEntitySummaryDto[]> {
    const organizationId = this.resolveOrganizationId(
      organizationIdFromParams,
      user,
    );
    const resolvedProjectId = this.resolveProjectId(projectId);
    const parsedCategory = this.parseCategory(category);
    const parsedSubfacetIds = this.parseSubfacetIds(subfacetIds);
    const parsedEntities = this.parseEntityFilters(entities);
    const parsedSince = this.parseIsoDate(since, 'since');
    const parsedLimit = this.parsePositiveNumber(
      limitPerSubfacet,
      'limitPerSubfacet',
    );

    this.logger.debug('[listEntitySummaries] request', {
      organizationId,
      projectId: resolvedProjectId,
      category: parsedCategory,
      subfacetIds: parsedSubfacetIds,
      entities: parsedEntities,
      since: parsedSince?.toISOString(),
      limitPerSubfacet: parsedLimit,
    });

    const summaries =
      await this.entitySummaryService.getCurrentSummariesByCategory({
        organizationId,
        projectId: resolvedProjectId,
        ...(parsedCategory ? { category: parsedCategory } : {}),
        ...(parsedSubfacetIds ? { subfacetIds: parsedSubfacetIds } : {}),
        ...(parsedEntities ? { entities: parsedEntities } : {}),
        ...(parsedSince ? { since: parsedSince } : {}),
        ...(parsedLimit ? { limitPerSubfacet: parsedLimit } : {}),
      });

    return summaries.map((summary) => ({
      ...summary,
      updatedAt: summary.updatedAt.toISOString(),
      subfacets: summary.subfacets.map((subfacet) => ({
        ...subfacet,
        updatedAt: subfacet.updatedAt.toISOString(),
      })),
    }));
  }

  @Get('graph-topology')
  @ApiOperation({
    summary: 'Proxy topology graph response from the graph service',
    description:
      'Returns the raw topology graph response for the organization/project.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  async getGraphTopology(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @AuthToken() userToken: string | null,
  ): Promise<TopologyGraphResponse> {
    const organizationId = this.resolveOrganizationId(
      organizationIdFromParams,
      user,
    );
    const resolvedProjectId = this.resolveProjectId(projectId);

    return this.graphsClientService.getTopologyGraph(
      organizationId,
      resolvedProjectId,
      userToken,
    );
  }

  @Get('entity-graph')
  @ApiOperation({
    summary: 'Get topology graph neighborhood for an entity',
    description:
      'Returns graph relationships for one seed entity up to the requested traversal depth.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'entityId',
    required: true,
    type: String,
    description: 'Seed entity identifier for traversal',
  })
  @ApiQuery({
    name: 'depth',
    required: true,
    type: Number,
    description: 'Maximum traversal depth from the seed entity (minimum 0)',
  })
  async getEntityGraph(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('entityId') entityId?: string,
    @Query('depth') depth?: string,
    @AuthToken() userToken?: string | null,
  ): Promise<UnifiedGraphSearchResponse> {
    const organizationId = this.resolveOrganizationId(
      organizationIdFromParams,
      user,
    );
    const resolvedProjectId = this.resolveProjectId(projectId);
    const parsedDepth = this.parseNonNegativeInteger(depth, 'depth');

    if (!entityId?.trim()) {
      throw new BadRequestException('entityId is required');
    }

    const response = await this.graphsClientService.getEntityGraph(
      organizationId,
      resolvedProjectId,
      entityId,
      parsedDepth,
      userToken ?? null,
    );
    type UnifiedGraphResult = NonNullable<
      UnifiedGraphSearchResponse['results']
    >[number];

    return {
      results: response.results?.map((item) => ({
        node: item.node as Record<string, unknown> | undefined,
        entityId: item.entityId,
        entityType: item.entityType as UnifiedGraphResult['entityType'],
        score: item.score,
        scoreBreakdown:
          item.scoreBreakdown as UnifiedGraphResult['scoreBreakdown'],
        path: item.path as UnifiedGraphResult['path'],
        pathCount: item.pathCount,
      })),
      totalElements: response.totalElements,
      totalPages: response.totalPages,
      page: response.page,
      size: response.size,
      relationships:
        response.relationships as UnifiedGraphSearchResponse['relationships'],
    };
  }

  @Get('subfacets')
  @ApiOperation({
    summary: 'List topology subfacets',
    description: 'Returns subfacet definitions with optional category filters.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: Object.values(SummaryCategory),
    description: 'Filter to a single topology category',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: Object.values(SubfacetStatus),
    description: 'Filter by subfacet status (defaults to ACTIVE)',
  })
  async listSubfacets(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
  ): Promise<TopologySubfacetDto[]> {
    const organizationId = this.resolveOrganizationId(
      organizationIdFromParams,
      user,
    );
    const resolvedProjectId = this.resolveProjectId(projectId);
    const parsedCategory = this.parseCategory(category);
    const parsedStatus =
      this.parseSubfacetStatus(status) ?? SubfacetStatus.ACTIVE;

    this.logger.debug('[listSubfacets] request', {
      organizationId,
      projectId: resolvedProjectId,
      category: parsedCategory,
      status: parsedStatus,
    });

    const subfacets = await this.subfacetService.listSubfacets({
      organizationId,
      projectId: resolvedProjectId,
      ...(parsedCategory ? { category: parsedCategory } : {}),
      ...(parsedStatus ? { status: parsedStatus } : {}),
    });

    return subfacets.map((subfacet) => ({
      id: subfacet.id,
      name: subfacet.name,
      slug: subfacet.slug,
      category: subfacet.category,
      status: subfacet.status,
      summary: subfacet.summary ?? undefined,
      lastSummarizedAt: subfacet.lastSummarizedAt
        ? subfacet.lastSummarizedAt.toISOString()
        : undefined,
      createdAt: subfacet.createdAt.toISOString(),
      updatedAt: subfacet.updatedAt.toISOString(),
    }));
  }

  @Get('category-summaries')
  @ApiOperation({
    summary: 'List topology category summaries',
    description: 'Returns the latest consolidated summary per category.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: Object.values(SummaryCategory),
    description: 'Filter to a single topology category',
  })
  async listCategorySummaries(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('category') category?: string,
  ): Promise<TopologyCategorySummaryDto[]> {
    const organizationId = this.resolveOrganizationId(
      organizationIdFromParams,
      user,
    );
    const resolvedProjectId = this.resolveProjectId(projectId);
    const parsedCategory = this.parseCategory(category);

    this.logger.debug('[listCategorySummaries] request', {
      organizationId,
      projectId: resolvedProjectId,
      category: parsedCategory,
    });

    const summaries = await this.categorySummaryService.listSummaries({
      organizationId,
      projectId: resolvedProjectId,
      ...(parsedCategory ? { category: parsedCategory } : {}),
    });

    return summaries.map((summary) => ({
      ...summary,
      lastUpdated: summary.lastUpdated.toISOString(),
    }));
  }

  @Get('audits/subfacet')
  @ApiOperation({
    summary: 'List subfacet consolidation audit runs',
    description: 'Returns recent subfacet consolidation runs for a category.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: Object.values(SummaryCategory),
    description: 'Filter to a single topology category',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of runs to return (min 1)',
  })
  async listSubfacetAudits(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ): Promise<TopologySubfacetConsolidationRunDto[]> {
    const organizationId = this.resolveOrganizationId(
      organizationIdFromParams,
      user,
    );
    const resolvedProjectId = this.resolveProjectId(projectId);
    const parsedCategory = this.parseCategory(category);
    const parsedLimit = this.parsePositiveNumber(limit, 'limit');

    this.logger.debug('[listSubfacetAudits] request', {
      organizationId,
      projectId: resolvedProjectId,
      category: parsedCategory,
      limit: parsedLimit,
    });

    const audits = await this.auditService.listRecentRuns({
      organizationId,
      projectId: resolvedProjectId,
      ...(parsedCategory ? { category: parsedCategory } : {}),
      ...(parsedLimit ? { limit: parsedLimit } : {}),
    });

    return audits.map((audit) => ({
      id: audit.id,
      organizationId: audit.organizationId as OrganizationId,
      category: audit.category,
      since: audit.since.toISOString(),
      until: audit.until.toISOString(),
      thresholdApplied: audit.thresholdApplied,
      accumulatedSnapshot: this.requireTopologyJsonBlob(
        audit.accumulatedSnapshot,
        'accumulatedSnapshot',
      ),
      consolidatedBefore: audit.consolidatedBefore
        ? this.requireTopologyJsonBlob(
            audit.consolidatedBefore,
            'consolidatedBefore',
          )
        : undefined,
      consolidationResult: this.requireTopologyJsonBlob(
        audit.consolidationResult,
        'consolidationResult',
      ),
      createdAt: audit.createdAt.toISOString(),
    }));
  }

  @Get('audits/subfacet-summary')
  @ApiOperation({
    summary: 'List subfacet summarization audit runs',
    description:
      'Returns recent subfacet summarization runs for a category or specific subfacet.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: Object.values(SummaryCategory),
    description: 'Filter to a single topology category',
  })
  @ApiQuery({
    name: 'subfacetId',
    required: false,
    type: String,
    description: 'Filter to a specific subfacet by id',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of runs to return (min 1)',
  })
  async listSubfacetSummaryAudits(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('category') category?: string,
    @Query('subfacetId') subfacetId?: string,
    @Query('limit') limit?: string,
  ): Promise<TopologySubfacetSummarizationRunDto[]> {
    const organizationId = this.resolveOrganizationId(
      organizationIdFromParams,
      user,
    );
    const resolvedProjectId = this.resolveProjectId(projectId);
    const parsedCategory = this.parseCategory(category);
    const parsedLimit = this.parsePositiveNumber(limit, 'limit');

    this.logger.debug('[listSubfacetSummaryAudits] request', {
      organizationId,
      projectId: resolvedProjectId,
      category: parsedCategory,
      subfacetId,
      limit: parsedLimit,
    });

    const audits = await this.auditService.listRecentSubfacetSummaryRuns({
      organizationId,
      projectId: resolvedProjectId,
      ...(parsedCategory ? { category: parsedCategory } : {}),
      ...(subfacetId ? { subfacetId } : {}),
      ...(parsedLimit ? { limit: parsedLimit } : {}),
    });

    return audits.map((audit) => ({
      id: audit.id,
      organizationId: audit.organizationId as OrganizationId,
      category: audit.category,
      subfacetId: audit.subfacetId,
      since: audit.since.toISOString(),
      until: audit.until.toISOString(),
      thresholdApplied: audit.thresholdApplied,
      accumulatedSnapshot: this.requireTopologyJsonBlob(
        audit.accumulatedSnapshot,
        'accumulatedSnapshot',
      ),
      consolidatedBefore: audit.consolidatedBefore
        ? this.requireTopologyJsonBlob(
            audit.consolidatedBefore,
            'consolidatedBefore',
          )
        : undefined,
      consolidationResult: this.requireTopologyJsonBlob(
        audit.consolidationResult,
        'consolidationResult',
      ),
      createdAt: audit.createdAt.toISOString(),
    }));
  }

  @Get('audits/category')
  @ApiOperation({
    summary: 'List category consolidation audit runs',
    description: 'Returns recent category consolidation runs for a category.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: Object.values(SummaryCategory),
    description: 'Filter to a single topology category',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of runs to return (min 1)',
  })
  async listCategoryAudits(
    @CurrentOrganization() organizationIdFromParams: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ): Promise<TopologyCategorySummarizationRunDto[]> {
    const organizationId = this.resolveOrganizationId(
      organizationIdFromParams,
      user,
    );
    const resolvedProjectId = this.resolveProjectId(projectId);
    const parsedCategory = this.parseCategory(category);
    const parsedLimit = this.parsePositiveNumber(limit, 'limit');

    this.logger.debug('[listCategoryAudits] request', {
      organizationId,
      projectId: resolvedProjectId,
      category: parsedCategory,
      limit: parsedLimit,
    });

    const audits = await this.auditService.listRecentCategoryRuns({
      organizationId,
      projectId: resolvedProjectId,
      ...(parsedCategory ? { category: parsedCategory } : {}),
      ...(parsedLimit ? { limit: parsedLimit } : {}),
    });

    return audits.map((audit) => ({
      id: audit.id,
      organizationId: audit.organizationId as OrganizationId,
      category: audit.category,
      since: audit.since.toISOString(),
      until: audit.until.toISOString(),
      thresholdApplied: audit.thresholdApplied,
      accumulatedSnapshot: this.requireTopologyJsonBlob(
        audit.accumulatedSnapshot,
        'accumulatedSnapshot',
      ),
      consolidatedBefore: audit.consolidatedBefore
        ? this.requireTopologyJsonBlob(
            audit.consolidatedBefore,
            'consolidatedBefore',
          )
        : undefined,
      consolidationResult: this.requireTopologyJsonBlob(
        audit.consolidationResult,
        'consolidationResult',
      ),
      createdAt: audit.createdAt.toISOString(),
    }));
  }

  private resolveOrganizationId(
    organizationIdFromParams: OrganizationId | undefined,
    user: AuthenticatedUser,
  ): OrganizationId {
    const organizationId =
      organizationIdFromParams ?? user?.currentOrgId ?? undefined;

    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    return organizationId;
  }

  private resolveProjectId(projectId?: string): ProjectId {
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }

    return projectId as ProjectId;
  }

  private parseCategory(category?: string): SummaryCategory | undefined {
    if (!category) {
      return undefined;
    }

    if (!Object.values(SummaryCategory).includes(category as SummaryCategory)) {
      throw new BadRequestException(
        `category must be one of ${Object.values(SummaryCategory).join(', ')}`,
      );
    }

    return category as SummaryCategory;
  }

  private parseSubfacetStatus(status?: string): SubfacetStatus | undefined {
    if (!status) {
      return undefined;
    }

    if (!Object.values(SubfacetStatus).includes(status as SubfacetStatus)) {
      throw new BadRequestException(
        `status must be one of ${Object.values(SubfacetStatus).join(', ')}`,
      );
    }

    return status as SubfacetStatus;
  }

  private parseSubfacetIds(
    subfacetIds?: string[] | string,
  ): string[] | undefined {
    if (!subfacetIds) {
      return undefined;
    }

    const ids = Array.isArray(subfacetIds) ? subfacetIds : [subfacetIds];

    if (ids.length === 0) {
      return undefined;
    }

    const normalized = ids.map((id) => id.trim());
    if (normalized.some((id) => !id)) {
      throw new BadRequestException('subfacetId must be non-empty');
    }

    return normalized;
  }

  private parseEntityFilters(
    entities?: string[] | string,
  ): Array<{ entityType: EntityType; entityId: string }> | undefined {
    if (!entities) {
      return undefined;
    }

    const values = Array.isArray(entities) ? entities : [entities];
    if (values.length === 0) {
      return undefined;
    }

    const parsed = new Map<
      string,
      { entityType: EntityType; entityId: string }
    >();

    for (const value of values) {
      const trimmed = value.trim();
      if (!trimmed) {
        throw new BadRequestException('entities must be non-empty');
      }

      const parts = trimmed.split(':');
      if (parts.length !== 2) {
        throw new BadRequestException(
          'entities must be formatted as ENTITY_TYPE:ENTITY_ID',
        );
      }

      const entityTypeRaw = parts[0] ?? '';
      const entityIdRaw = parts[1] ?? '';
      const entityType = entityTypeRaw.trim();
      const entityId = entityIdRaw.trim();

      if (!entityType || !entityId) {
        throw new BadRequestException(
          'entities must be formatted as ENTITY_TYPE:ENTITY_ID',
        );
      }

      if (!Object.values(EntityType).includes(entityType as EntityType)) {
        throw new BadRequestException(
          `entities must use valid entity types: ${Object.values(EntityType).join(', ')}`,
        );
      }

      const key = `${entityType}:${entityId}`;
      if (!parsed.has(key)) {
        parsed.set(key, { entityType: entityType as EntityType, entityId });
      }
    }

    return parsed.size ? Array.from(parsed.values()) : undefined;
  }

  private parseIsoDate(
    value: string | undefined,
    field: string,
  ): Date | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO date string`);
    }

    return parsed;
  }

  private parsePositiveNumber(
    value: string | undefined,
    field: string,
  ): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException(`${field} must be a positive number`);
    }

    return parsed;
  }

  private parseNonNegativeInteger(
    value: string | undefined,
    field: string,
  ): number {
    if (!value) {
      throw new BadRequestException(`${field} is required`);
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer`);
    }

    return parsed;
  }

  private requireTopologyJsonBlob(
    value: Prisma.JsonValue,
    field: string,
  ): TopologyJsonBlob {
    if (Array.isArray(value)) {
      return value as TopologyJsonBlob;
    }
    if (value && typeof value === 'object') {
      return value as TopologyJsonBlob;
    }
    throw new BadRequestException(
      `Invalid ${field} payload: expected object or array`,
    );
  }
}
