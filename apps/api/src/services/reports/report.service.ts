import { validateChangeWalkthroughPayload } from './change-walkthrough-payload.validation';
import { validateCodingResearchPayload } from './coding-research-payload.validation';
import { validateProjectReportPayload } from './project-report-payload.validation';
import {
  currentWritingSessionId,
  EvalOutputAdmissionService,
  ORDINARY_EVAL_OUTPUT_STAMP,
  type EvalOutputStamp,
} from '../eval/eval-output-admission.service';
import { ProjectReportRequestService } from '../project-reports/project-report-request.service';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadRequestException,
  Injectable,
  Inject,
  forwardRef,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  EntityType as PrismaEntityType,
  FileTouchIndex,
  Prisma,
  ReportAudience as PrismaReportAudience,
  ReportEntityRelation as PrismaReportEntityRelation,
  ReportType as PrismaReportType,
} from '@prisma/client';

import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import {
  CodingResearchReportPayload,
  CreateReportDto,
  CreateReportDtoOther,
  CreateReportEntityDto,
  CreateReportResponseDto,
  FeatureSyncDecisionReportPayloadV1,
  FeatureSyncDecisionReportPayloadV2,
  FileTouchIndexEntriesDto,
  FileTouchIndexEntryDto,
  FileTouchFeatureFilesDto,
  FileTouchFeatureSectionDto,
  FileTouchHistoryFileDto,
  FileTouchReferenceCandidateDto,
  FileTouchReferenceCandidatesDto,
  FileTouchServiceHistoryDto,
  FileTouchServiceHistoryEntryDto,
  FileTouchServiceHistorySortBy,
  FileTouchServiceHistorySortOrder,
  FileTouchTaskFilesDto,
  FileTouchTaskHistoryDto,
  FileTouchTaskHistoryEntryDto,
  FileTouchTaskHistoryEvidenceDto,
  FileTouchWorkHistoryDto,
  ImplementReportPayload,
  LinkedReportEntityRef,
  OtherReportPayload,
  ReportAudience,
  EvalAttemptUpdatedEvent,
  EvalAttemptUpdatedEventPayload,
  EvalRunUpdatedEvent,
  EvalRunUpdatedEventPayload,
  ReportCreatedEvent,
  ReportCreatedEventPayload,
  ReportDto,
  ReportDtoFeatureSyncDecisionV1,
  ReportDtoFeatureSyncDecisionV2,
  ReportDtoOther,
  ReportEntityDto,
  ReportEntityRelation,
  ReportPayload,
  ReportRelatedEntityType,
  ReportSortBy,
  ReportSortOrder,
  ReportSummaryDto,
  ReportType,
  SessionMonitorReportGuidance,
  UpdateReportDto,
} from 'src/generated';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { REPORT_SCHEMAS } from 'src/mcp/tools/report-schemas.generated';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import { EntityRegistryService } from 'src/services/entity-registry/entity-registry.service';
import { FlowExecutionService } from 'src/services/workflows/flow-execution.service';
import { NodeExecutionService } from 'src/services/workflows/node-execution.service';
import { isExternalAgentNode } from 'src/types/flow-internal.types';
import { ConversationId, OrganizationId, ProjectId, UserId } from 'src/types';
import {
  toReportAudience,
  USER_VISIBLE_PERSISTED_REPORT_AUDIENCES,
} from './report-audience';

type ReportWithEntities = Prisma.ReportGetPayload<{
  include: { reportEntities: true };
}>;

const REPORT_ENVELOPE_METADATA_KEY = '__reportEnvelope';

// Implement parses approved PLAN payloads strictly, so a payload that does not
// satisfy the PLAN contract must be rejected at write time, while the planner
// can still revise and resubmit it, rather than surfacing after approval.
const planPayloadAjv = new Ajv({ allErrors: true, strict: false });
addFormats(planPayloadAjv);
const validatePlanPayloadSchema = planPayloadAjv.compile(
  REPORT_SCHEMAS.PLAN.schema,
);

type FileTouchIndexingResult = {
  reportId: string;
  status: 'indexed' | 'skipped';
  indexedCount: number;
  reason?: string;
};

export type BackfillFileTouchIndexFilters = {
  organizationId?: string;
  projectId?: string;
  reportId?: string;
  limit?: number;
  offset?: number;
  dryRun?: boolean;
};

export type BackfillFileTouchIndexResult = {
  processed: number;
  indexed: number;
  skipped: number;
  dryRun: boolean;
  results: FileTouchIndexingResult[];
};

type FileTouchExtraction = {
  projectId: string;
  serviceId: string;
  featureId: string | null;
  attachedEntityType: PrismaEntityType;
  attachedEntityId: string;
  reportId: string;
  agentSessionId: string;
  normalizedPaths: string[];
};

type FileTouchServiceHistoryCursor = {
  version: 1;
  sortBy: FileTouchServiceHistorySortBy;
  sortOrder: FileTouchServiceHistorySortOrder;
  pathFilter: string;
  value: string | number;
  normalizedPath: string;
};

type ActiveFeatureHierarchyEntry = {
  id: string;
  name: string;
  parentTaskId: string | null;
};

export type ListReportsFilters = {
  accessibleProjectIds?: string[];
  projectId?: string;
  reportType?: ReportType;
  reportTypes?: ReportType[];
  audience?: ReportAudience;
  sourceExecutionId?: string;
  parentReportId?: string;
  entityType?: ReportRelatedEntityType;
  entityId?: string;
  relation?: ReportEntityRelation;
  includeExpired?: boolean;
  ragEnabled?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: ReportSortBy;
  sortOrder?: ReportSortOrder;
};

export type CreateCodingResearchReportInput = {
  organizationId: OrganizationId;
  projectId: string;
  sourceExecutionId: string;
  audience: ReportAudience;
  payload: Record<string, unknown>;
  taskId?: string;
  designDocId?: string;
  planId?: string;
  schemaVersion?: number;
  expiresAt?: Date;
};

// Eval run history is kept until its Eval is deleted, so these records are
// exempt from the retention expiry.
const NEVER_EXPIRING_REPORT_TYPES: ReadonlySet<string> = new Set([
  ReportType.EvalRun,
  ReportType.EvalAttempt,
  ReportType.EvalHumanReview,
]);

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);
  private readonly reportTitleByType = {
    CODING_RESEARCH: 'Coding Research',
    EVIDENCE_PIPELINE: 'Evidence Pipeline',
    SNAPSHOT: 'Snapshot',
    ROLLUP_PROPOSAL: 'Rollup Proposal',
    DAILY_SESSION: 'Daily Session',
    GOAL_PROGRESS: 'Goal Progress',
    RISK_ALERT: 'Risk Alert',
    SESSION_SUMMARY: 'Session Summary',
    COMMIT: 'Commit',
    PLAN: 'Plan',
    IMPLEMENT: 'Implement',
    REVIEW: 'Review',
    CHANGE_WALKTHROUGH: 'Change walkthrough',
    FEATURE_SYNC: 'Feature Sync',
    FEATURE_SYNC_HANDOFF: 'Feature Sync Handoff',
    FEATURE_SYNC_DECISION: 'Feature Sync Decision',
    DECISION_NEEDED: 'Decision Needed',
    PHASE_GROUNDING: 'Phase Grounding',
    VALIDATION_WALKTHROUGH: 'Validation Walkthrough',
    FEATURE_TREE_ANALYSIS: 'Feature Tree Analysis',
    COMPETITIVE_ANALYSIS: 'Competitive Analysis',
    SESSION_MONITOR_DEFERRAL: 'Session Monitor Deferral',
    PROJECT_REPORT: 'Project Report',
    EVAL_RUN: 'Eval Run',
    EVAL_ATTEMPT: 'Eval Attempt',
    EVAL_HUMAN_REVIEW: 'Eval Human Review',
  } as const satisfies Record<ReportType, string>;
  private readonly allowedReportTypes = new Set<string>(
    Object.values(ReportType),
  );
  private readonly allowedReportTypesList =
    Object.values(ReportType).join(', ');
  private readonly allowedReportAudiences = new Set<string>(
    Object.values(ReportAudience),
  );
  private readonly allowedReportAudiencesList =
    Object.values(ReportAudience).join(', ');
  private readonly allowedSortByValues = new Set<string>(
    Object.values(ReportSortBy),
  );
  private readonly allowedSortByList = Object.values(ReportSortBy).join(', ');
  private readonly allowedSortOrderValues = new Set<string>(
    Object.values(ReportSortOrder),
  );
  private readonly allowedSortOrderList =
    Object.values(ReportSortOrder).join(', ');
  private readonly defaultTtlDays = this.parsePositiveInt(
    process.env.REPORT_TTL_DAYS,
    30,
  );
  private static readonly EMPTY_NAME_MAP = new Map<string, string>();
  private readonly defaultListLimit = 50;
  private readonly maxListLimit = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventPublisher: DomainEventPublisher,
    private readonly entityRegistryService: EntityRegistryService,
    @Optional()
    @Inject(forwardRef(() => FlowExecutionService))
    private readonly flowExecutionService?: FlowExecutionService,
    @Optional()
    private readonly nodeExecutionService?: NodeExecutionService,
    private readonly projectReportRequests?: ProjectReportRequestService,
    @Optional()
    private readonly evalOutputAdmission: EvalOutputAdmissionService = new EvalOutputAdmissionService(),
  ) {}

  getReportTitle(reportType: ReportType): string {
    const title = this.reportTitleByType[reportType];
    if (title) {
      return title;
    }

    throw new Error(`Unsupported report title type: ${reportType}`);
  }

  async create(
    organizationId: OrganizationId,
    dto: CreateReportDto,
    conversationId?: string,
    callerUserId?: UserId,
  ): Promise<CreateReportResponseDto> {
    const audience =
      dto.reportType === ReportType.PhaseGrounding
        ? ReportAudience.WorkflowOnly
        : dto.audience;
    this.validateReportType(dto.reportType);
    validateChangeWalkthroughPayload(dto.reportType, dto.payload);
    validateCodingResearchPayload(dto.reportType, dto.payload);
    const projectReportPayload = validateProjectReportPayload(
      dto.reportType,
      dto.payload,
    );
    if (
      projectReportPayload &&
      (!dto.projectId ||
        dto.projectId !== projectReportPayload.scope.projectId ||
        !dto.sourceExecutionId ||
        !conversationId ||
        !callerUserId ||
        audience !== ReportAudience.ProjectVisible ||
        !this.projectReportRequests)
    ) {
      throw new BadRequestException(
        'PROJECT_REPORT requires a bound project-visible source execution',
      );
    }
    this.validateReportAudience(audience);
    if (dto.reportType === ReportType.Plan) {
      this.validatePlanPayloadShape(organizationId, dto.payload);
    }
    await this.validatePlanRequiredServiceIds(organizationId, dto);
    await this.validateGoalAnchor(organizationId, dto);
    const schemaVersion = this.resolveSchemaVersion(dto.schemaVersion);
    const expiresAt = this.resolveCreateExpiresAt(dto);
    const callerEntityCreates = (dto.entities ?? []).map((entity) =>
      this.toReportEntityCreateInput(entity),
    );

    const parentReportId = dto.parentReportId ?? null;
    if (parentReportId) {
      await this.validateParentReportExists(organizationId, parentReportId);
    }

    this.logger.log('Creating report', {
      organizationId,
      reportType: dto.reportType,
      audience,
      schemaVersion,
      entityCount: callerEntityCreates.length,
      linkedEntityCount: dto.linkedEntities?.length ?? 0,
      sourceExecutionId: dto.sourceExecutionId ?? null,
      parentReportId,
    });

    let created: ReportWithEntities;
    try {
      created = await this.prisma.db.$transaction(async (tx) => {
        if (projectReportPayload) {
          await this.projectReportRequests!.assertReportSubmissionInTransaction(
            tx as unknown as Prisma.TransactionClient,
            organizationId,
            dto.projectId!,
            dto.sourceExecutionId!,
            conversationId!,
            callerUserId!,
            projectReportPayload,
          );
        }
        const linkedContextCreates = this.materializeLinkedEntities(
          dto.linkedEntities,
        );
        const entityCreates = this.dedupeEntityCreates([
          ...callerEntityCreates,
          ...linkedContextCreates,
        ]);

        const evalStamp = await this.resolveEvalOutputStamp(
          tx,
          organizationId,
          dto,
        );
        const createdReport = await tx.report.create({
          data: {
            organizationId,
            projectId: dto.projectId ?? null,
            ragEnabled: evalStamp.ragEnabled,
            reportType: dto.reportType as PrismaReportType,
            audience: audience as PrismaReportAudience,
            payload: this.toPersistedReportPayload(dto.payload, dto.agent),
            schemaVersion,
            sourceExecutionId: dto.sourceExecutionId ?? null,
            parentReportId,
            expiresAt,
            reportEntities:
              entityCreates.length > 0 ? { create: entityCreates } : undefined,
          },
          include: {
            reportEntities: {
              orderBy: { createdAt: 'asc' },
            },
          },
        });

        if (projectReportPayload) {
          await this.projectReportRequests!.completeInTransaction(
            tx as unknown as Prisma.TransactionClient,
            createdReport.id,
            organizationId,
            dto.projectId!,
            dto.sourceExecutionId!,
            projectReportPayload,
          );
        }

        await this.publishReportCreatedEvent(tx, organizationId, createdReport);
        await this.publishEvalReportEvent(tx, organizationId, createdReport);
        return createdReport;
      });
    } catch (error) {
      // A failed PROJECT_REPORT submission rolls back atomically and leaves
      // its attempt RUNNING so the agent can resubmit. The session outcome
      // listener fails the attempt if the session ends without a report.
      this.logger.error('Failed to create report', {
        organizationId,
        reportType: dto.reportType,
        audience,
        schemaVersion,
        entityCount: callerEntityCreates.length,
        error,
      });
      throw error;
    }

    this.logger.log('Created report', {
      reportId: created.id,
      organizationId,
      reportType: created.reportType,
      audience: created.audience,
      entityCount: created.reportEntities.length,
    });

    const reportGuidance = await this.resolveReportGuidance({
      organizationId,
      conversationId,
      reportType: dto.reportType,
    });

    return {
      ...this.toDto(created),
      reportGuidance,
    } satisfies CreateReportResponseDto;
  }

  /**
   * Creates a report with a caller-chosen id inside the caller's transaction,
   * so records that reference each other's ids (an eval run and its attempts)
   * commit or fail together.
   */
  async createWithIdInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    id: string,
    dto: CreateReportDto,
  ): Promise<ReportDto> {
    this.validateReportType(dto.reportType);
    this.validateReportAudience(dto.audience);
    const schemaVersion = this.resolveSchemaVersion(dto.schemaVersion);
    const expiresAt = this.resolveCreateExpiresAt(dto);
    const entityCreates = this.dedupeEntityCreates([
      ...(dto.entities ?? []).map((entity) =>
        this.toReportEntityCreateInput(entity),
      ),
      ...this.materializeLinkedEntities(dto.linkedEntities),
    ]);

    this.logger.log('Creating report with caller-chosen id', {
      reportId: id,
      organizationId,
      reportType: dto.reportType,
      parentReportId: dto.parentReportId ?? null,
    });
    const evalStamp = await this.resolveEvalOutputStamp(
      tx,
      organizationId,
      dto,
    );
    const created = await tx.report.create({
      data: {
        id,
        organizationId,
        projectId: dto.projectId ?? null,
        ragEnabled: evalStamp.ragEnabled,
        reportType: dto.reportType as PrismaReportType,
        audience: dto.audience as PrismaReportAudience,
        payload: this.toPersistedReportPayload(dto.payload, dto.agent),
        schemaVersion,
        sourceExecutionId: dto.sourceExecutionId ?? null,
        parentReportId: dto.parentReportId ?? null,
        expiresAt,
        reportEntities:
          entityCreates.length > 0 ? { create: entityCreates } : undefined,
      },
      include: { reportEntities: { orderBy: { createdAt: 'asc' } } },
    });
    await this.publishReportCreatedEvent(tx, organizationId, created);
    await this.publishEvalReportEvent(tx, organizationId, created);
    return this.toDto(created);
  }

  async createCodingResearchReport(
    input: CreateCodingResearchReportInput,
  ): Promise<ReportDto> {
    const primaryEntity = this.resolvePrimaryResearchEntity(input);
    const entities: CreateReportEntityDto[] = [
      {
        entityType: primaryEntity.entityType,
        entityId: primaryEntity.entityId,
        relation: ReportEntityRelation.Primary,
      },
      ...(input.planId
        ? [
            {
              entityType: ReportRelatedEntityType.Task,
              entityId: input.planId,
              relation: ReportEntityRelation.Context,
            } satisfies CreateReportEntityDto,
          ]
        : []),
    ];

    const dto = {
      projectId: input.projectId,
      reportType: 'CODING_RESEARCH',
      audience: input.audience,
      payload: input.payload as unknown as CodingResearchReportPayload,
      schemaVersion: input.schemaVersion ?? 1,
      sourceExecutionId: input.sourceExecutionId,
      ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
      entities,
    } satisfies CreateReportDtoOther;

    return this.create(input.organizationId, dto);
  }

  async findAll(
    organizationId: OrganizationId,
    filters: ListReportsFilters = {},
  ): Promise<ReportDto[]> {
    this.validateEntityFilterConsistency(filters);
    const limit = this.resolveListLimit(filters.limit);
    const offset = this.resolveListOffset(filters.offset);
    const sortBy = this.resolveSortBy(filters.sortBy);
    const sortOrder = this.resolveSortOrder(filters.sortOrder);
    const includeExpired = filters.includeExpired ?? false;
    const reportTypesFilter = this.resolveReportTypesFilter(
      filters.reportTypes,
      filters.reportType,
    );

    this.logger.log('Listing reports', {
      organizationId,
      limit,
      offset,
      sortBy,
      sortOrder,
      includeExpired,
    });

    const reports = await this.prisma.db.report.findMany({
      where: {
        organizationId,
        ...(filters.accessibleProjectIds
          ? {
              AND: [
                {
                  OR: [
                    { projectId: null },
                    { projectId: { in: filters.accessibleProjectIds } },
                  ],
                },
              ],
            }
          : {}),
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
        ...reportTypesFilter,
        ...(filters.audience
          ? { audience: filters.audience as PrismaReportAudience }
          : {}),
        ...(filters.sourceExecutionId
          ? { sourceExecutionId: filters.sourceExecutionId }
          : {}),
        ...(filters.parentReportId
          ? { parentReportId: filters.parentReportId }
          : {}),
        ...(filters.ragEnabled !== undefined
          ? { ragEnabled: filters.ragEnabled }
          : {}),
        ...(!includeExpired
          ? { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
          : {}),
        ...(filters.entityType && filters.entityId
          ? {
              reportEntities: {
                some: {
                  entityType: this.requireReportEntityType(filters.entityType),
                  entityId: filters.entityId,
                  ...(filters.relation
                    ? {
                        relation:
                          filters.relation as PrismaReportEntityRelation,
                      }
                    : {}),
                },
              },
            }
          : {}),
      },
      include: {
        reportEntities: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: offset,
      take: limit,
    });

    const nameMap = await this.resolveEntityNames(organizationId, reports);
    return reports.map((report) => this.toDto(report, nameMap));
  }

  async loadReportsForMessageIds(
    organizationId: OrganizationId,
    messageIds: string[],
  ): Promise<Map<string, ReportDto[]>> {
    const result = new Map<string, ReportDto[]>();
    if (messageIds.length === 0) {
      return result;
    }

    const uniqueIds = Array.from(new Set(messageIds));

    this.logger.log('Loading reports for message ids', {
      organizationId,
      messageCount: uniqueIds.length,
    });

    const reports = await this.prisma.db.report.findMany({
      where: {
        organizationId,
        audience: {
          in: USER_VISIBLE_PERSISTED_REPORT_AUDIENCES,
        },
        reportEntities: {
          some: {
            entityType: PrismaEntityType.MESSAGE,
            entityId: { in: uniqueIds },
          },
        },
      },
      include: {
        reportEntities: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (reports.length === 0) {
      return result;
    }

    const nameMap = await this.resolveEntityNames(organizationId, reports);
    const requestedIds = new Set(uniqueIds);

    for (const report of reports) {
      const dto = this.toDto(report, nameMap);
      const matchedMessageIds = new Set<string>();
      for (const entity of report.reportEntities) {
        if (
          entity.entityType === PrismaEntityType.MESSAGE &&
          requestedIds.has(entity.entityId)
        ) {
          matchedMessageIds.add(entity.entityId);
        }
      }

      for (const messageId of matchedMessageIds) {
        const bucket = result.get(messageId);
        if (bucket) {
          bucket.push(dto);
        } else {
          result.set(messageId, [dto]);
        }
      }
    }

    return result;
  }

  async listSummariesByEntity(
    organizationId: OrganizationId,
    entityId: string,
    reportTypeFilter?: string,
  ): Promise<ReportSummaryDto[]> {
    const reportType =
      reportTypeFilter === undefined
        ? undefined
        : this.resolveReportTypeFilter(reportTypeFilter);

    this.logger.log('Listing report summaries by entity', {
      organizationId,
      entityId,
      reportType: reportType ?? null,
    });

    const reports = await this.prisma.db.report.findMany({
      where: {
        organizationId,
        ...(reportType ? { reportType: reportType as PrismaReportType } : {}),
        reportEntities: {
          some: { entityId },
        },
      },
      select: {
        id: true,
        reportType: true,
        sourceExecutionId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return reports.map((report) => ({
      id: report.id,
      reportType: report.reportType as ReportType,
      sourceExecution: report.sourceExecutionId ?? null,
      createdAt: report.createdAt.toISOString(),
    }));
  }

  async handleReportCreatedFileTouchIndex(
    event: ReportCreatedEvent,
  ): Promise<FileTouchIndexingResult> {
    const result = await this.indexFileTouchesFromReportDto(
      event.payload.report,
    );
    if (result.status === 'skipped') {
      this.logger.warn(
        'Skipped file-touch indexing for report.created',
        result,
      );
    }
    return result;
  }

  async backfillFileTouchIndex(
    filters: BackfillFileTouchIndexFilters = {},
  ): Promise<BackfillFileTouchIndexResult> {
    const limit = this.resolveListLimit(filters.limit);
    const offset = this.resolveListOffset(filters.offset);
    const dryRun = filters.dryRun ?? false;
    const reports = await this.prisma.db.report.findMany({
      where: {
        reportType: PrismaReportType.IMPLEMENT,
        ...(filters.organizationId
          ? { organizationId: filters.organizationId }
          : {}),
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
        ...(filters.reportId ? { id: filters.reportId } : {}),
      },
      include: {
        reportEntities: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
      skip: offset,
      take: limit,
    });

    const results: FileTouchIndexingResult[] = [];
    for (const report of reports) {
      results.push(
        await this.indexFileTouchesFromReportDto(this.toDto(report), {
          dryRun,
        }),
      );
    }

    return {
      processed: results.length,
      indexed: results.filter((result) => result.status === 'indexed').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      dryRun,
      results,
    };
  }

  async listFileTouchesByFile(params: {
    organizationId: OrganizationId;
    projectId: string;
    serviceId: string;
    path: string;
  }): Promise<FileTouchIndexEntriesDto> {
    const normalizedPath = this.normalizeRepoRelativePath(params.path);
    if (!normalizedPath) {
      throw new BadRequestException('path must be a repo-relative file path');
    }

    const rows = await this.prisma.db.fileTouchIndex.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        serviceId: params.serviceId,
        normalizedPath,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      entries: rows.map((row) => this.toFileTouchIndexEntryDto(row)),
    } satisfies FileTouchIndexEntriesDto;
  }

  async listFileTouchesByWork(params: {
    organizationId: OrganizationId;
    projectId: string;
    entityType?: ReportRelatedEntityType;
    entityId?: string;
    featureId?: string;
    serviceId?: string;
  }): Promise<FileTouchReferenceCandidatesDto> {
    const hasFeatureLookup = params.featureId !== undefined;
    const hasEntityType = params.entityType !== undefined;
    const hasEntityId = params.entityId !== undefined;

    const lookupMode = hasFeatureLookup ? 'feature' : 'task';
    this.logger.debug('Selecting file-touch lookup mode', {
      lookupMode,
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: params.entityType,
      entityId: params.entityId,
      featureId: params.featureId,
      serviceId: params.serviceId,
    });

    if (
      (hasFeatureLookup && (hasEntityType || hasEntityId)) ||
      (!hasFeatureLookup && (!hasEntityType || !hasEntityId))
    ) {
      this.logger.debug('Rejected file-touch lookup mode', {
        reason: 'lookup modes are not mutually exclusive or complete',
        hasFeatureLookup,
        hasEntityType,
        hasEntityId,
      });
      throw new BadRequestException(
        'Provide exactly one file-touch lookup mode: featureId or entityType with entityId',
      );
    }

    if (
      !hasFeatureLookup &&
      params.entityType !== ReportRelatedEntityType.Task
    ) {
      this.logger.debug('Rejected file-touch task lookup', {
        reason: 'task lookup requires entityType=TASK',
        entityType: params.entityType,
      });
      throw new BadRequestException(
        'Task file-touch lookup requires entityType=TASK',
      );
    }

    if (hasFeatureLookup) {
      this.logger.debug('Selected direct file-touch feature scope', {
        featureId: params.featureId,
      });
    }

    const attachedEntityType = hasFeatureLookup ? null : PrismaEntityType.TASK;

    const rows = await this.prisma.db.fileTouchIndex.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        ...(hasFeatureLookup
          ? {
              featureId: params.featureId,
              attachedEntityType: PrismaEntityType.TASK,
            }
          : {
              attachedEntityType: attachedEntityType!,
              attachedEntityId: params.entityId,
            }),
        ...(params.serviceId ? { serviceId: params.serviceId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    this.logger.debug('Loaded file-touch evidence', {
      lookupMode,
      evidenceCount: rows.length,
      featureId: params.featureId,
    });

    const serviceIds = Array.from(new Set(rows.map((row) => row.serviceId)));
    const services = serviceIds.length
      ? await this.prisma.db.service.findMany({
          where: {
            organizationId: params.organizationId,
            id: { in: serviceIds },
          },
          select: { id: true, name: true },
        })
      : [];
    const serviceNamesById = new Map(
      services.map((service) => [service.id, service.name]),
    );

    this.logger.debug('Resolved file-touch service identities', {
      requestedServiceCount: serviceIds.length,
      resolvedServiceCount: serviceNamesById.size,
      serviceIds,
    });

    const unresolvedServiceIds = serviceIds.filter(
      (serviceId) => !serviceNamesById.has(serviceId),
    );
    if (unresolvedServiceIds.length > 0) {
      this.logger.error('Failed to resolve file-touch service identities', {
        organizationId: params.organizationId,
        unresolvedServiceIds,
      });
      throw new NotFoundException(
        `Unable to resolve service identity for file-touch candidates: ${unresolvedServiceIds.join(', ')}`,
      );
    }

    const candidatesByKey = new Map<string, FileTouchReferenceCandidateDto>();
    for (const row of rows) {
      const key = JSON.stringify([row.serviceId, row.normalizedPath]);
      if (candidatesByKey.has(key)) {
        continue;
      }

      const serviceName = serviceNamesById.get(row.serviceId);
      if (serviceName === undefined) {
        this.logger.error(
          'File-touch service identity disappeared during mapping',
          {
            serviceId: row.serviceId,
            normalizedPath: row.normalizedPath,
          },
        );
        throw new NotFoundException(
          `Unable to resolve service identity for file-touch candidate: ${row.serviceId}`,
        );
      }

      candidatesByKey.set(key, {
        serviceId: row.serviceId,
        serviceName,
        normalizedPath: row.normalizedPath,
      } satisfies FileTouchReferenceCandidateDto);
    }

    const candidates = Array.from(candidatesByKey.values());
    this.logger.debug('Deduplicated file-touch evidence', {
      evidenceCount: rows.length,
      candidateCount: candidates.length,
      duplicateCount: rows.length - candidates.length,
    });

    return { candidates } satisfies FileTouchReferenceCandidatesDto;
  }

  async listFileHistoryByWork(params: {
    organizationId: OrganizationId;
    projectId: string;
    entityType?: ReportRelatedEntityType;
    entityId?: string;
    featureId?: string;
    serviceId?: string;
  }): Promise<FileTouchWorkHistoryDto> {
    const hasFeatureLookup = params.featureId !== undefined;
    const hasEntityType = params.entityType !== undefined;
    const hasEntityId = params.entityId !== undefined;

    this.logger.debug('Selecting production file-history lookup mode', {
      lookupMode: hasFeatureLookup ? 'feature' : 'task',
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: params.entityType,
      entityId: params.entityId,
      featureId: params.featureId,
      serviceId: params.serviceId,
    });

    if (
      (hasFeatureLookup && (hasEntityType || hasEntityId)) ||
      (!hasFeatureLookup && (!hasEntityType || !hasEntityId))
    ) {
      this.logger.debug('Rejected production file-history lookup mode', {
        reason: 'lookup modes are not mutually exclusive or complete',
        hasFeatureLookup,
        hasEntityType,
        hasEntityId,
      });
      throw new BadRequestException(
        'Provide exactly one production file-history lookup mode: featureId or entityType with entityId',
      );
    }

    if (
      !hasFeatureLookup &&
      params.entityType !== ReportRelatedEntityType.Task
    ) {
      throw new BadRequestException(
        'Task file-history lookup requires entityType=TASK',
      );
    }

    if (!hasFeatureLookup) {
      const task = await this.prisma.db.task.findFirst({
        where: {
          id: params.entityId,
          organizationId: params.organizationId,
          projectId: params.projectId,
          archivedAt: null,
          type: {
            in: [WORK_ITEM_TYPE_KEYS.Standard, WORK_ITEM_TYPE_KEYS.Bug],
          },
        },
        select: { id: true, type: true },
      });
      if (!task) {
        this.logger.error('Failed to resolve focal file-history task', {
          organizationId: params.organizationId,
          projectId: params.projectId,
          entityId: params.entityId,
        });
        throw new NotFoundException(
          `Unable to resolve active STANDARD or BUG file-history task: ${params.entityId}`,
        );
      }

      const rows = await this.prisma.db.fileTouchIndex.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          attachedEntityType: PrismaEntityType.TASK,
          attachedEntityId: task.id,
          ...(params.serviceId ? { serviceId: params.serviceId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });

      this.logger.debug('Loaded focal task file-history evidence', {
        taskId: task.id,
        taskType: task.type,
        evidenceCount: rows.length,
      });

      const serviceNamesById = await this.resolveFileTouchServiceNames({
        organizationId: params.organizationId,
        rows,
        context: 'production task file history',
      });
      const files = this.deduplicateFileHistoryRows(rows, serviceNamesById);

      this.logger.debug('Deduplicated focal task file-history evidence', {
        taskId: task.id,
        evidenceCount: rows.length,
        fileCount: files.length,
      });

      return {
        kind: FileTouchTaskFilesDto.KindEnum.Task,
        files,
      } satisfies FileTouchTaskFilesDto;
    }

    const subtreeRows = await this.prisma.db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE feature_subtree AS (
        SELECT id
        FROM   tasks
        WHERE  id = ${params.featureId}
          AND  organization_id = ${params.organizationId}
          AND  project_id = ${params.projectId}
          AND  type = 'FEATURE'
          AND  archived_at IS NULL
        UNION ALL
        SELECT t.id
        FROM   tasks t
        JOIN   feature_subtree fs ON t.parent_task_id = fs.id
        WHERE  t.organization_id = ${params.organizationId}
          AND  t.project_id = ${params.projectId}
          AND  t.type = 'FEATURE'
          AND  t.archived_at IS NULL
      )
      SELECT id FROM feature_subtree
    `;
    const subtreeIds = subtreeRows.map((row) => row.id);
    if (subtreeIds.length === 0) {
      this.logger.error('Failed to resolve focal file-history feature', {
        organizationId: params.organizationId,
        projectId: params.projectId,
        featureId: params.featureId,
      });
      throw new NotFoundException(
        `Unable to resolve active FEATURE file-history scope: ${params.featureId}`,
      );
    }

    this.logger.debug('Resolved production file-history feature subtree', {
      featureId: params.featureId,
      subtreeSize: subtreeIds.length,
      subtreeIds,
    });

    const [rows, activeFeatures] = await Promise.all([
      this.prisma.db.fileTouchIndex.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          attachedEntityType: PrismaEntityType.TASK,
          featureId: { in: subtreeIds },
          ...(params.serviceId ? { serviceId: params.serviceId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.db.task.findMany({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          type: WORK_ITEM_TYPE_KEYS.Feature,
          archivedAt: null,
        },
        select: { id: true, name: true, parentTaskId: true },
      }),
    ]);

    this.logger.debug('Loaded sectioned feature file-history evidence', {
      featureId: params.featureId,
      evidenceCount: rows.length,
      directOwnerCount: new Set(rows.map((row) => row.featureId)).size,
    });

    const featureById = new Map<string, ActiveFeatureHierarchyEntry>(
      activeFeatures.map((feature) => [feature.id, feature]),
    );
    const unresolvedSubtreeIds = subtreeIds.filter(
      (featureId) => !featureById.has(featureId),
    );
    if (unresolvedSubtreeIds.length > 0) {
      this.logger.error('Failed to resolve file-history feature identities', {
        organizationId: params.organizationId,
        projectId: params.projectId,
        unresolvedSubtreeIds,
      });
      throw new NotFoundException(
        `Unable to resolve feature identity for file-history sections: ${unresolvedSubtreeIds.join(', ')}`,
      );
    }

    const serviceNamesById = await this.resolveFileTouchServiceNames({
      organizationId: params.organizationId,
      rows,
      context: 'production feature file history',
    });
    const rowsByFeatureId = new Map<string, FileTouchIndex[]>();
    for (const row of rows) {
      if (row.featureId === null) {
        this.logger.error(
          'Feature-scoped file-history evidence has no direct feature owner',
          { fileTouchIndexId: row.id },
        );
        throw new NotFoundException(
          `Unable to resolve direct feature identity for file-history evidence: ${row.id}`,
        );
      }
      const featureRows = rowsByFeatureId.get(row.featureId) ?? [];
      featureRows.push(row);
      rowsByFeatureId.set(row.featureId, featureRows);
    }

    const sections = Array.from(rowsByFeatureId.entries())
      .map(([featureId, featureRows]) => {
        const feature = featureById.get(featureId);
        if (!feature) {
          throw new NotFoundException(
            `Unable to resolve feature identity for file-history section: ${featureId}`,
          );
        }
        return {
          featureId,
          featureName: feature.name,
          featurePath: this.buildActiveFeaturePath(feature, featureById),
          files: this.deduplicateFileHistoryRows(featureRows, serviceNamesById),
        } satisfies FileTouchFeatureSectionDto;
      })
      .sort((left, right) => left.featurePath.localeCompare(right.featurePath));

    this.logger.debug('Sectioned and deduplicated feature file history', {
      featureId: params.featureId,
      evidenceCount: rows.length,
      sectionCount: sections.length,
      fileCount: sections.reduce(
        (total, section) => total + section.files.length,
        0,
      ),
    });

    return {
      kind: FileTouchFeatureFilesDto.KindEnum.Feature,
      sections,
    } satisfies FileTouchFeatureFilesDto;
  }

  async listFileHistoryByFile(params: {
    organizationId: OrganizationId;
    projectId: string;
    serviceId: string;
    path: string;
  }): Promise<FileTouchTaskHistoryDto> {
    const normalizedPath = this.normalizeRepoRelativePath(params.path);
    if (!normalizedPath) {
      throw new BadRequestException('path must be a repo-relative file path');
    }

    this.logger.debug('Normalized reverse file-history identity', {
      organizationId: params.organizationId,
      projectId: params.projectId,
      serviceId: params.serviceId,
      requestedPath: params.path,
      normalizedPath,
    });

    const rows = await this.prisma.db.fileTouchIndex.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        serviceId: params.serviceId,
        normalizedPath,
        attachedEntityType: PrismaEntityType.TASK,
      },
      orderBy: { createdAt: 'desc' },
    });

    this.logger.debug('Loaded reverse file-history evidence', {
      serviceId: params.serviceId,
      normalizedPath,
      evidenceCount: rows.length,
    });

    const taskIds = Array.from(
      new Set(rows.map((row) => row.attachedEntityId)),
    );
    const tasks = taskIds.length
      ? await this.prisma.db.task.findMany({
          where: {
            id: { in: taskIds },
            organizationId: params.organizationId,
            projectId: params.projectId,
            archivedAt: null,
          },
          select: { id: true, name: true, type: true },
        })
      : [];
    const tasksById = new Map<string, (typeof tasks)[number]>(
      tasks.map((task) => [task.id, task]),
    );
    const unresolvedTaskIds = taskIds.filter(
      (taskId) => !tasksById.has(taskId),
    );
    if (unresolvedTaskIds.length > 0) {
      this.logger.error('Failed to resolve reverse file-history tasks', {
        organizationId: params.organizationId,
        projectId: params.projectId,
        unresolvedTaskIds,
      });
      throw new NotFoundException(
        `Unable to resolve active task identity for file history: ${unresolvedTaskIds.join(', ')}`,
      );
    }

    const groupedRows = new Map<string, FileTouchIndex[]>();
    for (const row of rows) {
      const taskRows = groupedRows.get(row.attachedEntityId) ?? [];
      taskRows.push(row);
      groupedRows.set(row.attachedEntityId, taskRows);
    }

    const directFeatureIds = Array.from(
      new Set(
        Array.from(groupedRows.values())
          .map((taskRows) => taskRows[0]?.featureId)
          .filter((featureId): featureId is string => Boolean(featureId)),
      ),
    );
    const directFeatures = directFeatureIds.length
      ? await this.prisma.db.task.findMany({
          where: {
            id: { in: directFeatureIds },
            organizationId: params.organizationId,
            projectId: params.projectId,
            type: WORK_ITEM_TYPE_KEYS.Feature,
            archivedAt: null,
          },
          select: { id: true, name: true },
        })
      : [];
    const featureNamesById = new Map<string, string>(
      directFeatures.map((feature) => [feature.id, feature.name]),
    );
    const unresolvedFeatureIds = directFeatureIds.filter(
      (featureId) => !featureNamesById.has(featureId),
    );
    if (unresolvedFeatureIds.length > 0) {
      this.logger.error(
        'Failed to resolve reverse file-history feature identities',
        {
          organizationId: params.organizationId,
          projectId: params.projectId,
          unresolvedFeatureIds,
        },
      );
      throw new NotFoundException(
        `Unable to resolve direct feature identity for file history: ${unresolvedFeatureIds.join(', ')}`,
      );
    }

    const agentSessionIds = Array.from(
      new Set(rows.map((row) => row.agentSessionId)),
    );
    const agentSessions = agentSessionIds.length
      ? await this.prisma.db.agentSession.findMany({
          where: {
            id: { in: agentSessionIds },
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
          select: { id: true, title: true },
        })
      : [];
    const agentSessionTitlesById = new Map<string, string>(
      agentSessions.map((agentSession) => [
        agentSession.id,
        agentSession.title,
      ]),
    );
    const unresolvedAgentSessionIds = agentSessionIds.filter(
      (agentSessionId) => !agentSessionTitlesById.has(agentSessionId),
    );
    if (unresolvedAgentSessionIds.length > 0) {
      this.logger.error(
        'Failed to resolve reverse file-history agent sessions',
        {
          organizationId: params.organizationId,
          projectId: params.projectId,
          unresolvedAgentSessionIds,
        },
      );
      throw new NotFoundException(
        `Unable to resolve agent session identity for file history: ${unresolvedAgentSessionIds.join(', ')}`,
      );
    }

    const taskHistory = Array.from(groupedRows.entries())
      .map(([taskId, taskRows]) => {
        const task = tasksById.get(taskId);
        if (!task) {
          throw new NotFoundException(
            `Unable to resolve active task identity for file history: ${taskId}`,
          );
        }

        const latestRow = taskRows[0];
        if (!latestRow) {
          throw new NotFoundException(
            `Unable to resolve file-history evidence for task: ${taskId}`,
          );
        }
        const directFeatureId = latestRow.featureId;
        const directFeatureName =
          directFeatureId === null
            ? null
            : featureNamesById.get(directFeatureId);
        if (directFeatureId !== null && directFeatureName === undefined) {
          throw new NotFoundException(
            `Unable to resolve direct feature identity for file history: ${directFeatureId}`,
          );
        }

        const evidence = taskRows
          .map((row) => {
            const agentSessionTitle = agentSessionTitlesById.get(
              row.agentSessionId,
            );
            if (!agentSessionTitle) {
              throw new NotFoundException(
                `Unable to resolve agent session identity for file history: ${row.agentSessionId}`,
              );
            }
            return {
              reportId: row.reportId,
              agentSessionId: row.agentSessionId,
              agentSessionTitle,
              createdAt: row.createdAt.toISOString(),
            } satisfies FileTouchTaskHistoryEvidenceDto;
          })
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        const firstEvidence = evidence[0];
        const lastEvidence = evidence[evidence.length - 1];
        if (!firstEvidence || !lastEvidence) {
          throw new NotFoundException(
            `Unable to resolve file-history evidence for task: ${taskId}`,
          );
        }

        return {
          taskId,
          taskName: task.name,
          taskType: task.type,
          directFeatureId,
          directFeatureName: directFeatureName ?? null,
          touchCount: taskRows.length,
          firstTouchedAt: firstEvidence.createdAt,
          lastTouchedAt: lastEvidence.createdAt,
          evidence,
        } satisfies FileTouchTaskHistoryEntryDto;
      })
      .sort(
        (left, right) =>
          right.lastTouchedAt.localeCompare(left.lastTouchedAt) ||
          left.taskName.localeCompare(right.taskName) ||
          left.taskId.localeCompare(right.taskId),
      );

    this.logger.debug('Grouped reverse file-history evidence', {
      serviceId: params.serviceId,
      normalizedPath,
      evidenceCount: rows.length,
      taskCount: taskHistory.length,
    });

    return { tasks: taskHistory } satisfies FileTouchTaskHistoryDto;
  }

  async listFileHistoryByService(params: {
    organizationId: OrganizationId;
    projectId: string;
    serviceId: string;
    pathFilter?: string;
    sortBy?: FileTouchServiceHistorySortBy;
    sortOrder?: FileTouchServiceHistorySortOrder;
    cursor?: string;
    limit?: number;
  }): Promise<FileTouchServiceHistoryDto> {
    const sortBy = params.sortBy ?? FileTouchServiceHistorySortBy.LastTouchedAt;
    const sortOrder = params.sortOrder ?? FileTouchServiceHistorySortOrder.Desc;
    const limit = params.limit ?? 50;
    const pathFilter = params.pathFilter?.trim().toLocaleLowerCase() ?? '';
    this.validateFileTouchServiceHistoryInputs({ sortBy, sortOrder, limit });

    const service = await this.prisma.db.service.findFirst({
      where: {
        id: params.serviceId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        archivedAt: null,
      },
      select: { id: true, name: true },
    });
    if (!service) {
      throw new NotFoundException(
        'Unable to resolve active Service for file history',
      );
    }

    const rows = await this.prisma.db.fileTouchIndex.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        serviceId: params.serviceId,
        attachedEntityType: PrismaEntityType.TASK,
      },
      orderBy: { createdAt: 'desc' },
    });
    const taskIds = Array.from(
      new Set(rows.map((row) => row.attachedEntityId)),
    );
    const tasks = taskIds.length
      ? await this.prisma.db.task.findMany({
          where: {
            id: { in: taskIds },
            organizationId: params.organizationId,
            projectId: params.projectId,
            archivedAt: null,
          },
          select: { id: true, name: true, type: true },
        })
      : [];
    const tasksById = new Map<string, (typeof tasks)[number]>(
      tasks.map((task) => [task.id, task]),
    );
    const activeRows = rows.filter((row) =>
      tasksById.has(row.attachedEntityId),
    );
    const rowsByPath = new Map<string, FileTouchIndex[]>();
    for (const row of activeRows) {
      const pathRows = rowsByPath.get(row.normalizedPath) ?? [];
      pathRows.push(row);
      rowsByPath.set(row.normalizedPath, pathRows);
    }

    const latestRows = Array.from(rowsByPath.values())
      .map((pathRows) => pathRows[0])
      .filter((row): row is FileTouchIndex => row !== undefined);
    const sessionIds = Array.from(
      new Set(latestRows.map((row) => row.agentSessionId)),
    );
    const sessions = sessionIds.length
      ? await this.prisma.db.agentSession.findMany({
          where: {
            id: { in: sessionIds },
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
          select: { id: true, title: true },
        })
      : [];
    const sessionsById = new Map<string, (typeof sessions)[number]>(
      sessions.map((session) => [session.id, session]),
    );

    const entries = Array.from(rowsByPath.entries())
      .map(([normalizedPath, pathRows]) => {
        const latestRow = pathRows[0];
        const oldestRow = pathRows[pathRows.length - 1];
        if (!latestRow || !oldestRow) {
          throw new NotFoundException(
            'Unable to resolve file history evidence',
          );
        }
        const task = tasksById.get(latestRow.attachedEntityId);
        const session = sessionsById.get(latestRow.agentSessionId);
        if (!task || !session) {
          throw new NotFoundException(
            'Unable to resolve latest task or agent session for file history',
          );
        }
        return {
          serviceId: service.id,
          serviceName: service.name,
          normalizedPath,
          touchCount: pathRows.length,
          firstTouchedAt: oldestRow.createdAt.toISOString(),
          lastTouchedAt: latestRow.createdAt.toISOString(),
          latestTaskId: task.id,
          latestTaskName: task.name,
          latestTaskType: task.type,
          latestAgentSessionId: session.id,
          latestAgentSessionTitle: session.title,
          latestReportId: latestRow.reportId,
        } satisfies FileTouchServiceHistoryEntryDto;
      })
      .filter((entry) =>
        entry.normalizedPath.toLocaleLowerCase().includes(pathFilter),
      )
      .sort(this.compareFileTouchServiceHistory(sortBy, sortOrder));

    const cursor = params.cursor
      ? this.decodeFileTouchServiceHistoryCursor(params.cursor)
      : null;
    let startIndex = 0;
    if (cursor) {
      if (
        cursor.sortBy !== sortBy ||
        cursor.sortOrder !== sortOrder ||
        cursor.pathFilter !== pathFilter
      ) {
        throw new BadRequestException(
          'cursor does not match the requested collection',
        );
      }
      const cursorIndex = entries.findIndex(
        (entry) =>
          entry.normalizedPath === cursor.normalizedPath &&
          this.fileTouchServiceHistorySortValue(entry, sortBy) === cursor.value,
      );
      if (cursorIndex < 0) {
        throw new BadRequestException(
          'cursor no longer identifies a collection row',
        );
      }
      startIndex = cursorIndex + 1;
    }

    const files = entries.slice(startIndex, startIndex + limit);
    const last = files[files.length - 1];
    const hasMore = startIndex + files.length < entries.length;
    return {
      files,
      nextCursor:
        hasMore && last
          ? this.encodeFileTouchServiceHistoryCursor({
              version: 1,
              sortBy,
              sortOrder,
              pathFilter,
              value: this.fileTouchServiceHistorySortValue(last, sortBy),
              normalizedPath: last.normalizedPath,
            })
          : null,
    } satisfies FileTouchServiceHistoryDto;
  }

  async findOne(
    organizationId: OrganizationId,
    reportId: string,
  ): Promise<ReportDto> {
    const report = await this.prisma.db.report.findFirst({
      where: {
        id: reportId,
        organizationId,
      },
      include: {
        reportEntities: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const nameMap = await this.resolveEntityNames(organizationId, [report]);
    return this.toDto(report, nameMap);
  }

  async update(
    organizationId: OrganizationId,
    reportId: string,
    dto: UpdateReportDto,
  ): Promise<ReportDto> {
    const existing = await this.prisma.db.report.findFirst({
      where: {
        id: reportId,
        organizationId,
      },
      select: { id: true, payload: true, reportType: true },
    });

    if (!existing) {
      throw new NotFoundException('Report not found');
    }
    if (existing.reportType === PrismaReportType.PLAN) {
      this.validatePlanPayloadShape(organizationId, dto.payload);
    }

    if (dto.payload !== undefined) {
      validateProjectReportPayload(existing.reportType, dto.payload);
      validateChangeWalkthroughPayload(existing.reportType, dto.payload);
      validateCodingResearchPayload(existing.reportType, dto.payload);
    }

    const schemaVersion =
      dto.schemaVersion === undefined
        ? undefined
        : this.resolveSchemaVersion(dto.schemaVersion);
    const requestedAudience =
      dto.audience === undefined
        ? undefined
        : this.validateAndReturnReportAudience(dto.audience);
    const audience =
      existing.reportType === PrismaReportType.PHASE_GROUNDING
        ? ReportAudience.WorkflowOnly
        : requestedAudience;
    const expiresAt =
      dto.expiresAt === undefined
        ? undefined
        : this.resolveExpiresAt(dto.expiresAt);
    const replaceEntities = dto.entities !== undefined;
    const callerEntityCreates = (dto.entities ?? []).map((entity) =>
      this.toReportEntityCreateInput(entity),
    );

    if (dto.parentReportId) {
      this.rejectSelfReference(reportId, dto.parentReportId);
      await this.validateParentReportExists(organizationId, dto.parentReportId);
    }

    const updated = await this.prisma.db.$transaction(async (tx) => {
      const linkedContextCreates = this.materializeLinkedEntities(
        dto.linkedEntities,
      );

      const entityCreates = replaceEntities
        ? this.dedupeEntityCreates([
            ...callerEntityCreates,
            ...linkedContextCreates,
          ])
        : [];

      const updatedReport = await tx.report.update({
        where: { id: reportId },
        data: {
          payload: this.toPersistedReportPayload(
            dto.payload,
            dto.agent,
            existing.payload,
          ),
          version: { increment: 1 },
          ...(audience !== undefined
            ? { audience: audience as PrismaReportAudience }
            : {}),
          ...(schemaVersion !== undefined ? { schemaVersion } : {}),
          ...(expiresAt !== undefined ? { expiresAt } : {}),
          ...(dto.sourceExecutionId !== undefined
            ? { sourceExecutionId: dto.sourceExecutionId }
            : {}),
          ...(dto.parentReportId !== undefined
            ? { parentReportId: dto.parentReportId ?? null }
            : {}),
          ...(replaceEntities
            ? {
                reportEntities: {
                  deleteMany: {},
                  ...(entityCreates.length > 0
                    ? { create: entityCreates }
                    : {}),
                },
              }
            : {}),
        },
        include: {
          reportEntities: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!replaceEntities && linkedContextCreates.length > 0) {
        const existingKeys = new Set(
          updatedReport.reportEntities.map(
            (e) => `${e.entityType}:${e.entityId}:${e.relation}`,
          ),
        );
        const newRows = linkedContextCreates.filter(
          (row) =>
            !existingKeys.has(
              `${row.entityType}:${row.entityId}:${row.relation}`,
            ),
        );
        if (newRows.length > 0) {
          await tx.reportEntity.createMany({
            data: newRows.map((row) => ({
              reportId: updatedReport.id,
              entityType: row.entityType,
              entityId: row.entityId,
              relation: row.relation,
            })),
          });
          const refreshed = await tx.report.findUnique({
            where: { id: reportId },
            include: {
              reportEntities: {
                orderBy: { createdAt: 'asc' },
              },
            },
          });
          if (!refreshed) {
            throw new NotFoundException('Report not found');
          }
          await this.publishEvalReportEvent(tx, organizationId, refreshed);
          return refreshed;
        }
      }

      await this.publishEvalReportEvent(tx, organizationId, updatedReport);
      return updatedReport;
    });

    return this.toDto(updated);
  }

  async remove(
    organizationId: OrganizationId,
    reportId: string,
  ): Promise<void> {
    const existing = await this.prisma.db.report.findFirst({
      where: {
        id: reportId,
        organizationId,
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Report not found');
    }

    await this.prisma.db.report.delete({
      where: {
        id: reportId,
      },
    });
  }

  async deleteExpiredReports(batchSize: number): Promise<number> {
    const normalizedBatchSize = Math.max(Math.floor(batchSize), 1);
    let totalDeleted = 0;

    while (true) {
      const expiredBatch = await this.prisma.db.report.findMany({
        where: {
          expiresAt: { lte: new Date() },
        },
        select: { id: true },
        orderBy: { expiresAt: 'asc' },
        take: normalizedBatchSize,
      });

      if (expiredBatch.length === 0) {
        break;
      }

      const deleteResult = await this.prisma.db.report.deleteMany({
        where: {
          id: { in: expiredBatch.map((report) => report.id) },
        },
      });

      totalDeleted += deleteResult.count;

      if (expiredBatch.length < normalizedBatchSize) {
        break;
      }
    }

    return totalDeleted;
  }

  async deleteReportsAttachedToEntity(params: {
    organizationId: OrganizationId;
    entityId: string;
    entityType: PrismaEntityType;
    projectId?: string | null;
  }): Promise<number> {
    const { organizationId, entityId, entityType, projectId } = params;

    this.logger.log('Deleting reports for entity', {
      organizationId,
      entityId,
      entityType,
      projectId,
    });

    const deleteResult = await this.prisma.db.report.deleteMany({
      where: {
        organizationId,
        reportEntities: {
          some: {
            entityType,
            entityId,
          },
        },
      },
    });

    const deletedCount = deleteResult.count;
    this.logger.log('Deleted reports for entity', {
      organizationId,
      entityId,
      entityType,
      deletedCount,
    });

    return deletedCount;
  }

  private resolvePrimaryResearchEntity(
    input: CreateCodingResearchReportInput,
  ): {
    entityType: ReportRelatedEntityType;
    entityId: string;
  } {
    if (input.taskId && input.designDocId) {
      this.logger.warn(
        'Rejected coding research report: both taskId and designDocId provided',
      );
      throw new BadRequestException(
        'Coding research report requires exactly one primary target entity',
      );
    }

    if (!input.taskId && !input.designDocId) {
      this.logger.warn(
        'Rejected coding research report: missing taskId and designDocId',
      );
      throw new BadRequestException(
        'Coding research report requires a taskId or designDocId target',
      );
    }

    if (input.taskId) {
      return {
        entityType: ReportRelatedEntityType.Task,
        entityId: input.taskId,
      };
    }

    return {
      entityType: ReportRelatedEntityType.DesignDoc,
      entityId: input.designDocId as string,
    };
  }

  private async indexFileTouchesFromReportDto(
    report: ReportDto,
    opts: { dryRun?: boolean } = {},
  ): Promise<FileTouchIndexingResult> {
    if (report.reportType !== ReportType.Implement) {
      return {
        reportId: report.id,
        status: 'skipped',
        indexedCount: 0,
        reason: 'not an IMPLEMENT report',
      };
    }

    const extraction = await this.extractFileTouchIndexInput(report);
    if (!extraction.ok) {
      return {
        reportId: report.id,
        status: 'skipped',
        indexedCount: 0,
        reason: extraction.reason,
      };
    }

    if (opts.dryRun) {
      return {
        reportId: report.id,
        status: 'indexed',
        indexedCount: extraction.value.normalizedPaths.length,
      };
    }

    const { createdCount, attributedCount } = await this.prisma.db.$transaction(
      async (tx) => {
        const attributed = extraction.value.featureId
          ? await tx.fileTouchIndex.updateMany({
              where: {
                reportId: extraction.value.reportId,
                normalizedPath: { in: extraction.value.normalizedPaths },
                featureId: null,
              },
              data: { featureId: extraction.value.featureId },
            })
          : { count: 0 };
        const created = await tx.fileTouchIndex.createMany({
          data: extraction.value.normalizedPaths.map((normalizedPath) => ({
            organizationId: report.organizationId,
            projectId: extraction.value.projectId,
            serviceId: extraction.value.serviceId,
            featureId: extraction.value.featureId,
            attachedEntityType: extraction.value.attachedEntityType,
            attachedEntityId: extraction.value.attachedEntityId,
            reportId: extraction.value.reportId,
            agentSessionId: extraction.value.agentSessionId,
            normalizedPath,
          })),
          skipDuplicates: true,
        });
        return {
          createdCount: created.count,
          attributedCount: attributed.count,
        };
      },
    );

    return {
      reportId: report.id,
      status: 'indexed',
      indexedCount: createdCount + attributedCount,
    };
  }

  private async extractFileTouchIndexInput(
    report: ReportDto,
  ): Promise<
    { ok: true; value: FileTouchExtraction } | { ok: false; reason: string }
  > {
    const payload = this.asImplementReportPayload(report.payload);
    if (!payload) {
      return { ok: false, reason: 'invalid IMPLEMENT payload' };
    }

    const normalizedPaths = this.normalizeChangedFiles(payload.filesChanged);
    if (normalizedPaths.length === 0) {
      return { ok: false, reason: 'no valid changed file paths' };
    }

    const projectId = report.projectId;
    if (!projectId) {
      return { ok: false, reason: 'missing projectId' };
    }

    const attachedEntity = this.resolveAttachedWorkEntity(report);
    if (!attachedEntity) {
      return {
        ok: false,
        reason: 'missing or ambiguous attached work entity',
      };
    }

    const agentSessionId = this.resolveAgentSessionId(report);
    if (!agentSessionId) {
      return { ok: false, reason: 'missing agent session context' };
    }

    const serviceId = await this.resolveServiceId(report, agentSessionId);
    if (!serviceId) {
      return { ok: false, reason: 'missing service context' };
    }

    const featureId = await this.resolveFeatureId(attachedEntity);

    return {
      ok: true,
      value: {
        projectId,
        serviceId,
        featureId,
        attachedEntityType: attachedEntity.entityType,
        attachedEntityId: attachedEntity.entityId,
        reportId: report.id,
        agentSessionId,
        normalizedPaths,
      },
    };
  }

  private asImplementReportPayload(
    payload: ReportPayload,
  ): ImplementReportPayload | null {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('reportType' in payload) ||
      payload.reportType !== ReportType.Implement ||
      !('filesChanged' in payload) ||
      !Array.isArray(payload.filesChanged) ||
      payload.filesChanged.some((file) => typeof file !== 'string')
    ) {
      return null;
    }

    return payload as ImplementReportPayload;
  }

  private normalizeChangedFiles(filesChanged: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const file of filesChanged) {
      const normalized = this.normalizeRepoRelativePath(file);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(normalized);
    }
    return result;
  }

  private async resolveFileTouchServiceNames(params: {
    organizationId: OrganizationId;
    rows: FileTouchIndex[];
    context: string;
  }): Promise<Map<string, string>> {
    const serviceIds = Array.from(
      new Set(params.rows.map((row) => row.serviceId)),
    );
    const services = serviceIds.length
      ? await this.prisma.db.service.findMany({
          where: {
            organizationId: params.organizationId,
            id: { in: serviceIds },
          },
          select: { id: true, name: true },
        })
      : [];
    const serviceNamesById = new Map(
      services.map((service) => [service.id, service.name]),
    );
    const unresolvedServiceIds = serviceIds.filter(
      (serviceId) => !serviceNamesById.has(serviceId),
    );

    this.logger.debug('Resolved production file-history service identities', {
      context: params.context,
      requestedServiceCount: serviceIds.length,
      resolvedServiceCount: serviceNamesById.size,
      serviceIds,
    });

    if (unresolvedServiceIds.length > 0) {
      this.logger.error('Failed to resolve production file-history services', {
        context: params.context,
        organizationId: params.organizationId,
        unresolvedServiceIds,
      });
      throw new NotFoundException(
        `Unable to resolve service identity for ${params.context}: ${unresolvedServiceIds.join(', ')}`,
      );
    }

    return serviceNamesById;
  }

  private deduplicateFileHistoryRows(
    rows: FileTouchIndex[],
    serviceNamesById: Map<string, string>,
  ): FileTouchHistoryFileDto[] {
    const filesByIdentity = new Map<string, FileTouchHistoryFileDto>();
    for (const row of rows) {
      const identity = JSON.stringify([row.serviceId, row.normalizedPath]);
      if (filesByIdentity.has(identity)) {
        continue;
      }
      const serviceName = serviceNamesById.get(row.serviceId);
      if (serviceName === undefined) {
        throw new NotFoundException(
          `Unable to resolve service identity for production file history: ${row.serviceId}`,
        );
      }
      filesByIdentity.set(identity, {
        serviceId: row.serviceId,
        serviceName,
        normalizedPath: row.normalizedPath,
      } satisfies FileTouchHistoryFileDto);
    }
    return Array.from(filesByIdentity.values());
  }

  private buildActiveFeaturePath(
    feature: ActiveFeatureHierarchyEntry,
    featureById: Map<string, ActiveFeatureHierarchyEntry>,
  ): string {
    const path: string[] = [];
    const visited = new Set<string>();
    let current: ActiveFeatureHierarchyEntry | undefined = feature;

    while (current) {
      if (visited.has(current.id)) {
        throw new BadRequestException(
          `Feature hierarchy contains a cycle at ${current.id}`,
        );
      }
      visited.add(current.id);
      path.unshift(current.name);
      current = current.parentTaskId
        ? featureById.get(current.parentTaskId)
        : undefined;
    }

    return path.join(' / ');
  }

  private validateFileTouchServiceHistoryInputs(params: {
    sortBy: FileTouchServiceHistorySortBy;
    sortOrder: FileTouchServiceHistorySortOrder;
    limit: number;
  }): void {
    if (!Object.values(FileTouchServiceHistorySortBy).includes(params.sortBy)) {
      throw new BadRequestException('sortBy is not supported');
    }
    if (
      !Object.values(FileTouchServiceHistorySortOrder).includes(
        params.sortOrder,
      )
    ) {
      throw new BadRequestException('sortOrder is not supported');
    }
    if (
      !Number.isInteger(params.limit) ||
      params.limit < 1 ||
      params.limit > 100
    ) {
      throw new BadRequestException(
        'limit must be an integer between 1 and 100',
      );
    }
  }

  private fileTouchServiceHistorySortValue(
    entry: FileTouchServiceHistoryEntryDto,
    sortBy: FileTouchServiceHistorySortBy,
  ): string | number {
    switch (sortBy) {
      case FileTouchServiceHistorySortBy.NormalizedPath:
        return entry.normalizedPath;
      case FileTouchServiceHistorySortBy.LastTouchedAt:
        return entry.lastTouchedAt;
      case FileTouchServiceHistorySortBy.TouchCount:
        return entry.touchCount;
      default:
        throw new BadRequestException('sortBy is not supported');
    }
  }

  private compareFileTouchServiceHistory(
    sortBy: FileTouchServiceHistorySortBy,
    sortOrder: FileTouchServiceHistorySortOrder,
  ): (
    left: FileTouchServiceHistoryEntryDto,
    right: FileTouchServiceHistoryEntryDto,
  ) => number {
    const direction =
      sortOrder === FileTouchServiceHistorySortOrder.Asc ? 1 : -1;
    return (left, right) => {
      const leftValue = this.fileTouchServiceHistorySortValue(left, sortBy);
      const rightValue = this.fileTouchServiceHistorySortValue(right, sortBy);
      const primary =
        typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
      return primary === 0
        ? left.normalizedPath.localeCompare(right.normalizedPath)
        : primary * direction;
    };
  }

  private encodeFileTouchServiceHistoryCursor(
    cursor: FileTouchServiceHistoryCursor,
  ): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeFileTouchServiceHistoryCursor(
    cursor: string,
  ): FileTouchServiceHistoryCursor {
    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      );
      if (
        typeof decoded !== 'object' ||
        decoded === null ||
        !('version' in decoded) ||
        decoded.version !== 1 ||
        !('sortBy' in decoded) ||
        !Object.values(FileTouchServiceHistorySortBy).includes(
          decoded.sortBy as FileTouchServiceHistorySortBy,
        ) ||
        !('sortOrder' in decoded) ||
        !Object.values(FileTouchServiceHistorySortOrder).includes(
          decoded.sortOrder as FileTouchServiceHistorySortOrder,
        ) ||
        !('pathFilter' in decoded) ||
        typeof decoded.pathFilter !== 'string' ||
        !('normalizedPath' in decoded) ||
        typeof decoded.normalizedPath !== 'string' ||
        !('value' in decoded) ||
        (typeof decoded.value !== 'string' && typeof decoded.value !== 'number')
      ) {
        throw new Error('invalid cursor shape');
      }
      return decoded as FileTouchServiceHistoryCursor;
    } catch {
      throw new BadRequestException('cursor is invalid');
    }
  }

  private normalizeRepoRelativePath(path: string): string | null {
    const trimmed = path.trim().replace(/\\/g, '/');
    if (trimmed.length === 0) {
      return null;
    }

    const repoRelativeFromAbsolute = this.normalizeAbsoluteRepoPath(trimmed);
    if (repoRelativeFromAbsolute !== null) {
      return repoRelativeFromAbsolute;
    }

    if (trimmed.startsWith('/') || /^[a-z]:\//iu.test(trimmed)) {
      return null;
    }

    return this.normalizeRelativePathParts(trimmed);
  }

  private normalizeAbsoluteRepoPath(path: string): string | null {
    const roots = [process.cwd().replace(/\\/g, '/')].filter(
      (root) => root.length > 0,
    );
    for (const root of roots.sort((a, b) => b.length - a.length)) {
      const rootPrefix = root.endsWith('/') ? root : `${root}/`;
      if (!path.startsWith(rootPrefix)) {
        continue;
      }
      return this.normalizeRelativePathParts(path.slice(rootPrefix.length));
    }
    return null;
  }

  private normalizeRelativePathParts(path: string): string | null {
    const parts = path.split('/').filter((part) => part && part !== '.');
    if (parts.length === 0 || parts.some((part) => part === '..')) {
      return null;
    }

    return parts.join('/');
  }

  private resolveAttachedWorkEntity(
    report: ReportDto,
  ): { entityType: PrismaEntityType; entityId: string } | null {
    const primaryWorkEntities = report.entities
      .filter((entity) => entity.relation === ReportEntityRelation.Primary)
      .map((entity) => ({
        entityType: this.toPrismaEntityType(entity.entityType),
        entityId: entity.entityId,
      }))
      .filter(
        (
          entity,
        ): entity is { entityType: PrismaEntityType; entityId: string } =>
          entity.entityType !== null &&
          this.isSupportedAttachedWorkEntityType(entity.entityType),
      );

    const unique = this.dedupeEntityRefs(primaryWorkEntities);
    return unique.length === 1 ? (unique[0] ?? null) : null;
  }

  private resolveAgentSessionId(report: ReportDto): string | null {
    const candidates = [
      ...report.entities
        .filter(
          (entity) =>
            entity.entityType === ReportRelatedEntityType.AgentSession,
        )
        .map((entity) => entity.entityId),
      report.sourceExecutionId ?? undefined,
    ].filter((value): value is string => typeof value === 'string');

    const unique = Array.from(new Set(candidates));
    return unique.length === 1 ? (unique[0] ?? null) : null;
  }

  private async resolveServiceId(
    report: ReportDto,
    agentSessionId: string,
  ): Promise<string | null> {
    const serviceIds = report.entities
      .filter((entity) => entity.entityType === ReportRelatedEntityType.Service)
      .map((entity) => entity.entityId);
    const uniqueServiceIds = Array.from(new Set(serviceIds));
    if (uniqueServiceIds.length === 1) {
      return uniqueServiceIds[0] ?? null;
    }
    if (uniqueServiceIds.length > 1) {
      return null;
    }

    const session = await this.prisma.db.agentSession.findFirst({
      where: {
        id: agentSessionId,
        organizationId: report.organizationId,
      },
      select: { serviceId: true },
    });
    return session?.serviceId ?? null;
  }

  private async resolveFeatureId(attachedEntity: {
    entityType: PrismaEntityType;
    entityId: string;
  }): Promise<string | null> {
    if (attachedEntity.entityType === PrismaEntityType.TASK) {
      return this.resolveFeatureIdFromTask(attachedEntity.entityId);
    }

    if (attachedEntity.entityType === PrismaEntityType.DESIGN_DOC) {
      const designDoc = await this.prisma.db.designDoc.findFirst({
        where: { id: attachedEntity.entityId },
        select: { parentEntityType: true, parentEntityId: true },
      });
      return designDoc?.parentEntityType === 'TASK' && designDoc.parentEntityId
        ? this.resolveFeatureIdFromTask(designDoc.parentEntityId)
        : null;
    }

    return null;
  }

  private async resolveFeatureIdFromTask(
    taskId: string,
  ): Promise<string | null> {
    let currentTaskId: string | null = taskId;
    const visited = new Set<string>();

    while (currentTaskId && !visited.has(currentTaskId)) {
      visited.add(currentTaskId);
      const task: {
        id: string;
        type: string;
        parentTaskId: string | null;
      } | null = await this.prisma.db.task.findFirst({
        where: { id: currentTaskId },
        select: { id: true, type: true, parentTaskId: true },
      });
      if (!task) {
        return null;
      }
      if (task.type === WORK_ITEM_TYPE_KEYS.Feature) {
        return task.id;
      }
      currentTaskId = task.parentTaskId;
    }

    return null;
  }

  private dedupeEntityRefs<
    T extends { entityType: PrismaEntityType; entityId: string },
  >(entities: T[]): T[] {
    const seen = new Set<string>();
    return entities.filter((entity) => {
      const key = `${entity.entityType}:${entity.entityId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private isSupportedAttachedWorkEntityType(
    entityType: PrismaEntityType,
  ): boolean {
    return (
      entityType === PrismaEntityType.TASK ||
      entityType === PrismaEntityType.DESIGN_DOC
    );
  }

  private toPrismaEntityType(
    entityType: ReportRelatedEntityType,
  ): PrismaEntityType | null {
    return Object.values(PrismaEntityType).includes(
      entityType as PrismaEntityType,
    )
      ? (entityType as PrismaEntityType)
      : null;
  }

  private toFileTouchIndexEntryDto(
    row: FileTouchIndex,
  ): FileTouchIndexEntryDto {
    return {
      id: row.id,
      projectId: row.projectId,
      serviceId: row.serviceId,
      featureId: row.featureId,
      attachedEntityType: row.attachedEntityType as ReportRelatedEntityType,
      attachedEntityId: row.attachedEntityId,
      reportId: row.reportId,
      agentSessionId: row.agentSessionId,
      normalizedPath: row.normalizedPath,
      createdAt: row.createdAt.toISOString(),
    } satisfies FileTouchIndexEntryDto;
  }

  private validateEntityFilterConsistency(filters: ListReportsFilters): void {
    const hasEntityType = typeof filters.entityType === 'string';
    const hasEntityId = typeof filters.entityId === 'string';
    const hasRelation = typeof filters.relation === 'string';

    if (hasEntityType !== hasEntityId) {
      this.logger.warn(
        'Rejected report list filters: entityType/entityId mismatch',
        filters,
      );
      throw new BadRequestException(
        'entityType and entityId must be provided together',
      );
    }

    if (hasRelation && (!hasEntityType || !hasEntityId)) {
      this.logger.warn(
        'Rejected report list filters: relation without entity filters',
        filters,
      );
      throw new BadRequestException(
        'relation filter requires entityType and entityId',
      );
    }
  }

  private toReportEntityCreateInput(
    entity: CreateReportEntityDto,
  ): Prisma.ReportEntityCreateWithoutReportInput {
    return {
      entityType: this.requireReportEntityType(entity.entityType),
      entityId: entity.entityId,
      relation: entity.relation as PrismaReportEntityRelation,
    };
  }

  toDto(
    report: ReportWithEntities,
    nameMap: Map<string, string> = ReportService.EMPTY_NAME_MAP,
  ):
    | ReportDtoOther
    | ReportDtoFeatureSyncDecisionV1
    | ReportDtoFeatureSyncDecisionV2 {
    const reportType = report.reportType as ReportType;
    const agent = this.readReportAgent(report.payload);
    const payload = this.withoutReportEnvelopeMetadata(report.payload);
    const linkedEntities: LinkedReportEntityRef[] = report.reportEntities
      .filter((e) => e.relation === PrismaReportEntityRelation.CONTEXT)
      .map((e) => ({
        entityType: e.entityType as ReportRelatedEntityType,
        entityId: e.entityId,
      }));
    const base = {
      id: report.id,
      organizationId: report.organizationId,
      projectId: report.projectId ?? null,
      audience: toReportAudience(report.audience),
      title:
        payload.reportType === ReportType.ProjectReport
          ? payload.title
          : this.getReportTitle(reportType),
      version: report.version,
      ...(agent !== null ? { agent } : {}),
      sourceExecutionId: report.sourceExecutionId ?? null,
      parentReportId: report.parentReportId ?? null,
      ragEnabled: report.ragEnabled,
      createdAt: report.createdAt.toISOString(),
      expiresAt: report.expiresAt?.toISOString() ?? null,
      entities: report.reportEntities.map((entity) =>
        this.toEntityDto(entity, nameMap),
      ),
      ...(linkedEntities.length > 0 ? { linkedEntities } : {}),
    };

    if (reportType === ReportType.FeatureSyncDecision) {
      if (report.schemaVersion === 1) {
        return {
          ...base,
          reportType: 'FEATURE_SYNC_DECISION',
          payload: payload as FeatureSyncDecisionReportPayloadV1,
          schemaVersion: 1,
        } satisfies ReportDtoFeatureSyncDecisionV1;
      }

      if (report.schemaVersion === 2) {
        return {
          ...base,
          reportType: 'FEATURE_SYNC_DECISION',
          payload: payload as FeatureSyncDecisionReportPayloadV2,
          schemaVersion: 2,
        } satisfies ReportDtoFeatureSyncDecisionV2;
      }

      throw new Error(
        `Unsupported FEATURE_SYNC_DECISION schema version: ${report.schemaVersion}`,
      );
    }

    return {
      ...base,
      reportType: reportType as ReportDtoOther['reportType'],
      payload: payload as OtherReportPayload,
      schemaVersion: report.schemaVersion,
    } satisfies ReportDtoOther;
  }

  private toPersistedReportPayload(
    payload: ReportPayload,
    agent: unknown,
    existingPayload?: unknown,
  ): Prisma.InputJsonValue {
    const normalizedAgent =
      agent === undefined
        ? this.readReportAgent(existingPayload)
        : this.readNonEmptyString(agent);
    const cleanedPayload = this.withoutReportEnvelopeMetadata(payload);

    if (!this.isRecord(cleanedPayload)) {
      return cleanedPayload as Prisma.InputJsonValue;
    }

    if (normalizedAgent === null) {
      return cleanedPayload as Prisma.InputJsonValue;
    }

    return {
      ...cleanedPayload,
      [REPORT_ENVELOPE_METADATA_KEY]: { agent: normalizedAgent },
    } as Prisma.InputJsonValue;
  }

  private withoutReportEnvelopeMetadata(payload: unknown): ReportPayload {
    if (!this.isRecord(payload) || !(REPORT_ENVELOPE_METADATA_KEY in payload)) {
      return payload as ReportPayload;
    }

    const cleanedPayload = { ...payload };
    delete cleanedPayload[REPORT_ENVELOPE_METADATA_KEY];
    return cleanedPayload as ReportPayload;
  }

  private readReportAgent(payload: unknown): string | null {
    if (!this.isRecord(payload)) {
      return null;
    }

    const metadata = payload[REPORT_ENVELOPE_METADATA_KEY];
    if (!this.isRecord(metadata)) {
      return null;
    }

    return this.readNonEmptyString(metadata.agent);
  }

  private readNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private materializeLinkedEntities(
    linkedEntities: LinkedReportEntityRef[] | undefined,
  ): Prisma.ReportEntityCreateWithoutReportInput[] {
    if (!linkedEntities || linkedEntities.length === 0) {
      return [];
    }

    const seen = new Set<string>();
    const rows: Prisma.ReportEntityCreateWithoutReportInput[] = [];
    for (const ref of linkedEntities) {
      const key = `${ref.entityType}:${ref.entityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        entityType: this.requireReportEntityType(ref.entityType),
        entityId: ref.entityId,
        relation: PrismaReportEntityRelation.CONTEXT,
      });
    }
    return rows;
  }

  private requireReportEntityType(
    entityType: ReportRelatedEntityType,
  ): PrismaEntityType {
    if (!Object.values(ReportRelatedEntityType).includes(entityType)) {
      throw new BadRequestException(
        `Unsupported report entityType: ${entityType}`,
      );
    }
    return entityType as PrismaEntityType;
  }

  private dedupeEntityCreates(
    rows: Prisma.ReportEntityCreateWithoutReportInput[],
  ): Prisma.ReportEntityCreateWithoutReportInput[] {
    const seen = new Set<string>();
    const result: Prisma.ReportEntityCreateWithoutReportInput[] = [];
    for (const row of rows) {
      const key = `${row.entityType}:${row.entityId}:${row.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(row);
    }
    return result;
  }

  private async resolveReportGuidance(params: {
    organizationId: OrganizationId;
    conversationId?: string;
    reportType: ReportType;
  }): Promise<SessionMonitorReportGuidance> {
    const { organizationId, conversationId, reportType } = params;
    if (conversationId === undefined) {
      this.logger.log('Report guidance resolved without conversation context', {
        organizationId,
        reportType,
      });
      return { actions: [] };
    }

    if (!this.flowExecutionService || !this.nodeExecutionService) {
      throw new Error(
        'Report guidance resolution requires workflow services when conversation context is present',
      );
    }

    const execution = await this.flowExecutionService.findActiveByConversation(
      conversationId as ConversationId,
      organizationId,
    );
    if (!execution?.currentNode) {
      this.logger.log('Report guidance resolved without active node', {
        organizationId,
        conversationId,
        flowId: execution?.flowId ?? null,
        reportType,
      });
      return { actions: [] };
    }

    const nodeInfo = this.nodeExecutionService.getNode(
      execution.flowId,
      execution.currentNode,
    );
    if (!nodeInfo || !isExternalAgentNode(nodeInfo.node)) {
      this.logger.log('Report guidance resolved for non-external active node', {
        organizationId,
        conversationId,
        flowId: execution.flowId,
        nodeId: execution.currentNode,
        nodeType: nodeInfo?.node.type ?? null,
        reportType,
      });
      return { actions: [] };
    }

    const actions = Object.keys(nodeInfo.node.actions);
    this.logger.log(
      'Report guidance resolved from active external agent node',
      {
        organizationId,
        conversationId,
        flowId: execution.flowId,
        nodeId: execution.currentNode,
        reportType,
        actionCount: actions.length,
      },
    );
    return { actions };
  }

  private async resolveEvalOutputStamp(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    dto: CreateReportDto,
  ): Promise<EvalOutputStamp> {
    if (!dto.projectId) {
      return ORDINARY_EVAL_OUTPUT_STAMP;
    }
    return this.evalOutputAdmission.resolve(tx, {
      organizationId,
      projectId: dto.projectId as ProjectId,
      writingSessionId: currentWritingSessionId(),
    });
  }

  private async publishReportCreatedEvent(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    report: ReportWithEntities,
  ): Promise<void> {
    if (!report.projectId) {
      this.logger.warn(
        'Skipping report.created event publish due to missing projectId',
        {
          organizationId,
          reportId: report.id,
        },
      );
      return;
    }

    const publishedReport = this.toDto(report);
    if (publishedReport.payload.reportType === ReportType.Plan) {
      publishedReport.payload = {
        ...publishedReport.payload,
        primaryImplementations:
          publishedReport.payload.primaryImplementations.map(
            (implementation) => {
              const { connections, ...fields } = implementation;
              return connections?.length === 0 ? fields : implementation;
            },
          ),
      };
    }

    const payload: ReportCreatedEventPayload = {
      payloadType: EVENT_TYPES.REPORT.CREATED,
      organizationId,
      projectId: report.projectId as ProjectId,
      report: publishedReport,
      shouldProcess: report.ragEnabled,
    };

    const event: Omit<ReportCreatedEvent, 'id'> = {
      type: EVENT_TYPES.REPORT.CREATED,
      aggregateId: report.id,
      payload,
    };

    await this.eventPublisher.publishInTransaction(tx, event);
  }

  /**
   * Announces a change to an eval run or attempt report so the app can follow
   * progress. Other report types publish nothing here.
   */
  private async publishEvalReportEvent(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    report: ReportWithEntities,
  ): Promise<void> {
    const isRun = report.reportType === PrismaReportType.EVAL_RUN;
    const isAttempt = report.reportType === PrismaReportType.EVAL_ATTEMPT;
    if (!isRun && !isAttempt) {
      return;
    }
    if (!report.projectId) {
      this.logger.warn('Skipping eval report event: report has no projectId', {
        organizationId,
        reportId: report.id,
        reportType: report.reportType,
      });
      return;
    }
    const projectId = report.projectId as ProjectId;
    const dto = this.toDto(report);

    if (dto.payload.reportType === ReportType.EvalRun) {
      const payload: EvalRunUpdatedEventPayload = {
        payloadType: EVENT_TYPES.EVAL_RUN.UPDATED,
        organizationId,
        projectId,
        evalId: dto.payload.evalId,
        run: dto,
      };
      const event: Omit<EvalRunUpdatedEvent, 'id'> = {
        type: EVENT_TYPES.EVAL_RUN.UPDATED,
        aggregateId: report.id,
        payload,
      };
      await this.eventPublisher.publishInTransaction(tx, event);
      return;
    }

    if (dto.payload.reportType === ReportType.EvalAttempt) {
      const run = report.parentReportId
        ? await (tx as unknown as Prisma.TransactionClient).report.findUnique({
            where: { id: report.parentReportId },
            select: { payload: true },
          })
        : null;
      const evalId = (run?.payload as { evalId?: string } | null)?.evalId;
      if (!report.parentReportId || !evalId) {
        throw new BadRequestException(
          'EVAL_ATTEMPT requires a parent EVAL_RUN report',
        );
      }
      const payload: EvalAttemptUpdatedEventPayload = {
        payloadType: EVENT_TYPES.EVAL_ATTEMPT.UPDATED,
        organizationId,
        projectId,
        evalId,
        evalRunId: report.parentReportId,
        attempt: dto,
      };
      const event: Omit<EvalAttemptUpdatedEvent, 'id'> = {
        type: EVENT_TYPES.EVAL_ATTEMPT.UPDATED,
        aggregateId: report.id,
        payload,
      };
      await this.eventPublisher.publishInTransaction(tx, event);
    }
  }

  private toEntityDto(
    entity: ReportWithEntities['reportEntities'][number],
    nameMap: Map<string, string> = ReportService.EMPTY_NAME_MAP,
  ): ReportEntityDto {
    return {
      entityType: entity.entityType as ReportRelatedEntityType,
      entityId: entity.entityId,
      relation: entity.relation as ReportEntityRelation,
      displayName: nameMap.get(entity.entityId),
      createdAt: entity.createdAt.toISOString(),
    };
  }

  private async resolveEntityNames(
    organizationId: OrganizationId,
    reports: ReportWithEntities[],
  ): Promise<Map<string, string>> {
    const seen = new Set<string>();
    const entities = reports.flatMap((r) =>
      r.reportEntities
        .filter((e) => {
          if (seen.has(e.entityId)) return false;
          seen.add(e.entityId);
          return true;
        })
        .map((e) => ({
          entityId: e.entityId,
          entityType: e.entityType,
        })),
    );

    if (entities.length === 0) {
      return new Map();
    }

    try {
      const resolved = await this.entityRegistryService.getEntitiesByIds({
        organizationId,
        entities,
      });

      return new Map(
        resolved
          .filter((r) => r.entityName)
          .map((r) => [r.entityId, r.entityName!]),
      );
    } catch (error) {
      this.logger.warn('Failed to resolve entity names for report entities', {
        organizationId,
        entityCount: entities.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  private resolveSchemaVersion(candidate: number | undefined): number {
    const schemaVersion = candidate ?? 1;
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
      this.logger.warn('Rejected report create: invalid schemaVersion', {
        schemaVersion,
      });
      throw new BadRequestException('schemaVersion must be an integer >= 1');
    }
    return schemaVersion;
  }

  private resolveCreateExpiresAt(dto: CreateReportDto): Date | null {
    if (!dto.neverExpires) {
      return this.resolveExpiresAt(dto.expiresAt);
    }
    if (!NEVER_EXPIRING_REPORT_TYPES.has(dto.reportType)) {
      this.logger.warn('Rejected report create: type cannot be non-expiring', {
        reportType: dto.reportType,
      });
      throw new BadRequestException(
        `neverExpires is only allowed for eval run records, not ${dto.reportType}`,
      );
    }
    if (dto.expiresAt) {
      this.logger.warn('Rejected report create: neverExpires with expiresAt', {
        reportType: dto.reportType,
      });
      throw new BadRequestException(
        'expiresAt must be omitted when neverExpires is true',
      );
    }
    return null;
  }

  private resolveExpiresAt(candidate: string | null | undefined): Date {
    if (typeof candidate === 'string') {
      const parsed = new Date(candidate);
      if (Number.isNaN(parsed.getTime())) {
        this.logger.warn('Rejected report create: invalid expiresAt', {
          expiresAt: candidate,
        });
        throw new BadRequestException(
          'expiresAt must be a valid ISO timestamp',
        );
      }

      if (parsed <= new Date()) {
        this.logger.warn('Rejected report create: non-future expiresAt', {
          expiresAt: candidate,
        });
        throw new BadRequestException('expiresAt must be in the future');
      }

      return parsed;
    }

    return new Date(Date.now() + this.defaultTtlDays * 24 * 60 * 60 * 1000);
  }

  private resolveListLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return this.defaultListLimit;
    }

    if (!Number.isInteger(limit) || limit < 1) {
      this.logger.warn('Rejected report list filters: invalid limit', {
        limit,
      });
      throw new BadRequestException('limit must be a positive integer');
    }

    return Math.min(limit, this.maxListLimit);
  }

  private resolveListOffset(offset: number | undefined): number {
    if (offset === undefined) {
      return 0;
    }

    if (!Number.isInteger(offset) || offset < 0) {
      this.logger.warn('Rejected report list filters: invalid offset', {
        offset,
      });
      throw new BadRequestException('offset must be a non-negative integer');
    }

    return offset;
  }

  private resolveReportTypesFilter(
    reportTypes: ReportType[] | undefined,
    reportType: ReportType | undefined,
  ): { reportType?: PrismaReportType | { in: PrismaReportType[] } } {
    if (reportTypes !== undefined && reportTypes.length > 0) {
      for (const candidate of reportTypes) {
        if (!this.allowedReportTypes.has(candidate)) {
          this.logger.warn('Rejected report list filters: invalid reportType', {
            reportType: candidate,
            allowedReportTypes: this.allowedReportTypesList,
          });
          throw new BadRequestException(
            `reportType must be one of: ${this.allowedReportTypesList}`,
          );
        }
      }
      return {
        reportType: { in: reportTypes as PrismaReportType[] },
      };
    }

    if (reportType !== undefined) {
      return { reportType: reportType as PrismaReportType };
    }

    return {};
  }

  private resolveSortBy(sortBy: ReportSortBy | undefined): ReportSortBy {
    if (sortBy === undefined) {
      return ReportSortBy.CreatedAt;
    }

    if (this.allowedSortByValues.has(sortBy)) {
      return sortBy;
    }

    this.logger.warn('Rejected report list filters: invalid sortBy', {
      sortBy,
      allowedSortByValues: this.allowedSortByList,
    });
    throw new BadRequestException(
      `sortBy must be one of: ${this.allowedSortByList}`,
    );
  }

  private resolveSortOrder(
    sortOrder: ReportSortOrder | undefined,
  ): 'asc' | 'desc' {
    const candidate = sortOrder ?? ReportSortOrder.Desc;

    if (!this.allowedSortOrderValues.has(candidate)) {
      this.logger.warn('Rejected report list filters: invalid sortOrder', {
        sortOrder: candidate,
        allowedSortOrderValues: this.allowedSortOrderList,
      });
      throw new BadRequestException(
        `sortOrder must be one of: ${this.allowedSortOrderList}`,
      );
    }

    return candidate === ReportSortOrder.Asc ? 'asc' : 'desc';
  }

  private parsePositiveInt(
    value: string | undefined,
    fallback: number,
  ): number {
    if (!value) {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return fallback;
    }

    return parsed;
  }

  private resolveReportTypeFilter(candidate: string): ReportType {
    if (this.allowedReportTypes.has(candidate)) {
      return candidate as ReportType;
    }

    this.logger.warn('Rejected report list filters: invalid reportType', {
      reportType: candidate,
      allowedReportTypes: this.allowedReportTypesList,
    });
    throw new BadRequestException(
      `reportType must be one of: ${this.allowedReportTypesList}`,
    );
  }

  private validateReportType(reportType: ReportType): void {
    if (this.allowedReportTypes.has(reportType)) {
      return;
    }

    this.logger.warn('Rejected report create: invalid reportType', {
      reportType,
      allowedReportTypes: this.allowedReportTypesList,
    });
    throw new BadRequestException(
      `reportType must be one of: ${this.allowedReportTypesList}`,
    );
  }

  private validatePlanPayloadShape(
    organizationId: OrganizationId,
    payload: unknown,
  ): void {
    const cleanedPayload = this.withoutReportEnvelopeMetadata(payload);
    if (validatePlanPayloadSchema(cleanedPayload)) {
      return;
    }
    const issues = (validatePlanPayloadSchema.errors ?? []).map((error) => {
      const location = error.instancePath || '/';
      const extraKey =
        error.keyword === 'additionalProperties'
          ? ` (${String(error.params.additionalProperty)})`
          : '';
      return `${location} ${error.message ?? 'is invalid'}${extraKey}`;
    });
    this.logger.warn('Rejected PLAN report: payload violates PLAN schema', {
      organizationId,
      issues,
    });
    throw new BadRequestException(
      `PLAN report payload does not match the PLAN report schema: ${issues.join('; ')}. Remove unknown fields and fix the listed issues, then revise and resubmit the report.`,
    );
  }

  private async validatePlanRequiredServiceIds(
    organizationId: OrganizationId,
    dto: CreateReportDto,
  ): Promise<void> {
    if (dto.reportType !== ReportType.Plan) {
      return;
    }

    const projectId = dto.projectId?.trim();
    if (!projectId) {
      this.logger.warn('Rejected PLAN report: missing project scope', {
        organizationId,
      });
      throw new BadRequestException(
        'PLAN reports require projectId so requiredServiceIds can be validated. Revise and resubmit the report.',
      );
    }

    const payload = dto.payload;
    if (payload.reportType !== ReportType.Plan) {
      this.logger.warn('Rejected PLAN report: payload discriminator mismatch', {
        organizationId,
        projectId,
        payloadReportType: payload.reportType,
      });
      throw new BadRequestException(
        'PLAN report payload.reportType must be PLAN. Revise and resubmit the report.',
      );
    }
    const requiredServiceIds = [...payload.requiredServiceIds];
    this.logger.debug('Validating PLAN report Service scope', {
      organizationId,
      projectId,
      requiredServiceIds,
      requiredServiceCount: requiredServiceIds.length,
    });
    const projectServices = await this.prisma.db.service.findMany({
      where: {
        id: { in: requiredServiceIds },
        organizationId,
        projectId,
        status: { not: 'ARCHIVED' },
        archivedAt: null,
      },
      select: { id: true },
    });
    const projectServiceIds = new Set(
      projectServices.map((service) => service.id),
    );
    const unavailableServiceIds = requiredServiceIds.filter(
      (serviceId) => !projectServiceIds.has(serviceId),
    );
    if (unavailableServiceIds.length === 0) {
      this.logger.debug('Validated PLAN report Service scope', {
        organizationId,
        projectId,
        requiredServiceIds,
      });
      return;
    }

    this.logger.warn('Rejected PLAN report: unavailable required Services', {
      organizationId,
      projectId,
      requiredServiceIds,
      unavailableServiceIds,
    });
    throw new BadRequestException(
      `PLAN requiredServiceIds must contain only non-archived Services in this project. Unavailable Service IDs: ${unavailableServiceIds.join(', ')}. Use list_services to resolve project Service IDs, then revise and resubmit the report.`,
    );
  }

  private validateReportAudience(audience: ReportAudience): void {
    if (this.allowedReportAudiences.has(audience)) {
      return;
    }

    this.logger.warn('Rejected report create: invalid audience', {
      audience,
      allowedReportAudiences: this.allowedReportAudiencesList,
    });
    throw new BadRequestException(
      `audience must be one of: ${this.allowedReportAudiencesList}`,
    );
  }

  private validateAndReturnReportAudience(
    audience: ReportAudience,
  ): ReportAudience {
    this.validateReportAudience(audience);
    return audience;
  }

  private async validateGoalAnchor(
    organizationId: OrganizationId,
    dto: CreateReportDto,
  ): Promise<void> {
    if (dto.reportType !== ReportType.GoalProgress) {
      return;
    }

    const goalAnchor = (dto.payload as { goalAnchor?: unknown } | undefined)
      ?.goalAnchor;
    if (!goalAnchor || typeof goalAnchor !== 'object') {
      return;
    }

    const entityId = (goalAnchor as { entityId?: unknown }).entityId;
    if (typeof entityId !== 'string') {
      return;
    }

    const goal = await this.prisma.db.task.findFirst({
      where: { id: entityId, organizationId, archivedAt: null },
      select: { id: true, type: true, projectId: true },
    });

    if (!goal || goal.type !== WORK_ITEM_TYPE_KEYS.Goal) {
      this.logger.warn(
        'Rejected report create: goalAnchor is not a GOAL task',
        {
          organizationId,
          goalAnchorEntityId: entityId,
          goalType: goal?.type ?? null,
        },
      );
      throw new BadRequestException(
        'payload.goalAnchor must reference a GOAL-typed task.',
      );
    }

    if (goal.projectId !== dto.projectId) {
      this.logger.warn(
        'Rejected report create: goalAnchor belongs to a different project',
        {
          organizationId,
          reportProjectId: dto.projectId ?? null,
          goalProjectId: goal.projectId,
          goalAnchorEntityId: entityId,
        },
      );
      throw new BadRequestException(
        'payload.goalAnchor must reference a goal in the same project as the report.',
      );
    }
  }

  private rejectSelfReference(reportId: string, parentReportId: string): void {
    if (reportId === parentReportId) {
      throw new BadRequestException('A report cannot be its own parent');
    }
  }

  private async validateParentReportExists(
    organizationId: OrganizationId,
    parentReportId: string,
  ): Promise<void> {
    const parent = await this.prisma.db.report.findFirst({
      where: { id: parentReportId, organizationId },
      select: { id: true },
    });

    if (!parent) {
      this.logger.warn('Rejected report create: parent report not found', {
        organizationId,
        parentReportId,
      });
      throw new NotFoundException(`Parent report ${parentReportId} not found`);
    }
  }
}
