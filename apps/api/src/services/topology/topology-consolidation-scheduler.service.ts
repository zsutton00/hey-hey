import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Client } from '@temporalio/client';
import {
  EntityType,
  Prisma,
  SubfacetStatus,
  SummaryCategory,
  TopologyConsolidationEntityStatus,
  TopologyConsolidationRunStatus,
  TopologyConsolidationSchedule,
  TopologyConsolidationScheduleStatus,
} from '@prisma/client';
import { InjectTemporalClient } from 'src/prisma/temporal.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId, WorkflowId } from 'src/types';
import {
  TopologyScheduledConsolidationWorkflowInput,
  TopologyScheduledConsolidationWorkflowResult,
} from './consolidation.types';
import { SubfacetCandidateService } from '../entity-summary/subfacet-candidate.service';
import { SubfacetService } from '../entity-summary/subfacet.service';
import {
  ACTIVE_CAP_PER_CATEGORY,
  PROMOTE_CANDIDATES_PER_RUN_PER_CATEGORY,
  canPromoteCandidate,
} from '../entity-summary/subfacet-lifecycle.policy';

type ChangedEntity = {
  organizationId: string;
  projectId: ProjectId;
  entityType: EntityType;
  entityId: string;
  summaryId: string;
  updatedAt: Date;
};

@Injectable()
export class TopologyConsolidationSchedulerService {
  private readonly logger = new Logger(
    TopologyConsolidationSchedulerService.name,
  );
  private readonly activeSchedules = new Set<string>();
  private readonly defaultCadenceHours = 24;
  private readonly scheduleLeaseMs = 60 * 60 * 1000;
  private readonly maxDueSchedulesPerTick = 20;

  constructor(
    private readonly prisma: PrismaService,
    @InjectTemporalClient() private readonly temporalClient: Client,
    private readonly subfacetService: SubfacetService,
    private readonly subfacetCandidateService: SubfacetCandidateService,
  ) {}

  onModuleInit(): void {
    this.logger.log('[scheduler] initialized', {
      cron: CronExpression.EVERY_MINUTE,
      defaultCadenceHours: this.defaultCadenceHours,
      maxDueSchedulesPerTick: this.maxDueSchedulesPerTick,
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async runDueSchedules(): Promise<void> {
    if (process.env.DISABLE_TOPOLOGY_CRON === 'true') {
      return;
    }

    const now = new Date();
    this.logger.log('[runDueSchedules] scanning for due schedules', {
      now: now.toISOString(),
      maxDueSchedulesPerTick: this.maxDueSchedulesPerTick,
      inProcessScheduleCount: this.activeSchedules.size,
    });

    const due = await this.prisma.db.topologyConsolidationSchedule.findMany({
      where: {
        status: TopologyConsolidationScheduleStatus.ACTIVE,
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      orderBy: [{ nextRunAt: 'asc' }, { updatedAt: 'asc' }],
      take: this.maxDueSchedulesPerTick,
    });
    this.logger.debug('[runDueSchedules] due schedules loaded', {
      dueCount: due.length,
      dueScheduleIds: due.map((schedule) => schedule.id),
    });

    for (const schedule of due) {
      if (this.activeSchedules.has(schedule.id)) {
        this.logger.debug(
          '[runDueSchedules] skipping already in-process schedule',
          {
            scheduleId: schedule.id,
          },
        );
        continue;
      }
      this.activeSchedules.add(schedule.id);
      this.logger.debug('[runDueSchedules] dispatching due schedule', {
        scheduleId: schedule.id,
        organizationId: schedule.organizationId,
        projectId: schedule.projectId,
        cadenceHours: schedule.cadenceHours,
        nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
      });
      void this.executeDueSchedule(schedule.id).finally(() => {
        this.activeSchedules.delete(schedule.id);
        this.logger.debug(
          '[runDueSchedules] schedule execution slot released',
          {
            scheduleId: schedule.id,
          },
        );
      });
    }
  }

  async getSchedule(
    organizationId: string,
    projectId: ProjectId,
  ): Promise<TopologyConsolidationSchedule | null> {
    return this.prisma.db.topologyConsolidationSchedule.findUnique({
      where: {
        organizationId_projectId: {
          organizationId,
          projectId,
        },
      },
    });
  }

  async upsertSchedule(params: {
    organizationId: string;
    projectId: ProjectId;
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
  }): Promise<TopologyConsolidationSchedule> {
    const cadenceHours = Math.max(
      params.cadenceHours ?? this.defaultCadenceHours,
      1,
    );
    const nextRunAt = this.computeNextRunAt(new Date(), cadenceHours);

    return this.prisma.db.topologyConsolidationSchedule.upsert({
      where: {
        organizationId_projectId: {
          organizationId: params.organizationId,
          projectId: params.projectId,
        },
      },
      create: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        cadenceHours,
        status: params.status ?? TopologyConsolidationScheduleStatus.ACTIVE,
        maxEntitiesPerRun: params.maxEntitiesPerRun,
        maxEntitiesPerSubfacet: params.maxEntitiesPerSubfacet,
        maxEntitiesPerSubfacetSummary: params.maxEntitiesPerSubfacetSummary,
        maxPerCategory: params.maxPerCategory,
        maxPerSubfacet: params.maxPerSubfacet,
        threshold: params.threshold,
        maxIterations: params.maxIterations,
        retryMaxAttempts: params.retryMaxAttempts ?? 3,
        retryBackoffSeconds: params.retryBackoffSeconds ?? 5,
        nextRunAt,
      },
      update: {
        cadenceHours,
        status: params.status ?? TopologyConsolidationScheduleStatus.ACTIVE,
        maxEntitiesPerRun: params.maxEntitiesPerRun,
        maxEntitiesPerSubfacet: params.maxEntitiesPerSubfacet,
        maxEntitiesPerSubfacetSummary: params.maxEntitiesPerSubfacetSummary,
        maxPerCategory: params.maxPerCategory,
        maxPerSubfacet: params.maxPerSubfacet,
        threshold: params.threshold,
        maxIterations: params.maxIterations,
        retryMaxAttempts: params.retryMaxAttempts ?? 3,
        retryBackoffSeconds: params.retryBackoffSeconds ?? 5,
      },
    });
  }

  async patchSchedule(params: {
    organizationId: string;
    projectId: ProjectId;
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
    nextRunAt?: Date | null;
  }): Promise<TopologyConsolidationSchedule> {
    const data = {
      ...(params.cadenceHours !== undefined
        ? { cadenceHours: Math.max(params.cadenceHours, 1) }
        : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.maxEntitiesPerRun !== undefined
        ? { maxEntitiesPerRun: params.maxEntitiesPerRun }
        : {}),
      ...(params.maxEntitiesPerSubfacet !== undefined
        ? { maxEntitiesPerSubfacet: params.maxEntitiesPerSubfacet }
        : {}),
      ...(params.maxEntitiesPerSubfacetSummary !== undefined
        ? {
            maxEntitiesPerSubfacetSummary: params.maxEntitiesPerSubfacetSummary,
          }
        : {}),
      ...(params.maxPerCategory !== undefined
        ? { maxPerCategory: params.maxPerCategory }
        : {}),
      ...(params.maxPerSubfacet !== undefined
        ? { maxPerSubfacet: params.maxPerSubfacet }
        : {}),
      ...(params.threshold !== undefined
        ? { threshold: params.threshold }
        : {}),
      ...(params.maxIterations !== undefined
        ? { maxIterations: params.maxIterations }
        : {}),
      ...(params.retryMaxAttempts !== undefined
        ? { retryMaxAttempts: params.retryMaxAttempts }
        : {}),
      ...(params.retryBackoffSeconds !== undefined
        ? { retryBackoffSeconds: params.retryBackoffSeconds }
        : {}),
      ...(params.nextRunAt !== undefined
        ? { nextRunAt: params.nextRunAt }
        : {}),
    } satisfies Prisma.TopologyConsolidationScheduleUpdateInput;

    return this.prisma.db.topologyConsolidationSchedule.update({
      where: {
        organizationId_projectId: {
          organizationId: params.organizationId,
          projectId: params.projectId,
        },
      },
      data,
    });
  }

  async listRuns(params: {
    organizationId: string;
    projectId: ProjectId;
    limit?: number;
  }) {
    return this.prisma.db.topologyConsolidationRun.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(params.limit ?? 20, 1), 100),
    });
  }

  async triggerNow(
    organizationId: string,
    projectId: ProjectId,
  ): Promise<TopologyConsolidationSchedule> {
    return this.prisma.db.topologyConsolidationSchedule.update({
      where: {
        organizationId_projectId: {
          organizationId,
          projectId,
        },
      },
      data: {
        status: TopologyConsolidationScheduleStatus.ACTIVE,
        nextRunAt: new Date(),
      },
    });
  }

  private async executeDueSchedule(scheduleId: string): Promise<void> {
    this.logger.debug('[executeDueSchedule] attempting claim', { scheduleId });
    const claimed = await this.claimSchedule(scheduleId);
    if (!claimed) {
      this.logger.debug('[executeDueSchedule] claim skipped', {
        scheduleId,
        reason: 'not claimable',
      });
      return;
    }

    const now = new Date();
    const since =
      claimed.lastSuccessAt ??
      new Date(now.getTime() - claimed.cadenceHours * 60 * 60 * 1000);
    this.logger.log('[executeDueSchedule] claimed schedule, creating run', {
      scheduleId: claimed.id,
      organizationId: claimed.organizationId,
      projectId: claimed.projectId,
      runSince: since.toISOString(),
      runUntil: now.toISOString(),
      cadenceHours: claimed.cadenceHours,
      lastSuccessAt: claimed.lastSuccessAt?.toISOString() ?? null,
    });
    const run = await this.prisma.db.topologyConsolidationRun.create({
      data: {
        scheduleId: claimed.id,
        organizationId: claimed.organizationId,
        projectId: claimed.projectId,
        since,
        until: now,
        status: TopologyConsolidationRunStatus.RUNNING,
      },
    });
    await this.prisma.db.topologyConsolidationSchedule.update({
      where: { id: claimed.id },
      data: { currentRunId: run.id },
    });
    this.logger.debug('[executeDueSchedule] run row created', {
      scheduleId: claimed.id,
      runId: run.id,
    });

    const changedEntities = await this.collectChangedEntities({
      organizationId: claimed.organizationId,
      projectId: claimed.projectId as ProjectId,
      since,
    });
    this.logger.log('[executeDueSchedule] changed entities evaluated', {
      scheduleId: claimed.id,
      runId: run.id,
      changedEntityCount: changedEntities.length,
      sampleEntities: changedEntities.slice(0, 10).map((entity) => ({
        entityType: entity.entityType,
        entityId: entity.entityId,
        updatedAt: entity.updatedAt.toISOString(),
      })),
    });

    if (changedEntities.length === 0) {
      this.logger.log('[executeDueSchedule] no-op run: no changed entities', {
        scheduleId: claimed.id,
        runId: run.id,
      });
      await this.completeNoopRun(claimed, run.id);
      return;
    }

    const workflowId =
      `topology-scheduled-${claimed.organizationId}-${claimed.projectId}-${run.id}` as WorkflowId;

    try {
      const input: TopologyScheduledConsolidationWorkflowInput = {
        organizationId: claimed.organizationId,
        projectId: claimed.projectId,
        since: since.toISOString(),
        topologyConsolidationRunId: run.id,
        temporalWorkflowId: workflowId,
        workflowAboutType: 'project',
        workflowAboutId: claimed.projectId,
        trigger: 'scheduled',
        categoryPromptMode: 'large',
        maxSubfacetsInPrompt: 100,
        changedEntitySamplePerSubfacet: 5,
        threshold: claimed.threshold ?? undefined,
        maxIterations: claimed.maxIterations ?? undefined,
        maxEntitiesPerRun: claimed.maxEntitiesPerRun ?? undefined,
        maxEntitiesPerSubfacet: claimed.maxEntitiesPerSubfacet ?? undefined,
        maxEntitiesPerSubfacetSummary:
          claimed.maxEntitiesPerSubfacetSummary ?? undefined,
        maxPerCategory: claimed.maxPerCategory ?? undefined,
        maxPerSubfacet: claimed.maxPerSubfacet ?? undefined,
      };
      this.logger.log('[executeDueSchedule] starting temporal workflow', {
        scheduleId: claimed.id,
        runId: run.id,
        workflowId,
        taskQueue: 'conversation-queue',
        input,
      });

      const handle = await this.temporalClient.workflow.start(
        'topologyScheduledConsolidationWorkflow',
        {
          args: [input],
          taskQueue: 'conversation-queue',
          workflowId,
        },
      );

      const result =
        (await handle.result()) as TopologyScheduledConsolidationWorkflowResult;
      this.logger.log('[executeDueSchedule] temporal workflow completed', {
        scheduleId: claimed.id,
        runId: run.id,
        workflowId,
        hadUpstreamChanges: result.hadUpstreamChanges,
        ranCategorySummarization: result.ranCategorySummarization,
        subfacetSummaries: result.subfacetSummarization.subfacets.length,
        subfacetConsolidations: result.subfacetConsolidation.categories.length,
        categorySummaries: result.categorySummarization?.categories.length ?? 0,
      });
      await this.finalizeRunWithResult({
        schedule: claimed,
        runId: run.id,
        workflowId,
        changedEntities,
        result,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown scheduling error';
      this.logger.error('[executeDueSchedule] scheduled run failed', {
        scheduleId: claimed.id,
        runId: run.id,
        workflowId,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.topologyConsolidationRun.update({
          where: { id: run.id },
          data: {
            status: TopologyConsolidationRunStatus.FAILED,
            temporalWorkflowId: workflowId,
            entitiesDiscovered: changedEntities.length,
            entitiesProcessed: 0,
            categoriesProcessed: 0,
            subfacetsProcessed: 0,
            errorMessage: message,
            details: {
              deadLetter: true,
              reason: message,
            },
            completedAt: new Date(),
          },
        });

        await this.markEntitiesFailed(tx, changedEntities, run.id, message);
        await this.releaseScheduleLock(
          tx,
          claimed.id,
          claimed.cadenceHours,
          false,
        );
      });
    }
  }

  private async claimSchedule(
    scheduleId: string,
  ): Promise<TopologyConsolidationSchedule | null> {
    const now = new Date();
    const lockToken = `${scheduleId}-${now.getTime()}`;
    const leaseExpiresAt = new Date(now.getTime() + this.scheduleLeaseMs);
    this.logger.debug('[claimSchedule] attempting db lease claim', {
      scheduleId,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    });

    const claimed =
      await this.prisma.db.topologyConsolidationSchedule.updateMany({
        where: {
          id: scheduleId,
          status: TopologyConsolidationScheduleStatus.ACTIVE,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
        data: {
          lockToken,
          leaseExpiresAt,
          runningSince: now,
        },
      });

    if (claimed.count === 0) {
      this.logger.debug('[claimSchedule] lease claim failed', {
        scheduleId,
      });
      return null;
    }

    const schedule =
      await this.prisma.db.topologyConsolidationSchedule.findUnique({
        where: { id: scheduleId },
      });
    this.logger.debug('[claimSchedule] lease claimed', {
      scheduleId,
      foundSchedule: !!schedule,
    });
    return schedule;
  }

  private async completeNoopRun(
    schedule: TopologyConsolidationSchedule,
    runId: string,
  ): Promise<void> {
    this.logger.log('[completeNoopRun] finalizing no-op run', {
      scheduleId: schedule.id,
      runId,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.topologyConsolidationRun.update({
        where: { id: runId },
        data: {
          status: TopologyConsolidationRunStatus.SUCCEEDED,
          entitiesDiscovered: 0,
          entitiesProcessed: 0,
          categoriesProcessed: 0,
          subfacetsProcessed: 0,
          details: { noop: true, reason: 'No updated entity summaries' },
          completedAt: new Date(),
        },
      });

      await this.promoteCandidatesToProvisionals({
        tx,
        organizationId: schedule.organizationId as OrganizationId,
        projectId: schedule.projectId as ProjectId,
      });

      await this.releaseScheduleLock(
        tx,
        schedule.id,
        schedule.cadenceHours,
        true,
      );
    });
  }

  private async finalizeRunWithResult(params: {
    schedule: TopologyConsolidationSchedule;
    runId: string;
    workflowId: WorkflowId;
    changedEntities: ChangedEntity[];
    result: TopologyScheduledConsolidationWorkflowResult;
  }): Promise<void> {
    const { schedule, runId, workflowId, changedEntities, result } = params;
    const subfacetErrors = result.subfacetSummarization.subfacets.filter(
      (item) => !!item.error,
    );
    const consolidationErrors = result.subfacetConsolidation.categories.filter(
      (item) => !!item.error,
    );
    const categoryErrors = (
      result.categorySummarization?.categories ?? []
    ).filter((item) => !!item.error);

    const hadErrors =
      subfacetErrors.length > 0 ||
      consolidationErrors.length > 0 ||
      categoryErrors.length > 0;
    const hasAnySuccess =
      result.subfacetSummarization.subfacets.some((item) => !!item.response) ||
      result.subfacetConsolidation.categories.some((item) => !!item.response) ||
      (result.categorySummarization?.categories ?? []).some(
        (item) => !!item.response,
      );

    const status = hadErrors
      ? hasAnySuccess
        ? TopologyConsolidationRunStatus.PARTIALLY_FAILED
        : TopologyConsolidationRunStatus.FAILED
      : TopologyConsolidationRunStatus.SUCCEEDED;

    const categoriesProcessed =
      result.categorySummarization?.categories.length ?? 0;
    const subfacetsProcessed = result.subfacetSummarization.subfacets.length;
    this.logger.log(
      '[finalizeRunWithResult] finalizing run with workflow result',
      {
        scheduleId: schedule.id,
        runId,
        workflowId,
        status,
        hadErrors,
        hasAnySuccess,
        changedEntities: changedEntities.length,
        categoriesProcessed,
        subfacetsProcessed,
        subfacetErrorCount: subfacetErrors.length,
        consolidationErrorCount: consolidationErrors.length,
        categoryErrorCount: categoryErrors.length,
      },
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.topologyConsolidationRun.update({
        where: { id: runId },
        data: {
          status,
          temporalWorkflowId: workflowId,
          entitiesDiscovered: changedEntities.length,
          entitiesProcessed:
            status === TopologyConsolidationRunStatus.SUCCEEDED
              ? changedEntities.length
              : 0,
          categoriesProcessed,
          subfacetsProcessed,
          errorMessage: hadErrors
            ? [
                ...subfacetErrors.map((e) => e.error),
                ...consolidationErrors.map((e) => e.error),
                ...categoryErrors.map((e) => e.error),
              ]
                .filter(Boolean)
                .join('; ')
            : null,
          details: result,
          completedAt: new Date(),
        },
      });

      if (status === TopologyConsolidationRunStatus.SUCCEEDED) {
        await this.markEntitiesProcessed(tx, changedEntities, runId);
        await this.promoteCandidatesToProvisionals({
          tx,
          organizationId: schedule.organizationId as OrganizationId,
          projectId: schedule.projectId as ProjectId,
        });
      } else {
        await this.markEntitiesFailed(
          tx,
          changedEntities,
          runId,
          'Scheduled topology run did not fully succeed',
        );
      }

      await this.releaseScheduleLock(
        tx,
        schedule.id,
        schedule.cadenceHours,
        status === TopologyConsolidationRunStatus.SUCCEEDED,
      );
    });
  }

  private async promoteCandidatesToProvisionals(params: {
    tx: Prisma.TransactionClient;
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<void> {
    const categories: SummaryCategory[] = [
      SummaryCategory.technology,
      SummaryCategory.product,
      SummaryCategory.process,
      SummaryCategory.people,
    ];

    for (const category of categories) {
      const subfacets = await params.tx.subfacet.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          category,
          status: {
            in: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
          },
        },
        select: { status: true },
      });
      const activeCount = subfacets.filter(
        (subfacet) => subfacet.status === SubfacetStatus.ACTIVE,
      ).length;
      const provisionalCount = subfacets.filter(
        (subfacet) => subfacet.status === SubfacetStatus.PROVISIONAL,
      ).length;
      if (
        !canPromoteCandidate({
          activeCount,
          provisionalCount,
        })
      ) {
        continue;
      }

      const availableSlots = Math.max(
        ACTIVE_CAP_PER_CATEGORY - (activeCount + provisionalCount),
        0,
      );
      if (availableSlots === 0) {
        continue;
      }

      const maxPromotions = Math.min(
        PROMOTE_CANDIDATES_PER_RUN_PER_CATEGORY,
        availableSlots,
      );
      const candidates =
        await this.subfacetCandidateService.listPromotableCandidates({
          tx: params.tx,
          organizationId: params.organizationId,
          projectId: params.projectId,
          category,
          limit: maxPromotions,
        });
      if (!candidates.length) {
        continue;
      }

      const promotions: Array<{ candidateId: string; subfacetId: string }> = [];
      for (const candidate of candidates) {
        const subfacet = await this.subfacetService.createProvisionalSubfacet({
          tx: params.tx,
          organizationId: params.organizationId,
          projectId: params.projectId,
          category,
          name: candidate.name,
        });
        promotions.push({ candidateId: candidate.id, subfacetId: subfacet.id });
      }
      await this.subfacetCandidateService.markPromoted({
        tx: params.tx,
        promotions,
      });

      this.logger.log('[promoteCandidatesToProvisionals] promoted candidates', {
        organizationId: params.organizationId,
        projectId: params.projectId,
        category,
        promotedCount: promotions.length,
      });
    }
  }

  private async collectChangedEntities(params: {
    organizationId: string;
    projectId: ProjectId;
    since: Date;
  }): Promise<ChangedEntity[]> {
    this.logger.debug('[collectChangedEntities] loading candidate summaries', {
      organizationId: params.organizationId,
      projectId: params.projectId,
      since: params.since.toISOString(),
    });
    const summaries = await this.prisma.db.entitySummary.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        isCurrent: true,
        updatedAt: { gte: params.since },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        updatedAt: true,
      },
    });

    if (!summaries.length) {
      this.logger.debug('[collectChangedEntities] no summaries found', {
        organizationId: params.organizationId,
        projectId: params.projectId,
      });
      return [];
    }
    this.logger.debug('[collectChangedEntities] candidate summaries loaded', {
      organizationId: params.organizationId,
      projectId: params.projectId,
      summaryCount: summaries.length,
    });

    const existing =
      await this.prisma.db.topologyConsolidationEntityState.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          OR: summaries.map((summary) => ({
            entityType: summary.entityType,
            entityId: summary.entityId,
          })),
        },
      });
    const existingByEntity = new Map(
      existing.map((state) => [`${state.entityType}:${state.entityId}`, state]),
    );

    const changed: ChangedEntity[] = [];
    const now = new Date();
    let skippedCount = 0;
    for (const summary of summaries) {
      const key = `${summary.entityType}:${summary.entityId}`;
      const current = existingByEntity.get(key);
      const shouldProcess =
        !current ||
        current.status === TopologyConsolidationEntityStatus.FAILED ||
        !current.latestSummaryUpdatedAt ||
        current.latestSummaryUpdatedAt.getTime() < summary.updatedAt.getTime();

      await this.prisma.db.topologyConsolidationEntityState.upsert({
        where: {
          organizationId_projectId_entityType_entityId: {
            organizationId: params.organizationId,
            projectId: params.projectId,
            entityType: summary.entityType,
            entityId: summary.entityId,
          },
        },
        create: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          entityType: summary.entityType,
          entityId: summary.entityId,
          latestSummaryId: summary.id,
          latestSummaryUpdatedAt: summary.updatedAt,
          status: shouldProcess
            ? TopologyConsolidationEntityStatus.PENDING
            : TopologyConsolidationEntityStatus.PROCESSED,
          lastAttemptAt: now,
        },
        update: {
          latestSummaryId: summary.id,
          latestSummaryUpdatedAt: summary.updatedAt,
          status: shouldProcess
            ? TopologyConsolidationEntityStatus.PENDING
            : current?.status,
          lastAttemptAt: now,
          ...(shouldProcess ? { errorMessage: null } : {}),
        },
      });

      if (shouldProcess) {
        changed.push({
          organizationId: params.organizationId,
          projectId: params.projectId,
          entityType: summary.entityType,
          entityId: summary.entityId,
          summaryId: summary.id,
          updatedAt: summary.updatedAt,
        });
      } else {
        skippedCount += 1;
      }
    }
    this.logger.log(
      '[collectChangedEntities] entity change detection complete',
      {
        organizationId: params.organizationId,
        projectId: params.projectId,
        candidates: summaries.length,
        changed: changed.length,
        skipped: skippedCount,
      },
    );

    return changed;
  }

  private async markEntitiesProcessed(
    tx: Prisma.TransactionClient,
    entities: ChangedEntity[],
    runId: string,
  ): Promise<void> {
    this.logger.debug('[markEntitiesProcessed] marking entities processed', {
      runId,
      entityCount: entities.length,
    });
    const now = new Date();
    await Promise.all(
      entities.map((entity) =>
        tx.topologyConsolidationEntityState.update({
          where: {
            organizationId_projectId_entityType_entityId: {
              organizationId: entity.organizationId,
              projectId: entity.projectId,
              entityType: entity.entityType,
              entityId: entity.entityId,
            },
          },
          data: {
            latestSummaryId: entity.summaryId,
            latestSummaryUpdatedAt: entity.updatedAt,
            status: TopologyConsolidationEntityStatus.PROCESSED,
            lastProcessedRunId: runId,
            lastProcessedAt: now,
            lastAttemptAt: now,
            errorMessage: null,
          },
        }),
      ),
    );
  }

  private async markEntitiesFailed(
    tx: Prisma.TransactionClient,
    entities: ChangedEntity[],
    runId: string,
    errorMessage: string,
  ): Promise<void> {
    this.logger.warn('[markEntitiesFailed] marking entities failed', {
      runId,
      entityCount: entities.length,
      errorMessage,
    });
    const now = new Date();
    await Promise.all(
      entities.map((entity) =>
        tx.topologyConsolidationEntityState.update({
          where: {
            organizationId_projectId_entityType_entityId: {
              organizationId: entity.organizationId,
              projectId: entity.projectId,
              entityType: entity.entityType,
              entityId: entity.entityId,
            },
          },
          data: {
            latestSummaryId: entity.summaryId,
            latestSummaryUpdatedAt: entity.updatedAt,
            status: TopologyConsolidationEntityStatus.FAILED,
            lastProcessedRunId: runId,
            lastAttemptAt: now,
            errorMessage,
          },
        }),
      ),
    );
  }

  private async releaseScheduleLock(
    tx: Prisma.TransactionClient,
    scheduleId: string,
    cadenceHours: number,
    success: boolean,
  ): Promise<void> {
    const now = new Date();
    const nextRunAt = this.computeNextRunAt(now, cadenceHours);
    this.logger.log('[releaseScheduleLock] releasing schedule lease', {
      scheduleId,
      success,
      cadenceHours,
      lastRunAt: now.toISOString(),
      nextRunAt: nextRunAt.toISOString(),
    });
    await tx.topologyConsolidationSchedule.update({
      where: { id: scheduleId },
      data: {
        lockToken: null,
        leaseExpiresAt: null,
        runningSince: null,
        currentRunId: null,
        lastRunAt: now,
        ...(success ? { lastSuccessAt: now } : {}),
        nextRunAt,
      },
    });
  }

  private computeNextRunAt(from: Date, cadenceHours: number): Date {
    return new Date(
      from.getTime() + Math.max(cadenceHours, 1) * 60 * 60 * 1000,
    );
  }
}
