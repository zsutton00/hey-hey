import { resolveAncestorPlanWorkItem } from './plan/resolve-plan-work-item';
import { parseProjectReportSessionConfig } from 'src/contracts/project-report-session-config';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ForbiddenException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  AgentSession,
  AgentSessionStatus as PrismaAgentSessionStatus,
  AgentSessionType as PrismaAgentSessionType,
  EntityType,
  Prisma,
} from '@prisma/client';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import {
  AgentSessionCreatedEvent,
  AgentSessionCreatedEventPayload,
  AgentSessionDeletedEvent,
  AgentSessionDeletedEventPayload,
  AgentSessionStatusChangedEvent,
  AgentSessionStatusChangedEventPayload,
  AgentSessionStatus,
  AgentSessionType,
  AgentSessionConfig,
  AgentSessionConfigEntityConversationV1,
  AgentSessionConfigProjectReportV1,
  AgentSessionConfigV1,
  AgentSessionConfigV2,
  AgentSessionCurrentStateBatchItemDto,
  AgentSessionCurrentStateBatchResponseDto,
  AgentSessionCurrentState,
  AgentSessionCurrentStateObservation,
  AgentSessionContextSize,
  AgentSessionContextSizeObservation,
  AgentSessionDto,
  AgentSessionLastMessageSummary,
  AgentSessionListSort,
  AgentSessionParentEntitySummary,
  AgentSessionServiceSummary,
  GrantAgentSessionServicesDto,
  CreateAgentSessionDto,
  CreateAgentSessionConversationDto,
  CreateAgentSessionConversationResponseDto,
  CreateConversationDto,
  InitiationType,
  SessionMethod,
  SessionMonitorImplementationTerminalPolicy,
  SessionMonitorReviewTerminalPolicy,
  SessionMonitorTerminalPolicy,
  SessionMonitorTerminalPolicyAction,
  MessageStatus,
  MessageType,
  PaginatedAgentSessionItemDto,
  PaginatedAgentSessionResponseDto,
  ProjectAssistantConfig,
  ProjectModeFiles,
  ProjectModeSelection,
  ProjectModeSettings,
  ProjectModeSnapshot,
  ReportDto,
  ResolveWorkItemCoordinatorAgentSessionDto,
  ResolveWorkItemCoordinatorAgentSessionResponseDto,
  UpdateAgentSessionDto,
  UserResponseDto,
  WorkflowName,
  WorkItemTypeLifecycleStatus,
} from 'src/generated';
import { ConversationWorkflowService } from './workflows/conversation-workflow.service';
import { ConversationService } from './conversation.service';
import { DEFAULT_AGENT_SESSION_TITLE } from './agent-session-title';
import { EntityRegistryService } from './entity-registry/entity-registry.service';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from 'src/types';
import { validate as isUuid } from 'uuid';
import { ReportService } from './reports/report.service';
import { evaluateTaskMonitorStartRunConfiguration } from './task-monitor-start-run-configuration';
import {
  AgentSessionCurrentStateObservationContext,
  AgentSessionCurrentStateProjection,
  AgentSessionCurrentStateProjectionEntry,
  AgentSessionCurrentStateProjectionResult,
} from './agent-session-current-state-projection.service';
import {
  AgentSessionCurrentStateLoadedIdentity,
  AgentSessionCurrentStateReadService,
} from './agent-session-current-state-read.service';
import {
  PROJECT_MODE_DESCRIPTION_SECTION_KEY,
  PROJECT_MODE_FILES_SCHEMA_REF,
  PROJECT_MODE_FILES_SECTION_KEY,
  PROJECT_MODE_TYPE_KEY,
  validateProjectModeSelection,
  validateProjectModeSnapshot,
} from './tasks/project-mode-files.validator';
import {
  DEFAULT_PROJECT_MODE_PROJECT_ASSISTANT_ENABLED,
  PROJECT_MODE_SETTINGS_SCHEMA_REF,
  PROJECT_MODE_SETTINGS_SECTION_KEY,
  resolveProjectModeSessionRole,
} from './tasks/project-mode-settings.validator';
import { TaskSectionSchemaValidatorRegistry } from './tasks/task-section-schema-validator.registry';
import { WorkItemTypeRegistryService } from './tasks/work-item-type-registry.service';
import { ProjectModeEligibilityService } from './tasks/project-mode-eligibility.service';
import { resolveProjectModeEligibleWorkItemTypeKeys } from './tasks/project-mode-eligible-types';
import type { WorkItemTypeSectionDefinition } from '../generated/model/workItemTypeSectionDefinition';
import { isQualifyingLegacyRepositoryImportExecution } from '../workflows/repository-import-legacy-compatibility';

type AgentSessionWithDates = AgentSession & {
  sessionDate: Date;
  createdAt: Date;
  updatedAt: Date;
};

type AgentSessionServiceRelationSelection = {
  serviceId: string;
};
type MutableInputJsonObject = Record<string, Prisma.InputJsonValue | null>;

type AgentSessionWithSelectedServices = AgentSessionWithDates & {
  serviceRelations?: AgentSessionServiceRelationSelection[];
};

type AgentSessionUpdateInput = Omit<UpdateAgentSessionDto, 'machineId'> & {
  machineId?: UpdateAgentSessionDto['machineId'];
};

type AgentSessionProjectModeCaptureScope = {
  entityType?: string | null;
  entityId?: string | null;
};

type WorkItemCoordinatorAssociationRow = {
  agentSessionId: string;
};

type ListFilters = {
  ids?: string[];
  userId?: string;
  conversationId?: string;
  entityType?: EntityType;
  entityId?: string;
  serviceId?: string;
  type?: AgentSessionType;
};

export type PaginatedAgentSessionFilters = {
  type?: AgentSessionType;
  statuses: AgentSessionStatus[];
  sort: AgentSessionListSort;
  limit: number;
  userId?: string;
  serviceId?: string;
  taskId?: string;
  cursor?: string;
};

export type AgentSessionRuntimeConnectionContext = {
  connectionId: string;
  userId?: string;
  machineId?: string;
  organizationIds: readonly string[];
  projectIds: readonly string[];
};

export type StartRunConversationBinding =
  | { kind: 'REPOSITORY_IMPORT_MATERIALIZATION' }
  | { kind: 'WORK_TRACKER_IMPORT_MATERIALIZATION' }
  | { kind: 'STANDARD_LAUNCH' };

type AgentSessionPageCursor = {
  version: 2;
  fingerprint: string;
  lastMessageAt: string | null;
  id: string;
};

type PaginatedAgentSessionRow = AgentSessionWithServiceRow & {
  lastMessageId: string | null;
  lastMessageConversationId: string | null;
  lastMessageType: string | null;
  lastMessageStatus: string | null;
  lastMessageData: Prisma.JsonValue | null;
  lastMessageAt: Date | null;
  lastMessageCreatedAt: Date | null;
  parentEntityId: string | null;
  parentEntityType: string | null;
  parentEntityName: string | null;
  selectedServices: unknown;
};

const ENTITY_TYPE_VALUES = new Set<string>(Object.values(EntityType));
const AGENT_SESSION_TYPE_VALUES = new Set<string>(
  Object.values(PrismaAgentSessionType),
);
const AGENT_SESSION_STATUS_VALUES = new Set<string>(
  Object.values(PrismaAgentSessionStatus),
);
const MESSAGE_TYPE_VALUES = new Set<string>(Object.values(MessageType));
const MESSAGE_STATUS_VALUES = new Set<string>(Object.values(MessageStatus));
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

export function parseEntityTypeQuery(
  value: string | undefined,
): EntityType | undefined {
  if (value === undefined || value === '') return undefined;
  if (!ENTITY_TYPE_VALUES.has(value)) {
    throw new BadRequestException(
      `entityType must be one of: ${Array.from(ENTITY_TYPE_VALUES).join(', ')}`,
    );
  }
  return value as EntityType;
}

export function parseAgentSessionTypeQuery(
  value: string | undefined,
): AgentSessionType | undefined {
  if (value === undefined || value === '') return undefined;
  if (!AGENT_SESSION_TYPE_VALUES.has(value)) {
    throw new BadRequestException(
      `type must be one of: ${Array.from(AGENT_SESSION_TYPE_VALUES).join(', ')}`,
    );
  }
  return value as AgentSessionType;
}

export function parseAgentSessionServiceIdQuery(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isUuid(value)) {
    throw new BadRequestException('serviceId must be a valid UUID');
  }
  return value;
}

export function parseAgentSessionUserIdQuery(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isUuid(value)) {
    throw new BadRequestException('userId must be a valid UUID');
  }
  return value;
}

export function parseAgentSessionTaskIdQuery(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isUuid(value)) {
    throw new BadRequestException('taskId must be a valid UUID');
  }
  return value;
}

export function parseAgentSessionStatusesQuery(
  value: string | string[] | undefined,
): AgentSessionStatus[] {
  if (value === undefined) {
    return [];
  }

  const rawValues = Array.isArray(value) ? value : [value];
  const normalized = rawValues.flatMap((entry) =>
    entry.split(',').map((part) => part.trim()),
  );

  if (
    normalized.length === 0 ||
    normalized.some((status) => status.length === 0)
  ) {
    throw new BadRequestException(
      'status must contain one or more non-empty values',
    );
  }

  const invalidStatus = normalized.find(
    (status) => !AGENT_SESSION_STATUS_VALUES.has(status),
  );
  if (invalidStatus) {
    throw new BadRequestException(
      `status must contain only: ${Array.from(AGENT_SESSION_STATUS_VALUES).join(
        ', ',
      )}`,
    );
  }

  return Array.from(new Set(normalized)).sort() as AgentSessionStatus[];
}

export function parseAgentSessionListSortQuery(
  value: string | undefined,
): AgentSessionListSort {
  if (value === undefined || value === '') {
    return AgentSessionListSort.LastMessage;
  }
  if (value !== AgentSessionListSort.LastMessage) {
    throw new BadRequestException('sort must be LAST_MESSAGE');
  }
  return value;
}

export function parseAgentSessionPageLimitQuery(
  value: string | undefined,
): number {
  if (value === undefined || value === '') {
    return DEFAULT_PAGE_LIMIT;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException('limit must be an integer between 1 and 100');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_PAGE_LIMIT) {
    throw new BadRequestException('limit must be an integer between 1 and 100');
  }
  return parsed;
}

type FindOneOptions = {
  includeService?: boolean;
  includeUser?: boolean;
  projectId?: ProjectId;
};

type AgentSessionWithServiceRow = {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  machineId: string | null;
  status: PrismaAgentSessionStatus;
  sessionDate: Date;
  serviceId: string | null;
  provider: string | null;
  providerAgentSessionId: string | null;
  conversationId: string | null;
  entityType: string | null;
  entityId: string | null;
  title: string;
  lastSyncedAt: Date | null;
  hasUnsyncedChanges: boolean;
  monitoringEnabled: boolean;
  autoDecide: boolean;
  type: PrismaAgentSessionType;
  createdAt: Date;
  updatedAt: Date;
  config: Prisma.JsonValue | null;
  contextSizeTokens: bigint | null;
  contextSizeRunId: string | null;
  contextSizeProviderSessionId: string | null;
  contextSizeObservedAt: Date | null;
  contextSizeMaxTokens: bigint | null;
  joinedServiceId: string | null;
  joinedServiceName: string | null;
  selectedServiceIds: string[];
};

const SESSION_METHOD_VALUES = new Set<string>(Object.values(SessionMethod));
const AGENT_SESSION_CONFIG_TYPES = new Set<string>([
  AgentSessionConfigV1.TypeEnum.CodingSessionV1,
  AgentSessionConfigV2.TypeEnum.CodingSession,
  AgentSessionConfigEntityConversationV1.TypeEnum.EntityConversation,
  AgentSessionConfigProjectReportV1.TypeEnum.ProjectReport,
]);
const ENTITY_CONVERSATION_EFFORT_VALUES = new Set<string>(
  Object.values(AgentSessionConfigEntityConversationV1.EffortEnum),
);
const PROJECT_ASSISTANT_CONFIG_KEYS = new Set([
  'enabled',
  'allowEdgeUpdates',
  'notifyDiscrepancies',
  'allowUpdateProposals',
]);
const SESSION_MONITOR_TERMINAL_POLICY_KEYS = new Set([
  'implementationDone',
  'reviewDone',
]);
const SESSION_MONITOR_IMPLEMENTATION_TERMINAL_POLICY_KEYS = new Set([
  'completion',
  'requestReview',
]);
const SESSION_MONITOR_REVIEW_TERMINAL_POLICY_KEYS = new Set(['completion']);
const SESSION_MONITOR_TERMINAL_POLICY_ACTION_KEYS = new Set([
  'action',
  'response',
]);
const LEGACY_SESSION_MONITOR_TERMINAL_POLICY_TYPE =
  'session_monitor_terminal_policy';

const AGENT_SESSION_PROVIDERS = ['claude', 'codex', 'opencode'] as const;
type AgentSessionProvider = (typeof AGENT_SESSION_PROVIDERS)[number];
const AGENT_SESSION_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'ERRORED',
] as const;
type AgentSessionStatusValue = (typeof AGENT_SESSION_STATUSES)[number];

@Injectable()
export class AgentSessionService {
  private readonly logger = new Logger(AgentSessionService.name);
  private readonly taskSectionSchemaValidators =
    new TaskSectionSchemaValidatorRegistry();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventPublisher: DomainEventPublisher,
    @Inject(forwardRef(() => ConversationWorkflowService))
    private readonly conversationWorkflowService: ConversationWorkflowService,
    private readonly entityRegistryService: EntityRegistryService,
    @Inject(forwardRef(() => ReportService))
    private readonly reportService: ReportService,
    @Optional()
    private readonly currentStateProjection?: AgentSessionCurrentStateProjection,
    @Optional()
    private readonly currentStateReadService?: AgentSessionCurrentStateReadService,
    @Optional()
    @Inject(forwardRef(() => ConversationService))
    private readonly conversationService?: ConversationService,
    @Optional()
    private readonly workItemTypeRegistry?: WorkItemTypeRegistryService,
    @Optional()
    private readonly projectModeEligibility?: ProjectModeEligibilityService,
  ) {}

  async resolveStartRunConversationBinding(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    agentSessionId: string;
    conversationId: ConversationId;
    conversationWorkflowName: WorkflowName;
    requestedWorkflowName?: string;
  }): Promise<StartRunConversationBinding> {
    if (params.requestedWorkflowName === WorkflowName.WorkTrackerImport) {
      const session = await this.prisma.db.agentSession.findFirst({
        where: {
          id: params.agentSessionId,
          organizationId: params.organizationId,
          projectId: params.projectId,
        },
        select: { conversationId: true },
      });
      if (
        !session ||
        session.conversationId !== params.conversationId ||
        params.conversationWorkflowName !== WorkflowName.WorkTrackerImport
      ) {
        this.logger.warn('Work-tracker import start-run binding rejected', {
          agentSessionId: params.agentSessionId,
          conversationId: params.conversationId,
          conversationWorkflowName: params.conversationWorkflowName,
        });
        throw new ConflictException({
          code: 'WORK_TRACKER_IMPORT_START_RUN_BINDING_MISMATCH',
          message:
            'The work-tracker import start-run request does not match the Agent Session conversation binding.',
        });
      }
      return { kind: 'WORK_TRACKER_IMPORT_MATERIALIZATION' };
    }
    if (params.requestedWorkflowName !== WorkflowName.RepositoryImport) {
      return { kind: 'STANDARD_LAUNCH' };
    }

    const session = await this.prisma.db.agentSession.findFirst({
      where: {
        id: params.agentSessionId,
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
      select: { conversationId: true },
    });
    if (!session || session.conversationId !== params.conversationId) {
      throw new ConflictException({
        code: 'REPOSITORY_IMPORT_START_RUN_BINDING_MISMATCH',
        message:
          'The repository import start-run request does not match the Agent Session conversation binding.',
      });
    }
    if (params.conversationWorkflowName === WorkflowName.RepositoryImport) {
      return { kind: 'REPOSITORY_IMPORT_MATERIALIZATION' };
    }
    if (params.conversationWorkflowName !== WorkflowName.Onboarding) {
      return { kind: 'STANDARD_LAUNCH' };
    }

    const legacyConversation = await this.prisma.db.conversation.findFirst({
      where: {
        id: params.conversationId,
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
      select: {
        workflowName: true,
        flowExecutions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { flowId: true, currentNode: true, flowState: true },
        },
      },
    });
    const execution = legacyConversation?.flowExecutions[0];
    if (
      !execution ||
      !isQualifyingLegacyRepositoryImportExecution({
        conversationWorkflowName: legacyConversation.workflowName,
        executionFlowId: execution.flowId,
        currentNode: execution.currentNode,
        flowState: execution.flowState,
      })
    ) {
      throw new ConflictException({
        code: 'REPOSITORY_IMPORT_START_RUN_BINDING_MISMATCH',
        message:
          'The repository import start-run request does not match a qualifying import conversation.',
      });
    }
    return { kind: 'REPOSITORY_IMPORT_MATERIALIZATION' };
  }

  async create(
    organizationId: OrganizationId,
    projectId: ProjectId,
    currentUserId: UserId,
    dto: CreateAgentSessionDto,
    userToken: string | null = null,
  ): Promise<AgentSessionDto> {
    this.assertConversationIdNotProvided(dto);
    this.assertValidProvider(dto.provider);
    this.assertValidStatus(dto.status);
    this.assertValidAutoDecide(dto.autoDecide);
    const selectedServiceIds = this.normalizeSelectedServiceIds(dto.serviceIds);
    this.assertLaunchServiceMembership(selectedServiceIds, dto.launchServiceId);
    this.assertLaunchServiceHasSelectedLink(
      dto.launchServiceId,
      selectedServiceIds,
    );
    const validatedConfig = this.assertValidConfig(dto.config, true);
    parseEntityTypeQuery(dto.entityType);
    parseAgentSessionTypeQuery(dto.type);

    const agentSessionId = randomUUID();
    const sessionTitle = dto.title || DEFAULT_AGENT_SESSION_TITLE;
    const effectiveUserId = (dto.userId as UserId) ?? currentUserId;
    this.assertValidExistingWorkflowBindingRequest(
      dto,
      validatedConfig,
      effectiveUserId,
      currentUserId,
    );

    const data: Prisma.AgentSessionCreateInput = {
      id: agentSessionId,
      organization: { connect: { id: organizationId } },
      user: { connect: { id: effectiveUserId } },
      project: { connect: { id: projectId } },
      status: dto.status ?? undefined,
      sessionDate: new Date(dto.sessionDate),
      title: sessionTitle,
      service: dto.launchServiceId
        ? { connect: { id: dto.launchServiceId } }
        : undefined,
      provider: dto.provider ?? undefined,
      providerAgentSessionId: dto.agentSessionId ?? undefined,
      type: dto.type ?? undefined,
      entityType: dto.entityType ?? undefined,
      entityId: dto.entityId ?? undefined,
      conversation: dto.existingWorkflowBinding
        ? { connect: { id: dto.existingWorkflowBinding.conversationId } }
        : undefined,
      ...(dto.autoDecide !== undefined ? { autoDecide: dto.autoDecide } : {}),
    };

    try {
      const created = await this.prisma.db.$transaction(async (tx) => {
        if (dto.existingWorkflowBinding) {
          await this.lockAndValidateExistingWorkflowBinding({
            tx,
            organizationId,
            projectId,
            currentUserId,
            binding: dto.existingWorkflowBinding,
            launchServiceId: dto.launchServiceId,
          });
          const existingSession = await tx.agentSession.findFirst({
            where: {
              organizationId,
              projectId,
              conversationId: dto.existingWorkflowBinding.conversationId,
            },
            orderBy: { createdAt: 'asc' },
            include: this.buildSelectedServiceRelationsInclude(),
          });
          if (existingSession) {
            this.assertExistingWorkflowSessionMatches({
              existingSession,
              dto,
              selectedServiceIds,
              validatedConfig,
              effectiveUserId,
            });
            this.logger.log(
              'Reusing Agent Session bound to existing workflow',
              {
                agentSessionId: existingSession.id,
                conversationId: dto.existingWorkflowBinding.conversationId,
                workflowId: dto.existingWorkflowBinding.workflowId,
              },
            );
            return existingSession as AgentSessionWithSelectedServices;
          }
        }
        await this.assertProjectOwnership(organizationId, projectId, tx);
        await this.assertCreateEntityProjectConsistency(
          tx,
          organizationId,
          dto,
        );
        await this.assertSelectedServicesProjectConsistency(
          tx,
          organizationId,
          projectId,
          selectedServiceIds,
        );
        await this.assertTaskMonitorConfigOwnership(
          tx,
          organizationId,
          projectId,
          validatedConfig,
        );
        const persistedConfig = await this.captureProjectModeConfig(
          tx,
          organizationId,
          projectId,
          dto,
          validatedConfig,
          userToken,
        );

        const createdSession = (await tx.agentSession.create({
          data: {
            ...data,
            ...(persistedConfig !== undefined
              ? { config: this.buildConfigCreateValue(persistedConfig) }
              : {}),
          },
        })) as AgentSessionWithDates;

        if (selectedServiceIds.length > 0) {
          await tx.serviceAgentSession.createMany({
            data: selectedServiceIds.map((serviceId) => ({
              serviceId,
              agentSessionId: createdSession.id,
            })),
          });
        }

        const createdWithRelations = this.withSelectedServiceRelations(
          createdSession,
          selectedServiceIds,
        );

        await this.publishCreatedEvent(
          tx,
          organizationId,
          createdWithRelations,
        );
        return createdWithRelations;
      });

      this.logger.log('Created agent session', {
        agentSessionId: created.id,
        entityType: created.entityType ?? undefined,
        entityId: created.entityId ?? undefined,
        type: created.type,
        conversationId: created.conversationId ?? undefined,
      });

      return this.enrichAgentSessionDto(
        this.toDto(created),
        this.toCurrentStateIdentity(created),
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (this.isAgentSessionIdConflict(error)) {
        throw new ConflictException(
          'agentSessionId is already linked to another agent session',
        );
      }
      this.logger.error('Failed to create agent session', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Unable to create agent session: ${(error as Error).message}`,
      );
    }
  }

  async resolveWorkItemCoordinator(
    organizationId: OrganizationId,
    projectId: ProjectId,
    currentUserId: UserId,
    dto: ResolveWorkItemCoordinatorAgentSessionDto,
  ): Promise<ResolveWorkItemCoordinatorAgentSessionResponseDto> {
    this.logger.debug('Resolving durable work-item coordinator identity', {
      organizationId,
      projectId,
      coordinatorType: dto.type,
      workItemType: dto.workItemType,
      workItemId: dto.workItemId,
    });

    const coordinatorType = parseAgentSessionTypeQuery(dto.type);
    if (!coordinatorType) {
      this.logger.warn(
        'Coordinator resolution rejected an empty session type',
        {
          organizationId,
          projectId,
          workItemId: dto.workItemId,
        },
      );
      throw new BadRequestException('type is required');
    }

    if (
      dto.workItemType.length === 0 ||
      dto.workItemType !== dto.workItemType.trim()
    ) {
      this.logger.warn(
        'Coordinator resolution rejected an invalid work-item type',
        {
          organizationId,
          projectId,
          coordinatorType,
          workItemType: dto.workItemType,
          workItemId: dto.workItemId,
        },
      );
      throw new BadRequestException(
        'workItemType must be a non-empty exact work-item type',
      );
    }

    const sessionDate = new Date(dto.sessionDate);
    if (Number.isNaN(sessionDate.getTime())) {
      this.logger.warn('Coordinator resolution rejected an invalid date', {
        organizationId,
        projectId,
        coordinatorType,
        workItemType: dto.workItemType,
        workItemId: dto.workItemId,
      });
      throw new BadRequestException('sessionDate must be a valid date-time');
    }

    const lockIdentity = [
      organizationId,
      projectId,
      coordinatorType,
      dto.workItemType,
      dto.workItemId,
    ].join(':');

    try {
      const result = await this.prisma.db.$transaction(async (tx) => {
        this.logger.debug('Acquiring work-item coordinator identity lock', {
          organizationId,
          projectId,
          coordinatorType,
          workItemType: dto.workItemType,
          workItemId: dto.workItemId,
        });
        await tx.$queryRaw(
          Prisma.sql`
            SELECT pg_advisory_xact_lock(
              hashtextextended(${lockIdentity}, 0)
            )::text AS "lockAcquired"
          `,
        );
        this.logger.debug('Acquired work-item coordinator identity lock', {
          organizationId,
          projectId,
          coordinatorType,
          workItemType: dto.workItemType,
          workItemId: dto.workItemId,
        });

        const workItem = await tx.task.findFirst({
          where: {
            id: dto.workItemId,
            organizationId,
            projectId,
            archivedAt: null,
          },
          select: { type: true },
        });
        if (!workItem) {
          this.logger.warn(
            'Coordinator resolution could not find an active owning work item',
            {
              organizationId,
              projectId,
              coordinatorType,
              workItemType: dto.workItemType,
              workItemId: dto.workItemId,
            },
          );
          throw new NotFoundException(
            'Owning work item was not found in the organization and project',
          );
        }
        if (workItem.type !== dto.workItemType) {
          this.logger.warn(
            'Coordinator resolution rejected a work-item type mismatch',
            {
              organizationId,
              projectId,
              coordinatorType,
              requestedWorkItemType: dto.workItemType,
              actualWorkItemType: workItem.type,
              workItemId: dto.workItemId,
            },
          );
          throw new BadRequestException(
            'workItemType does not match the owning work item',
          );
        }

        const associations = await tx.$queryRaw<
          WorkItemCoordinatorAssociationRow[]
        >(
          Prisma.sql`
              SELECT "agent_session_id" AS "agentSessionId"
              FROM "agent_session_work_item_associations"
              WHERE "organization_id" = ${organizationId}
                AND "project_id" = ${projectId}
                AND "coordinator_type" = ${coordinatorType}::"AgentSessionType"
                AND "work_item_type" = ${dto.workItemType}
                AND "work_item_id" = ${dto.workItemId}
              LIMIT 1
            `,
        );
        const association = associations[0];

        if (association) {
          this.logger.debug('Found durable work-item coordinator association', {
            organizationId,
            projectId,
            coordinatorType,
            workItemType: dto.workItemType,
            workItemId: dto.workItemId,
            agentSessionId: association.agentSessionId,
          });
          const existing = await tx.agentSession.findFirst({
            where: {
              id: association.agentSessionId,
              organizationId,
              projectId,
              type: coordinatorType as PrismaAgentSessionType,
            },
          });
          if (!existing) {
            this.logger.error(
              'Durable coordinator association points to an invalid Agent Session',
              {
                organizationId,
                projectId,
                coordinatorType,
                workItemType: dto.workItemType,
                workItemId: dto.workItemId,
                agentSessionId: association.agentSessionId,
              },
            );
            throw new ConflictException(
              'Coordinator association points to an invalid Agent Session',
            );
          }

          this.logger.debug('Reusing canonical work-item coordinator', {
            organizationId,
            projectId,
            coordinatorType,
            workItemType: dto.workItemType,
            workItemId: dto.workItemId,
            agentSessionId: existing.id,
            conversationId: existing.conversationId ?? undefined,
          });
          return {
            agentSession: this.toDto(existing as AgentSessionWithDates),
            created: false,
          };
        }

        this.logger.debug(
          'No durable coordinator association found; creating canonical Agent Session',
          {
            organizationId,
            projectId,
            coordinatorType,
            workItemType: dto.workItemType,
            workItemId: dto.workItemId,
          },
        );
        const created = (await tx.agentSession.create({
          data: {
            id: randomUUID(),
            organizationId,
            projectId,
            userId: currentUserId,
            status: PrismaAgentSessionStatus.NOT_STARTED,
            sessionDate,
            title: dto.title || DEFAULT_AGENT_SESSION_TITLE,
            type: coordinatorType as PrismaAgentSessionType,
            entityType: EntityType.TASK,
            entityId: dto.workItemId,
          },
        })) as AgentSessionWithDates;

        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO "agent_session_work_item_associations" (
              "id",
              "organization_id",
              "project_id",
              "coordinator_type",
              "work_item_type",
              "work_item_id",
              "agent_session_id",
              "created_at",
              "updated_at"
            )
            VALUES (
              ${randomUUID()},
              ${organizationId},
              ${projectId},
              ${coordinatorType}::"AgentSessionType",
              ${dto.workItemType},
              ${dto.workItemId},
              ${created.id},
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
          `,
        );
        this.logger.debug('Persisted work-item coordinator association', {
          organizationId,
          projectId,
          coordinatorType,
          workItemType: dto.workItemType,
          workItemId: dto.workItemId,
          agentSessionId: created.id,
        });

        await this.publishCreatedEvent(tx, organizationId, created);
        this.logger.log('Created canonical work-item coordinator', {
          organizationId,
          projectId,
          coordinatorType,
          workItemType: dto.workItemType,
          workItemId: dto.workItemId,
          agentSessionId: created.id,
        });
        return {
          agentSession: this.toDto(created),
          created: true,
        };
      });

      this.logger.debug('Resolved durable work-item coordinator identity', {
        organizationId,
        projectId,
        coordinatorType,
        workItemType: dto.workItemType,
        workItemId: dto.workItemId,
        agentSessionId: result.agentSession.id,
        created: result.created,
      });
      return {
        ...result,
        agentSession: await this.enrichAgentSessionDto(
          result.agentSession,
          this.toCurrentStateIdentityFromDto(result.agentSession),
        ),
      };
    } catch (error) {
      this.logger.error('Failed to resolve durable work-item coordinator', {
        organizationId,
        projectId,
        coordinatorType,
        workItemType: dto.workItemType,
        workItemId: dto.workItemId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create an agent session row inside an existing transaction and publish the
   * `agent_session.created` event into the same tx. Caller builds the Prisma
   * create input (relation connects, type, status, title, etc).
   *
   * Used by callers that need the session's lifecycle to be atomic with other
   * writes — e.g. proposal approval materializing a plan + design doc + agent
   * session + conversation in one shot. The dedicated `create()` above opens
   * its own transaction and is not safe to call from inside another one.
   */
  async createInTransaction(
    tx: AnyTransactionClient,
    data: Prisma.AgentSessionCreateInput,
    organizationId: OrganizationId,
  ): Promise<AgentSessionDto> {
    const created = (await tx.agentSession.create({
      data,
    })) as AgentSessionWithDates;

    this.logger.log('Created agent session in transaction', {
      agentSessionId: created.id,
      type: created.type,
      entityType: created.entityType ?? undefined,
      entityId: created.entityId ?? undefined,
    });

    await this.publishCreatedEvent(tx, organizationId, created);

    return this.toDto(created);
  }

  async createConversationForSession(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentSessionId: string,
    dto: CreateAgentSessionConversationDto,
  ): Promise<CreateAgentSessionConversationResponseDto> {
    this.logger.log('Creating conversation for agent session', {
      agentSessionId,
      workflowType: dto.workflowType,
    });

    await this.assertProjectOwnership(organizationId, projectId);

    const session = await this.prisma.db.agentSession.findFirst({
      where: { id: agentSessionId, organizationId, projectId },
    });

    if (!session) {
      throw new BadRequestException('Agent session not found in this project');
    }

    if (session.conversationId !== null) {
      if (!this.conversationService) {
        throw new ConflictException(
          'Agent session already has a conversation, but it could not be loaded',
        );
      }
      const conversation =
        await this.conversationService.getConversationFromAdapter(
          projectId,
          session.conversationId as ConversationId,
          organizationId,
        );
      if (!conversation) {
        throw new ConflictException(
          'Agent session conversation binding could not be resolved',
        );
      }
      const boundSession = await this.prisma.db.agentSession.findFirstOrThrow({
        where: { id: agentSessionId, organizationId, projectId },
        include: this.buildSelectedServiceRelationsInclude(),
      });
      return {
        agentSession: await this.enrichAgentSessionDto(
          this.toDto(boundSession as AgentSessionWithSelectedServices),
          this.toCurrentStateIdentity(boundSession),
        ),
        conversation,
      };
    }

    const createDto: CreateConversationDto = {
      projectId,
      organizationId,
      initiatedBy: InitiationType.User,
      triggerEvent: EVENT_TYPES.AGENT_SESSION.CREATED,
      ...(dto.title ? { title: dto.title } : {}),
      workflowName: dto.workflowType,
      workflowAboutType: dto.workflowAboutType ?? 'agent-session',
      workflowAboutId: dto.workflowAboutId ?? agentSessionId,
      context: {},
    } as unknown as CreateConversationDto;

    const { conversation } =
      await this.conversationWorkflowService.createConversation(
        createDto,
        organizationId,
        {
          userId: session.userId as UserId,
          onCreatedInTx: async (tx, conversationId) => {
            // Conditional update guards against a race where two concurrent
            // requests each try to attach a conversation to the same session.
            const result = await tx.agentSession.updateMany({
              where: { id: agentSessionId, conversationId: null },
              data: { conversationId },
            });
            if (result.count !== 1) {
              throw new ConflictException(
                'Agent session already has a conversation',
              );
            }
          },
        },
      );

    const updated = await this.prisma.db.agentSession.findFirstOrThrow({
      where: { id: agentSessionId },
      include: this.buildSelectedServiceRelationsInclude(),
    });

    return {
      agentSession: await this.enrichAgentSessionDto(
        this.toDto(updated as AgentSessionWithSelectedServices),
        this.toCurrentStateIdentity(updated),
      ),
      conversation,
    };
  }

  async applyDerivedTitleByConversation(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    derivedTitle: string,
  ): Promise<void> {
    const trimmed = derivedTitle.trim();
    if (!trimmed || trimmed === DEFAULT_AGENT_SESSION_TITLE) {
      return;
    }

    const renamed = await this.prisma.db.agentSession.findMany({
      where: {
        conversationId,
        organizationId,
        title: DEFAULT_AGENT_SESSION_TITLE,
      },
      select: { id: true },
    });

    if (renamed.length === 0) {
      return;
    }

    await this.prisma.db.agentSession.updateMany({
      where: {
        conversationId,
        organizationId,
        title: DEFAULT_AGENT_SESSION_TITLE,
      },
      data: { title: trimmed },
    });

    for (const { id } of renamed) {
      await this.entityRegistryService.registerEntity({
        organizationId,
        entityId: id,
        entityType: EntityType.AGENT_SESSION,
        name: trimmed,
      });
      this.logger.debug(
        '[AgentSessionService] Derived title applied; registry synced',
        {
          agentSessionId: id,
          organizationId,
        },
      );
    }
  }

  async findAll(
    organizationId: OrganizationId,
    projectId: ProjectId,
    filters: ListFilters = {},
    includeService = false,
  ): Promise<AgentSessionDto[]> {
    if (filters.ids !== undefined && filters.ids.length === 0) {
      throw new BadRequestException('ids filter cannot be empty');
    }

    if (includeService) {
      return this.findAllWithServiceSummary(organizationId, projectId, filters);
    }

    const where: Prisma.AgentSessionWhereInput = {
      organizationId,
      projectId,
      ...(filters.ids ? { id: { in: filters.ids } } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.conversationId
        ? { conversationId: filters.conversationId }
        : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.serviceId
        ? {
            serviceRelations: {
              some: { serviceId: filters.serviceId },
            },
          }
        : {}),
      ...(filters.type ? { type: filters.type } : {}),
    };

    const sessions = await this.prisma.db.agentSession.findMany({
      where,
      orderBy: { sessionDate: 'desc' },
      include: this.buildSelectedServiceRelationsInclude(),
    });

    const dtos = sessions.map((session) =>
      this.toDto(session as AgentSessionWithSelectedServices),
    );
    return this.enrichAgentSessionDtos(
      dtos,
      sessions.map((session) => this.toCurrentStateIdentity(session)),
    );
  }

  async findPaginated(
    organizationId: OrganizationId,
    projectId: ProjectId,
    filters: PaginatedAgentSessionFilters,
  ): Promise<PaginatedAgentSessionResponseDto> {
    const fingerprint = this.buildPageCursorFingerprint(filters);
    const cursor = filters.cursor
      ? this.decodePageCursor(filters.cursor, fingerprint)
      : undefined;
    const whereConditions: Prisma.Sql[] = [
      Prisma.sql`cs.organization_id::text = ${organizationId}`,
      Prisma.sql`cs.project_id::text = ${projectId}`,
    ];

    if (filters.userId) {
      whereConditions.push(Prisma.sql`cs.user_id::text = ${filters.userId}`);
    }
    if (filters.type) {
      whereConditions.push(Prisma.sql`cs.type::text = ${filters.type}`);
    }
    if (filters.statuses.length > 0) {
      whereConditions.push(
        Prisma.sql`cs.status::text IN (${Prisma.join(
          filters.statuses.map((status) => Prisma.sql`${status}`),
        )})`,
      );
    }
    if (filters.serviceId) {
      whereConditions.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM "service_agent_sessions" service_filter_relation
          JOIN "services" service_filter
            ON service_filter.id::text = service_filter_relation.service_id::text
          WHERE service_filter_relation.agent_session_id::text = cs.id::text
            AND service_filter_relation.service_id::text = ${filters.serviceId}
            AND service_filter.organization_id::text = cs.organization_id::text
            AND service_filter.project_id::text = cs.project_id::text
        )
      `);
    }
    if (filters.taskId) {
      whereConditions.push(Prisma.sql`
        cs.entity_type::text = ${EntityType.TASK}
        AND cs.entity_id::text = ${filters.taskId}
      `);
    }
    if (cursor) {
      whereConditions.push(this.buildPageCursorWhereClause(cursor));
    }

    const rows = await this.prisma.db.$queryRaw<PaginatedAgentSessionRow[]>`
      SELECT
        cs.id AS "id",
        cs.organization_id AS "organizationId",
        cs.project_id AS "projectId",
        cs.user_id AS "userId",
        cs.machine_id AS "machineId",
        cs.status AS "status",
        cs.session_date AS "sessionDate",
        cs.service_id AS "serviceId",
        cs.provider AS "provider",
        cs.provider_agent_session_id AS "providerAgentSessionId",
        cs.conversation_id AS "conversationId",
        cs.entity_type AS "entityType",
        cs.entity_id AS "entityId",
        cs.title AS "title",
        cs.last_synced_at AS "lastSyncedAt",
        cs.has_unsynced_changes AS "hasUnsyncedChanges",
        cs.monitoring_enabled AS "monitoringEnabled",
        cs.auto_decide AS "autoDecide",
        cs.type AS "type",
        cs.config AS "config",
        cs.context_size_tokens AS "contextSizeTokens",
        cs.context_size_run_id AS "contextSizeRunId",
        cs.context_size_provider_session_id AS "contextSizeProviderSessionId",
        cs.context_size_observed_at AS "contextSizeObservedAt",
        cs.context_size_max_tokens AS "contextSizeMaxTokens",
        cs.created_at AS "createdAt",
        cs.updated_at AS "updatedAt",
        launch_service.id AS "joinedServiceId",
        launch_service.name AS "joinedServiceName",
        COALESCE(selected.selected_service_ids, ARRAY[]::text[]) AS "selectedServiceIds",
        COALESCE(selected.selected_services, '[]'::jsonb) AS "selectedServices",
        latest_message.id AS "lastMessageId",
        latest_message.conversation_id AS "lastMessageConversationId",
        latest_message.type AS "lastMessageType",
        latest_message.status AS "lastMessageStatus",
        latest_message.data AS "lastMessageData",
        latest_message.content_updated_at AS "lastMessageAt",
        latest_message.created_at AS "lastMessageCreatedAt",
        parent_entity.entity_id AS "parentEntityId",
        parent_entity.entity_type AS "parentEntityType",
        parent_entity.entity_name AS "parentEntityName"
      FROM "agent_sessions" cs
      LEFT JOIN "services" launch_service
        ON launch_service.id::text = cs.service_id::text
       AND launch_service.organization_id::text = cs.organization_id::text
      LEFT JOIN LATERAL (
        SELECT
          array_agg(sas.service_id::text ORDER BY sas.created_at, sas.service_id) AS selected_service_ids,
          jsonb_agg(
            jsonb_build_object('id', selected_service.id, 'name', selected_service.name)
            ORDER BY sas.created_at, sas.service_id
          ) AS selected_services
        FROM "service_agent_sessions" sas
        JOIN "services" selected_service
          ON selected_service.id::text = sas.service_id::text
         AND selected_service.organization_id::text = cs.organization_id::text
        WHERE sas.agent_session_id::text = cs.id::text
      ) selected ON TRUE
      LEFT JOIN LATERAL (
        SELECT message.id,
               message.conversation_id,
               message.type,
               message.status,
               message.data,
               message.created_at,
               message.content_updated_at
        FROM "messages" message
        WHERE message.conversation_id::text = cs.conversation_id::text
          -- Null exactly while the row is an undated queued input.
          AND message.content_updated_at IS NOT NULL
        ORDER BY message.content_updated_at DESC, message.id DESC
        LIMIT 1
      ) latest_message ON TRUE
      LEFT JOIN "entity_registry" parent_entity
        ON parent_entity.organization_id::text = cs.organization_id::text
       AND parent_entity.entity_id::text = cs.entity_id::text
       AND parent_entity.entity_type::text = cs.entity_type::text
       AND parent_entity.deleted_at IS NULL
      WHERE ${Prisma.join(whereConditions, ' AND ')}
      ORDER BY latest_message.content_updated_at DESC NULLS LAST, cs.id::text ASC
      LIMIT ${filters.limit + 1}
    `;

    const hasNextPage = rows.length > filters.limit;
    const pageRows = rows.slice(0, filters.limit);
    const reportsByMessageId =
      await this.reportService.loadReportsForMessageIds(
        organizationId,
        pageRows.flatMap((row) =>
          row.lastMessageId === null ? [] : [row.lastMessageId],
        ),
      );
    const baseItems = pageRows.map((row) =>
      this.toPaginatedItemDto(
        row,
        row.lastMessageId === null
          ? []
          : (reportsByMessageId.get(row.lastMessageId) ?? []),
      ),
    );
    const enrichedAgentSessions = await this.enrichAgentSessionDtos(
      baseItems.map((item) => item.agentSession),
      pageRows.map((row) => this.toCurrentStateIdentity(row)),
    );
    const items: PaginatedAgentSessionItemDto[] = baseItems.map(
      (item, index) => ({
        ...item,
        agentSession: enrichedAgentSessions[index] ?? item.agentSession,
      }),
    );
    const lastRow = pageRows.at(-1);

    return {
      items,
      nextCursor:
        hasNextPage && lastRow
          ? this.encodePageCursor({
              version: 2,
              fingerprint,
              lastMessageAt: lastRow.lastMessageAt?.toISOString() ?? null,
              id: lastRow.id,
            })
          : null,
    } satisfies PaginatedAgentSessionResponseDto;
  }

  async findOne(
    organizationId: OrganizationId,
    agentSessionId: string,
    options: FindOneOptions = {},
  ): Promise<AgentSessionDto> {
    const { includeService = false, includeUser = false, projectId } = options;
    let dto: AgentSessionDto;

    if (includeService) {
      const session = await this.findOneWithServiceSummary(
        organizationId,
        agentSessionId,
        projectId,
      );

      if (!session) {
        throw new NotFoundException('Agent session not found');
      }

      dto = session;
    } else {
      const session = await this.prisma.db.agentSession.findFirst({
        where: {
          id: agentSessionId,
          organizationId,
          ...(projectId ? { projectId } : {}),
        },
        include: this.buildSelectedServiceRelationsInclude(),
      });

      if (!session) {
        throw new NotFoundException('Agent session not found');
      }

      dto = this.toDto(session as AgentSessionWithSelectedServices);
    }

    dto = await this.enrichAgentSessionDto(
      dto,
      this.toCurrentStateIdentityFromDto(dto),
    );

    if (!includeUser) {
      return dto;
    }

    return this.attachUser(dto);
  }

  async update(
    organizationId: OrganizationId,
    agentSessionId: string,
    dto: AgentSessionUpdateInput,
    userToken: string | null = null,
  ): Promise<AgentSessionDto> {
    this.assertConversationIdNotProvided(dto);
    this.assertValidProvider(dto.provider);
    this.assertValidStatus(dto.status);
    this.assertValidMonitoringEnabled(dto.monitoringEnabled);
    this.assertValidAutoDecide(dto.autoDecide);
    const selectedServiceIds = this.normalizeSelectedServiceIds(dto.serviceIds);
    this.assertLaunchServiceMembership(selectedServiceIds, dto.launchServiceId);
    const validatedConfig = this.assertValidConfig(dto.config, true);
    parseEntityTypeQuery(dto.entityType);
    parseAgentSessionTypeQuery(dto.type);

    try {
      const updated = await this.prisma.db.$transaction(
        async (tx) => {
          const existing = await tx.agentSession.findFirst({
            where: { id: agentSessionId, organizationId },
            include: this.buildSelectedServiceRelationsInclude(),
          });

          if (!existing) {
            throw new NotFoundException('Agent session not found');
          }

          if (dto.machineId !== undefined) {
            const selectedMachine = await tx.machine.findFirst({
              where: {
                id: dto.machineId,
                userId: existing.userId,
                revokedAt: null,
                OR: [{ organizationId }, { organizationId: null }],
              },
              select: { id: true },
            });
            if (!selectedMachine) {
              this.logger.warn(
                'Rejecting agent session update for unavailable machine',
                {
                  organizationId,
                  agentSessionId,
                  machineId: dto.machineId,
                  userId: existing.userId,
                },
              );
              throw new BadRequestException(
                'Selected machine is not available for this Agent Session',
              );
            }
          }

          this.assertTaskMonitorConfigOwnershipImmutable(
            existing.config ?? null,
            dto.config,
          );
          this.assertServiceBindingInvariant(existing, dto.launchServiceId);
          this.assertProviderBindingInvariant(existing, dto.provider);
          const updatedSelectedServiceIds =
            dto.serviceIds !== undefined
              ? selectedServiceIds
              : this.getSelectedServiceIdsFromLoadedRelations(existing);
          this.assertLaunchServiceHasSelectedLink(
            existing.serviceId ?? dto.launchServiceId,
            updatedSelectedServiceIds,
          );

          if (selectedServiceIds.length > 0) {
            await this.assertSelectedServicesProjectConsistency(
              tx,
              organizationId,
              existing.projectId as ProjectId,
              selectedServiceIds,
            );
          }

          const persistedConfig =
            dto.config === undefined
              ? undefined
              : await this.captureProjectModeConfig(
                  tx,
                  organizationId,
                  existing.projectId as ProjectId,
                  {
                    entityType:
                      dto.entityType !== undefined
                        ? dto.entityType
                        : existing.entityType,
                    entityId:
                      dto.entityId !== undefined
                        ? dto.entityId
                        : existing.entityId,
                  },
                  validatedConfig,
                  userToken,
                );
          const data = this.buildUpdateInput(existing, dto, persistedConfig);

          const updatedSession = await tx.agentSession.update({
            where: { id: agentSessionId },
            data,
          });
          if (dto.serviceIds !== undefined) {
            await this.replaceSelectedServiceLinks(
              tx,
              agentSessionId,
              selectedServiceIds,
            );
          }

          const updatedWithRelations = this.withSelectedServiceRelations(
            updatedSession as AgentSessionWithDates,
            updatedSelectedServiceIds,
          );

          await this.publishStatusChangedEventIfNeeded(
            tx,
            organizationId,
            existing,
            updatedWithRelations,
          );

          return updatedWithRelations;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      return this.enrichAgentSessionDto(
        this.toDto(updated as AgentSessionWithSelectedServices),
        this.toCurrentStateIdentity(updated),
      );
    } catch (error) {
      if (this.isAgentSessionIdConflict(error)) {
        throw new ConflictException(
          'agentSessionId is already linked to another agent session',
        );
      }

      throw error;
    }
  }

  async grantServices(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    agentSessionId: string;
    userId: UserId;
    grant: GrantAgentSessionServicesDto;
    liveBoundServiceIds: readonly string[];
  }): Promise<AgentSessionDto> {
    const requestedServiceIds = Array.from(input.grant.serviceIds);
    const boundServiceIds = new Set(input.liveBoundServiceIds);
    const unboundServiceIds = requestedServiceIds.filter(
      (serviceId) => !boundServiceIds.has(serviceId),
    );
    if (unboundServiceIds.length > 0) {
      throw new BadRequestException(
        'Every granted Service must have a live binding on the authenticated machine',
      );
    }

    const updated = await this.prisma.db.$transaction(
      async (tx) => {
        const session = await tx.agentSession.findFirst({
          where: {
            id: input.agentSessionId,
            organizationId: input.organizationId,
            projectId: input.projectId,
          },
          include: this.buildSelectedServiceRelationsInclude(),
        });
        if (!session) {
          throw new NotFoundException('Agent session not found');
        }
        if (session.userId !== input.userId) {
          throw new ForbiddenException(
            'Agent session is owned by a different user',
          );
        }
        if (!session.machineId || session.machineId !== input.grant.machineId) {
          throw new BadRequestException(
            'The authenticated machine does not match the Agent Session binding',
          );
        }
        if (session.serviceId) {
          if (session.serviceId !== input.grant.launchServiceId) {
            throw new BadRequestException(
              'launchServiceId must match the Agent Session launch Service',
            );
          }
        } else if (!requestedServiceIds.includes(input.grant.launchServiceId)) {
          throw new BadRequestException(
            'launchServiceId must be one of the granted Services when the Agent Session has no launch Service',
          );
        }

        await this.assertSelectedServicesProjectConsistency(
          tx,
          input.organizationId,
          input.projectId,
          requestedServiceIds,
        );
        await tx.serviceAgentSession.createMany({
          data: requestedServiceIds.map((serviceId) => ({
            agentSessionId: session.id,
            serviceId,
          })),
          skipDuplicates: true,
        });
        // An anchorless session promotes the first granted Service, matching
        // typed-mention admission; an existing anchor is never replaced.
        if (!session.serviceId) {
          await tx.agentSession.update({
            where: { id: session.id },
            data: { serviceId: input.grant.launchServiceId },
          });
        }

        const persisted = await tx.agentSession.findUnique({
          where: { id: session.id },
          include: this.buildSelectedServiceRelationsInclude(),
        });
        if (!persisted) {
          throw new NotFoundException(
            'Agent session not found after Service grant',
          );
        }
        this.assertLaunchServiceHasSelectedLink(
          persisted.serviceId,
          this.getSelectedServiceIdsFromLoadedRelations(persisted),
        );
        return persisted;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    this.logger.log('Agent Session Services granted additively', {
      agentSessionId: input.agentSessionId,
      machineId: input.grant.machineId,
      requestedServiceIds,
      persistedServiceIds:
        this.getSelectedServiceIdsFromLoadedRelations(updated),
    });
    return this.enrichAgentSessionDto(
      this.toDto(updated as AgentSessionWithSelectedServices),
      this.toCurrentStateIdentity(updated),
    );
  }

  /**
   * Compatibility wrapper for older callers that need to move a session off
   * NOT_STARTED. New start-run paths should call claimStartRunLaunch before
   * authoring any rows so duplicate launch requests are suppressed early.
   */
  async advanceToInProgress(
    organizationId: OrganizationId,
    agentSessionId: string,
  ): Promise<void> {
    await this.claimStartRunLaunch(organizationId, agentSessionId);
  }

  /**
   * Resolve the Agent Session config for launch. Task Monitor launch config must
   * match the persisted V2 value, while project MODE launches use the exact
   * immutable capture persisted on the Agent Session.
   */
  async resolveStartRunConfiguration(params: {
    organizationId: OrganizationId;
    agentSessionId: string;
    taskMonitorId?: string;
    config: AgentSessionConfig | null | undefined;
  }): Promise<AgentSessionConfigV2 | undefined> {
    const requestedConfig = this.assertValidConfig(params.config, true, true);
    const session = await this.prisma.db.agentSession.findFirst({
      where: {
        id: params.agentSessionId,
        organizationId: params.organizationId,
      },
      select: {
        autoDecide: true,
        config: true,
      },
    });
    if (!session) {
      throw new NotFoundException('Agent session not found');
    }

    const persistedConfig = this.parseStoredConfig(session.config ?? null);
    const requestedTaskMonitorId =
      requestedConfig?.type === AgentSessionConfigV2.TypeEnum.CodingSession
        ? requestedConfig.taskMonitorId
        : undefined;
    const persistedTaskMonitorId =
      persistedConfig?.type === AgentSessionConfigV2.TypeEnum.CodingSession
        ? persistedConfig.taskMonitorId
        : undefined;
    const evaluation = evaluateTaskMonitorStartRunConfiguration({
      contextTaskMonitorId: params.taskMonitorId,
      requestedConfig,
      persistedConfig,
      persistedAutoDecide: session.autoDecide,
    });

    if (evaluation.status === 'not-task-monitor-owned') {
      const requestedHasProjectMode =
        requestedConfig?.type === AgentSessionConfigV2.TypeEnum.CodingSession &&
        (requestedConfig.projectModeSelection !== undefined ||
          requestedConfig.projectModeSnapshot !== undefined);

      if (
        persistedConfig?.type === AgentSessionConfigV2.TypeEnum.CodingSession &&
        persistedConfig.projectModeSelection !== undefined &&
        persistedConfig.projectModeSnapshot !== undefined
      ) {
        if (
          requestedConfig !== undefined &&
          requestedConfig !== null &&
          (!requestedHasProjectMode ||
            requestedConfig.type !==
              AgentSessionConfigV2.TypeEnum.CodingSession ||
            !this.projectModeCapturesMatch(requestedConfig, persistedConfig))
        ) {
          throw new BadRequestException(
            'Project MODE start-run configuration does not match the persisted Agent Session',
          );
        }

        this.logger.debug(
          'Agent Session start-run uses the persisted project MODE capture',
          {
            organizationId: params.organizationId,
            agentSessionId: params.agentSessionId,
            modeId: persistedConfig.projectModeSelection.modeId,
            snapshotHash: persistedConfig.projectModeSnapshot.snapshotHash,
          },
        );
        return persistedConfig;
      }

      if (requestedHasProjectMode) {
        throw new BadRequestException(
          'Project MODE start-run configuration has no persisted Agent Session capture',
        );
      }

      this.logger.debug(
        'Agent Session start-run has no Task Monitor ownership context',
        {
          organizationId: params.organizationId,
          agentSessionId: params.agentSessionId,
        },
      );
      return undefined;
    }

    if (evaluation.status === 'incomplete-coding-session-config') {
      this.logger.warn(
        'Task Monitor start-run rejected incomplete coding-session config',
        {
          organizationId: params.organizationId,
          agentSessionId: params.agentSessionId,
          contextTaskMonitorId: params.taskMonitorId,
          requestedTaskMonitorId,
          persistedTaskMonitorId,
        },
      );
      throw new BadRequestException(
        'Task Monitor start-run requires a V2 CODING_SESSION config',
      );
    }
    if (evaluation.status === 'ownership-mismatch') {
      this.logger.warn('Task Monitor start-run rejected ownership mismatch', {
        organizationId: params.organizationId,
        agentSessionId: params.agentSessionId,
        contextTaskMonitorId: params.taskMonitorId,
        requestedTaskMonitorId,
        persistedTaskMonitorId,
      });
      throw new BadRequestException(
        'Task Monitor start-run ownership does not match the persisted AgentSession',
      );
    }

    if (evaluation.status === 'configuration-mismatch') {
      throw new BadRequestException(
        'Task Monitor start-run configuration does not match the persisted AgentSession',
      );
    }

    this.logger.debug('Task Monitor start-run ownership validated', {
      organizationId: params.organizationId,
      agentSessionId: params.agentSessionId,
      taskMonitorId: persistedTaskMonitorId,
    });
    if (
      requestedConfig === undefined ||
      requestedConfig === null ||
      requestedConfig.type !== AgentSessionConfigV2.TypeEnum.CodingSession
    ) {
      throw new Error(
        'Task Monitor start-run admission returned an invalid configuration',
      );
    }
    return requestedConfig;
  }

  private projectModeCapturesMatch(
    left: AgentSessionConfigV2,
    right: AgentSessionConfigV2,
  ): boolean {
    const leftSelection = left.projectModeSelection;
    const rightSelection = right.projectModeSelection;
    const leftSnapshot = left.projectModeSnapshot;
    const rightSnapshot = right.projectModeSnapshot;
    if (!leftSelection || !rightSelection || !leftSnapshot || !rightSnapshot) {
      return false;
    }

    const leftFiles = leftSnapshot.files.files;
    const rightFiles = rightSnapshot.files.files;
    const leftPaths = Object.keys(leftFiles);
    const rightPaths = Object.keys(rightFiles);
    const filesMatch =
      leftPaths.length === rightPaths.length &&
      leftPaths.every(
        (path) =>
          Object.prototype.hasOwnProperty.call(rightFiles, path) &&
          leftFiles[path] === rightFiles[path],
      );
    const applicableTypesMatch =
      leftSnapshot.applicableWorkItemTypeKeys.length ===
        rightSnapshot.applicableWorkItemTypeKeys.length &&
      leftSnapshot.applicableWorkItemTypeKeys.every(
        (typeKey, index) =>
          typeKey === rightSnapshot.applicableWorkItemTypeKeys[index],
      );

    return (
      leftSelection.schemaVersion === rightSelection.schemaVersion &&
      leftSelection.modeId === rightSelection.modeId &&
      leftSnapshot.schemaVersion === rightSnapshot.schemaVersion &&
      leftSnapshot.modeId === rightSnapshot.modeId &&
      leftSnapshot.catalogDescription === rightSnapshot.catalogDescription &&
      leftSnapshot.snapshotHash === rightSnapshot.snapshotHash &&
      applicableTypesMatch &&
      leftSnapshot.files.schemaVersion === rightSnapshot.files.schemaVersion &&
      filesMatch
    );
  }

  /**
   * Atomically claim a start-run launch before the controller authors any
   * kickoff or trigger messages. Returns false when another request already
   * moved the session past NOT_STARTED, which lets callers fail fast before
   * duplicating start_run rows.
   */
  async claimStartRunLaunch(
    organizationId: OrganizationId,
    agentSessionId: string,
  ): Promise<boolean> {
    return this.prisma.db.$transaction(
      async (tx) => {
        const claim = await tx.agentSession.updateMany({
          where: {
            id: agentSessionId,
            organizationId,
            status: PrismaAgentSessionStatus.NOT_STARTED,
          },
          data: { status: PrismaAgentSessionStatus.IN_PROGRESS },
        });

        const updatedSession = await tx.agentSession.findFirst({
          where: { id: agentSessionId, organizationId },
          include: this.buildSelectedServiceRelationsInclude(),
        });

        if (!updatedSession) {
          throw new NotFoundException('Agent session not found');
        }

        if (claim.count === 0) {
          this.logger.log(
            'claimStartRunLaunch no-op: agent session already advanced off NOT_STARTED',
            { agentSessionId, organizationId, status: updatedSession.status },
          );
          return false;
        }

        const updatedWithRelations = this.withSelectedServiceRelations(
          updatedSession as AgentSessionWithDates,
          this.getSelectedServiceIdsFromLoadedRelations(
            updatedSession as AgentSessionWithSelectedServices,
          ),
        );

        await this.publishStatusChangedEventIfNeeded(
          tx,
          organizationId,
          {
            ...updatedWithRelations,
            status: PrismaAgentSessionStatus.NOT_STARTED,
          } as AgentSessionWithSelectedServices,
          updatedWithRelations,
        );

        this.logger.log(
          'Claimed agent session NOT_STARTED -> IN_PROGRESS for start-run',
          { agentSessionId, organizationId },
        );

        return true;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * Release a pre-launch claim after a start-run dispatch fails before any
   * workflow or kickoff row starts. This preserves retryability without letting
   * concurrent duplicate launch requests create duplicate trigger rows.
   */
  async releaseStartRunLaunchClaim(
    organizationId: OrganizationId,
    agentSessionId: string,
  ): Promise<void> {
    await this.prisma.db.$transaction(
      async (tx) => {
        const release = await tx.agentSession.updateMany({
          where: {
            id: agentSessionId,
            organizationId,
            status: PrismaAgentSessionStatus.IN_PROGRESS,
          },
          data: { status: PrismaAgentSessionStatus.NOT_STARTED },
        });

        const updatedSession = await tx.agentSession.findFirst({
          where: { id: agentSessionId, organizationId },
          include: this.buildSelectedServiceRelationsInclude(),
        });

        if (!updatedSession) {
          throw new NotFoundException('Agent session not found');
        }

        if (release.count === 0) {
          this.logger.log(
            'releaseStartRunLaunchClaim no-op: agent session was not IN_PROGRESS',
            { agentSessionId, organizationId, status: updatedSession.status },
          );
          return;
        }

        const updatedWithRelations = this.withSelectedServiceRelations(
          updatedSession as AgentSessionWithDates,
          this.getSelectedServiceIdsFromLoadedRelations(
            updatedSession as AgentSessionWithSelectedServices,
          ),
        );

        await this.publishStatusChangedEventIfNeeded(
          tx,
          organizationId,
          {
            ...updatedWithRelations,
            status: PrismaAgentSessionStatus.IN_PROGRESS,
          } as AgentSessionWithSelectedServices,
          updatedWithRelations,
        );

        this.logger.log(
          'Released agent session IN_PROGRESS -> NOT_STARTED after failed start-run',
          { agentSessionId, organizationId },
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async bindStartRunMachine(
    organizationId: OrganizationId,
    agentSessionId: string,
    userId: UserId,
    machineId: string,
  ): Promise<void> {
    this.logger.log('Binding acknowledged start-run machine', {
      organizationId,
      agentSessionId,
      userId,
      machineId,
    });
    const update = await this.prisma.db.agentSession.updateMany({
      where: { id: agentSessionId, organizationId, userId },
      data: { machineId },
    });
    if (update.count !== 1) {
      this.logger.error('Failed to bind start-run machine to Agent Session', {
        organizationId,
        agentSessionId,
        userId,
        machineId,
        updatedCount: update.count,
      });
      throw new NotFoundException('Agent session not found');
    }
  }

  async remove(
    organizationId: OrganizationId,
    agentSessionId: string,
  ): Promise<void> {
    return this.removeSession(organizationId, agentSessionId, false);
  }

  /** Roll back records owned exclusively by an eval launch that never started. */
  async rollbackEvalLaunchSession(
    organizationId: OrganizationId,
    agentSessionId: string,
  ): Promise<void> {
    return this.removeSession(organizationId, agentSessionId, true);
  }

  private async removeSession(
    organizationId: OrganizationId,
    agentSessionId: string,
    rollbackEvalLaunch: boolean,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.agentSession.findFirst({
        where: { id: agentSessionId, organizationId },
        include: this.buildSelectedServiceRelationsInclude(),
      });

      if (!existing) {
        throw new NotFoundException('Agent session not found');
      }

      if (rollbackEvalLaunch && existing.status !== 'NOT_STARTED') {
        throw new ConflictException('Cannot roll back a started eval session');
      }

      const agentOperations = await tx.agentOperation.findMany({
        where: { agentSessionId },
        select: { operationId: true },
      });
      const operationIds = agentOperations.map(
        ({ operationId }) => operationId,
      );

      if (operationIds.length > 0) {
        // Retain the conversation messages while removing their references to
        // operations that are about to be deleted.
        await tx.message.updateMany({
          where: { executionOperationId: { in: operationIds } },
          data: { executionOperationId: null },
        });
      }

      // Agent operations own the dispatch rows that reference their grants.
      // Remove them first so those restrictive grant foreign keys do not
      // prevent cleanup of a session-bound grant.
      await tx.agentOperation.deleteMany({
        where: { agentSessionId },
      });

      await tx.executionGrant.deleteMany({
        where: { agentSessionId },
      });

      await tx.executionAuthorization.deleteMany({
        where: { agentSessionId },
      });

      await tx.agentSession.delete({
        where: { id: agentSessionId },
      });

      if (rollbackEvalLaunch && existing.conversationId) {
        await tx.message.deleteMany({
          where: { conversationId: existing.conversationId },
        });
        await tx.conversation.delete({
          where: { id: existing.conversationId },
        });
      }

      await this.publishDeletedEvent(
        tx,
        organizationId,
        existing as AgentSessionWithSelectedServices,
      );
    });
  }

  async markSynced(
    organizationId: OrganizationId,
    agentSessionId: string,
  ): Promise<void> {
    await this.prisma.db.agentSession.updateMany({
      where: { id: agentSessionId, organizationId },
      data: { lastSyncedAt: new Date(), hasUnsyncedChanges: false },
    });
  }

  async markUnsyncedChanges(
    organizationId: OrganizationId,
    agentSessionId: string,
  ): Promise<void> {
    await this.prisma.db.agentSession.updateMany({
      where: { id: agentSessionId, organizationId },
      data: { hasUnsyncedChanges: true },
    });
  }

  async findIdByConversationId(
    organizationId: OrganizationId,
    conversationId: string,
  ): Promise<string | null> {
    const session = await this.prisma.db.agentSession.findFirst({
      where: { conversationId, organizationId },
      select: { id: true },
    });
    return session?.id ?? null;
  }

  /**
   * Accept a runtime observation only after resolving the session against the
   * identity proven by the authenticated machine socket. The observation
   * itself never supplies organization, project, user, machine, or revision
   * data.
   */
  async observeCurrentState(
    connection: AgentSessionRuntimeConnectionContext,
    observation: AgentSessionCurrentStateObservation,
  ): Promise<AgentSessionCurrentStateProjectionResult> {
    const projection = this.requireCurrentStateProjection();
    const context = await this.authorizeRuntimeObservation(
      connection,
      observation.agentSessionId,
      (authorized) => projection.recordAuthorizationDecision?.(authorized),
    );
    return projection.observe(
      context,
      observation.currentState,
      observation.observedAt,
    );
  }

  /**
   * Persist a CLI turn-end context-size reading after the same socket-proven
   * identity checks as current-state observations. A reading older than the
   * stored one is dropped. The write bypasses Prisma's `@updatedAt` so a
   * reading never reorders session lists or invalidates current-state reads.
   */
  async observeContextSize(
    connection: AgentSessionRuntimeConnectionContext,
    observation: AgentSessionContextSizeObservation,
  ): Promise<
    | { outcome: 'stale' }
    | {
        outcome: 'applied';
        organizationId: OrganizationId;
        projectId: ProjectId;
        userId: string;
        conversationId: string | null;
        contextSize: AgentSessionContextSize;
      }
  > {
    const context = await this.authorizeRuntimeObservation(
      connection,
      observation.agentSessionId,
    );
    const observedAt = new Date(observation.observedAt);
    if (Number.isNaN(observedAt.getTime())) {
      throw new BadRequestException('Context size observedAt is not a date');
    }
    if (
      !Number.isSafeInteger(observation.totalTokens) ||
      observation.totalTokens < 0
    ) {
      throw new BadRequestException(
        'Context size totalTokens must be a non-negative integer',
      );
    }
    const maxTokens = observation.maxTokens ?? null;
    if (
      maxTokens !== null &&
      (!Number.isSafeInteger(maxTokens) || maxTokens < 1)
    ) {
      throw new BadRequestException(
        'Context size maxTokens must be a positive integer',
      );
    }
    const updated = await this.prisma.db.$executeRaw`
      UPDATE "agent_sessions"
      SET context_size_tokens = ${BigInt(observation.totalTokens)},
          context_size_run_id = ${observation.runId},
          context_size_provider_session_id = ${observation.providerSessionId},
          context_size_observed_at = ${observedAt},
          context_size_max_tokens = ${maxTokens === null ? null : BigInt(maxTokens)}
      WHERE id = ${context.agentSessionId}
        AND (context_size_observed_at IS NULL OR context_size_observed_at < ${observedAt})
    `;
    if (updated === 0) {
      this.logger.debug('[context-size] stale observation dropped', {
        agentSessionId: context.agentSessionId,
        observedAt: observation.observedAt,
      });
      return { outcome: 'stale' };
    }
    return {
      outcome: 'applied',
      organizationId: context.organizationId as OrganizationId,
      projectId: context.projectId as ProjectId,
      userId: context.userId,
      conversationId: context.conversationId ?? null,
      contextSize: {
        totalTokens: observation.totalTokens,
        runId: observation.runId,
        providerSessionId: observation.providerSessionId,
        observedAt: observedAt.toISOString(),
        maxTokens,
      },
    };
  }

  /**
   * Resolve a CLI runtime observation's Agent Session against the identity
   * proven by the authenticated machine socket. The observation itself never
   * supplies organization, project, user, machine, or revision data.
   */
  private async authorizeRuntimeObservation(
    connection: AgentSessionRuntimeConnectionContext,
    agentSessionId: string,
    recordAuthorizationDecision?: (authorized: boolean) => void,
  ): Promise<AgentSessionCurrentStateObservationContext> {
    const session = await this.prisma.db.agentSession.findFirst({
      where: { id: agentSessionId },
      select: {
        id: true,
        organizationId: true,
        projectId: true,
        userId: true,
        machineId: true,
        conversationId: true,
      },
    });

    const organizationId = connection.organizationIds.find(
      (candidate) => candidate === session?.organizationId,
    );
    const durableMachineId = session?.machineId;
    const authorized =
      session !== null &&
      organizationId !== undefined &&
      connection.userId === session.userId &&
      connection.machineId !== undefined &&
      durableMachineId !== null &&
      connection.machineId === durableMachineId &&
      connection.projectIds.includes(session.projectId);
    recordAuthorizationDecision?.(authorized);

    if (!authorized || !session || !organizationId || !connection.userId) {
      this.logger.warn('[current-state] runtime observation rejected', {
        agentSessionId: agentSessionId,
        connectionId: connection.connectionId,
        organizationId,
        userId: connection.userId,
        machineId: connection.machineId,
        reason: !session
          ? 'session_not_found'
          : connection.userId !== session.userId
            ? 'user_mismatch'
            : connection.machineId !== session.machineId
              ? 'machine_mismatch'
              : !organizationId
                ? 'organization_mismatch'
                : 'project_mismatch',
      });
      throw new ForbiddenException('Agent Session runtime observation denied');
    }
    if (!durableMachineId) {
      throw new ForbiddenException(
        'Agent Session has no durable machine binding',
      );
    }

    const context: AgentSessionCurrentStateObservationContext = {
      agentSessionId: session.id,
      organizationId,
      projectId: session.projectId,
      userId: session.userId,
      machineId: durableMachineId,
      connectionId: connection.connectionId,
      conversationId: session.conversationId,
    };

    this.logger.debug('[current-state] runtime observation authorized', {
      agentSessionId: session.id,
      connectionId: connection.connectionId,
      organizationId,
      projectId: session.projectId,
      userId: session.userId,
      machineId: session.machineId,
    });
    return context;
  }

  async readCurrentState(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentSessionId: string,
  ): Promise<AgentSessionCurrentStateBatchItemDto | null> {
    if (this.currentStateReadService) {
      const [item] = await this.currentStateReadService.readAuthorized(
        organizationId,
        projectId,
        [agentSessionId],
      );
      return item ?? null;
    }

    const session = await this.prisma.db.agentSession.findFirst({
      where: { id: agentSessionId, organizationId, projectId },
      select: { id: true },
    });
    if (!session) {
      return null;
    }

    const entry =
      await this.requireCurrentStateProjection().read(agentSessionId);
    if (
      !entry ||
      entry.organizationId !== organizationId ||
      entry.projectId !== projectId
    ) {
      return null;
    }
    return this.toCurrentStateBatchItem(entry);
  }

  async readCurrentStateBatch(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentSessionIds: readonly string[],
  ): Promise<AgentSessionCurrentStateBatchResponseDto> {
    if (this.currentStateReadService) {
      return {
        items: await this.currentStateReadService.readAuthorized(
          organizationId,
          projectId,
          agentSessionIds,
        ),
      } satisfies AgentSessionCurrentStateBatchResponseDto;
    }

    const sessions = await this.prisma.db.agentSession.findMany({
      where: {
        id: { in: [...agentSessionIds] },
        organizationId,
        projectId,
      },
      select: { id: true },
    });
    const authorizedIds = sessions.map((session) => session.id);
    const entries =
      await this.requireCurrentStateProjection().readMany(authorizedIds);
    const items = authorizedIds.flatMap((agentSessionId) => {
      const entry = entries.get(agentSessionId);
      if (
        !entry ||
        entry.organizationId !== organizationId ||
        entry.projectId !== projectId
      ) {
        return [];
      }
      return [this.toCurrentStateBatchItem(entry)];
    });
    return { items } satisfies AgentSessionCurrentStateBatchResponseDto;
  }

  async clearRuntimeCurrentState(
    connection: Pick<
      AgentSessionRuntimeConnectionContext,
      'connectionId' | 'userId' | 'machineId' | 'organizationIds'
    >,
  ): Promise<number> {
    if (!connection.userId || !connection.machineId) {
      return 0;
    }
    return this.requireCurrentStateProjection().disconnect({
      connectionId: connection.connectionId,
      userId: connection.userId,
      machineId: connection.machineId,
      organizationId: connection.organizationIds[0] ?? '',
    });
  }

  private toCurrentStateBatchItem(
    entry: AgentSessionCurrentStateProjectionEntry,
  ): AgentSessionCurrentStateBatchItemDto {
    return {
      agentSessionId: entry.agentSessionId,
      currentState: entry.currentState,
      revision: entry.revision,
      transitionedAt: entry.transitionedAt,
    } satisfies AgentSessionCurrentStateBatchItemDto;
  }

  private requireCurrentStateProjection(): AgentSessionCurrentStateProjection {
    if (!this.currentStateProjection) {
      throw new Error(
        'Agent Session current-state projection is not registered',
      );
    }
    return this.currentStateProjection;
  }

  private toDto(session: AgentSessionWithSelectedServices): AgentSessionDto {
    return this.toDtoWithService(session);
  }

  private toCurrentStateIdentity(
    session: Pick<
      AgentSessionWithServiceRow,
      'id' | 'organizationId' | 'projectId' | 'updatedAt'
    >,
  ): AgentSessionCurrentStateLoadedIdentity {
    return {
      agentSessionId: session.id,
      organizationId: session.organizationId,
      projectId: session.projectId,
      updatedAt: session.updatedAt,
    };
  }

  private toCurrentStateIdentityFromDto(
    dto: AgentSessionDto,
  ): AgentSessionCurrentStateLoadedIdentity {
    if (!dto.updatedAt) {
      throw new Error(
        'Agent Session DTO is missing updatedAt for current-state enrichment',
      );
    }
    return {
      agentSessionId: dto.id,
      organizationId: dto.organizationId,
      projectId: dto.projectId,
      updatedAt: new Date(dto.updatedAt),
    };
  }

  private async enrichAgentSessionDto(
    dto: AgentSessionDto,
    identity: AgentSessionCurrentStateLoadedIdentity,
  ): Promise<AgentSessionDto> {
    const [enriched] = await this.enrichAgentSessionDtos([dto], [identity]);
    return enriched ?? dto;
  }

  private async enrichAgentSessionDtos(
    dtos: readonly AgentSessionDto[],
    identities: readonly AgentSessionCurrentStateLoadedIdentity[],
  ): Promise<AgentSessionDto[]> {
    if (!this.currentStateReadService || dtos.length === 0) {
      return [...dtos];
    }

    const resolved = await this.currentStateReadService.readLoaded(identities);
    return dtos.map((dto) => ({
      ...dto,
      currentState:
        resolved.items.get(dto.id)?.currentState ??
        AgentSessionCurrentState.Idle,
    }));
  }

  private async publishStatusChangedEventIfNeeded(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    existing: Pick<AgentSession, 'status'>,
    updated: AgentSessionWithSelectedServices,
  ): Promise<void> {
    const previousStatus = this.toStatus(existing.status);
    const newStatus = this.toStatus(updated.status);

    if (previousStatus === newStatus) {
      return;
    }

    const projectId = updated.projectId as ProjectId;

    const payload: AgentSessionStatusChangedEventPayload = {
      payloadType: EVENT_TYPES.AGENT_SESSION.STATUS_CHANGED,
      organizationId,
      projectId,
      conversationId: updated.conversationId as ConversationId | null,
      userId: updated.userId as UserId,
      agentSession: this.toDto(updated),
      previousStatus,
      newStatus,
      type: updated.type as AgentSessionType,
    };

    const event: Omit<AgentSessionStatusChangedEvent, 'id'> = {
      type: EVENT_TYPES.AGENT_SESSION.STATUS_CHANGED,
      aggregateId: updated.id,
      payload,
    };

    await this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishCreatedEvent(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    created: AgentSessionWithSelectedServices,
  ): Promise<void> {
    const projectId = created.projectId as ProjectId;
    const taskEntityId =
      created.entityType === 'TASK' ? (created.entityId ?? null) : null;
    const designDocEntityId =
      created.entityType === 'DESIGN_DOC' ? (created.entityId ?? null) : null;
    const planId = await this.resolveSessionPlanId(
      tx,
      organizationId,
      taskEntityId,
      designDocEntityId,
    );

    const payload: AgentSessionCreatedEventPayload = {
      payloadType: EVENT_TYPES.AGENT_SESSION.CREATED,
      organizationId,
      projectId,
      ...(taskEntityId ? { taskId: taskEntityId as TaskId } : {}),
      ...(planId ? { planId } : {}),
      ...(created.serviceId ? { serviceId: created.serviceId } : {}),
      conversationId: created.conversationId as ConversationId | null,
      userId: created.userId as UserId,
      agentSession: this.toDto(created),
      type: created.type as AgentSessionType,
    };

    const event: Omit<AgentSessionCreatedEvent, 'id'> = {
      type: EVENT_TYPES.AGENT_SESSION.CREATED,
      aggregateId: created.id,
      payload,
    };

    await this.eventPublisher.publishInTransaction(tx, event);
  }

  private async resolveSessionPlanId(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    taskId: string | null,
    designDocId: string | null,
  ): Promise<string | undefined> {
    const taskPlanId = await this.resolvePlanIdForEntity(
      tx,
      organizationId,
      EntityType.TASK,
      taskId,
    );
    if (taskPlanId) {
      return taskPlanId;
    }

    return this.resolvePlanIdForEntity(
      tx,
      organizationId,
      EntityType.DESIGN_DOC,
      designDocId,
    );
  }

  private async resolvePlanIdForEntity(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    entityType: EntityType,
    entityId: string | null,
  ): Promise<string | undefined> {
    if (!entityId) {
      return undefined;
    }

    if (entityType === EntityType.TASK) {
      return resolveAncestorPlanWorkItem(tx, organizationId, entityId);
    }
    if (entityType === EntityType.DESIGN_DOC) {
      const doc = await tx.designDoc.findFirst({
        where: { id: entityId, organizationId },
        select: { parentEntityId: true, parentEntityType: true },
      });
      if (doc?.parentEntityType === 'TASK' && doc.parentEntityId) {
        return resolveAncestorPlanWorkItem(
          tx,
          organizationId,
          doc.parentEntityId,
        );
      }
    }
    return undefined;
  }

  private async publishDeletedEvent(
    tx: AnyTransactionClient,
    organizationId: OrganizationId,
    deleted: AgentSessionWithSelectedServices,
  ): Promise<void> {
    const projectId = deleted.projectId as ProjectId;

    const payload: AgentSessionDeletedEventPayload = {
      payloadType: EVENT_TYPES.AGENT_SESSION.DELETED,
      organizationId,
      projectId,
      conversationId: deleted.conversationId as ConversationId | null,
      userId: deleted.userId as UserId,
      agentSession: this.toDto(deleted),
      type: deleted.type as AgentSessionType,
    };

    const event: Omit<AgentSessionDeletedEvent, 'id'> = {
      type: EVENT_TYPES.AGENT_SESSION.DELETED,
      aggregateId: deleted.id,
      payload,
    };

    await this.eventPublisher.publishInTransaction(tx, event);
  }

  private buildUpdateInput(
    existing: Pick<AgentSession, 'serviceId'>,
    dto: AgentSessionUpdateInput,
    persistedConfig?: AgentSessionConfig | null,
  ): Prisma.AgentSessionUpdateInput {
    return {
      ...(dto.machineId !== undefined
        ? { machine: { connect: { id: dto.machineId } } }
        : {}),
      ...(dto.sessionDate ? { sessionDate: new Date(dto.sessionDate) } : {}),
      ...(dto.title ? { title: dto.title } : {}),
      ...(dto.userId ? { user: { connect: { id: dto.userId } } } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.launchServiceId && existing.serviceId !== dto.launchServiceId
        ? { service: { connect: { id: dto.launchServiceId } } }
        : {}),
      ...(dto.provider !== undefined ? { provider: dto.provider } : {}),
      ...(dto.agentSessionId !== undefined
        ? { providerAgentSessionId: dto.agentSessionId }
        : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.entityType !== undefined
        ? { entityType: dto.entityType ?? null }
        : {}),
      ...(dto.entityId !== undefined ? { entityId: dto.entityId ?? null } : {}),
      ...(dto.lastSyncedAt !== undefined
        ? { lastSyncedAt: dto.lastSyncedAt ? new Date(dto.lastSyncedAt) : null }
        : {}),
      ...(dto.hasUnsyncedChanges !== undefined
        ? { hasUnsyncedChanges: dto.hasUnsyncedChanges }
        : {}),
      ...(dto.monitoringEnabled !== undefined
        ? this.buildMonitoringEnabledUpdate(dto.monitoringEnabled)
        : {}),
      ...(dto.autoDecide !== undefined
        ? this.buildAutoDecideUpdate(dto.autoDecide)
        : {}),
      ...(dto.config !== undefined
        ? this.buildConfigUpdate(
            persistedConfig !== undefined ? persistedConfig : dto.config,
            persistedConfig !== undefined,
          )
        : {}),
    };
  }

  private buildConfigUpdate(
    config: AgentSessionConfig | null,
    capturedProjectModeConfig = false,
  ): Pick<Prisma.AgentSessionUpdateInput, 'config'> {
    const validated = capturedProjectModeConfig
      ? config
      : this.assertValidConfig(config);
    const value = this.buildConfigCreateValue(validated ?? null);
    this.logger.log('Updating config on agent session', {
      type: validated?.type ?? null,
      version: validated?.version ?? null,
      method:
        validated && 'method' in validated ? (validated.method ?? null) : null,
    });
    return { config: value };
  }

  private buildConfigCreateValue(
    config: AgentSessionConfig | null,
  ): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
    if (config === null) {
      return Prisma.DbNull;
    }
    this.logger.log('Persisting agent session config', {
      type: config.type,
      version: config.version,
      method: 'method' in config ? (config.method ?? null) : null,
    });
    const serialized: MutableInputJsonObject = {
      type: config.type,
      version: config.version,
    };
    if (
      config.type === AgentSessionConfigProjectReportV1.TypeEnum.ProjectReport
    ) {
      return {
        ...serialized,
        requestId: config.requestId,
        attemptId: config.attemptId,
        model: config.model,
        ...(config.effort !== undefined ? { effort: config.effort } : {}),
        ...(config.fastMode !== undefined ? { fastMode: config.fastMode } : {}),
      };
    }
    if ('method' in config && config.method !== undefined) {
      serialized.method = config.method;
    }
    if (
      config.type ===
      AgentSessionConfigEntityConversationV1.TypeEnum.EntityConversation
    ) {
      serialized.model = config.model;
      if (config.effort !== undefined) {
        serialized.effort = config.effort;
      }
      if (config.projectAssistant !== undefined) {
        serialized.projectAssistant = this.buildProjectAssistantConfigJson(
          config.projectAssistant,
        );
      }
    }
    if (config.type === AgentSessionConfigV2.TypeEnum.CodingSession) {
      serialized.model = config.model;
      if (config.effort !== undefined) {
        serialized.effort = config.effort;
      }
      if (config.fastMode !== undefined) {
        serialized.fastMode = config.fastMode;
      }
      if (config.worktree !== undefined) {
        serialized.worktree = config.worktree;
      }
      if (config.sessionMonitorTerminalPolicy !== undefined) {
        serialized.sessionMonitorTerminalPolicy = this.buildTerminalPolicyJson(
          config.sessionMonitorTerminalPolicy,
        );
      }
      if (config.taskMonitorId !== undefined) {
        serialized.taskMonitorId = config.taskMonitorId;
      }
      if (config.projectAssistant !== undefined) {
        serialized.projectAssistant = this.buildProjectAssistantConfigJson(
          config.projectAssistant,
        );
      }
      if (config.projectModeSelection !== undefined) {
        serialized.projectModeSelection =
          config.projectModeSelection as unknown as Prisma.InputJsonValue;
      }
      if (config.projectModeSnapshot !== undefined) {
        serialized.projectModeSnapshot =
          config.projectModeSnapshot as unknown as Prisma.InputJsonValue;
      }
    }
    return serialized;
  }

  private buildProjectAssistantConfigJson(
    config: ProjectAssistantConfig,
  ): Prisma.InputJsonValue {
    const serialized: MutableInputJsonObject = {};
    if (config.enabled !== undefined) {
      serialized.enabled = config.enabled;
    }
    if (config.allowEdgeUpdates !== undefined) {
      serialized.allowEdgeUpdates = config.allowEdgeUpdates;
    }
    if (config.notifyDiscrepancies !== undefined) {
      serialized.notifyDiscrepancies = config.notifyDiscrepancies;
    }
    if (config.allowUpdateProposals !== undefined) {
      serialized.allowUpdateProposals = config.allowUpdateProposals;
    }
    return serialized;
  }

  private buildTerminalPolicyJson(
    policy: SessionMonitorTerminalPolicy,
  ): Prisma.InputJsonValue {
    if (policy.implementationDone === null) {
      throw new BadRequestException(
        'config.sessionMonitorTerminalPolicy.implementationDone must be an object',
      );
    }
    const serialized: MutableInputJsonObject = {
      implementationDone: this.buildImplementationTerminalPolicyJson(
        policy.implementationDone,
      ),
    };
    if (policy.reviewDone !== undefined) {
      serialized.reviewDone = this.buildReviewTerminalPolicyJson(
        policy.reviewDone,
      );
    }
    return serialized;
  }

  private buildImplementationTerminalPolicyJson(
    policy: SessionMonitorImplementationTerminalPolicy,
  ): Prisma.InputJsonValue {
    const serialized: MutableInputJsonObject = {};
    if (policy.completion !== undefined) {
      serialized.completion = this.buildTerminalPolicyActionJson(
        policy.completion,
      );
    }
    if (policy.requestReview !== undefined) {
      serialized.requestReview = policy.requestReview;
    }
    return serialized;
  }

  private buildReviewTerminalPolicyJson(
    policy: SessionMonitorReviewTerminalPolicy,
  ): Prisma.InputJsonValue {
    const serialized: MutableInputJsonObject = {
      completion: this.buildTerminalPolicyActionJson(policy.completion),
    };
    return serialized;
  }

  private buildTerminalPolicyActionJson(
    action: SessionMonitorTerminalPolicyAction,
  ): Prisma.InputJsonValue {
    const serialized: MutableInputJsonObject = {
      action: action.action,
    };
    if (action.response !== undefined) {
      serialized.response = action.response;
    }
    return serialized;
  }

  private buildMonitoringEnabledUpdate(
    monitoringEnabled: boolean,
  ): Pick<Prisma.AgentSessionUpdateInput, 'monitoringEnabled'> {
    this.logger.log('Updating monitoringEnabled on agent session', {
      monitoringEnabled,
    });
    return { monitoringEnabled };
  }

  private buildAutoDecideUpdate(
    autoDecide: boolean,
  ): Pick<Prisma.AgentSessionUpdateInput, 'autoDecide'> {
    this.logger.log('Updating autoDecide on agent session', {
      autoDecide,
    });
    return { autoDecide };
  }

  private toDtoWithService(
    session: AgentSessionWithSelectedServices,
    service?: AgentSessionServiceSummary,
  ): AgentSessionDto {
    const provider = this.toProvider(session.provider);
    const serviceIds = this.extractSelectedServiceIds(session);

    return {
      id: session.id,
      organizationId: session.organizationId,
      projectId: session.projectId as ProjectId,
      userId: session.userId,
      status: this.toStatus(session.status),
      currentState: AgentSessionCurrentState.Idle,
      launchServiceId: session.serviceId ?? undefined,
      serviceIds,
      provider,
      agentSessionId: session.providerAgentSessionId ?? undefined,
      conversationId: session.conversationId,
      machineId: session.machineId ?? null,
      entityType: (session.entityType as EntityType | null) ?? undefined,
      entityId: session.entityId ?? undefined,
      service,
      sessionDate: session.sessionDate.toISOString(),
      title: session.title,
      lastSyncedAt: session.lastSyncedAt?.toISOString() ?? null,
      hasUnsyncedChanges: session.hasUnsyncedChanges,
      monitoringEnabled: session.monitoringEnabled,
      autoDecide: session.autoDecide,
      type: session.type as AgentSessionType,
      config: this.parseStoredConfig(session.config ?? null),
      contextSize: this.toContextSize(session),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    } satisfies AgentSessionDto;
  }

  private toContextSize(
    session: Pick<
      AgentSession,
      | 'contextSizeTokens'
      | 'contextSizeRunId'
      | 'contextSizeProviderSessionId'
      | 'contextSizeObservedAt'
      | 'contextSizeMaxTokens'
    >,
  ): AgentSessionContextSize | null {
    // Raw list queries may omit the columns entirely; treat that as unknown.
    if (
      typeof session.contextSizeTokens !== 'bigint' ||
      !session.contextSizeRunId ||
      !session.contextSizeProviderSessionId ||
      !(session.contextSizeObservedAt instanceof Date)
    ) {
      return null;
    }
    return {
      totalTokens: Number(session.contextSizeTokens),
      runId: session.contextSizeRunId,
      providerSessionId: session.contextSizeProviderSessionId,
      observedAt: session.contextSizeObservedAt.toISOString(),
      maxTokens:
        typeof session.contextSizeMaxTokens === 'bigint'
          ? Number(session.contextSizeMaxTokens)
          : null,
    };
  }

  private async findAllWithServiceSummary(
    organizationId: OrganizationId,
    projectId: ProjectId,
    filters: ListFilters,
  ): Promise<AgentSessionDto[]> {
    const rows = await this.queryAgentSessionsWithServiceSummary(
      organizationId,
      projectId,
      filters,
      true,
    );

    const dtos = rows.map((row) => this.toDtoFromServiceJoinRow(row));
    return this.enrichAgentSessionDtos(
      dtos,
      rows.map((row) => this.toCurrentStateIdentity(row)),
    );
  }

  private async findOneWithServiceSummary(
    organizationId: OrganizationId,
    agentSessionId: string,
    projectId?: ProjectId,
  ): Promise<AgentSessionDto | null> {
    const rows = await this.queryAgentSessionsWithServiceSummary(
      organizationId,
      projectId ?? null,
      { ids: [agentSessionId] },
      false,
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    return this.toDtoFromServiceJoinRow(row);
  }

  private async queryAgentSessionsWithServiceSummary(
    organizationId: OrganizationId,
    projectId: ProjectId | null,
    filters: ListFilters,
    orderBySessionDateDesc: boolean,
  ): Promise<AgentSessionWithServiceRow[]> {
    const whereConditions = this.buildRawWhereClauses(
      organizationId,
      projectId,
      filters,
    );

    const query = Prisma.sql`
      SELECT
        cs.id AS "id",
        cs.organization_id AS "organizationId",
        cs.project_id AS "projectId",
        cs.user_id AS "userId",
        cs.machine_id AS "machineId",
        cs.status AS "status",
        cs.session_date AS "sessionDate",
        cs.service_id AS "serviceId",
        cs.provider AS "provider",
        cs.provider_agent_session_id AS "providerAgentSessionId",
        cs.conversation_id AS "conversationId",
        cs.entity_type AS "entityType",
        cs.entity_id AS "entityId",
        cs.title AS "title",
        cs.last_synced_at AS "lastSyncedAt",
        cs.has_unsynced_changes AS "hasUnsyncedChanges",
        cs.monitoring_enabled AS "monitoringEnabled",
        cs.auto_decide AS "autoDecide",
        cs.type AS "type",
        cs.config AS "config",
        cs.context_size_tokens AS "contextSizeTokens",
        cs.context_size_run_id AS "contextSizeRunId",
        cs.context_size_provider_session_id AS "contextSizeProviderSessionId",
        cs.context_size_observed_at AS "contextSizeObservedAt",
        cs.context_size_max_tokens AS "contextSizeMaxTokens",
        cs.created_at AS "createdAt",
        cs.updated_at AS "updatedAt",
        svc.id AS "joinedServiceId",
        svc.name AS "joinedServiceName",
        COALESCE(selected.selected_service_ids, ARRAY[]::text[]) AS "selectedServiceIds"
      FROM "agent_sessions" cs
      LEFT JOIN "services" svc
        ON svc.id::text = cs.service_id::text
       AND svc.organization_id::text = cs.organization_id::text
      LEFT JOIN LATERAL (
        SELECT array_agg(sas.service_id::text ORDER BY sas.created_at) AS selected_service_ids
        FROM "service_agent_sessions" sas
        WHERE sas.agent_session_id::text = cs.id::text
      ) selected ON TRUE
      WHERE ${Prisma.join(whereConditions, ' AND ')}
      ${
        orderBySessionDateDesc
          ? Prisma.sql`ORDER BY cs.session_date DESC`
          : Prisma.empty
      }
    `;

    return this.prisma.db.$queryRaw<AgentSessionWithServiceRow[]>(query);
  }

  private buildRawWhereClauses(
    organizationId: OrganizationId,
    projectId: ProjectId | null,
    filters: ListFilters,
  ): Prisma.Sql[] {
    const whereConditions: Prisma.Sql[] = [
      Prisma.sql`cs.organization_id::text = ${organizationId}`,
    ];

    if (projectId) {
      whereConditions.push(Prisma.sql`cs.project_id::text = ${projectId}`);
    }

    if (filters.ids && filters.ids.length > 0) {
      whereConditions.push(
        Prisma.sql`cs.id::text IN (${Prisma.join(
          filters.ids.map((id) => Prisma.sql`${id}`),
        )})`,
      );
    }

    if (filters.userId) {
      whereConditions.push(Prisma.sql`cs.user_id::text = ${filters.userId}`);
    }

    if (filters.conversationId) {
      whereConditions.push(
        Prisma.sql`cs.conversation_id::text = ${filters.conversationId}`,
      );
    }

    if (filters.entityType) {
      whereConditions.push(Prisma.sql`cs.entity_type = ${filters.entityType}`);
    }

    if (filters.entityId) {
      whereConditions.push(Prisma.sql`cs.entity_id = ${filters.entityId}`);
    }

    if (filters.serviceId) {
      whereConditions.push(
        Prisma.sql`EXISTS (
          SELECT 1
          FROM "service_agent_sessions" filter_sas
          WHERE filter_sas.agent_session_id::text = cs.id::text
            AND filter_sas.service_id::text = ${filters.serviceId}
        )`,
      );
    }

    if (filters.type) {
      whereConditions.push(Prisma.sql`cs.type::text = ${filters.type}`);
    }

    return whereConditions;
  }

  private toDtoFromServiceJoinRow(row: AgentSessionWithServiceRow) {
    const session: AgentSessionWithSelectedServices = {
      id: row.id,
      organizationId: row.organizationId,
      projectId: row.projectId,
      userId: row.userId,
      machineId: row.machineId,
      status: row.status,
      sessionDate: row.sessionDate,
      serviceId: row.serviceId,
      provider: row.provider,
      providerAgentSessionId: row.providerAgentSessionId,
      conversationId: row.conversationId,
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.title,
      lastSyncedAt: row.lastSyncedAt,
      hasUnsyncedChanges: row.hasUnsyncedChanges,
      monitoringEnabled: row.monitoringEnabled,
      autoDecide: row.autoDecide,
      type: row.type,
      config: row.config,
      contextSizeTokens: row.contextSizeTokens,
      contextSizeRunId: row.contextSizeRunId,
      contextSizeProviderSessionId: row.contextSizeProviderSessionId,
      contextSizeObservedAt: row.contextSizeObservedAt,
      contextSizeMaxTokens: row.contextSizeMaxTokens,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      serviceRelations: row.selectedServiceIds.map((serviceId) => ({
        serviceId,
      })),
    };

    return this.toDtoWithService(
      session,
      this.toServiceSummary(
        row.serviceId,
        row.joinedServiceId,
        row.joinedServiceName,
      ),
    );
  }

  private toPaginatedItemDto(
    row: PaginatedAgentSessionRow,
    reports: ReportDto[],
  ): PaginatedAgentSessionItemDto {
    const agentSession = this.toDtoFromServiceJoinRow(row);
    const services = this.parseSelectedServiceSummaries(
      row.selectedServices,
      row.selectedServiceIds,
    );

    return {
      agentSession,
      lastMessage: this.toLastMessageSummary(row),
      parentEntity: this.toParentEntitySummary(row),
      services,
      reports,
    } satisfies PaginatedAgentSessionItemDto;
  }

  private toLastMessageSummary(
    row: PaginatedAgentSessionRow,
  ): AgentSessionLastMessageSummary | null {
    const values = [
      row.lastMessageId,
      row.lastMessageConversationId,
      row.lastMessageType,
      row.lastMessageStatus,
      row.lastMessageData,
      row.lastMessageAt,
      row.lastMessageCreatedAt,
    ];
    if (values.every((value) => value === null)) {
      return null;
    }
    if (values.some((value) => value === null)) {
      throw new BadRequestException(
        'Agent session returned incomplete last-message data',
      );
    }
    if (
      !MESSAGE_TYPE_VALUES.has(row.lastMessageType!) ||
      !MESSAGE_STATUS_VALUES.has(row.lastMessageStatus!) ||
      typeof row.lastMessageData !== 'object' ||
      Array.isArray(row.lastMessageData)
    ) {
      throw new BadRequestException(
        'Agent session returned invalid last-message data',
      );
    }

    return {
      id: row.lastMessageId as MessageId,
      conversationId: row.lastMessageConversationId as ConversationId,
      type: row.lastMessageType as MessageType,
      status: row.lastMessageStatus as MessageStatus,
      data: row.lastMessageData as object,
      createdAt: row.lastMessageCreatedAt!.toISOString(),
    } satisfies AgentSessionLastMessageSummary;
  }

  private toParentEntitySummary(
    row: PaginatedAgentSessionRow,
  ): AgentSessionParentEntitySummary | null {
    const values = [
      row.parentEntityId,
      row.parentEntityType,
      row.parentEntityName,
    ];
    if (values.every((value) => value === null)) {
      return null;
    }
    if (
      values.some((value) => value === null) ||
      !ENTITY_TYPE_VALUES.has(row.parentEntityType!)
    ) {
      throw new BadRequestException(
        'Agent session returned invalid parent-entity data',
      );
    }

    return {
      id: row.parentEntityId!,
      type: row.parentEntityType as EntityType,
      name: row.parentEntityName!,
    } satisfies AgentSessionParentEntitySummary;
  }

  private parseSelectedServiceSummaries(
    value: unknown,
    selectedServiceIds: string[],
  ): AgentSessionServiceSummary[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(
        'Agent session returned invalid selected-service data',
      );
    }

    const services = value.map((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        Array.isArray(entry) ||
        typeof (entry as { id?: unknown }).id !== 'string' ||
        typeof (entry as { name?: unknown }).name !== 'string'
      ) {
        throw new BadRequestException(
          'Agent session returned invalid selected-service data',
        );
      }
      return {
        id: (entry as { id: string }).id,
        name: (entry as { name: string }).name,
      } satisfies AgentSessionServiceSummary;
    });

    if (
      services.length !== selectedServiceIds.length ||
      services.some(
        (service, index) => service.id !== selectedServiceIds[index],
      )
    ) {
      throw new BadRequestException(
        'Agent session selected-service relationships are inconsistent',
      );
    }
    return services;
  }

  private buildPageCursorFingerprint(
    filters: Pick<
      PaginatedAgentSessionFilters,
      'type' | 'statuses' | 'sort' | 'userId' | 'serviceId' | 'taskId'
    >,
  ): string {
    const canonicalFilters = JSON.stringify({
      type: filters.type ?? null,
      statuses: Array.from(new Set(filters.statuses)).sort(),
      sort: filters.sort,
      userId: filters.userId ?? null,
      serviceId: filters.serviceId ?? null,
      taskId: filters.taskId ?? null,
    });
    return createHash('sha256').update(canonicalFilters).digest('hex');
  }

  private encodePageCursor(cursor: AgentSessionPageCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodePageCursor(
    encoded: string,
    expectedFingerprint: string,
  ): AgentSessionPageCursor {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
      throw new BadRequestException('cursor is invalid');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('cursor is invalid');
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new BadRequestException('cursor is invalid');
    }
    const cursor = parsed as Partial<AgentSessionPageCursor>;
    if (
      cursor.version !== 2 ||
      typeof cursor.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(cursor.fingerprint) ||
      typeof cursor.id !== 'string' ||
      !isUuid(cursor.id) ||
      !(
        cursor.lastMessageAt === null ||
        (typeof cursor.lastMessageAt === 'string' &&
          !Number.isNaN(Date.parse(cursor.lastMessageAt)) &&
          new Date(cursor.lastMessageAt).toISOString() === cursor.lastMessageAt)
      )
    ) {
      throw new BadRequestException('cursor is invalid');
    }
    if (cursor.fingerprint !== expectedFingerprint) {
      throw new BadRequestException(
        'cursor does not match the requested filters',
      );
    }

    return cursor as AgentSessionPageCursor;
  }

  private buildPageCursorWhereClause(
    cursor: AgentSessionPageCursor,
  ): Prisma.Sql {
    if (cursor.lastMessageAt === null) {
      return Prisma.sql`
        latest_message.content_updated_at IS NULL
        AND cs.id::text > ${cursor.id}
      `;
    }

    const lastMessageAt = new Date(cursor.lastMessageAt);
    return Prisma.sql`
      (
        latest_message.content_updated_at < ${lastMessageAt}
        OR (
          latest_message.content_updated_at = ${lastMessageAt}
          AND cs.id::text > ${cursor.id}
        )
        OR latest_message.content_updated_at IS NULL
      )
    `;
  }

  private toServiceSummary(
    sessionServiceId: string | null,
    joinedServiceId: string | null,
    joinedServiceName: string | null,
  ): AgentSessionServiceSummary | undefined {
    if (sessionServiceId === null) {
      if (joinedServiceId !== null || joinedServiceName !== null) {
        throw new BadRequestException(
          'Agent session returned unexpected joined service data',
        );
      }

      return undefined;
    }

    if (joinedServiceId === null || joinedServiceName === null) {
      throw new BadRequestException(
        'Agent session has a serviceId but no valid joined service record',
      );
    }

    return {
      id: joinedServiceId,
      name: joinedServiceName,
    };
  }

  private async attachUser(dto: AgentSessionDto): Promise<AgentSessionDto> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: dto.userId },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new BadRequestException(
        'Agent session has a userId but no valid user record',
      );
    }

    return {
      ...dto,
      user: this.toUserDto(user),
    } satisfies AgentSessionDto;
  }

  private toUserDto(user: {
    id: string;
    email: string;
    name: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserResponseDto {
    return {
      id: user.id as UserId,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      currentOrganizationId: null,
    } satisfies UserResponseDto;
  }

  /**
   * Validate the typed, versioned config blob coming from the wire. Returns the
   * narrowed value, or `null` when the caller passed `null`, or `undefined`
   * when the caller omitted the field entirely (caller distinguishes "leave as
   * is" vs "set to null"). Anything else is rejected — most importantly any
   * config type other than an OpenAPI-modeled variant. `version` evolves the
   * selected variant's schema; it is not the variant discriminator.
   */
  private assertValidConfig(
    config: AgentSessionConfig | null | undefined,
    allowProjectModeSelection = false,
    allowProjectModeSnapshot = false,
  ): AgentSessionConfig | null | undefined {
    if (config === undefined) {
      return undefined;
    }
    if (config === null) {
      return null;
    }
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new BadRequestException(
        'config must be an object or null when present',
      );
    }
    if (!AGENT_SESSION_CONFIG_TYPES.has(config.type)) {
      throw new BadRequestException(
        `config.type must be one of: ${Array.from(
          AGENT_SESSION_CONFIG_TYPES,
        ).join(', ')}`,
      );
    }
    if (
      'method' in config &&
      config.method !== undefined &&
      config.method !== null
    ) {
      if (!SESSION_METHOD_VALUES.has(config.method)) {
        throw new BadRequestException(
          `config.method must be one of: ${Array.from(
            SESSION_METHOD_VALUES,
          ).join(', ')}`,
        );
      }
    }
    if (config.type === AgentSessionConfigV1.TypeEnum.CodingSessionV1) {
      if (config.version !== AgentSessionConfigV1.VersionEnum.V1) {
        throw new BadRequestException(
          'config.version must be v1 for CODING_SESSION_V1',
        );
      }
      return config;
    }
    if (
      config.type === AgentSessionConfigProjectReportV1.TypeEnum.ProjectReport
    ) {
      return parseProjectReportSessionConfig(config);
    }
    if (
      config.type ===
      AgentSessionConfigEntityConversationV1.TypeEnum.EntityConversation
    ) {
      if (
        config.version !== AgentSessionConfigEntityConversationV1.VersionEnum.V1
      ) {
        throw new BadRequestException(
          'config.version must be v1 for ENTITY_CONVERSATION',
        );
      }
      if (typeof config.model !== 'string' || config.model.length === 0) {
        throw new BadRequestException(
          'config.model is required and must be a non-empty string for ENTITY_CONVERSATION',
        );
      }
      if (
        config.effort !== undefined &&
        !ENTITY_CONVERSATION_EFFORT_VALUES.has(config.effort)
      ) {
        throw new BadRequestException(
          'config.effort must be a supported Entity Conversation effort when present',
        );
      }
      this.assertValidProjectAssistantConfig(config.projectAssistant);
      return config;
    }
    if (config.version !== AgentSessionConfigV2.VersionEnum.V2) {
      throw new BadRequestException(
        'config.version must be v2 for CODING_SESSION',
      );
    }
    if (config.type === AgentSessionConfigV2.TypeEnum.CodingSession) {
      if (typeof config.model !== 'string' || config.model.length === 0) {
        throw new BadRequestException(
          'config.model is required and must be a non-empty string for v2',
        );
      }
      if (config.effort !== undefined && typeof config.effort !== 'string') {
        throw new BadRequestException(
          'config.effort must be a string when present',
        );
      }
      if (
        config.fastMode !== undefined &&
        typeof config.fastMode !== 'boolean'
      ) {
        throw new BadRequestException(
          'config.fastMode must be a boolean when present',
        );
      }
      if (
        config.worktree !== undefined &&
        (typeof config.worktree !== 'string' || config.worktree.length === 0)
      ) {
        throw new BadRequestException(
          'config.worktree must be a non-empty string branch name when present',
        );
      }
      if (config.sessionMonitorTerminalPolicy !== undefined) {
        this.assertValidSessionMonitorTerminalPolicy(
          config.sessionMonitorTerminalPolicy,
        );
      }
      if (
        config.taskMonitorId !== undefined &&
        (typeof config.taskMonitorId !== 'string' ||
          !isUuid(config.taskMonitorId))
      ) {
        throw new BadRequestException(
          'config.taskMonitorId must be a UUID when present',
        );
      }
      this.assertValidProjectAssistantConfig(config.projectAssistant);
      let projectModeSelection: ProjectModeSelection | undefined;
      let projectModeSnapshot: ProjectModeSnapshot | undefined;
      if (config.projectModeSnapshot !== undefined) {
        if (!allowProjectModeSnapshot) {
          throw new BadRequestException(
            'config.projectModeSnapshot is platform-owned and cannot be supplied by callers',
          );
        }
        const snapshot = validateProjectModeSnapshot(
          config.projectModeSnapshot,
        );
        if (!snapshot.success) {
          throw new BadRequestException(
            `config.projectModeSnapshot is invalid: ${snapshot.message}`,
          );
        }
        projectModeSnapshot = snapshot.value;
        if (config.projectModeSelection === undefined) {
          throw new BadRequestException(
            'config.projectModeSnapshot requires config.projectModeSelection',
          );
        }
      }
      if (config.projectModeSelection !== undefined) {
        if (!allowProjectModeSelection) {
          throw new BadRequestException(
            'config.projectModeSelection may only be set during Agent Session creation',
          );
        }
        const selection = validateProjectModeSelection(
          config.projectModeSelection,
        );
        if (!selection.success) {
          throw new BadRequestException(
            `config.projectModeSelection is invalid: ${selection.message}`,
          );
        }
        projectModeSelection = selection.value;
        if (config.method !== undefined) {
          throw new BadRequestException(
            'config.method and config.projectModeSelection are mutually exclusive',
          );
        }
      }
      if (allowProjectModeSnapshot && projectModeSelection) {
        if (!projectModeSnapshot) {
          throw new BadRequestException(
            'config.projectModeSelection requires config.projectModeSnapshot at start-run',
          );
        }
        if (projectModeSnapshot.modeId !== projectModeSelection.modeId) {
          throw new BadRequestException(
            'config.projectModeSnapshot must match config.projectModeSelection',
          );
        }
      }
    }
    return config;
  }

  private assertValidProjectAssistantConfig(
    config: unknown,
  ): asserts config is ProjectAssistantConfig | undefined {
    if (config === undefined) {
      return;
    }
    if (
      typeof config !== 'object' ||
      config === null ||
      Array.isArray(config)
    ) {
      throw new BadRequestException(
        'config.projectAssistant must be an object when present',
      );
    }
    const record = config as Record<string, unknown>;
    this.assertAllowedKeys(
      record,
      PROJECT_ASSISTANT_CONFIG_KEYS,
      'config.projectAssistant',
    );
    for (const key of PROJECT_ASSISTANT_CONFIG_KEYS) {
      if (record[key] !== undefined && typeof record[key] !== 'boolean') {
        throw new BadRequestException(
          `config.projectAssistant.${key} must be a boolean when present`,
        );
      }
    }
  }

  private assertValidSessionMonitorTerminalPolicy(
    policy: unknown,
  ): asserts policy is SessionMonitorTerminalPolicy {
    if (
      typeof policy !== 'object' ||
      policy === null ||
      Array.isArray(policy)
    ) {
      throw new BadRequestException(
        'config.sessionMonitorTerminalPolicy must be an object when present',
      );
    }

    const record = policy as Record<string, unknown>;
    this.assertAllowedKeys(
      record,
      SESSION_MONITOR_TERMINAL_POLICY_KEYS,
      'config.sessionMonitorTerminalPolicy',
    );

    this.assertValidImplementationTerminalPolicy(
      record.implementationDone,
      'config.sessionMonitorTerminalPolicy.implementationDone',
    );
    if (record.reviewDone !== undefined) {
      this.assertValidReviewTerminalPolicy(
        record.reviewDone,
        'config.sessionMonitorTerminalPolicy.reviewDone',
      );
    }
  }

  private assertValidImplementationTerminalPolicy(
    value: unknown,
    path: string,
  ): asserts value is SessionMonitorImplementationTerminalPolicy {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException(`${path} must be an object`);
    }

    const record = value as Record<string, unknown>;
    this.assertAllowedKeys(
      record,
      SESSION_MONITOR_IMPLEMENTATION_TERMINAL_POLICY_KEYS,
      path,
    );
    if (record.completion !== undefined) {
      this.assertValidTerminalPolicyAction(
        record.completion,
        `${path}.completion`,
      );
    }
    if (record.requestReview !== undefined && record.requestReview !== true) {
      throw new BadRequestException(
        `${path}.requestReview must be true when present`,
      );
    }
    if (record.completion === undefined && record.requestReview !== true) {
      throw new BadRequestException(
        `${path} must include completion or requestReview`,
      );
    }
  }

  private assertValidReviewTerminalPolicy(
    value: unknown,
    path: string,
  ): asserts value is SessionMonitorReviewTerminalPolicy {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException(`${path} must be an object`);
    }

    const record = value as Record<string, unknown>;
    this.assertAllowedKeys(
      record,
      SESSION_MONITOR_REVIEW_TERMINAL_POLICY_KEYS,
      path,
    );
    this.assertValidTerminalPolicyAction(
      record.completion,
      `${path}.completion`,
    );
  }

  private assertValidTerminalPolicyAction(
    value: unknown,
    path: string,
  ): asserts value is SessionMonitorTerminalPolicyAction {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException(`${path} must be an object`);
    }

    const record = value as Record<string, unknown>;
    this.assertAllowedKeys(
      record,
      SESSION_MONITOR_TERMINAL_POLICY_ACTION_KEYS,
      path,
    );

    if (typeof record.action !== 'string' || record.action.length === 0) {
      throw new BadRequestException(
        `${path}.action must be a non-empty string`,
      );
    }
    if (record.response !== undefined && typeof record.response !== 'string') {
      throw new BadRequestException(`${path}.response must be a string`);
    }
  }

  private assertAllowedKeys(
    record: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    path: string,
  ): void {
    const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
    if (unexpected.length > 0) {
      throw new BadRequestException(
        `${path} contains unsupported field(s): ${unexpected.join(', ')}`,
      );
    }
  }

  /**
   * Translate the Prisma Json column into the typed DTO shape. Null stays null
   * — the read path treats a null column as "no launch context". Legacy rows
   * persisted before the config-level type discriminator are normalized by
   * adding the matching generated `type` constant. A row stored under any
   * future schema version returns null so the wire never silently renders an
   * unrecognized payload under the wrong literal.
   */
  private parseStoredConfig(
    value: Prisma.JsonValue | null,
  ): AgentSessionConfig | null {
    if (value === null) {
      return null;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      this.logger.warn('Agent session config stored as non-object; ignoring', {
        valueType: typeof value,
      });
      return null;
    }
    const record = value as Record<string, unknown>;
    const typeRaw = record.type;
    const versionRaw = record.version;
    if (typeRaw === AgentSessionConfigProjectReportV1.TypeEnum.ProjectReport) {
      return parseProjectReportSessionConfig(value);
    }
    if (typeof versionRaw !== 'string') {
      this.logger.warn('Agent session config missing string version; ignoring');
      return null;
    }
    if (
      typeRaw !== undefined &&
      (typeof typeRaw !== 'string' || !AGENT_SESSION_CONFIG_TYPES.has(typeRaw))
    ) {
      this.logger.warn(
        'Agent session config has unrecognized type; deserializer required',
        { type: typeRaw },
      );
      return null;
    }

    if (
      typeRaw ===
      AgentSessionConfigEntityConversationV1.TypeEnum.EntityConversation
    ) {
      if (
        versionRaw !== AgentSessionConfigEntityConversationV1.VersionEnum.V1
      ) {
        this.logger.warn(
          'Entity Conversation config has unrecognized version; deserializer required',
          { version: versionRaw },
        );
        return null;
      }
      const modelRaw = record.model;
      if (typeof modelRaw !== 'string' || modelRaw.length === 0) {
        this.logger.warn(
          'Entity Conversation config missing required model; ignoring row',
        );
        return null;
      }
      const result: AgentSessionConfigEntityConversationV1 = {
        type: AgentSessionConfigEntityConversationV1.TypeEnum
          .EntityConversation,
        version: AgentSessionConfigEntityConversationV1.VersionEnum.V1,
        model: modelRaw,
      };
      if (
        typeof record.effort === 'string' &&
        ENTITY_CONVERSATION_EFFORT_VALUES.has(record.effort)
      ) {
        result.effort =
          record.effort as AgentSessionConfigEntityConversationV1.EffortEnum;
      } else if (record.effort !== undefined) {
        this.logger.warn(
          'Entity Conversation config has invalid effort; dropping selection',
          { effort: record.effort },
        );
      }
      const projectAssistant = this.parseStoredProjectAssistantConfig(
        record.projectAssistant,
      );
      if (projectAssistant !== undefined) {
        result.projectAssistant = projectAssistant;
      }
      return result;
    }

    if (
      versionRaw !== AgentSessionConfigV1.VersionEnum.V1 &&
      versionRaw !== AgentSessionConfigV2.VersionEnum.V2
    ) {
      this.logger.warn(
        'Agent session config has unrecognized version; deserializer required',
        { version: versionRaw },
      );
      return null;
    }
    const methodRaw = record.method;
    const methodValid =
      methodRaw === undefined ||
      methodRaw === null ||
      (typeof methodRaw === 'string' && SESSION_METHOD_VALUES.has(methodRaw));
    if (!methodValid) {
      this.logger.warn(
        'Agent session config has unrecognized method; dropping',
        {
          method: methodRaw,
        },
      );
    }
    const method =
      methodValid && typeof methodRaw === 'string'
        ? (methodRaw as SessionMethod)
        : undefined;

    if (versionRaw === AgentSessionConfigV1.VersionEnum.V1) {
      if (
        typeRaw !== undefined &&
        typeRaw !== AgentSessionConfigV1.TypeEnum.CodingSessionV1
      ) {
        this.logger.warn('Agent session config type/version mismatch', {
          type: typeRaw,
          version: versionRaw,
        });
        return null;
      }
      const result: AgentSessionConfigV1 = {
        type: AgentSessionConfigV1.TypeEnum.CodingSessionV1,
        version: AgentSessionConfigV1.VersionEnum.V1,
      };
      if (method !== undefined) {
        result.method = method;
      }
      return result;
    }

    const modelRaw = record.model;
    if (typeof modelRaw !== 'string' || modelRaw.length === 0) {
      this.logger.warn(
        'Agent session V2 config missing required model; ignoring row',
      );
      return null;
    }
    if (
      typeRaw !== undefined &&
      typeRaw !== AgentSessionConfigV2.TypeEnum.CodingSession
    ) {
      this.logger.warn('Agent session config type/version mismatch', {
        type: typeRaw,
        version: versionRaw,
      });
      return null;
    }
    const result: AgentSessionConfigV2 = {
      type: AgentSessionConfigV2.TypeEnum.CodingSession,
      version: AgentSessionConfigV2.VersionEnum.V2,
      model: modelRaw,
    };
    if (method !== undefined) {
      result.method = method;
    }
    if (typeof record.effort === 'string') {
      result.effort = record.effort;
    }
    if (typeof record.fastMode === 'boolean') {
      result.fastMode = record.fastMode;
    } else if (record.fastMode !== undefined) {
      this.logger.warn(
        'Agent session V2 config has invalid fastMode; dropping selection',
        { fastMode: record.fastMode },
      );
    }
    if (typeof record.worktree === 'string' && record.worktree.length > 0) {
      result.worktree = record.worktree;
    }
    const terminalPolicy = this.parseStoredSessionMonitorTerminalPolicy(
      record.sessionMonitorTerminalPolicy,
    );
    if (terminalPolicy !== undefined) {
      result.sessionMonitorTerminalPolicy = terminalPolicy;
    }
    if (
      typeof record.taskMonitorId === 'string' &&
      isUuid(record.taskMonitorId)
    ) {
      result.taskMonitorId = record.taskMonitorId;
    } else if (record.taskMonitorId !== undefined) {
      this.logger.warn(
        'Agent session V2 config has invalid taskMonitorId; dropping ownership',
        { taskMonitorId: record.taskMonitorId },
      );
    }
    const projectAssistant = this.parseStoredProjectAssistantConfig(
      record.projectAssistant,
    );
    if (projectAssistant !== undefined) {
      result.projectAssistant = projectAssistant;
    }
    if (
      record.projectModeSelection !== undefined ||
      record.projectModeSnapshot !== undefined
    ) {
      const selection = validateProjectModeSelection(
        record.projectModeSelection,
      );
      const snapshot = validateProjectModeSnapshot(record.projectModeSnapshot);
      if (
        !selection.success ||
        !snapshot.success ||
        selection.value.modeId !== snapshot.value.modeId ||
        this.buildProjectModeSnapshotHash(snapshot.value) !==
          snapshot.value.snapshotHash
      ) {
        this.logger.warn(
          'Agent session V2 config has an invalid project MODE capture; ignoring row',
        );
        return null;
      }
      result.projectModeSelection = selection.value;
      result.projectModeSnapshot = snapshot.value;
    }
    return result;
  }

  private async captureProjectModeConfig(
    dbClient: Pick<AnyTransactionClient, 'task'>,
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: AgentSessionProjectModeCaptureScope,
    config: AgentSessionConfig | null | undefined,
    userToken: string | null,
  ): Promise<AgentSessionConfig | null | undefined> {
    if (
      config?.type !== AgentSessionConfigV2.TypeEnum.CodingSession ||
      config.projectModeSelection === undefined
    ) {
      return config;
    }

    if (dto.entityType !== EntityType.TASK || !dto.entityId) {
      throw new BadRequestException(
        'config.projectModeSelection requires a TASK-scoped Agent Session',
      );
    }

    const selectedMode = await dbClient.task.findFirst({
      where: { id: config.projectModeSelection.modeId, organizationId },
      select: {
        projectId: true,
        type: true,
        status: true,
        archivedAt: true,
        sections: {
          where: {
            key: {
              in: [
                PROJECT_MODE_DESCRIPTION_SECTION_KEY,
                PROJECT_MODE_FILES_SECTION_KEY,
                PROJECT_MODE_SETTINGS_SECTION_KEY,
              ],
            },
          },
          select: { key: true, materializedMarkdown: true },
        },
      },
    });
    if (!selectedMode) {
      throw new BadRequestException(
        'config.projectModeSelection.modeId must identify an existing MODE',
      );
    }
    if (selectedMode.projectId !== projectId) {
      throw new BadRequestException(
        'config.projectModeSelection.modeId must belong to the Agent Session project',
      );
    }
    if (selectedMode.archivedAt !== null || selectedMode.status !== 'ACTIVE') {
      throw new BadRequestException(
        'config.projectModeSelection.modeId must identify an active MODE',
      );
    }
    if (selectedMode.type !== PROJECT_MODE_TYPE_KEY) {
      throw new BadRequestException(
        'config.projectModeSelection.modeId must identify a MODE work item',
      );
    }

    const effectiveModeDefinition = this.workItemTypeRegistry?.getDefinition(
      projectId,
      PROJECT_MODE_TYPE_KEY,
    );
    if (
      !effectiveModeDefinition ||
      effectiveModeDefinition.status !== WorkItemTypeLifecycleStatus.Active
    ) {
      throw new BadRequestException(
        'The MODE work-item type is not active in the Agent Session project',
      );
    }
    const modeSettings = this.parseProjectModeSettings(
      effectiveModeDefinition.definition.sections,
      selectedMode.sections.find(
        (section: { key: string; materializedMarkdown: string | null }) =>
          section.key === PROJECT_MODE_SETTINGS_SECTION_KEY,
      )?.materializedMarkdown,
    );
    const eligibility = this.projectModeEligibility
      ? await this.projectModeEligibility.assertEligible({
          dbClient,
          organizationId,
          projectId,
          modeId: config.projectModeSelection.modeId,
          modeSettings,
          focalTaskId: dto.entityId,
          userToken,
        })
      : undefined;
    const applicableWorkItemTypeKeys =
      eligibility?.applicableWorkItemTypeKeys ??
      resolveProjectModeEligibleWorkItemTypeKeys(modeSettings).keys;

    if (!eligibility) {
      const focalWorkItem = await dbClient.task.findFirst({
        where: {
          id: dto.entityId,
          organizationId,
          projectId,
          archivedAt: null,
        },
        select: { type: true },
      });
      const focalTypeDefinition = focalWorkItem
        ? this.workItemTypeRegistry?.getDefinition(
            projectId,
            focalWorkItem.type,
          )
        : undefined;
      if (
        !focalWorkItem ||
        !applicableWorkItemTypeKeys.includes(focalWorkItem.type) ||
        !focalTypeDefinition ||
        focalTypeDefinition.status !== WorkItemTypeLifecycleStatus.Active
      ) {
        throw new BadRequestException(
          'The selected project MODE is not eligible for this work-item type',
        );
      }
    }

    const filesDefinition = this.findProjectModeFilesDefinition(
      effectiveModeDefinition.definition.sections,
    );
    const description = selectedMode.sections.find(
      (section: { key: string; materializedMarkdown: string | null }) =>
        section.key === PROJECT_MODE_DESCRIPTION_SECTION_KEY,
    )?.materializedMarkdown;
    const filesContent = selectedMode.sections.find(
      (section: { key: string; materializedMarkdown: string | null }) =>
        section.key === PROJECT_MODE_FILES_SECTION_KEY,
    )?.materializedMarkdown;
    if (typeof description !== 'string') {
      throw new BadRequestException(
        'The selected project MODE is missing its catalog description',
      );
    }
    if (typeof filesContent !== 'string') {
      throw new BadRequestException(
        'The selected project MODE is missing its files section',
      );
    }
    const canonicalFiles = this.taskSectionSchemaValidators.canonicalize(
      filesDefinition,
      filesContent,
    );
    const files = JSON.parse(canonicalFiles) as ProjectModeFiles;
    const projectAssistantEnabled =
      modeSettings?.projectAssistant.enabled ??
      DEFAULT_PROJECT_MODE_PROJECT_ASSISTANT_ENABLED;
    const selection: ProjectModeSelection = {
      schemaVersion:
        ProjectModeSelection.SchemaVersionEnum.ProjectModeSelectionV1,
      modeId: config.projectModeSelection.modeId,
    };
    const snapshotWithoutHash: Omit<ProjectModeSnapshot, 'snapshotHash'> = {
      schemaVersion:
        ProjectModeSnapshot.SchemaVersionEnum.ProjectModeSnapshotV3,
      modeId: selection.modeId,
      catalogDescription: description,
      applicableWorkItemTypeKeys,
      files,
      projectAssistant: { enabled: projectAssistantEnabled },
      sessionRole: resolveProjectModeSessionRole(modeSettings),
    };
    const snapshot: ProjectModeSnapshot = {
      ...snapshotWithoutHash,
      snapshotHash: this.buildProjectModeSnapshotHash(snapshotWithoutHash),
    };
    this.logger.log('Captured project MODE snapshot', {
      modeId: snapshot.modeId,
      schemaVersion: snapshot.schemaVersion,
      projectAssistantEnabled,
      sessionRole: snapshot.sessionRole,
      snapshotHash: snapshot.snapshotHash,
    });
    return {
      ...config,
      projectModeSelection: selection,
      projectModeSnapshot: snapshot,
    };
  }

  private findProjectModeFilesDefinition(
    sectionDefinitions: unknown,
  ): WorkItemTypeSectionDefinition {
    if (!Array.isArray(sectionDefinitions)) {
      throw new BadRequestException(
        'The MODE work-item type has malformed section definitions',
      );
    }
    const definition = sectionDefinitions.find(
      (candidate): candidate is WorkItemTypeSectionDefinition =>
        typeof candidate === 'object' &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        (candidate as Record<string, unknown>).key ===
          PROJECT_MODE_FILES_SECTION_KEY &&
        (candidate as Record<string, unknown>).kind === 'json' &&
        (candidate as Record<string, unknown>).schemaRef ===
          PROJECT_MODE_FILES_SCHEMA_REF,
    );
    if (!definition) {
      throw new BadRequestException(
        'The MODE work-item type does not declare the canonical files schema',
      );
    }
    return definition;
  }

  private parseProjectModeSettings(
    sectionDefinitions: unknown,
    settingsContent: string | null | undefined,
  ): ProjectModeSettings | null {
    if (typeof settingsContent !== 'string' || settingsContent === '') {
      this.logger.debug(
        'Project MODE has no settings section; Project Assistant defaults on and STANDARD-only eligibility applies',
      );
      return null;
    }
    const definition = Array.isArray(sectionDefinitions)
      ? sectionDefinitions.find(
          (candidate): candidate is WorkItemTypeSectionDefinition =>
            typeof candidate === 'object' &&
            candidate !== null &&
            (candidate as Record<string, unknown>).key ===
              PROJECT_MODE_SETTINGS_SECTION_KEY &&
            (candidate as Record<string, unknown>).schemaRef ===
              PROJECT_MODE_SETTINGS_SCHEMA_REF,
        )
      : undefined;
    if (!definition) {
      this.logger.warn(
        'Project MODE has settings content but its type does not declare the canonical settings schema',
      );
      throw new BadRequestException(
        'The MODE work-item type does not declare the canonical settings schema',
      );
    }
    return JSON.parse(
      this.taskSectionSchemaValidators.canonicalize(
        definition,
        settingsContent,
      ),
    ) as ProjectModeSettings;
  }

  // v1/v2 hash inputs must stay byte-identical for readback and resume.
  // Only v3 binds the resolved role into snapshot integrity.
  private buildProjectModeSnapshotHash(
    snapshot: Omit<ProjectModeSnapshot, 'snapshotHash'> | ProjectModeSnapshot,
  ): string {
    const content: Record<string, unknown> = {
      schemaVersion: snapshot.schemaVersion,
      modeId: snapshot.modeId,
      catalogDescription: snapshot.catalogDescription,
      applicableWorkItemTypeKeys: snapshot.applicableWorkItemTypeKeys,
      files: snapshot.files,
    };
    if (
      snapshot.schemaVersion ===
        ProjectModeSnapshot.SchemaVersionEnum.ProjectModeSnapshotV2 ||
      snapshot.schemaVersion ===
        ProjectModeSnapshot.SchemaVersionEnum.ProjectModeSnapshotV3
    ) {
      content.projectAssistant = {
        enabled: snapshot.projectAssistant?.enabled,
      };
    }
    if (
      snapshot.schemaVersion ===
      ProjectModeSnapshot.SchemaVersionEnum.ProjectModeSnapshotV3
    ) {
      content.sessionRole = snapshot.sessionRole;
    }
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
  }

  private parseStoredProjectAssistantConfig(
    value: unknown,
  ): ProjectAssistantConfig | undefined {
    if (value === undefined) {
      return undefined;
    }
    try {
      this.assertValidProjectAssistantConfig(value);
    } catch (error) {
      this.logger.warn(
        'Agent session config has invalid projectAssistant settings; dropping',
        { reason: error instanceof Error ? error.message : String(error) },
      );
      return undefined;
    }
    if (value === undefined) {
      return undefined;
    }
    const result: ProjectAssistantConfig = {};
    if (value.enabled !== undefined) {
      result.enabled = value.enabled;
    }
    if (value.allowEdgeUpdates !== undefined) {
      result.allowEdgeUpdates = value.allowEdgeUpdates;
    }
    if (value.notifyDiscrepancies !== undefined) {
      result.notifyDiscrepancies = value.notifyDiscrepancies;
    }
    if (value.allowUpdateProposals !== undefined) {
      result.allowUpdateProposals = value.allowUpdateProposals;
    }
    return result;
  }

  private parseStoredSessionMonitorTerminalPolicy(
    value: unknown,
  ): SessionMonitorTerminalPolicy | undefined {
    if (value === undefined) {
      return undefined;
    }

    try {
      const normalized =
        this.normalizeStoredSessionMonitorTerminalPolicy(value);
      this.assertValidSessionMonitorTerminalPolicy(normalized);
      return normalized;
    } catch (error) {
      this.logger.warn(
        'Agent session V2 config has invalid sessionMonitorTerminalPolicy; dropping',
        { reason: error instanceof Error ? error.message : String(error) },
      );
      return undefined;
    }
  }

  private normalizeStoredSessionMonitorTerminalPolicy(value: unknown): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return value;
    }
    const record = value as Record<string, unknown>;
    if (record.type === undefined) {
      return value;
    }
    if (record.type !== LEGACY_SESSION_MONITOR_TERMINAL_POLICY_TYPE) {
      throw new BadRequestException(
        'stored sessionMonitorTerminalPolicy has unrecognized legacy type',
      );
    }
    const { type: _legacyType, ...policy } = record;
    return policy;
  }

  private async assertTaskMonitorConfigOwnership(
    dbClient: Pick<AnyTransactionClient, 'task'>,
    organizationId: OrganizationId,
    projectId: ProjectId,
    config: AgentSessionConfig | null | undefined,
  ): Promise<void> {
    const taskMonitorId =
      config?.type === AgentSessionConfigV2.TypeEnum.CodingSession
        ? config.taskMonitorId
        : undefined;
    if (taskMonitorId === undefined) {
      this.logger.debug(
        'Agent Session create has no Task Monitor ownership context',
        { organizationId, projectId },
      );
      return;
    }

    this.logger.debug('Validating Agent Session Task Monitor ownership', {
      organizationId,
      projectId,
      taskMonitorId,
    });
    const monitor = await dbClient.task.findFirst({
      where: {
        id: taskMonitorId,
        organizationId,
        projectId,
        archivedAt: null,
      },
      select: { type: true },
    });
    if (!monitor) {
      this.logger.warn(
        'Agent Session create rejected missing or out-of-scope Task Monitor',
        { organizationId, projectId, taskMonitorId },
      );
      throw new BadRequestException(
        'config.taskMonitorId must identify an active work item in the project',
      );
    }
    if (monitor.type !== 'TASK_MONITOR') {
      this.logger.warn(
        'Agent Session create rejected non-Task-Monitor ownership',
        {
          organizationId,
          projectId,
          taskMonitorId,
          actualWorkItemType: monitor.type,
        },
      );
      throw new BadRequestException(
        'config.taskMonitorId must identify a TASK_MONITOR work item',
      );
    }
    this.logger.debug('Validated Agent Session Task Monitor ownership', {
      organizationId,
      projectId,
      taskMonitorId,
    });
  }

  private assertTaskMonitorConfigOwnershipImmutable(
    storedConfig: Prisma.JsonValue | null,
    requestedConfig: AgentSessionConfig | null | undefined,
  ): void {
    if (requestedConfig === undefined) {
      return;
    }
    const existing = this.parseStoredConfig(storedConfig);
    const existingTaskMonitorId =
      existing?.type === AgentSessionConfigV2.TypeEnum.CodingSession
        ? existing.taskMonitorId
        : undefined;
    const requestedTaskMonitorId =
      requestedConfig?.type === AgentSessionConfigV2.TypeEnum.CodingSession
        ? requestedConfig.taskMonitorId
        : undefined;
    if (existingTaskMonitorId === requestedTaskMonitorId) {
      return;
    }
    this.logger.warn('Agent Session config update rejected ownership change', {
      existingTaskMonitorId,
      requestedTaskMonitorId,
    });
    throw new BadRequestException(
      'config.taskMonitorId is immutable after Agent Session creation',
    );
  }

  private assertValidProvider(provider: unknown): void {
    if (provider === undefined || provider === null) {
      return;
    }

    if (!AGENT_SESSION_PROVIDERS.includes(provider as AgentSessionProvider)) {
      throw new BadRequestException(
        `provider must be one of: ${AGENT_SESSION_PROVIDERS.join(', ')}`,
      );
    }
  }

  private assertValidMonitoringEnabled(value: unknown): void {
    if (value === undefined) {
      return;
    }

    if (typeof value !== 'boolean') {
      throw new BadRequestException('monitoringEnabled must be a boolean');
    }
  }

  private assertValidAutoDecide(value: unknown): void {
    if (value === undefined) {
      return;
    }

    if (typeof value !== 'boolean') {
      throw new BadRequestException('autoDecide must be a boolean');
    }
  }

  private assertValidStatus(status: unknown): void {
    if (status === undefined || status === null) {
      return;
    }

    if (!AGENT_SESSION_STATUSES.includes(status as AgentSessionStatusValue)) {
      throw new BadRequestException(
        `status must be one of: ${AGENT_SESSION_STATUSES.join(', ')}`,
      );
    }
  }

  private async assertProjectOwnership(
    organizationId: OrganizationId,
    projectId: ProjectId,
    dbClient: Pick<AnyTransactionClient, 'project'> = this.prisma.db,
  ): Promise<void> {
    const project = await dbClient.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });

    if (!project) {
      throw new BadRequestException(
        'projectId must belong to the organization',
      );
    }
  }

  private async assertCreateEntityProjectConsistency(
    dbClient: Pick<
      AnyTransactionClient,
      | 'task'
      | 'initiative'
      | 'designDoc'
      | 'project'
      | 'service'
      | 'proposal'
      | 'agentSession'
    >,
    organizationId: OrganizationId,
    dto: CreateAgentSessionDto,
  ): Promise<void> {
    const expectedProjectId = dto.projectId;
    const entityType = dto.entityType;

    if (entityType && dto.entityId) {
      switch (entityType) {
        case 'PROJECT': {
          const project = await dbClient.project.findFirst({
            where: { id: dto.entityId, organizationId },
            select: { id: true },
          });
          if (!project) {
            throw new BadRequestException(
              'entityId must belong to the organization',
            );
          }
          if (project.id !== expectedProjectId) {
            throw new BadRequestException(
              'entityId (PROJECT) must belong to the projectId',
            );
          }
          break;
        }
        case 'TASK': {
          const task = await dbClient.task.findFirst({
            where: { id: dto.entityId, organizationId },
            select: { projectId: true },
          });
          if (!task) {
            throw new BadRequestException(
              'entityId must belong to the organization',
            );
          }
          if (task.projectId !== expectedProjectId) {
            throw new BadRequestException(
              'entityId (TASK) must belong to the projectId',
            );
          }
          break;
        }
        case 'INITIATIVE': {
          const initiative = await dbClient.initiative.findFirst({
            where: { id: dto.entityId, organizationId },
            select: { originatingProjectId: true },
          });
          if (!initiative) {
            throw new BadRequestException(
              'entityId must belong to the organization',
            );
          }
          if (initiative.originatingProjectId !== expectedProjectId) {
            throw new BadRequestException(
              'entityId (INITIATIVE) must belong to the projectId',
            );
          }
          break;
        }
        case 'DESIGN_DOC': {
          const designDoc = await dbClient.designDoc.findFirst({
            where: { id: dto.entityId, organizationId },
            select: { projectId: true },
          });
          if (!designDoc) {
            throw new BadRequestException(
              'entityId must belong to the organization',
            );
          }
          if (
            !designDoc.projectId ||
            designDoc.projectId !== expectedProjectId
          ) {
            throw new BadRequestException(
              'entityId (DESIGN_DOC) must belong to the projectId',
            );
          }
          break;
        }
        case 'SERVICE': {
          const service = await dbClient.service.findFirst({
            where: { id: dto.entityId, organizationId },
            select: { projectId: true },
          });
          if (!service) {
            throw new BadRequestException(
              'entityId must belong to the organization',
            );
          }
          if (!service.projectId || service.projectId !== expectedProjectId) {
            throw new BadRequestException(
              'entityId (SERVICE) must belong to the projectId',
            );
          }
          break;
        }
        case 'PROPOSAL': {
          const proposal = await dbClient.proposal.findFirst({
            where: { id: dto.entityId, organizationId },
            select: { projectId: true },
          });
          if (!proposal) {
            throw new BadRequestException(
              'entityId must belong to the organization',
            );
          }
          if (proposal.projectId !== expectedProjectId) {
            throw new BadRequestException(
              'entityId (PROPOSAL) must belong to the projectId',
            );
          }
          break;
        }
        case 'AGENT_SESSION': {
          const agentSession = await dbClient.agentSession.findFirst({
            where: { id: dto.entityId, organizationId },
            select: { projectId: true },
          });
          if (!agentSession) {
            throw new BadRequestException(
              'entityId must belong to the organization',
            );
          }
          if (agentSession.projectId !== expectedProjectId) {
            throw new BadRequestException(
              'entityId (AGENT_SESSION) must belong to the projectId',
            );
          }
          break;
        }
        default:
          throw new BadRequestException(
            `Unsupported entityType for agent session about-target: ${dto.entityType}`,
          );
      }
    }

    if (dto.launchServiceId) {
      const service = await dbClient.service.findFirst({
        where: {
          id: dto.launchServiceId,
          organizationId,
        },
        select: { projectId: true },
      });

      if (!service) {
        throw new BadRequestException(
          'launchServiceId must belong to the organization',
        );
      }

      if (!service.projectId || service.projectId !== expectedProjectId) {
        throw new BadRequestException(
          'launchServiceId must belong to the projectId',
        );
      }
    }
  }

  private async assertSelectedServicesProjectConsistency(
    dbClient: Pick<AnyTransactionClient, 'service'>,
    organizationId: OrganizationId,
    projectId: ProjectId,
    serviceIds: string[],
  ): Promise<void> {
    if (serviceIds.length === 0) {
      return;
    }

    const services: Array<{ id: string; projectId: string | null }> =
      await dbClient.service.findMany({
        where: {
          id: { in: serviceIds },
          organizationId,
        },
        select: { id: true, projectId: true },
      });

    const foundServiceIds = new Set(services.map((service) => service.id));
    const missingServiceIds = serviceIds.filter(
      (serviceId) => !foundServiceIds.has(serviceId),
    );
    if (missingServiceIds.length > 0) {
      throw new BadRequestException(
        `serviceIds must belong to the organization: ${missingServiceIds.join(
          ', ',
        )}`,
      );
    }

    const wrongProjectServiceIds = services
      .filter((service) => service.projectId !== projectId)
      .map((service) => service.id);
    if (wrongProjectServiceIds.length > 0) {
      throw new BadRequestException(
        `serviceIds must belong to the projectId: ${wrongProjectServiceIds.join(
          ', ',
        )}`,
      );
    }
  }

  private async replaceSelectedServiceLinks(
    dbClient: Pick<AnyTransactionClient, 'serviceAgentSession'>,
    agentSessionId: string,
    serviceIds: string[],
  ): Promise<string[]> {
    await dbClient.serviceAgentSession.deleteMany({
      where: { agentSessionId },
    });

    if (serviceIds.length === 0) {
      return [];
    }

    await dbClient.serviceAgentSession.createMany({
      data: serviceIds.map((serviceId) => ({
        serviceId,
        agentSessionId,
      })),
    });

    return serviceIds;
  }

  private normalizeSelectedServiceIds(
    serviceIds: string[] | undefined,
  ): string[] {
    if (serviceIds === undefined) {
      return [];
    }

    return Array.from(new Set(serviceIds));
  }

  private withSelectedServiceRelations<T extends AgentSessionWithDates>(
    session: T,
    serviceIds: string[],
  ): T & { serviceRelations: AgentSessionServiceRelationSelection[] } {
    return {
      ...session,
      serviceRelations: serviceIds.map((serviceId) => ({ serviceId })),
    };
  }

  private buildSelectedServiceRelationsInclude() {
    return {
      serviceRelations: {
        select: { serviceId: true },
        orderBy: { createdAt: 'asc' as const },
      },
    };
  }

  private extractSelectedServiceIds(
    session: AgentSessionWithSelectedServices,
  ): string[] {
    if (!session.serviceRelations) {
      if (session.serviceId) {
        throw new BadRequestException(
          'Agent session service relations must be loaded before DTO mapping',
        );
      }

      return [];
    }

    const serviceIds = session.serviceRelations.map(
      (relation) => relation.serviceId,
    );
    if (session.serviceId && serviceIds.length === 0) {
      throw new BadRequestException(
        'Agent session has launch service but no selected service links',
      );
    }

    return serviceIds;
  }

  private getSelectedServiceIdsFromLoadedRelations(
    session: AgentSessionWithSelectedServices,
  ): string[] {
    if (!session.serviceRelations) {
      return session.serviceId ? [session.serviceId] : [];
    }

    return session.serviceRelations.map((relation) => relation.serviceId);
  }

  private assertLaunchServiceHasSelectedLink(
    launchServiceId: string | null | undefined,
    serviceIds: string[],
  ): void {
    if (!launchServiceId) {
      return;
    }

    if (!serviceIds.includes(launchServiceId)) {
      throw new BadRequestException(
        'launchServiceId must have a selected service link',
      );
    }
  }

  private assertValidExistingWorkflowBindingRequest(
    dto: CreateAgentSessionDto,
    validatedConfig: AgentSessionConfig | null | undefined,
    effectiveUserId: UserId,
    currentUserId: UserId,
  ): void {
    if (!dto.existingWorkflowBinding) {
      return;
    }
    if (effectiveUserId !== currentUserId) {
      throw new ForbiddenException(
        'An existing workflow can only be bound to the caller Agent Session',
      );
    }
    if (
      dto.type !== AgentSessionType.Coding ||
      !dto.provider ||
      validatedConfig?.type !== AgentSessionConfigV2.TypeEnum.CodingSession
    ) {
      throw new BadRequestException(
        'Existing import workflow binding requires a CODING Agent Session with provider and complete v2 runtime config',
      );
    }
  }

  private async lockAndValidateExistingWorkflowBinding(params: {
    tx: AnyTransactionClient;
    organizationId: OrganizationId;
    projectId: ProjectId;
    currentUserId: UserId;
    binding: NonNullable<CreateAgentSessionDto['existingWorkflowBinding']>;
    launchServiceId?: string | null;
  }): Promise<void> {
    const { tx, organizationId, projectId, currentUserId, binding } = params;
    const lockIdentity = [
      'agent-session-existing-workflow',
      organizationId,
      projectId,
      binding.conversationId,
      binding.workflowId,
    ].join(':');
    this.logger.debug('Locking existing workflow Agent Session binding', {
      organizationId,
      projectId,
      conversationId: binding.conversationId,
      workflowId: binding.workflowId,
    });
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))::text`,
    );
    const conversationQuery = {
      where: {
        id: binding.conversationId,
        organizationId,
        projectId,
        workflowId: binding.workflowId,
        workflowName: {
          in: [
            WorkflowName.RepositoryImport,
            WorkflowName.WorkTrackerImport,
            WorkflowName.Onboarding,
          ],
        },
        flowExecutions: {
          some: {
            conversationId: binding.conversationId,
            organizationId,
            projectId,
            userId: currentUserId,
            flowId: {
              in: [
                WorkflowName.RepositoryImport,
                WorkflowName.WorkTrackerImport,
                WorkflowName.Onboarding,
              ],
            },
          },
        },
      },
      select: {
        id: true,
        workflowName: true,
        flowExecutions: {
          where: {
            conversationId: binding.conversationId,
            organizationId,
            projectId,
            userId: currentUserId,
            flowId: {
              in: [
                WorkflowName.RepositoryImport,
                WorkflowName.WorkTrackerImport,
                WorkflowName.Onboarding,
              ],
            },
          },
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { flowId: true, currentNode: true, flowState: true },
        },
      },
    } satisfies Prisma.ConversationFindFirstArgs;
    const conversation = await tx.conversation.findFirst(conversationQuery);
    const execution = conversation?.flowExecutions[0];
    const isDedicatedImport =
      (conversation?.workflowName === WorkflowName.RepositoryImport &&
        execution?.flowId === WorkflowName.RepositoryImport) ||
      (conversation?.workflowName === WorkflowName.WorkTrackerImport &&
        execution?.flowId === WorkflowName.WorkTrackerImport);
    const isLegacyImport =
      !!conversation &&
      !!execution &&
      isQualifyingLegacyRepositoryImportExecution({
        conversationWorkflowName: conversation.workflowName,
        executionFlowId: execution.flowId,
        currentNode: execution.currentNode,
        flowState: execution.flowState,
      });
    if (!conversation || (!isDedicatedImport && !isLegacyImport)) {
      this.logger.warn('Existing workflow Agent Session binding rejected', {
        organizationId,
        projectId,
        conversationId: binding.conversationId,
        workflowId: binding.workflowId,
        currentUserId,
      });
      throw new ForbiddenException(
        'The repository import workflow is not owned by the caller in this project',
      );
    }
    // Work-tracker imports run on the paired CLI without a repository workspace.
    if (
      conversation.workflowName !== WorkflowName.WorkTrackerImport &&
      !params.launchServiceId
    ) {
      throw new BadRequestException(
        'Existing repository import workflow binding requires a launch Service',
      );
    }
  }

  private assertExistingWorkflowSessionMatches(params: {
    existingSession: AgentSessionWithSelectedServices;
    dto: CreateAgentSessionDto;
    selectedServiceIds: string[];
    validatedConfig: AgentSessionConfig | null | undefined;
    effectiveUserId: UserId;
  }): void {
    const {
      existingSession,
      dto,
      selectedServiceIds,
      validatedConfig,
      effectiveUserId,
    } = params;
    const existingServiceIds =
      this.getSelectedServiceIdsFromLoadedRelations(existingSession).toSorted();
    const requestedServiceIds = selectedServiceIds.toSorted();
    const storedConfig = this.parseStoredConfig(existingSession.config);
    const matches =
      existingSession.userId === effectiveUserId &&
      existingSession.type === dto.type &&
      existingSession.serviceId === (dto.launchServiceId ?? null) &&
      existingSession.provider === (dto.provider ?? null) &&
      isDeepStrictEqual(existingServiceIds, requestedServiceIds) &&
      isDeepStrictEqual(storedConfig, validatedConfig ?? null);
    if (!matches) {
      this.logger.warn(
        'Existing workflow already has an Agent Session with different launch context',
        {
          existingAgentSessionId: existingSession.id,
          conversationId: existingSession.conversationId,
        },
      );
      throw new ConflictException(
        'The repository import workflow is already bound to a different Agent Session launch context',
      );
    }
  }

  private assertConversationIdNotProvided(dto: unknown): void {
    const input = dto as { conversationId?: unknown };
    if (input.conversationId !== undefined) {
      throw new BadRequestException(
        'conversationId is managed by the system and cannot be provided',
      );
    }
  }

  private assertServiceBindingInvariant(
    existing: Pick<AgentSession, 'serviceId'>,
    launchServiceId: string | undefined,
  ): void {
    if (launchServiceId === undefined || existing.serviceId === null) {
      return;
    }

    if (launchServiceId !== existing.serviceId) {
      throw new ConflictException(
        'launchServiceId is immutable once set for an agent session',
      );
    }
  }

  private assertLaunchServiceMembership(
    serviceIds: string[] | undefined,
    launchServiceId: string | undefined,
  ): void {
    if (!serviceIds || serviceIds.length === 0) {
      return;
    }

    if (!launchServiceId) {
      throw new BadRequestException(
        'launchServiceId is required when serviceIds is non-empty',
      );
    }

    if (!serviceIds.includes(launchServiceId)) {
      throw new BadRequestException(
        'launchServiceId must be a member of serviceIds',
      );
    }
  }

  private assertProviderBindingInvariant(
    existing: Pick<AgentSession, 'provider'>,
    provider: AgentSessionProvider | undefined,
  ): void {
    if (provider === undefined || existing.provider === null) {
      return;
    }

    if (provider !== existing.provider) {
      throw new ConflictException(
        'provider is immutable once set for an agent session',
      );
    }
  }

  private isAgentSessionIdConflict(error: unknown): boolean {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.includes('provider_agent_session_id')
    ) {
      return true;
    }

    return false;
  }

  private toProvider(
    value: string | null,
  ): AgentSessionDto.ProviderEnum | undefined {
    if (value === null) {
      return undefined;
    }

    if (AGENT_SESSION_PROVIDERS.includes(value as AgentSessionProvider)) {
      return value as AgentSessionDto.ProviderEnum;
    }

    throw new BadRequestException(
      `Invalid provider value stored for agent session: ${value}`,
    );
  }

  private toStatus(value: PrismaAgentSessionStatus): AgentSessionStatus {
    if (AGENT_SESSION_STATUSES.includes(value as AgentSessionStatusValue)) {
      return value as AgentSessionStatus;
    }

    throw new BadRequestException(
      `Invalid status value stored for agent session: ${value}`,
    );
  }
}
