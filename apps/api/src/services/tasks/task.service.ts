import { withApiSpan } from 'src/telemetry/api-tracing';
import type { ProjectModeSettings } from '../../generated';
import {
  findIneligibleProjectModeTypeKeys,
  PROJECT_MODE_SETTINGS_SCHEMA_REF,
} from './project-mode-settings.validator';
import {
  withDiagramDefaults,
  validateDiagramSections,
} from './diagram-metadata';
import {
  diagramGroupMemberKey,
  formatDiagramGroupsIssues,
  parseDiagramGroupsContent,
  reconcileDiagramGroups,
  validateDiagramGroups,
} from './diagram-groups';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AgentSessionType,
  Priority,
  Prisma,
  TaskDependencyRelationType,
  TaskDependencySourceType,
  TaskSource,
  WorkItemTypeCascadeExecutionState,
  WorkStatus,
} from '@prisma/client';
import {
  ArtifactType,
  ConversationResponseDto,
  CreateTaskDependencyDto,
  CreateTaskDto,
  Influence,
  TaskContentChangedEventPayload,
  TaskCreatedEventPayload,
  TaskDependencyResponseDto,
  TaskEventUpdateSnapshot,
  TaskHierarchyResponseDto,
  TaskOriginalArtifactData,
  TaskPriority,
  TaskResponseDto,
  ServiceTaskRelation,
  TaskSectionKey,
  TaskSectionUpdateSource,
  TaskStatusChangedEventPayload,
  TaskUpdatedEventPayload,
  GoalTrackedWorkSummary,
  TrackedEntitySnapshot,
  UpdateTaskDependencyDto,
  UpdateTaskDto,
  PaginatedWorkItemReferenceResponseDto,
  WorkItemGraphAggregateResponseDto,
  WorkItemGraphDerivedReference,
  WorkItemGraphLayoutValue,
  WorkItemGraphParticipationType,
  WorkItemSectionInput,
} from 'src/generated';
import { AgentEdgeType as ApiAgentEdgeType } from 'src/generated/model/agentEdgeType';
import type { AgentEdgeResponseDto } from 'src/generated/model/agentEdgeResponseDto';
import type { WorkItemTypeSectionDefinition } from 'src/generated';
import type {
  AgentEdge,
  AgentEdgeEndpointEntityType,
  SearchRequest,
  StructuredGraphReadResponse,
} from 'src/generated/graphs';
import { AgentEdgeType } from 'src/generated/graphs/model/agentEdgeType';
import { RelationshipType } from 'src/generated/graphs/model/relationshipType';
import { AgentEdgeClientService } from 'src/services/agent-edge-client.service';
import { GraphsClientService } from 'src/services/graphs-client.service';
import {
  AGENT_EDGE_LABELS,
  graphRelationshipToAgentEdge,
} from 'src/services/graphs/agent-edge-mapping';
import { TaskArchivedEventPayload } from 'src/generated/model/taskArchivedEventPayload';
import { hasProposalSupport } from 'src/mcp/tools/proposal-tool-names';
import { TaskAssignedEventPayload } from 'src/generated/model/taskAssignedEventPayload';
import { TaskUnassignedEventPayload } from 'src/generated/model/taskUnassignedEventPayload';
import { EntityType } from 'src/generated/model/entityType';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from 'src/types';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import {
  EventContextManager,
  WithEventContext,
} from '../../core/events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import {
  TaskArchivedEvent,
  TaskAssignedEvent,
  TaskContentChangedEvent,
  TaskCreatedEvent,
  TaskStatusChangedEvent,
  TaskUnassignedEvent,
  TaskUpdatedEvent,
} from '../../core/events/types/domain-events';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import {
  MaterializedWorkItemSection,
  WorkItemSectionKey,
  WorkItemSectionRecord,
} from '../../types/work-item-section.types';
import {
  buildTaskEventContentSnapshot,
  buildTaskEventContentSnapshotFromSections,
  buildTaskEventUpdateSnapshot,
  extractTaskSectionContent,
  TaskEventContentSnapshot,
  toTaskSnapshot,
} from '../../utils/task-event.util';
import {
  TaskArtifactService,
  TaskOriginalData,
  toTaskOriginalArtifactTaskType,
} from './task-artifact.service';
import { TaskDraft } from './types';
import { FeatureRequirementAuthoringService } from './feature-requirement-authoring.service';
import { EMPTY_FEATURE_REQUIREMENTS_CONTENT } from './feature-requirements-reader';
import { WorkItemTypeRegistryService } from './work-item-type-registry.service';
import { formatWorkItemStatusNotAllowedMessage } from './work-item-status-policy';
import { WorkItemParentageValidator } from './work-item-parentage-validator.service';
import {
  resolveWorkItemSectionContentKind,
  TaskSectionSchemaValidatorRegistry,
} from './task-section-schema-validator.registry';
import { PlanHierarchyRollupService } from './plan-hierarchy-rollup.service';
import { validateWorkItemGraphLayoutContent } from './work-item-graph-layout.validator';
import {
  WORK_ITEM_GRAPH_PARTICIPATION_LIMITS,
  WorkItemGraphParticipationComposer,
} from './work-item-graph-participation';
import {
  readWorkItemConfig,
  validateWorkItemConfigForType,
} from './work-item-config';

export type TaskEntity = Prisma.TaskGetPayload<Prisma.TaskDefaultArgs>;

export type TaskUpdatePostCommit = {
  statusChange?: { previousStatus: WorkStatus; newStatus: WorkStatus };
  updateOriginalArtifact?: boolean;
};

type TaskWithCounts = TaskEntity & {
  _count?: Record<string, number | undefined>;
};

type AgentSessionCounts = {
  codingSessionCount: number;
  agentSessionCount: number;
};

type TaskServiceRelationEntity = Prisma.ServiceTaskGetPayload<{
  select: {
    id: true;
    serviceId: true;
    taskId: true;
    relationType: true;
    createdAt: true;
  };
}>;

type TaskWithCountsAndRelations = TaskWithCounts & {
  serviceRelations?: TaskServiceRelationEntity[];
};

type TaskDependencyEntity =
  Prisma.TaskDependencyGetPayload<Prisma.TaskDependencyDefaultArgs>;

type TaskInitiativeInfo = {
  originatingProjectId: ProjectId | null;
};

type TaskResponseWithInitiative = TaskResponseDto & {
  initiative?: TaskInitiativeInfo | null;
};

type TaskUpdateInput = Partial<Omit<TaskResponseDto, 'sections'>> & {
  sections?: WorkItemSectionInput[];
  sectionUpdateSource?: TaskSectionUpdateSource;
};

type TaskWithCountsAndInitiative = TaskWithCountsAndRelations & {
  initiative?: { originatingProjectId: string | null } | null;
};

type TrackedTaskRow = {
  id: string;
  name: string;
  status: WorkStatus;
  dueDate: Date | null;
};

/**
 * Independent GOAL projections built from one shared tracked-target load.
 * Snapshots default on for compatibility; the compact summary is opt-in.
 */
type TrackedGoalProjections = {
  includeTrackedEntities: boolean;
  includeTrackedWorkSummary: boolean;
};

const DEFAULT_TRACKED_GOAL_PROJECTIONS: TrackedGoalProjections = {
  includeTrackedEntities: true,
  includeTrackedWorkSummary: false,
};

type ChildCounts = {
  total: number;
  done: number;
  inProgress: number;
  backlog: number;
};

const BACKLOG_STATUSES = new Set<WorkStatus>([
  WorkStatus.GENERATED,
  WorkStatus.BACKLOG,
  WorkStatus.GENERATING_DESCRIPTION,
  WorkStatus.REFINING_DESCRIPTION,
  WorkStatus.REFINING_DETAILS,
  WorkStatus.REFINING_ACCEPTANCE_CRITERIA,
  WorkStatus.GENERATING_DETAILS,
  WorkStatus.GENERATING_DESCRIPTION_AND_DETAILS,
  WorkStatus.GENERATING_ACCEPTANCE_CRITERIA,
  WorkStatus.GENERATING_ALL,
  WorkStatus.ON_HOLD,
]);

const IN_PROGRESS_STATUSES = new Set<WorkStatus>([WorkStatus.ACTIVE]);

const DONE_STATUSES = new Set<WorkStatus>([
  WorkStatus.COMPLETED,
  WorkStatus.CANCELLED,
]);

const INCIDENT_AGENT_EDGE_TYPES = new Set<string>(Object.values(AgentEdgeType));
const TRAVERSAL_ONLY_INCIDENT_EDGE_TYPES = new Set<RelationshipType>([
  RelationshipType.ProposedTogether,
]);

const toIncidentAgentEdgeType = (
  relationshipType: RelationshipType,
): AgentEdgeType => {
  if (!INCIDENT_AGENT_EDGE_TYPES.has(relationshipType)) {
    throw new BadRequestException(
      `Unsupported work-item incident edge type: ${relationshipType}`,
    );
  }
  return relationshipType as AgentEdgeType;
};

const TASK_SECTION_FIELDS = Object.values(TaskSectionKey);

/**
 * Sentinel `includeSectionKeys` value meaning "every section THIS task's type
 * declares" — resolved per task at load time against the work-item type
 * registry, rather than a fixed built-in key list. This is the default for
 * single-item and full reads; it is what lets custom, per-project section keys
 * round-trip on read (a hardcoded built-in key set would drop them at the DB
 * boundary). Compared by reference in {@link TaskService.resolveTaskSectionsMap};
 * its contents are never used as DB keys.
 */
export const ALL_DECLARED_SECTIONS: string[] = ['__all_declared_sections__'];

export type TaskSectionField = string;

type TaskSectionRecord = WorkItemSectionRecord & { taskId: string };

type TaskSectionCreatePayload = {
  key: TaskSectionField;
  order: number;
  materializedMarkdown: string | null;
};

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);
  private readonly taskSectionSchemaValidators: TaskSectionSchemaValidatorRegistry;

  constructor(
    private prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
    private taskArtifactService: TaskArtifactService,
    private readonly planHierarchyRollupService: PlanHierarchyRollupService,
    private readonly graphsClient: GraphsClientService,
    private readonly agentEdgeClient: AgentEdgeClientService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    private readonly workItemParentageValidator: WorkItemParentageValidator,
    private readonly participationComposer: WorkItemGraphParticipationComposer,
    @Optional() _redisService?: unknown,
    @Optional()
    private readonly featureRequirementAuthoringService?: FeatureRequirementAuthoringService,
  ) {
    this.taskSectionSchemaValidators = new TaskSectionSchemaValidatorRegistry();
    console.log('🔥 TASK SERVICE DEBUG: Constructor called', {
      prismaExists: !!prisma,
      eventPublisherExists: !!eventPublisher,
      taskArtifactServiceExists: !!taskArtifactService,
      timestamp: new Date().toISOString(),
      instanceId: Math.random().toString(36).substr(2, 9),
    });
  }

  private createEmptyChildCounts(): ChildCounts {
    return {
      total: 0,
      done: 0,
      inProgress: 0,
      backlog: 0,
    };
  }

  private resolveTaskType(type?: string | null): WorkItemTypeKey {
    // Default an omitted/null/empty type to STANDARD; otherwise return the
    // provided key verbatim. The four built-in keys pass through unchanged, and
    // a project-scoped custom key is preserved rather than collapsed to
    // STANDARD. The parameter is widened to `string` because `CreateTaskDto.type`
    // admits project-defined custom keys, not just the built-in union; the
    // value is still WorkItemTypeKey-shaped at runtime. The safety burden shifts to
    // assertTypeActive at the type-providing call sites, which reject an
    // unknown/archived key against the project scope before this resolves.
    if (type == null || type.length === 0) {
      return WORK_ITEM_TYPE_KEYS.Standard;
    }
    return type as WorkItemTypeKey;
  }

  private isMissingDueDate(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.length === 0)
    );
  }

  private resolveInitialStatus(
    taskType: WorkItemTypeKey,
    dtoStatus: WorkStatus | undefined,
    projectId: string,
  ): WorkStatus {
    const policy = this.workItemTypeRegistry.getInitialStatusPolicy(
      taskType,
      projectId,
    );
    if (policy.hasSetInitialStatus) {
      return policy.initialStatus as WorkStatus;
    }
    return dtoStatus ?? (policy.initialStatus as WorkStatus);
  }

  private getSectionFieldsForTaskType(
    taskType: WorkItemTypeKey,
    projectId: string,
  ): TaskSectionField[] {
    return [...this.workItemTypeRegistry.getSections(taskType, projectId)];
  }

  private isAllowedTaskSectionKey(
    key: string,
    taskType: WorkItemTypeKey,
    projectId: string,
  ): key is TaskSectionField {
    return this.getSectionFieldsForTaskType(taskType, projectId).includes(
      key as TaskSectionField,
    );
  }

  private assertSectionKeysMatchTaskType(
    keys: string[],
    taskType: WorkItemTypeKey,
    projectId: string,
  ): void {
    const invalid = keys.filter(
      (key) => !this.isAllowedTaskSectionKey(key, taskType, projectId),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Unsupported task section key(s) for ${taskType}: ${invalid.join(', ')}`,
      );
    }
  }

  private buildTaskSectionCreatePayload(
    values: Partial<Record<TaskSectionField, string | null | undefined>>,
    taskType: WorkItemTypeKey,
    projectId: string,
  ): TaskSectionCreatePayload[] {
    return this.workItemTypeRegistry
      .getSectionDefinitions(taskType, projectId)
      .map((sectionDefinition, index) => {
        const key = sectionDefinition.key;
        return {
          key,
          order: index,
          materializedMarkdown: this.initialMaterializedSectionContent(
            sectionDefinition,
            values[key],
          ),
        };
      });
  }

  private initialMaterializedSectionContent(
    sectionDefinition: WorkItemTypeSectionDefinition,
    content: string | null | undefined,
  ): string | null {
    if (content !== undefined && content !== null) {
      return content;
    }
    return resolveWorkItemSectionContentKind(sectionDefinition) === 'markdown'
      ? ''
      : null;
  }

  private buildTaskSectionUpdatesFromInput(
    projectId: string,
    sections?: WorkItemSectionInput[],
    taskType: WorkItemTypeKey = WORK_ITEM_TYPE_KEYS.Standard,
  ): Array<{ key: TaskSectionField; content: string }> {
    if (!sections || sections.length === 0) {
      return [];
    }

    const updates: Array<{ key: TaskSectionField; content: string }> = [];
    for (const section of sections) {
      const key = section.key as TaskSectionField;
      if (!this.isAllowedTaskSectionKey(key, taskType, projectId)) {
        throw new BadRequestException(
          `Unsupported task section key: ${section.key}`,
        );
      }
      const sectionDefinition = this.workItemTypeRegistry.getSectionDefinition(
        taskType,
        key,
        projectId,
      );

      updates.push({
        key,
        content: this.normalizeTaskSectionInputContent(
          sectionDefinition,
          section.content,
          projectId,
        ),
      });
    }

    return updates;
  }

  /** Future deltas reuse live-edit key admission and canonicalization. */
  public renderFutureTaskSections(
    projectId: string,
    taskType: WorkItemTypeKey,
    sections: WorkItemSectionInput[],
  ): Array<{ key: string; content: string }> {
    return this.buildTaskSectionUpdatesFromInput(projectId, sections, taskType);
  }

  private buildTaskSectionContentMap(
    projectId: string,
    sections?: WorkItemSectionInput[],
    taskType: WorkItemTypeKey = WORK_ITEM_TYPE_KEYS.Standard,
  ): Partial<Record<TaskSectionField, string>> {
    const values: Partial<Record<TaskSectionField, string>> = {};
    if (!sections) {
      return values;
    }

    for (const section of sections) {
      const key = section.key as TaskSectionField;
      if (!this.isAllowedTaskSectionKey(key, taskType, projectId)) {
        throw new BadRequestException(
          `Unsupported task section key: ${section.key}`,
        );
      }
      const sectionDefinition = this.workItemTypeRegistry.getSectionDefinition(
        taskType,
        key,
        projectId,
      );
      values[key] = this.normalizeTaskSectionInputContent(
        sectionDefinition,
        section.content,
        projectId,
      );
    }

    return values;
  }

  private featureRequirementAuthoring(): FeatureRequirementAuthoringService {
    return (
      this.featureRequirementAuthoringService ??
      new FeatureRequirementAuthoringService(this.workItemTypeRegistry)
    );
  }

  private throwFeatureRequirementDiagnostics(
    field: string,
    diagnostics: readonly { field: string; message: string }[],
  ): never {
    throw new BadRequestException(
      `${field} validation failed:\n${diagnostics
        .map((diagnostic) => `  ${diagnostic.field}: ${diagnostic.message}`)
        .join('\n')}`,
    );
  }

  private preparedFeatureRequirementSection(
    field: string,
    result: Awaited<
      ReturnType<
        FeatureRequirementAuthoringService['prepareInitialRequirements']
      >
    >,
  ): WorkItemSectionInput {
    if (!result.success) {
      return this.throwFeatureRequirementDiagnostics(field, result.diagnostics);
    }
    return { key: TaskSectionKey.Requirements, content: result.section };
  }

  private async assertFeatureRequirementSection(
    tx: Prisma.TransactionClient,
    organizationId: string,
    projectId: string,
    content: unknown,
    field: string,
    workItemId?: string,
    effectiveParentId?: string,
  ): Promise<void> {
    const result = await this.featureRequirementAuthoring().validate(content, {
      organizationId,
      projectId,
      workItemId,
      effectiveParentId,
      db: tx,
    });
    if (!result.success) {
      this.throwFeatureRequirementDiagnostics(field, result.diagnostics);
    }
  }

  private async sectionsForTaskCreate(
    taskType: WorkItemTypeKey,
    createTaskDto: CreateTaskDto,
    context: { organizationId: string; db: Prisma.TransactionClient },
  ): Promise<WorkItemSectionInput[] | undefined> {
    const initialRequirements = createTaskDto.initialRequirements;
    if (initialRequirements === undefined) {
      return createTaskDto.sections;
    }
    if (taskType !== WORK_ITEM_TYPE_KEYS.Feature) {
      throw new BadRequestException(
        'initialRequirements is only accepted for FEATURE tasks.',
      );
    }
    if (
      createTaskDto.sections?.some(
        (section) => section.key === TaskSectionKey.Requirements,
      )
    ) {
      throw new BadRequestException(
        'Provide FEATURE requirements through initialRequirements or sections[requirements], not both.',
      );
    }

    const requirements = this.preparedFeatureRequirementSection(
      'initialRequirements',
      await this.featureRequirementAuthoring().prepareInitialRequirements(
        initialRequirements,
        context,
      ),
    );
    return [...(createTaskDto.sections ?? []), requirements];
  }

  private normalizeTaskSectionInputContent(
    sectionDefinition: WorkItemTypeSectionDefinition | undefined,
    content: unknown,
    projectId: string,
  ): string {
    if (sectionDefinition) {
      const canonical = this.taskSectionSchemaValidators.canonicalize(
        sectionDefinition,
        content,
      );
      if (sectionDefinition.schemaRef === PROJECT_MODE_SETTINGS_SCHEMA_REF) {
        const ineligible = findIneligibleProjectModeTypeKeys(
          JSON.parse(canonical) as ProjectModeSettings,
          (typeKey) =>
            this.workItemTypeRegistry.isTypeActiveForProject(
              typeKey,
              projectId,
            ),
        );
        if (ineligible.length > 0) {
          throw new BadRequestException(
            `Eligible work-item type keys must be active in the project's effective registry: ${ineligible.join(', ')}`,
          );
        }
      }
      return canonical;
    }

    if (typeof content !== 'string') {
      throw new BadRequestException(
        'Task section content must be a string for key: unknown',
      );
    }
    return content;
  }

  private async ensureTaskSectionProfile(
    tx: Prisma.TransactionClient,
    taskId: TaskId,
    taskType: WorkItemTypeKey,
    projectId: string,
  ): Promise<void> {
    const allowedSectionDefinitions =
      this.workItemTypeRegistry.getSectionDefinitions(taskType, projectId);
    const allowedKeys = allowedSectionDefinitions.map((section) => section.key);
    const allowedDefinitionByKey = new Map(
      allowedSectionDefinitions.map((section) => [section.key, section]),
    );
    const allowedKeySet = new Set(allowedKeys);

    const existingSections = await tx.taskSection.findMany({
      where: { taskId },
      select: { id: true, key: true },
    });

    const existingByKey = new Map(
      existingSections.map((section) => [section.key, section.id]),
    );

    const disallowedIds = existingSections
      .filter((section) => !allowedKeySet.has(section.key as TaskSectionField))
      .map((section) => section.id);
    if (disallowedIds.length > 0) {
      await tx.taskSection.deleteMany({
        where: { id: { in: disallowedIds } },
      });
    }

    for (const [index, key] of allowedKeys.entries()) {
      const existingId = existingByKey.get(key);
      if (!existingId) {
        const sectionDefinition = allowedDefinitionByKey.get(key);
        await tx.taskSection.create({
          data: {
            taskId,
            key,
            order: index,
            materializedMarkdown:
              sectionDefinition &&
              resolveWorkItemSectionContentKind(sectionDefinition) !==
                'markdown'
                ? null
                : '',
          },
        });
        continue;
      }

      await tx.taskSection.update({
        where: { id: existingId },
        data: { order: index },
      });
    }
  }

  private async createSectionHistoryRow(
    tx: Prisma.TransactionClient,
    params: {
      taskId: string;
      sectionKey: string;
      contentSnapshot: string;
      changedBy?: UserId;
      changeReason?: string;
    },
  ): Promise<void> {
    const latestVersion = await tx.taskSectionHistory.findFirst({
      where: {
        taskId: params.taskId,
        sectionKey: params.sectionKey,
      },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true },
    });

    const nextVersion = (latestVersion?.versionNumber ?? 0) + 1;

    await tx.taskSectionHistory.create({
      data: {
        taskId: params.taskId,
        sectionKey: params.sectionKey,
        versionNumber: nextVersion,
        contentSnapshot: params.contentSnapshot,
        changedBy: params.changedBy ?? null,
        changeReason: params.changeReason ?? null,
        previousVersionId: latestVersion?.id ?? null,
      },
    });

    this.logger.debug('[applySectionUpdates] created section history row', {
      taskId: params.taskId,
      sectionKey: params.sectionKey,
      versionNumber: nextVersion,
      hasPreviousVersion: !!latestVersion,
    });
  }

  async getTaskSectionHistory(
    organizationId: OrganizationId,
    taskId: TaskId,
    sectionKey?: string,
  ): Promise<
    Array<{
      id: string;
      sectionKey: string;
      versionNumber: number;
      contentSnapshot: string;
      changedBy: string | null;
      changedAt: Date;
      changeReason: string | null;
      previousVersionId: string | null;
    }>
  > {
    const task = await this.prisma.db.task.findFirst({
      where: { id: taskId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    const where: Prisma.TaskSectionHistoryWhereInput = { taskId };
    if (sectionKey) {
      where.sectionKey = sectionKey;
    }

    return this.prisma.db.taskSectionHistory.findMany({
      where,
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        sectionKey: true,
        versionNumber: true,
        contentSnapshot: true,
        changedBy: true,
        changedAt: true,
        changeReason: true,
        previousVersionId: true,
      },
    });
  }

  private async publishTaskCreatedEvent(
    tx: Prisma.TransactionClient,
    params: {
      task: TaskEntity;
      content: TaskEventContentSnapshot;
      organizationId: OrganizationId;
      initiativeId: InitiativeId | null;
      projectId: ProjectId;
    },
  ): Promise<string | null> {
    const payload: TaskCreatedEventPayload = {
      payloadType: EVENT_TYPES.TASK.CREATED,
      task: toTaskSnapshot(
        { ...params.task, type: params.task.type as WorkItemTypeKey },
        params.content,
      ),
      initiativeId: params.initiativeId ?? undefined,
      organizationId: params.organizationId,
      projectId: params.projectId,
    };

    const event: Omit<TaskCreatedEvent, 'id'> = {
      type: EVENT_TYPES.TASK.CREATED,
      aggregateId: params.task.id as TaskId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishTaskCreatedEventOutOfTransaction(params: {
    task: TaskEntity;
    content: TaskEventContentSnapshot;
    organizationId: OrganizationId;
    initiativeId: InitiativeId | null;
    projectId: ProjectId;
  }): Promise<string | null> {
    const payload: TaskCreatedEventPayload = {
      payloadType: EVENT_TYPES.TASK.CREATED,
      task: toTaskSnapshot(
        { ...params.task, type: params.task.type as WorkItemTypeKey },
        {
          ...params.content,
          sections: await this.prisma.db.taskSection.findMany({
            where: { taskId: params.task.id },
            orderBy: { order: 'asc' },
            select: { key: true, order: true, materializedMarkdown: true },
          }),
        },
      ),
      initiativeId: params.initiativeId ?? undefined,
      organizationId: params.organizationId,
      projectId: params.projectId,
    };

    const event: Omit<TaskCreatedEvent, 'id'> = {
      type: EVENT_TYPES.TASK.CREATED,
      aggregateId: params.task.id as TaskId,
      payload,
    };

    return this.eventPublisher.publish(event);
  }

  private async publishTaskUpdatedEvent(
    tx: Prisma.TransactionClient,
    params: {
      taskId: TaskId;
      update: TaskEventUpdateSnapshot;
      organizationId: OrganizationId;
      initiativeId: InitiativeId | null;
      projectId: ProjectId;
      userId?: UserId;
      previousData?: Record<string, unknown>;
    },
  ): Promise<string | null> {
    const payload: TaskUpdatedEventPayload = {
      payloadType: EVENT_TYPES.TASK.UPDATED,
      update: params.update,
      previousData: params.previousData,
      organizationId: params.organizationId,
      initiativeId: params.initiativeId ?? undefined,
      projectId: params.projectId,
      userId: params.userId,
    };

    const event: Omit<TaskUpdatedEvent, 'id'> = {
      type: EVENT_TYPES.TASK.UPDATED,
      aggregateId: params.taskId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishTaskContentChangedEvent(
    tx: Prisma.TransactionClient,
    params: {
      taskId: TaskId;
      content: TaskEventContentSnapshot;
      organizationId: OrganizationId;
      initiativeId: InitiativeId | null;
      projectId: ProjectId;
      userId?: UserId;
    },
  ): Promise<string | null> {
    this.logger.debug(
      '[publishTaskContentChangedEvent] preparing task.content_changed payload',
      {
        taskId: params.taskId,
        organizationId: params.organizationId,
        initiativeId: params.initiativeId,
        projectId: params.projectId,
        userId: params.userId,
        contentLengths: {
          type: params.content.type,
          description: params.content.description.length,
          acceptanceCriteria: params.content.acceptanceCriteria?.length ?? 0,
        },
      },
    );

    const payload: TaskContentChangedEventPayload = {
      payloadType: EVENT_TYPES.TASK.CONTENT_CHANGED,
      content: params.content,
      organizationId: params.organizationId,
      initiativeId: params.initiativeId ?? undefined,
      projectId: params.projectId,
      userId: params.userId,
    };

    const event: Omit<TaskContentChangedEvent, 'id'> = {
      type: EVENT_TYPES.TASK.CONTENT_CHANGED,
      aggregateId: params.taskId,
      payload,
    };

    this.logger.debug(
      '[publishTaskContentChangedEvent] publishing task.content_changed in transaction',
      {
        taskId: params.taskId,
        eventType: event.type,
      },
    );

    const outboxId = await this.eventPublisher.publishInTransaction(tx, event);

    this.logger.debug(
      '[publishTaskContentChangedEvent] task.content_changed persisted to outbox',
      {
        taskId: params.taskId,
        outboxId,
      },
    );

    return outboxId;
  }

  private async publishTaskStatusChangedEvent(
    tx: Prisma.TransactionClient,
    params: {
      taskId: TaskId;
      previousStatus: WorkStatus;
      newStatus: WorkStatus;
      organizationId: OrganizationId;
      initiativeId: InitiativeId | null;
      projectId: ProjectId;
      originatingProjectId?: ProjectId | null;
      userId?: UserId;
    },
  ): Promise<string | null> {
    const payload: TaskStatusChangedEventPayload = {
      payloadType: EVENT_TYPES.TASK.STATUS_CHANGED,
      previousStatus: params.previousStatus,
      newStatus: params.newStatus,
      organizationId: params.organizationId,
      initiativeId: params.initiativeId ?? undefined,
      projectId: params.projectId,
      originatingProjectId: params.originatingProjectId ?? undefined,
      userId: params.userId,
    };

    const event: Omit<TaskStatusChangedEvent, 'id'> = {
      type: EVENT_TYPES.TASK.STATUS_CHANGED,
      aggregateId: params.taskId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async rollUpCanonicalPlanHierarchy(
    tx: Prisma.TransactionClient,
    childTaskId: TaskId | null,
    userId?: UserId,
    formerParentTaskId?: string | null,
  ): Promise<void> {
    const transitions = await this.planHierarchyRollupService.rollUp(tx, {
      taskId: childTaskId,
      formerParentTaskId,
    });
    if (transitions.length > 0) {
      this.logger.debug('[rollUpCanonicalPlanHierarchy] applied transitions', {
        childTaskId,
        formerParentTaskId: formerParentTaskId ?? null,
        transitionCount: transitions.length,
      });
    }
    for (const transition of transitions) {
      await this.publishTaskStatusChangedEvent(tx, {
        taskId: transition.taskId as TaskId,
        previousStatus: transition.previousStatus,
        newStatus: transition.newStatus,
        organizationId: transition.organizationId as OrganizationId,
        initiativeId: transition.initiativeId as InitiativeId | null,
        projectId: transition.projectId as ProjectId,
        originatingProjectId: transition.projectId as ProjectId,
        userId,
      });
    }
  }

  private async publishTaskAssignedEvent(
    tx: Prisma.TransactionClient,
    params: {
      taskId: TaskId;
      assigneeId: UserId;
      previousAssigneeId?: UserId;
      organizationId: OrganizationId;
      initiativeId: InitiativeId | null;
      projectId: ProjectId;
    },
  ): Promise<string | null> {
    const payload: TaskAssignedEventPayload = {
      payloadType: EVENT_TYPES.TASK.ASSIGNED,
      assigneeId: params.assigneeId,
      previousAssigneeId: params.previousAssigneeId,
      organizationId: params.organizationId,
      initiativeId: params.initiativeId ?? undefined,
      projectId: params.projectId,
    };

    const event: Omit<TaskAssignedEvent, 'id'> = {
      type: EVENT_TYPES.TASK.ASSIGNED,
      aggregateId: params.taskId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishTaskUnassignedEvent(
    tx: Prisma.TransactionClient,
    params: {
      taskId: TaskId;
      previousAssigneeId: UserId;
      organizationId: OrganizationId;
      initiativeId: InitiativeId | null;
      projectId: ProjectId;
    },
  ): Promise<string | null> {
    const payload: TaskUnassignedEventPayload = {
      payloadType: EVENT_TYPES.TASK.UNASSIGNED,
      previousAssigneeId: params.previousAssigneeId,
      organizationId: params.organizationId,
      initiativeId: params.initiativeId ?? undefined,
      projectId: params.projectId,
    };

    const event: Omit<TaskUnassignedEvent, 'id'> = {
      type: EVENT_TYPES.TASK.UNASSIGNED,
      aggregateId: params.taskId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishTaskArchivedEvent(
    tx: Prisma.TransactionClient,
    params: {
      taskId: TaskId;
      archivedAt: Date;
      organizationId: OrganizationId;
      initiativeId: InitiativeId | null;
      projectId: ProjectId;
    },
  ): Promise<string | null> {
    const payload: TaskArchivedEventPayload = {
      payloadType: EVENT_TYPES.TASK.ARCHIVED,
      archivedAt: params.archivedAt.toISOString(),
      organizationId: params.organizationId,
      initiativeId: params.initiativeId ?? undefined,
      projectId: params.projectId,
    };

    const event: Omit<TaskArchivedEvent, 'id'> = {
      type: EVENT_TYPES.TASK.ARCHIVED,
      aggregateId: params.taskId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async loadTaskEventContentSnapshot(
    taskId: TaskId,
    taskType: WorkItemTypeKey,
    projectId: string,
  ): Promise<TaskEventContentSnapshot> {
    const sectionsByTaskId = await this.loadTaskSectionsMap(
      [taskId],
      this.getSectionFieldsForTaskType(taskType, projectId),
    );
    const sections = sectionsByTaskId.get(taskId);
    return buildTaskEventContentSnapshotFromSections(taskType, sections);
  }

  private assertNoDirectSectionUpdates(
    update: Partial<Record<TaskSectionField, unknown>>,
  ): void {
    const blocked = TASK_SECTION_FIELDS.filter(
      (field) => update[field] !== undefined,
    );
    if (blocked.length > 0) {
      throw new BadRequestException(
        `Task content is edited via sections. Remove: ${blocked.join(', ')}`,
      );
    }
  }

  private shouldUpdateOriginalArtifactFromSource(
    source?: TaskSectionUpdateSource,
  ): boolean {
    return source === TaskSectionUpdateSource.AgentSuggested;
  }

  async applySectionUpdates(
    organizationId: OrganizationId,
    taskId: TaskId,
    updates: Array<{ key: TaskSectionField; content: string }>,
    options?: {
      updateOriginalArtifact?: boolean;
      taskTypeOverride?: WorkItemTypeKey;
      changedBy?: UserId;
      changeReason?: string;
      effectiveParentId?: string | null;
    },
  ): Promise<TaskResponseDto> {
    if (!updates.length) {
      const existing = await this.findOne(organizationId, taskId);
      if (!existing) {
        throw new NotFoundException(`Task with ID ${taskId} not found.`);
      }
      return existing;
    }

    const initiativeId = await this.prisma.$transaction(async (tx) => {
      const result = await this.applySectionUpdatesInTransaction(
        tx,
        organizationId,
        taskId,
        updates,
        options,
      );
      return result.initiativeId;
    });

    // Post-commit work — refines the TASK_ORIGINAL artifact based on this
    // change; not load-bearing for atomicity, runs on its own connection.
    if (options?.updateOriginalArtifact) {
      await this.updateOriginalArtifactForRefinementOverwrites(
        organizationId,
        taskId,
      );
    } else {
      this.logger.debug(
        '[applySectionUpdates] skipping TASK_ORIGINAL update (not agent-generated)',
        {
          taskId,
          organizationId,
        },
      );
    }

    const [response] = await this.mapTasksWithChildCounts(
      [
        {
          ...(await this.prisma.db.task.findUniqueOrThrow({
            where: { id: taskId },
          })),
        },
      ],
      organizationId,
      initiativeId,
      undefined,
      undefined,
      ALL_DECLARED_SECTIONS,
    );

    if (!response) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    return response;
  }

  /**
   * Transaction-aware section-updates path. Runs all reads and writes on the
   * caller's tx so the section change is atomic with whatever the caller is
   * coordinating (e.g. a proposal row flip from DRAFT → APPROVED).
   *
   * Returns `initiativeId` so callers can do post-commit response shaping
   * without a redundant DB read.
   */
  async applySectionUpdatesInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    taskId: TaskId,
    updates: Array<{ key: TaskSectionField; content: string | null }>,
    options?: {
      updateOriginalArtifact?: boolean;
      taskTypeOverride?: WorkItemTypeKey;
      changedBy?: UserId;
      changeReason?: string;
      materializationId?: string;
      effectiveParentId?: string | null;
    },
  ): Promise<{ initiativeId: InitiativeId | null }> {
    const existingTask = await tx.task.findFirst({
      where: { id: taskId, organizationId, archivedAt: null },
      select: {
        id: true,
        type: true,
        tag: true,
        status: true,
        projectId: true,
        initiativeId: true,
        parentTaskId: true,
      },
    });
    if (!existingTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    const projectId = existingTask.projectId as ProjectId;
    await this.assertWorkItemWriteAllowed(
      tx,
      organizationId,
      projectId,
      [taskId],
      options?.materializationId,
      options?.taskTypeOverride,
    );

    const effectiveTaskType =
      options?.taskTypeOverride ??
      this.resolveTaskType(existingTask.type as WorkItemTypeKey);

    this.logger.debug('Applying task section updates', {
      taskId,
      organizationId,
      taskType: effectiveTaskType,
      updates: updates.map((update) => ({
        key: update.key,
        contentLength: update.content?.length ?? 0,
      })),
    });
    this.assertSectionKeysMatchTaskType(
      updates.map((update) => update.key),
      effectiveTaskType,
      projectId,
    );
    const groupsSectionKey = this.graphGroupsSectionKey(
      effectiveTaskType,
      projectId,
    );
    if (groupsSectionKey) {
      updates = await this.reconcileDiagramGroupsUpdate(
        tx,
        organizationId,
        taskId,
        groupsSectionKey,
        updates,
      );
    }
    if (
      effectiveTaskType === 'DIAGRAM' ||
      effectiveTaskType === 'DIAGRAM_ELEMENT'
    ) {
      const persisted = await tx.taskSection.findMany({
        where: { taskId },
        select: { key: true, materializedMarkdown: true },
      });
      const sections = new Map<string, WorkItemSectionInput>(
        persisted.map((section) => [
          section.key,
          { key: section.key, content: section.materializedMarkdown },
        ]),
      );
      for (const update of updates)
        sections.set(update.key, { key: update.key, content: update.content });
      await validateDiagramSections({
        db: tx,
        organizationId,
        projectId,
        type: effectiveTaskType,
        sections: [...sections.values()],
        definitions: this.workItemTypeRegistry.getSectionDefinitions(
          effectiveTaskType,
          projectId,
        ),
      });
    }

    const requirementsUpdate = updates.find(
      (update) => update.key === TaskSectionKey.Requirements,
    );
    if (
      effectiveTaskType === WORK_ITEM_TYPE_KEYS.Feature &&
      requirementsUpdate
    ) {
      await this.assertFeatureRequirementSection(
        tx,
        organizationId,
        projectId,
        requirementsUpdate.content,
        'sections[requirements]',
        taskId,
        options?.effectiveParentId !== undefined
          ? (options.effectiveParentId ?? undefined)
          : (existingTask.parentTaskId ?? undefined),
      );
    }

    this.logger.debug(
      '[applySectionUpdates] task.content_changed transaction started',
      {
        taskId,
        organizationId,
        updateKeys: updates.map((update) => update.key),
      },
    );

    if (
      options?.taskTypeOverride &&
      this.resolveTaskType(existingTask.type as WorkItemTypeKey) !==
        options.taskTypeOverride
    ) {
      await this.ensureTaskSectionProfile(
        tx,
        taskId,
        options.taskTypeOverride,
        projectId,
      );
    }

    const updateKeys = updates.map((update) => update.key);
    const sections = await tx.taskSection.findMany({
      where: {
        taskId,
        key: { in: updateKeys },
      },
      select: {
        id: true,
        key: true,
        materializedMarkdown: true,
      },
    });

    const sectionMap = new Map(
      sections.map((section) => [section.key, section]),
    );
    const sectionDefinitions = this.workItemTypeRegistry.getSectionDefinitions(
      effectiveTaskType,
      projectId,
    );
    const sectionDefinitionByKey = new Map(
      sectionDefinitions.map((definition, index) => [
        definition.key,
        { definition, order: index },
      ]),
    );

    for (const key of new Set(updateKeys)) {
      if (sectionMap.has(key)) {
        continue;
      }
      const declaredSection = sectionDefinitionByKey.get(key);
      if (!declaredSection) {
        throw new BadRequestException(
          `Unsupported task section key(s) for ${effectiveTaskType}: ${key}`,
        );
      }
      const section = await tx.taskSection.upsert({
        where: { taskId_key: { taskId, key } },
        create: {
          taskId,
          key,
          order: declaredSection.order,
          materializedMarkdown:
            resolveWorkItemSectionContentKind(declaredSection.definition) ===
            'markdown'
              ? ''
              : null,
        },
        update: {},
        select: {
          id: true,
          key: true,
          materializedMarkdown: true,
        },
      });
      sectionMap.set(section.key, section);
    }

    if (sectionMap.size !== updateKeys.length) {
      throw new BadRequestException(
        `Task ${taskId} is missing required sections.`,
      );
    }

    this.logger.debug(
      '[applySectionUpdates] located task sections for requested updates',
      {
        taskId,
        foundSectionCount: sections.length,
        requestedSectionCount: updateKeys.length,
      },
    );

    for (const update of updates) {
      const existing = sectionMap.get(update.key);
      if (!existing) {
        this.logger.warn('Attempted to update missing task section', {
          taskId,
          sectionKey: update.key,
        });
        continue;
      }

      const previousContent = existing.materializedMarkdown;

      if (previousContent != null && previousContent !== '') {
        await this.createSectionHistoryRow(tx, {
          taskId,
          sectionKey: update.key,
          contentSnapshot: previousContent,
          changedBy: options?.changedBy,
          changeReason: options?.changeReason,
        });
      } else {
        this.logger.debug(
          '[applySectionUpdates] skipping history for initial section content',
          { taskId, sectionKey: update.key },
        );
      }

      await tx.taskSection.update({
        where: { id: existing.id },
        data: {
          materializedMarkdown: update.content,
        },
      });
    }

    const sectionsForEvent = (await tx.taskSection.findMany({
      where: {
        taskId,
      },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        key: true,
        order: true,
        materializedMarkdown: true,
      },
    })) as Array<{
      id: string;
      key: TaskSectionField;
      order: number;
      materializedMarkdown: string | null;
    }>;

    this.logger.debug(
      '[applySectionUpdates] loaded sections for content_changed snapshot',
      {
        taskId,
        sectionKeys: sectionsForEvent.map((section) => section.key),
        sectionCount: sectionsForEvent.length,
      },
    );

    const contentSnapshot = buildTaskEventContentSnapshotFromSections(
      effectiveTaskType,
      sectionsForEvent,
      existingTask.tag,
    );

    this.logger.debug(
      '[applySectionUpdates] built content snapshot for task.content_changed',
      {
        taskId,
        contentLengths: {
          type: contentSnapshot.type,
          description: contentSnapshot.description.length,
          acceptanceCriteria: contentSnapshot.acceptanceCriteria?.length ?? 0,
          requirements: contentSnapshot.requirements?.length ?? 0,
        },
      },
    );

    const outboxId = await this.publishTaskContentChangedEvent(tx, {
      taskId,
      content: contentSnapshot,
      organizationId,
      initiativeId: existingTask.initiativeId as InitiativeId | null,
      projectId,
    });

    this.logger.debug(
      '[applySectionUpdates] task.content_changed publish call completed',
      {
        taskId,
        outboxId,
      },
    );

    return {
      initiativeId: existingTask.initiativeId as InitiativeId | null,
    };
  }

  private toTaskResponse(
    task: TaskEntity,
    childCounts?: ChildCounts,
    designDocCount?: number,
    agentSessionCounts?: AgentSessionCounts,
    sections?: MaterializedWorkItemSection[],
    serviceRelations?: ServiceTaskRelation[],
    edges?: AgentEdge[],
    trackedEntities?: TrackedEntitySnapshot[],
    trackedWorkSummary?: GoalTrackedWorkSummary,
  ): TaskResponseDto {
    return {
      ...task,
      parentTaskId: task.parentTaskId || null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      archivedAt: task.archivedAt?.toISOString() || null,
      dueDate: task.dueDate?.toISOString() || null,
      ...(task.config !== undefined
        ? { config: readWorkItemConfig(task.config) }
        : {}),
      tag: task.tag ?? undefined,
      childCounts: childCounts ?? this.createEmptyChildCounts(),
      designDocCount: designDocCount ?? null,
      codingSessionCount: agentSessionCounts?.codingSessionCount ?? null,
      agentSessionCount: agentSessionCounts?.agentSessionCount ?? null,
      hasProposalSupport: hasProposalSupport('TASK'),
      sections,
      ...(serviceRelations !== undefined ? { serviceRelations } : {}),
      ...(edges !== undefined ? { edges } : {}),
      ...(trackedEntities !== undefined ? { trackedEntities } : {}),
      ...(trackedWorkSummary !== undefined ? { trackedWorkSummary } : {}),
    } as TaskResponseDto;
  }

  private toServiceTaskRelation(
    relation: TaskServiceRelationEntity,
  ): ServiceTaskRelation {
    return {
      id: relation.id,
      serviceId: relation.serviceId,
      taskId: relation.taskId,
      relationType: relation.relationType ?? undefined,
      createdAt: relation.createdAt.toISOString(),
    };
  }

  private mapServiceTaskRelations(
    task: TaskWithCountsAndRelations,
  ): ServiceTaskRelation[] | undefined {
    if (!Object.prototype.hasOwnProperty.call(task, 'serviceRelations')) {
      return undefined;
    }

    return (task.serviceRelations ?? []).map((relation) =>
      this.toServiceTaskRelation(relation),
    );
  }

  private async buildChildCountsMap(
    organizationId: OrganizationId,
    initiativeId: InitiativeId | null | undefined,
    parentTaskIds: string[],
  ): Promise<Map<string, ChildCounts>> {
    if (parentTaskIds.length === 0) {
      return new Map();
    }

    const where: Prisma.TaskWhereInput = {
      organizationId,
      archivedAt: null,
      parentTaskId: {
        in: parentTaskIds,
      },
    };

    if (initiativeId !== undefined) {
      where.initiativeId = initiativeId;
    }

    const grouped = await this.prisma.db.task.groupBy({
      by: ['parentTaskId', 'status'],
      where,
      _count: {
        _all: true,
      },
    });

    const countsMap = new Map<string, ChildCounts>();

    for (const row of grouped) {
      if (!row.parentTaskId) {
        continue;
      }

      let counts = countsMap.get(row.parentTaskId);
      if (!counts) {
        counts = this.createEmptyChildCounts();
        countsMap.set(row.parentTaskId, counts);
      }

      counts.total += row._count._all;

      if (DONE_STATUSES.has(row.status)) {
        counts.done += row._count._all;
      } else if (IN_PROGRESS_STATUSES.has(row.status)) {
        counts.inProgress += row._count._all;
      } else if (BACKLOG_STATUSES.has(row.status)) {
        counts.backlog += row._count._all;
      } else {
        // Unknown statuses default to backlog bucket
        counts.backlog += row._count._all;
      }
    }

    return countsMap;
  }

  private async buildDesignDocCountsMapForTaskIds(
    organizationId: OrganizationId,
    taskIds: string[],
  ): Promise<Map<string, number>> {
    if (taskIds.length === 0) {
      return new Map();
    }
    const counts = await this.prisma.db.designDoc.groupBy({
      by: ['parentEntityId'],
      where: {
        parentEntityType: 'TASK',
        parentEntityId: { in: taskIds },
        organizationId,
        archivedAt: null,
      },
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const row of counts) {
      if (row.parentEntityId) {
        map.set(row.parentEntityId, row._count._all);
      }
    }
    return map;
  }

  private static readonly TASK_EDGES_PAGE_SIZE = 100;

  private async resolveRelatedTaskIds(
    organizationId: OrganizationId,
    projectId: ProjectId | undefined,
    relatedEntityId: string | undefined,
    relatedEntityType: AgentEdgeEndpointEntityType | undefined,
    edgeTypes: readonly RelationshipType[] | undefined,
    userToken: string | null | undefined,
  ): Promise<Set<string> | undefined> {
    const hasId = relatedEntityId !== undefined;
    const hasType = relatedEntityType !== undefined;
    if (!hasId && !hasType) {
      return undefined;
    }
    if (!hasId || !hasType) {
      throw new BadRequestException(
        'relatedEntityId and relatedEntityType must be provided together',
      );
    }
    if (!edgeTypes || edgeTypes.length === 0) {
      throw new BadRequestException(
        'edgeTypes is required when filtering by a related entity',
      );
    }
    if (!projectId) {
      throw new BadRequestException(
        'projectId is required when filtering by a related entity',
      );
    }
    if (!userToken) {
      throw new BadRequestException(
        'An authenticated user token is required when filtering by a related entity',
      );
    }

    const edges = await this.findIncidentEdges(
      organizationId,
      projectId,
      [relatedEntityId],
      edgeTypes,
      userToken,
    );

    const taskIds = new Set<string>();
    const endpointMatches = (
      nodeId: string,
      entityType: AgentEdgeEndpointEntityType | undefined,
    ): boolean =>
      nodeId === relatedEntityId &&
      (entityType === undefined || entityType === relatedEntityType);
    const isTaskEndpoint = (
      entityType: AgentEdgeEndpointEntityType | undefined,
    ): boolean => entityType === undefined || entityType === 'TASK';

    for (const edge of edges) {
      const touchesRequestedId =
        edge.sourceNodeId === relatedEntityId ||
        edge.targetNodeId === relatedEntityId;
      if (!touchesRequestedId) {
        throw new Error(
          `Incident edge ${edge.id} did not touch the requested related entity`,
        );
      }
      if (
        endpointMatches(edge.sourceNodeId, edge.sourceEntityType) &&
        isTaskEndpoint(edge.targetEntityType)
      ) {
        taskIds.add(edge.targetNodeId);
      }
      if (
        endpointMatches(edge.targetNodeId, edge.targetEntityType) &&
        isTaskEndpoint(edge.sourceEntityType)
      ) {
        taskIds.add(edge.sourceNodeId);
      }
    }

    return taskIds;
  }

  private async buildTaskEdgesMap(
    organizationId: OrganizationId,
    projectId: ProjectId,
    taskIds: string[],
    userToken: string | null,
    edgeTypes?: readonly RelationshipType[],
  ): Promise<Map<string, AgentEdge[]>> {
    this.logger.debug('[buildTaskEdgesMap] loading agent edges', {
      organizationId,
      projectId,
      taskCount: taskIds.length,
      hasToken: !!userToken,
    });

    if (taskIds.length === 0 || !userToken) {
      return new Map();
    }

    const edges = await this.findIncidentEdges(
      organizationId,
      projectId,
      taskIds,
      edgeTypes && edgeTypes.length > 0 ? edgeTypes : AGENT_EDGE_LABELS,
      userToken,
    );
    const taskIdSet = new Set(taskIds);
    const map = new Map<string, AgentEdge[]>();
    const seenByTaskId = new Map<string, Set<string>>();

    const addEdge = (taskId: string, edge: AgentEdge): void => {
      let seen = seenByTaskId.get(taskId);
      if (!seen) {
        seen = new Set<string>();
        seenByTaskId.set(taskId, seen);
      }
      if (seen.has(edge.id)) return;

      seen.add(edge.id);
      const taskEdges = map.get(taskId) ?? [];
      taskEdges.push(edge);
      map.set(taskId, taskEdges);
    };

    for (const edge of edges) {
      let attached = false;
      if (taskIdSet.has(edge.sourceNodeId)) {
        addEdge(edge.sourceNodeId, edge);
        attached = true;
      }
      if (
        edge.targetNodeId !== edge.sourceNodeId &&
        taskIdSet.has(edge.targetNodeId)
      ) {
        addEdge(edge.targetNodeId, edge);
        attached = true;
      }
      if (!attached) {
        throw new Error(
          `Incident edge ${edge.id} did not touch any requested work item`,
        );
      }
    }

    this.logger.debug('[buildTaskEdgesMap] loaded agent edges', {
      organizationId,
      projectId,
      taskCount: taskIds.length,
      taskCoverage: map.size,
    });

    return map;
  }

  /**
   * Incident-query only serves stored agent-authored edges; derived types such
   * as PROPOSED_TOGETHER exist only at read time, so they go through the graph
   * exact grouped incident projection instead.
   */
  private async findIncidentEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    nodeIds: string[],
    relationshipTypes: readonly RelationshipType[],
    userToken: string,
  ): Promise<AgentEdge[]> {
    const traversalOnlyTypes = relationshipTypes.filter((type) =>
      TRAVERSAL_ONLY_INCIDENT_EDGE_TYPES.has(type),
    );
    const authorableTypes = relationshipTypes.filter(
      (type) => !TRAVERSAL_ONLY_INCIDENT_EDGE_TYPES.has(type),
    );
    this.logger.debug('[findIncidentEdges] resolving incident edges', {
      organizationId,
      projectId,
      nodeCount: nodeIds.length,
      authorableTypes,
      traversalOnlyTypes,
    });

    const [incidentEdges, traversalEdges] = await Promise.all([
      authorableTypes.length > 0
        ? this.agentEdgeClient.findIncident(
            organizationId,
            projectId,
            {
              nodeIds: new Set(nodeIds),
              types: new Set(authorableTypes.map(toIncidentAgentEdgeType)),
            },
            userToken,
          )
        : Promise.resolve([]),
      traversalOnlyTypes.length > 0
        ? this.findTraversalOnlyIncidentEdges(
            organizationId,
            projectId,
            nodeIds,
            traversalOnlyTypes,
            userToken,
          )
        : Promise.resolve([]),
    ]);
    return [...incidentEdges, ...traversalEdges];
  }

  private async findTraversalOnlyIncidentEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    taskIds: string[],
    relationshipTypes: readonly RelationshipType[],
    userToken: string,
  ): Promise<AgentEdge[]> {
    const pageSize = TaskService.TASK_EDGES_PAGE_SIZE;
    const response = await this.graphsClient.readIncidentEdges(
      organizationId,
      projectId,
      {
        seedEntityIds: taskIds,
        relationshipTypes: [...relationshipTypes],
      },
      userToken,
    );

    for (const group of response.groups) {
      if (group.neighborTotal > pageSize) {
        this.logger.warn(
          '[findTraversalOnlyIncidentEdges] edges may be truncated',
          {
            seedEntityId: group.seedEntityId,
            neighborTotal: group.neighborTotal,
            pageSize,
          },
        );
      }
    }

    const requestedTaskIds = new Set(taskIds);
    const requestedTypes = new Set<string>(relationshipTypes);
    const seen = new Set<string>();
    const edges: AgentEdge[] = [];
    for (const seedResult of response.groups) {
      if (!requestedTaskIds.has(seedResult.seedEntityId)) continue;
      for (const relationship of seedResult.relationships ?? []) {
        if (!requestedTypes.has(relationship.type)) continue;
        const edge = graphRelationshipToAgentEdge(relationship);
        if (!edge) continue;
        const dedupeKey =
          edge.type === RelationshipType.ProposedTogether
            ? `${edge.type}:${[edge.sourceNodeId, edge.targetNodeId]
                .sort()
                .join(':')}`
            : `id:${edge.id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        edges.push(edge);
      }
    }
    return edges;
  }

  private assertRequestedGraphEdgeTypesAllowed(
    tasks: readonly Pick<TaskWithCountsAndRelations, 'id' | 'type'>[],
    projectId: ProjectId,
    edgeTypes: readonly RelationshipType[] | undefined,
  ): void {
    if (!edgeTypes || edgeTypes.length === 0) {
      return;
    }

    for (const task of tasks) {
      const typeKey = this.resolveTaskType(task.type);
      const graphCapability = this.workItemTypeRegistry.getGraphCapability(
        typeKey,
        projectId,
      );
      if (!graphCapability) {
        continue;
      }

      const allowed = new Set<string>(
        graphCapability.readableRelationships.map(
          (relationship) => relationship.edgeType,
        ),
      );
      const disallowed = edgeTypes.filter((edgeType) => !allowed.has(edgeType));
      if (disallowed.length > 0) {
        throw new BadRequestException(
          `Requested edgeTypes are not readable for graph-capable work-item type ${typeKey}: ${[
            ...new Set(disallowed),
          ].join(', ')}`,
        );
      }
    }
  }

  private getDefaultReadableEdgeTypesForTask(
    task: Pick<TaskWithCountsAndRelations, 'type'>,
    projectId: ProjectId,
  ): readonly RelationshipType[] {
    const typeKey = this.resolveTaskType(task.type);
    const graphCapability = this.workItemTypeRegistry.getGraphCapability(
      typeKey,
      projectId,
    );
    return graphCapability
      ? (graphCapability.readableRelationships.map(
          (relationship) => relationship.edgeType,
        ) as RelationshipType[])
      : AGENT_EDGE_LABELS;
  }

  private resolveReadableEdgeTypesByTaskId(
    tasks: readonly Pick<TaskWithCountsAndRelations, 'id' | 'type'>[],
    projectId: ProjectId,
    requestedEdgeTypes: readonly RelationshipType[] | undefined,
  ): Map<string, Set<RelationshipType>> {
    const map = new Map<string, Set<RelationshipType>>();
    for (const task of tasks) {
      const readableTypes =
        requestedEdgeTypes && requestedEdgeTypes.length > 0
          ? requestedEdgeTypes
          : this.getDefaultReadableEdgeTypesForTask(task, projectId);
      map.set(task.id, new Set(readableTypes));
    }
    return map;
  }

  private resolveIncidentEdgeTypesToLoad(
    readableEdgeTypesByTaskId: Map<string, Set<RelationshipType>>,
  ): RelationshipType[] {
    const edgeTypes = new Set<RelationshipType>();
    for (const readableTypes of readableEdgeTypesByTaskId.values()) {
      for (const edgeType of readableTypes) {
        edgeTypes.add(edgeType);
      }
    }
    return [...edgeTypes];
  }

  private filterEdgesMapByReadableTypes(
    edgesMap: Map<string, AgentEdge[]>,
    readableEdgeTypesByTaskId: Map<string, Set<RelationshipType>>,
  ): Map<string, AgentEdge[]> {
    const filtered = new Map<string, AgentEdge[]>();
    for (const [taskId, edges] of edgesMap.entries()) {
      const readableTypes = readableEdgeTypesByTaskId.get(taskId);
      if (!readableTypes) {
        continue;
      }
      const readableEdges = edges.filter((edge) =>
        readableTypes.has(edge.type as RelationshipType),
      );
      if (readableEdges.length > 0) {
        filtered.set(taskId, readableEdges);
      }
    }
    return filtered;
  }

  private async buildGraphGatedTaskEdgesMap(
    organizationId: OrganizationId,
    projectId: ProjectId,
    tasks: readonly Pick<TaskWithCountsAndRelations, 'id' | 'type'>[],
    userToken: string | null,
    edgeTypes: readonly RelationshipType[] | undefined,
  ): Promise<Map<string, AgentEdge[]>> {
    this.assertRequestedGraphEdgeTypesAllowed(tasks, projectId, edgeTypes);
    const readableEdgeTypesByTaskId = this.resolveReadableEdgeTypesByTaskId(
      tasks,
      projectId,
      edgeTypes,
    );
    const incidentEdgeTypesToLoad = this.resolveIncidentEdgeTypesToLoad(
      readableEdgeTypesByTaskId,
    );
    if (incidentEdgeTypesToLoad.length === 0) {
      return new Map();
    }
    const edgesMap = await this.buildTaskEdgesMap(
      organizationId,
      projectId,
      tasks.map((task) => task.id),
      userToken,
      incidentEdgeTypesToLoad,
    );
    return this.filterEdgesMapByReadableTypes(
      edgesMap,
      readableEdgeTypesByTaskId,
    );
  }

  /**
   * Loads each Goal's resolved TRACKS targets once (grouped identity read plus
   * one batched task read). Both the snapshot projection and the compact
   * summary are derived from these rows, so requesting both costs one graph
   * call. The graph request shape is governed by the grouped identity-read
   * contract and must not change here.
   */
  private async loadTrackedTaskRowsByGoal(
    organizationId: OrganizationId,
    projectId: ProjectId,
    goalTaskIds: string[],
    userToken: string | null,
    projections: TrackedGoalProjections = DEFAULT_TRACKED_GOAL_PROJECTIONS,
  ): Promise<Map<string, TrackedTaskRow[]>> {
    this.logger.debug('[loadTrackedTaskRowsByGoal] loading tracked targets', {
      organizationId,
      projectId,
      goalCount: goalTaskIds.length,
      hasToken: !!userToken,
      includeTrackedEntities: projections.includeTrackedEntities,
      includeTrackedWorkSummary: projections.includeTrackedWorkSummary,
    });

    if (goalTaskIds.length === 0 || !userToken) {
      return new Map();
    }

    const startedAt = Date.now();
    const request: SearchRequest = {
      seedEntityIds: goalTaskIds,
      projection: 'IDENTITIES_BY_SEED',
      traversal: {
        direction: 'OUTGOING',
        depth: 1,
        relationshipTypes: ['TRACKS'],
      },
      includeSeedEntities: false,
    };

    const response = await this.graphsClient.searchGraph(
      organizationId,
      projectId,
      request,
      userToken,
    );
    const graphMs = Date.now() - startedAt;

    const goalIdSet = new Set(goalTaskIds);
    const targetsByGoal = new Map<string, string[]>();
    const taskTargetIds = new Set<string>();

    if (!response.identitiesBySeed) {
      throw new Error(
        'Graph identity projection response is missing identitiesBySeed',
      );
    }
    for (const seedResult of response.identitiesBySeed) {
      if (!goalIdSet.has(seedResult.seedNodeId)) continue;
      const targets = seedResult.targets
        .filter((target) => target.entityType === 'TASK')
        .map((target) => target.entityId);
      targetsByGoal.set(seedResult.seedNodeId, targets);
      for (const targetId of targets) {
        taskTargetIds.add(targetId);
      }
    }

    const tasks: TrackedTaskRow[] = await this.prisma.db.task.findMany({
      where: {
        id: { in: Array.from(taskTargetIds) },
        organizationId,
        archivedAt: null,
      },
      select: { id: true, name: true, status: true, dueDate: true },
    });

    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const map = new Map<string, TrackedTaskRow[]>();
    for (const [goalId, targetIds] of targetsByGoal.entries()) {
      const rows: TrackedTaskRow[] = [];
      for (const targetId of targetIds) {
        const taskRow = taskById.get(targetId);
        if (taskRow) rows.push(taskRow);
      }
      map.set(goalId, rows);
    }

    this.logger.debug('[loadTrackedTaskRowsByGoal] loaded tracked targets', {
      organizationId,
      projectId,
      goalCount: goalTaskIds.length,
      goalCoverage: map.size,
      targetCount: taskTargetIds.size,
      resolvedTargetCount: tasks.length,
      graphMs,
      totalMs: Date.now() - startedAt,
      includeTrackedEntities: projections.includeTrackedEntities,
      includeTrackedWorkSummary: projections.includeTrackedWorkSummary,
    });

    return map;
  }

  private toTrackedSnapshots(rows: TrackedTaskRow[]): TrackedEntitySnapshot[] {
    return rows.map((row) => ({
      targetEntityId: row.id,
      targetEntityType: 'TASK',
      title: row.name,
      status: row.status,
      dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    }));
  }

  /**
   * Counts only resolved, non-archived targets. Past-due and undated counts
   * cover open targets (neither completed nor cancelled); undated open targets
   * are left for the caller to resolve against the Goal's own due date, which
   * mirrors the snapshot-based derived goal-status rule.
   */
  private toTrackedWorkSummary(
    rows: TrackedTaskRow[],
    now: Date = new Date(),
  ): GoalTrackedWorkSummary {
    const summary: GoalTrackedWorkSummary = {
      totalCount: rows.length,
      completedCount: 0,
      cancelledCount: 0,
      pastDueCount: 0,
      openUndatedCount: 0,
    };
    const nowMs = now.getTime();
    for (const row of rows) {
      if (row.status === WorkStatus.COMPLETED) {
        summary.completedCount += 1;
        continue;
      }
      if (row.status === WorkStatus.CANCELLED) {
        summary.cancelledCount += 1;
        continue;
      }
      if (!row.dueDate) {
        summary.openUndatedCount += 1;
      } else if (row.dueDate.getTime() < nowMs) {
        summary.pastDueCount += 1;
      }
    }
    return summary;
  }

  private toTrackedGoalFields(
    task: TaskEntity,
    trackedRowsByGoal: Map<string, TrackedTaskRow[]> | undefined,
    projections: TrackedGoalProjections,
    now: Date,
  ): {
    trackedEntities?: TrackedEntitySnapshot[];
    trackedWorkSummary?: GoalTrackedWorkSummary;
  } {
    if (task.type !== WORK_ITEM_TYPE_KEYS.Goal) return {};
    const rows = trackedRowsByGoal?.get(task.id) ?? [];
    return {
      trackedEntities: projections.includeTrackedEntities
        ? this.toTrackedSnapshots(rows)
        : undefined,
      // Without a loaded map (no token) a zero summary would be fabricated
      // data, so the summary is omitted instead.
      trackedWorkSummary:
        projections.includeTrackedWorkSummary && trackedRowsByGoal
          ? this.toTrackedWorkSummary(rows, now)
          : undefined,
    };
  }

  private async buildAgentSessionCountsMap(
    organizationId: OrganizationId,
    taskIds: string[],
  ): Promise<Map<string, AgentSessionCounts>> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const grouped = await this.prisma.db.agentSession.groupBy({
      by: ['entityId', 'type'],
      where: {
        organizationId,
        entityType: 'TASK',
        entityId: { in: taskIds },
      },
      _count: { _all: true },
    });

    const map = new Map<string, AgentSessionCounts>();

    for (const row of grouped) {
      if (!row.entityId) continue;

      let counts = map.get(row.entityId);
      if (!counts) {
        counts = { codingSessionCount: 0, agentSessionCount: 0 };
        map.set(row.entityId, counts);
      }

      if (row.type === AgentSessionType.CODING) {
        counts.codingSessionCount += row._count._all;
      } else {
        counts.agentSessionCount += row._count._all;
      }
    }

    return map;
  }

  private async resolveFeatureSubtreeIds(
    projectId: ProjectId,
    rootFeatureId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE feature_subtree AS (
        SELECT id
        FROM   tasks
        WHERE  id = ${rootFeatureId}
          AND  project_id = ${projectId}
          AND  type = 'FEATURE'
          AND  archived_at IS NULL
        UNION ALL
        SELECT t.id
        FROM   tasks t
        JOIN   feature_subtree fs ON t.parent_task_id = fs.id
        WHERE  t.project_id = ${projectId}
          AND  t.type = 'FEATURE'
          AND  t.archived_at IS NULL
      )
      SELECT id FROM feature_subtree
    `;

    const subtreeIds = rows.map((r) => r.id);

    this.logger.debug('[resolveFeatureSubtreeIds] resolved feature subtree', {
      projectId,
      rootFeatureId,
      subtreeSize: subtreeIds.length,
    });

    return subtreeIds;
  }

  private buildTaskInclude(
    organizationId: OrganizationId,
    options: {
      includeDesignDocCounts?: boolean;
      includeInitiative?: boolean;
      includeServiceRelations?: boolean;
    },
  ): Prisma.TaskInclude | undefined {
    const include: Prisma.TaskInclude = {};
    const countSelect: Prisma.TaskCountOutputTypeSelect = {};

    if (Object.keys(countSelect).length > 0) {
      include._count = {
        select: countSelect,
      };
    }

    if (options.includeInitiative) {
      include.initiative = {
        select: {
          originatingProjectId: true,
        },
      };
    }

    if (options.includeServiceRelations) {
      include.serviceRelations = {
        select: {
          id: true,
          serviceId: true,
          taskId: true,
          relationType: true,
          createdAt: true,
        },
      };
    }

    return Object.keys(include).length > 0 ? include : undefined;
  }

  private async hydrateTaskSections(
    sections: TaskSectionRecord[],
    _prismaClient: PrismaService['db'] | Prisma.TransactionClient = this.prisma
      .db,
  ): Promise<TaskSectionRecord[]> {
    return sections;
  }

  private async loadTaskSectionsMap(
    taskIds: string[],
    includeSectionKeys?: string[],
  ): Promise<Map<string, MaterializedWorkItemSection[]>> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const rawSections = (await this.prisma.db.taskSection.findMany({
      where: {
        taskId: { in: taskIds },
        ...(includeSectionKeys && includeSectionKeys.length > 0
          ? { key: { in: includeSectionKeys } }
          : {}),
      },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        taskId: true,
        key: true,
        order: true,
        materializedMarkdown: true,
      },
    })) as TaskSectionRecord[];

    const hydrated = await this.hydrateTaskSections(rawSections);
    const provenanceByTaskAndSection =
      await this.loadMaterializedSectionProvenance(taskIds);
    const sectionsByTaskId = new Map<string, MaterializedWorkItemSection[]>();

    for (const section of hydrated) {
      const list = sectionsByTaskId.get(section.taskId) ?? [];
      list.push({
        id: section.id,
        key: section.key,
        order: section.order,
        materializedMarkdown: section.materializedMarkdown ?? '',
        materializedProposalId:
          provenanceByTaskAndSection.get(section.taskId)?.get(section.key) ??
          '',
      });
      sectionsByTaskId.set(section.taskId, list);
    }

    for (const taskId of taskIds) {
      const sections = sectionsByTaskId.get(taskId) ?? [];
      if (sections.length === 0) {
        if (!includeSectionKeys || includeSectionKeys.length === 0) {
          throw new BadRequestException(
            `Task ${taskId} is missing required sections.`,
          );
        }
        sectionsByTaskId.set(taskId, []);
        continue;
      }
      sections.sort((a, b) => a.order - b.order);
      sectionsByTaskId.set(taskId, sections);
    }

    return sectionsByTaskId;
  }

  private async loadMaterializedSectionProvenance(
    taskIds: string[],
  ): Promise<Map<string, Map<string, string>>> {
    const proposals = await this.prisma.db.proposal.findMany({
      where: {
        targetEntityType: 'TASK',
        targetEntityId: { in: taskIds },
        status: 'APPROVED',
      },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        targetEntityId: true,
        updatedAt: true,
        updates: true,
        groupMembership: { select: { executionState: true, appliedAt: true } },
        workItemChangeSetMaterialization: {
          select: { status: true, publishedAt: true, operationSet: true },
        },
      },
    });
    const result = new Map<string, Map<string, string>>();
    const materializedContext = new Map<string, Map<string, string>>();
    const materializedProposals = proposals
      .filter((proposal) => {
        const membership = proposal.groupMembership;
        const materialization = proposal.workItemChangeSetMaterialization;
        return (
          (!membership || membership.executionState === 'APPLIED') &&
          (!materialization || materialization.status === 'PUBLISHED')
        );
      })
      .sort((left, right) => {
        const leftMaterializedAt =
          left.workItemChangeSetMaterialization?.publishedAt ??
          left.groupMembership?.appliedAt ??
          left.updatedAt;
        const rightMaterializedAt =
          right.workItemChangeSetMaterialization?.publishedAt ??
          right.groupMembership?.appliedAt ??
          right.updatedAt;
        const chronological =
          leftMaterializedAt.getTime() - rightMaterializedAt.getTime();
        return chronological || left.id.localeCompare(right.id);
      });
    for (const proposal of materializedProposals) {
      const materialization = proposal.workItemChangeSetMaterialization;
      const changes = this.changedStructuredMockupSections(
        materialization?.operationSet ?? proposal.updates,
        proposal.targetEntityId,
      );
      if (changes.length === 0) continue;
      const taskMap = result.get(proposal.targetEntityId) ?? new Map();
      const contextMap =
        materializedContext.get(proposal.targetEntityId) ?? new Map();
      for (const change of changes) {
        if (contextMap.get(change.key) === change.context) continue;
        contextMap.set(change.key, change.context);
        taskMap.set(change.key, proposal.id);
      }
      materializedContext.set(proposal.targetEntityId, contextMap);
      result.set(proposal.targetEntityId, taskMap);
    }
    return result;
  }

  private changedStructuredMockupSections(
    value: unknown,
    taskId: string,
  ): Array<{ key: string; context: string }> {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.sections)) {
      return record.sections.flatMap((section) => {
        if (!section || typeof section !== 'object') return [];
        const candidate = section as Record<string, unknown>;
        return this.visualMockupContext(candidate.key, candidate.content);
      });
    }
    if (!Array.isArray(record.operations)) return [];
    const root =
      record.root &&
      typeof record.root === 'object' &&
      !Array.isArray(record.root)
        ? (record.root as Record<string, unknown>)
        : null;
    return record.operations.flatMap((operation) => {
      if (!operation || typeof operation !== 'object') return [];
      const candidate = operation as Record<string, unknown>;
      if (candidate.op !== 'section.replace') return [];
      const ref = candidate.ref;
      if (!ref || typeof ref !== 'object') return [];
      const identity = ref as Record<string, unknown>;
      let targetsMaterializedRoot =
        identity.refType === 'existing' && identity.id === taskId;
      if (root?.refType === 'temporary') {
        targetsMaterializedRoot =
          typeof root.tempId === 'string' &&
          identity.refType === 'temporary' &&
          identity.tempId === root.tempId;
      } else if (root?.refType === 'existing') {
        targetsMaterializedRoot =
          root.id === taskId &&
          identity.refType === 'existing' &&
          identity.id === taskId;
      }
      return targetsMaterializedRoot
        ? this.visualMockupContext(candidate.key, candidate.content)
        : [];
    });
  }

  private visualMockupContext(
    key: unknown,
    content: unknown,
  ): Array<{ key: string; context: string }> {
    const structured = this.structuredMockupContext(key, content);
    return structured.length > 0
      ? structured
      : this.htmlCssMockupContext(key, content);
  }

  private htmlCssMockupContext(
    key: unknown,
    content: unknown,
  ): Array<{ key: string; context: string }> {
    if (typeof key !== 'string') return [];
    let decoded = content;
    if (typeof content === 'string') {
      try {
        decoded = JSON.parse(content) as unknown;
      } catch {
        return [];
      }
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return [];
    }
    const document = decoded as Record<string, unknown>;
    if (typeof document.html !== 'string' || typeof document.css !== 'string') {
      return [];
    }
    return [
      {
        key,
        context: JSON.stringify({
          html: document.html,
          css: document.css,
          sizeKey: document.sizeKey ?? null,
        }),
      },
    ];
  }

  private structuredMockupContext(
    key: unknown,
    content: unknown,
  ): Array<{ key: string; context: string }> {
    if (typeof key !== 'string') return [];
    let decoded = content;
    if (typeof content === 'string') {
      try {
        decoded = JSON.parse(content) as unknown;
      } catch {
        return [];
      }
    }
    if (!decoded || typeof decoded !== 'object') return [];
    const document = decoded as Record<string, unknown>;
    if (
      document.schemaVersion !== 'work-item-structured-mockup.v3' &&
      document.schemaVersion !== 'work-item-structured-mockup.v4' &&
      document.schemaVersion !== 'work-item-structured-mockup.v5'
    )
      return [];
    return [
      {
        key,
        context: JSON.stringify({
          content: document.content,
          sizeKey: document.sizeKey ?? null,
        }),
      },
    ];
  }

  /**
   * Resolve the section map for a set of tasks about to be returned to a
   * caller. Three modes, selected by `includeSectionKeys`:
   *   - the {@link ALL_DECLARED_SECTIONS} sentinel → each task surfaces its full
   *     declared section set, resolved per its OWN type + project. The default
   *     for single-item and full reads; this is what lets custom, per-project
   *     section keys round-trip.
   *   - a non-empty literal key list → restrict to exactly those keys (e.g. a
   *     list view asking for `description` only). Named custom keys still
   *     resolve, since the filter is on the keys the caller supplied.
   *   - undefined / empty → no sections loaded.
   */
  private async resolveTaskSectionsMap(
    tasks: TaskWithCountsAndRelations[],
    includeSectionKeys: string[] | undefined,
  ): Promise<Map<string, MaterializedWorkItemSection[]>> {
    if (includeSectionKeys === ALL_DECLARED_SECTIONS) {
      return this.loadDeclaredTaskSectionsMap(tasks);
    }
    if (includeSectionKeys && includeSectionKeys.length > 0) {
      return this.loadTaskSectionsMap(
        tasks.map((task) => task.id),
        includeSectionKeys,
      );
    }
    return new Map<string, MaterializedWorkItemSection[]>();
  }

  /**
   * Load each task's declared sections, resolved per the task's OWN type +
   * project via the work-item type registry rather than a hardcoded built-in
   * key set. Custom, per-project section keys round-trip; a key the type no
   * longer declares is excluded. Mirrors the per-type resolution already used
   * by {@link loadTaskEventContentSnapshot}.
   */
  private async loadDeclaredTaskSectionsMap(
    tasks: TaskWithCountsAndRelations[],
  ): Promise<Map<string, MaterializedWorkItemSection[]>> {
    if (tasks.length === 0) {
      return new Map();
    }

    const declaredByTaskId = new Map<string, Set<string>>();
    const unionKeys = new Set<string>();
    for (const task of tasks) {
      const declared = this.getSectionFieldsForTaskType(
        this.resolveTaskType(task.type),
        task.projectId,
      );
      declaredByTaskId.set(task.id, new Set(declared));
      for (const key of declared) {
        unionKeys.add(key);
      }
    }

    // No type in this batch declares any section — nothing to load.
    if (unionKeys.size === 0) {
      return new Map(tasks.map((task) => [task.id, []]));
    }

    // One query over the union of declared keys, then constrain each task to
    // the keys ITS OWN type declares (the union may carry another task type's
    // keys). Per-task rows already arrive ordered by the declared sequence.
    const loaded = await this.loadTaskSectionsMap(
      tasks.map((task) => task.id),
      Array.from(unionKeys),
    );

    const result = new Map<string, MaterializedWorkItemSection[]>();
    for (const task of tasks) {
      const declared = declaredByTaskId.get(task.id) ?? new Set<string>();
      result.set(
        task.id,
        (loaded.get(task.id) ?? []).filter((section) =>
          declared.has(section.key),
        ),
      );
    }
    return result;
  }

  private async mapTasksWithChildCounts(
    tasks: TaskWithCountsAndRelations[],
    organizationId: OrganizationId,
    initiativeId: InitiativeId | null | undefined,
    designDocCountsMap?: Map<string, number>,
    agentSessionCountsMap?: Map<string, AgentSessionCounts>,
    includeSectionKeys?: string[],
    edgesMap?: Map<string, AgentEdge[]>,
    trackedRowsByGoal?: Map<string, TrackedTaskRow[]>,
    trackedProjections: TrackedGoalProjections = DEFAULT_TRACKED_GOAL_PROJECTIONS,
  ): Promise<TaskResponseDto[]> {
    if (!tasks.length) {
      return [];
    }

    const countsMap = await this.buildChildCountsMap(
      organizationId,
      initiativeId,
      tasks.map((task) => task.id),
    );
    const sectionsByTaskId = await this.resolveTaskSectionsMap(
      tasks,
      includeSectionKeys,
    );

    const now = new Date();
    const responses = tasks.map((task) => {
      const tracked = this.toTrackedGoalFields(
        task,
        trackedRowsByGoal,
        trackedProjections,
        now,
      );
      return this.toTaskResponse(
        task,
        countsMap.get(task.id),
        designDocCountsMap?.get(task.id),
        agentSessionCountsMap?.get(task.id),
        sectionsByTaskId.get(task.id),
        this.mapServiceTaskRelations(task),
        edgesMap ? (edgesMap.get(task.id) ?? []) : undefined,
        tracked.trackedEntities,
        tracked.trackedWorkSummary,
      );
    });
    return responses;
  }

  private async loadActiveParentTask(
    organizationId: OrganizationId,
    parentTaskId: TaskId,
    db: { task: { findFirst: (...args: any[]) => any } } = this.prisma.db,
    projectId?: ProjectId,
  ): Promise<{ id: string; type: string }> {
    const parentTask = await db.task.findFirst({
      where: {
        id: parentTaskId,
        organizationId,
        archivedAt: null,
        ...(projectId
          ? { projectId, status: { not: WorkStatus.ARCHIVED } }
          : {}),
      },
      select: { id: true, type: true },
    });

    if (!parentTask) {
      throw new NotFoundException(
        `Parent task with ID ${parentTaskId} not found in this organization.`,
      );
    }

    return parentTask;
  }

  private validateParentTaskPlacement(
    parentTask: { type: string },
    movingTaskType: WorkItemTypeKey,
    projectId: ProjectId,
  ): void {
    this.workItemParentageValidator.assertValid({
      childType: movingTaskType,
      parentEntityType: EntityType.Task,
      parentType: parentTask.type,
      projectId,
    });
  }

  private async validateParentTaskOwnership(
    organizationId: OrganizationId,
    parentTaskId: TaskId,
    movingTaskType: WorkItemTypeKey,
    projectId: ProjectId,
    db: { task: { findFirst: (...args: any[]) => any } } = this.prisma.db,
  ): Promise<void> {
    const parentTask = await this.loadActiveParentTask(
      organizationId,
      parentTaskId,
      db,
    );
    this.validateParentTaskPlacement(parentTask, movingTaskType, projectId);
  }

  private async mapMixedInitiativeTasksWithChildCounts(
    tasks: TaskWithCountsAndRelations[],
    organizationId: OrganizationId,
    designDocCountsMap?: Map<string, number>,
    agentSessionCountsMap?: Map<string, AgentSessionCounts>,
    includeSectionKeys?: string[],
    edgesMap?: Map<string, AgentEdge[]>,
    trackedRowsByGoal?: Map<string, TrackedTaskRow[]>,
    trackedProjections: TrackedGoalProjections = DEFAULT_TRACKED_GOAL_PROJECTIONS,
  ): Promise<TaskResponseDto[]> {
    if (!tasks.length) {
      return [];
    }

    const grouped = new Map<string | null, TaskEntity[]>();
    for (const task of tasks) {
      const group = grouped.get(task.initiativeId) ?? [];
      group.push(task);
      grouped.set(task.initiativeId, group);
    }

    const initiativeCounts = new Map<string | null, Map<string, ChildCounts>>();

    await Promise.all(
      Array.from(grouped.entries()).map(async ([initiativeId, groupTasks]) => {
        const counts = await this.buildChildCountsMap(
          organizationId,
          initiativeId as InitiativeId | null,
          groupTasks.map((task) => task.id),
        );
        initiativeCounts.set(initiativeId, counts);
      }),
    );

    const sectionsByTaskId = await this.resolveTaskSectionsMap(
      tasks,
      includeSectionKeys,
    );

    const now = new Date();
    return tasks.map((task) => {
      const counts =
        initiativeCounts.get(task.initiativeId)?.get(task.id) ??
        this.createEmptyChildCounts();
      const tracked = this.toTrackedGoalFields(
        task,
        trackedRowsByGoal,
        trackedProjections,
        now,
      );
      return this.toTaskResponse(
        task,
        counts,
        designDocCountsMap?.get(task.id),
        agentSessionCountsMap?.get(task.id),
        sectionsByTaskId.get(task.id),
        this.mapServiceTaskRelations(task),
        edgesMap ? (edgesMap.get(task.id) ?? []) : undefined,
        tracked.trackedEntities,
        tracked.trackedWorkSummary,
      );
    });
  }

  @WithEventContext('TaskService')
  async create(
    organizationId: OrganizationId,
    initiativeId: InitiativeId | undefined,
    createTaskDto: CreateTaskDto,
    projectId: ProjectId,
  ): Promise<TaskResponseDto> {
    // Set up event context with business data
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = organizationId;
      currentContext.metadata = {
        ...currentContext.metadata,
        initiativeId,
      };
    }

    // Create task and publish event in transaction
    const task = await this.prisma.$transaction(async (tx) => {
      return this.createInTransaction(
        tx,
        organizationId,
        initiativeId ?? null,
        createTaskDto,
        projectId,
      );
    });

    // FEATURE tasks have no initiative — skip artifact storage and return directly
    if (!initiativeId) {
      const [response] = await this.mapTasksWithChildCounts(
        [task],
        organizationId,
        null,
        undefined,
        undefined,
        ALL_DECLARED_SECTIONS,
      );
      if (!response) {
        throw new NotFoundException(`Task with ID ${task.id} not found.`);
      }
      return response;
    }

    // Derive values needed for post-transaction work without re-querying
    const taskType = this.resolveTaskType(createTaskDto.type);
    const sectionValues = this.buildTaskSectionContentMap(
      projectId,
      createTaskDto.sections,
      taskType,
    );

    // Store original task data for change detection — only when there's
    // meaningful content to use as a baseline for diffing user edits.
    const hasDescription = Boolean(sectionValues.description?.trim());
    if (hasDescription) {
      try {
        const originalData: TaskOriginalData = {
          type: ArtifactType.TaskOriginal,
          taskType: toTaskOriginalArtifactTaskType(taskType),
          name: task.name,
          description: sectionValues.description ?? '',
          acceptanceCriteria: this.workItemTypeRegistry.isSectionAllowed(
            taskType,
            TaskSectionKey.AcceptanceCriteria,
            projectId,
          )
            ? (sectionValues.acceptanceCriteria ?? '')
            : undefined,
          priority: this.normalizeOriginalPriority(createTaskDto.priority),
          estimatedEffort: undefined,
          tags: [] as string[],
          reasoning: undefined,
        };

        await this.taskArtifactService.storeOriginalGeneration(
          [originalData],
          [{ id: task.id as TaskId }],
          organizationId,
          projectId,
          {
            sourceId: task.id,
            generationModel: 'manual-creation',
            generationPrompt: 'user-created-task',
            influences: [],
          },
        );

        this.logger.debug(
          '[create] Stored TASK_ORIGINAL artifact for manually created task',
          {
            taskId: task.id,
            organizationId,
            initiativeId,
          },
        );
      } catch (error) {
        this.logger.error('[create] Failed to store TASK_ORIGINAL artifact', {
          error: error instanceof Error ? error.message : error,
          taskId: task.id,
          organizationId,
          initiativeId,
        });
      }
    }

    const [response] = await this.mapTasksWithChildCounts(
      [task],
      organizationId,
      initiativeId,
      undefined,
      undefined,
      ALL_DECLARED_SECTIONS,
    );
    if (!response) {
      throw new NotFoundException(`Task with ID ${task.id} not found.`);
    }
    return response;
  }

  /**
   * Core task-creation logic that runs inside an existing Prisma transaction.
   *
   * Performs the same validation and entity creation as {@link create} but
   * within the caller's transaction.  Use this when task creation must be
   * atomic with other operations (e.g. proposal approval).
   */
  async createInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    initiativeId: InitiativeId | null,
    createTaskDto: CreateTaskDto,
    explicitProjectId?: ProjectId,
    explicitTaskId?: TaskId,
    materializationId?: string,
  ): Promise<TaskEntity> {
    let projectId: ProjectId | null = explicitProjectId ?? null;

    if (initiativeId) {
      const initiative = await tx.initiative.findFirst({
        where: { id: initiativeId, organizationId },
        select: { id: true, originatingProjectId: true },
      });

      if (!initiative) {
        throw new NotFoundException(
          `Initiative with ID ${initiativeId} not found in this organization.`,
        );
      }

      if (!initiative.originatingProjectId) {
        throw new BadRequestException(
          `Initiative ${initiativeId} is missing originating project data.`,
        );
      }

      if (
        explicitProjectId &&
        initiative.originatingProjectId !== explicitProjectId
      ) {
        throw new BadRequestException(
          `Initiative ${initiativeId} belongs to project ${initiative.originatingProjectId}, not ${explicitProjectId}.`,
        );
      }

      projectId = initiative.originatingProjectId as ProjectId;
    }

    const parentTaskId = (createTaskDto.parentTaskId ?? null) as TaskId | null;

    const taskType = this.resolveTaskType(createTaskDto.type);

    // Fetch the parent (if any) so it can supply the project scope when no
    // explicit/initiative project was given — every per-type rule check below
    // resolves the type's rules in the task's project, so projectId must be
    // settled before any of them run. Its existence is validated AFTER the
    // top-level rule below, so a top-level-only type given a parentTaskId fails
    // as "must be top-level" rather than "parent not found".
    const parentTask = parentTaskId
      ? await tx.task.findFirst({
          where: {
            id: parentTaskId,
            organizationId,
            archivedAt: null,
            ...(taskType === WORK_ITEM_TYPE_KEYS.Diagram ||
            taskType === WORK_ITEM_TYPE_KEYS.DiagramElement
              ? { status: { not: WorkStatus.ARCHIVED } }
              : {}),
          },
          select: { id: true, type: true, projectId: true },
        })
      : null;
    if (!projectId && parentTask?.projectId) {
      projectId = parentTask.projectId as ProjectId;
    }
    if (!projectId) {
      throw new BadRequestException('projectId is required to create a task.');
    }
    await this.assertWorkItemWriteAllowed(
      tx,
      organizationId,
      projectId,
      [explicitTaskId, parentTaskId].filter((id): id is TaskId => !!id),
      materializationId,
    );

    // Reject an unrecognized work-item type — before deriving sections/scalars
    // — so callers get a message naming the project's valid types instead of
    // resolveTaskType's silent coercion to STANDARD or a downstream registry
    // snapshot-miss. Gated here, after projectId is settled (it can derive from
    // the parent), so the check fires in every project-resolution path: a
    // provided-but-unknown/archived custom key throws regardless of where the
    // project came from. An omitted type defaults to STANDARD and is untouched;
    // the four built-in system types are always active, so this is
    // behavior-preserving for them.
    if (createTaskDto.type != null) {
      this.workItemTypeRegistry.assertTypeActive(createTaskDto.type, projectId);
    }
    const config = validateWorkItemConfigForType(
      createTaskDto.config,
      this.workItemTypeRegistry.getAcceptedConfigKinds(taskType, projectId),
      taskType,
    );
    await this.assertWorkItemWriteAllowed(
      tx,
      organizationId,
      projectId,
      [],
      undefined,
      taskType,
    );
    if (
      this.workItemTypeRegistry.isScalarRequired(
        taskType,
        'dueDate',
        projectId,
      ) &&
      this.isMissingDueDate(createTaskDto.dueDate)
    ) {
      throw new BadRequestException('GOAL tasks require a dueDate.');
    }
    if (
      this.workItemTypeRegistry.isScalarRequired(taskType, 'tag', projectId) &&
      createTaskDto.tag === undefined
    ) {
      throw new BadRequestException(
        'FEATURE tasks require a tag (one of: product, frontend, backend, infra, design, AI).',
      );
    }
    if (
      createTaskDto.tag !== undefined &&
      this.workItemTypeRegistry.isScalarForbidden(taskType, 'tag', projectId)
    ) {
      throw new BadRequestException(
        `tag is only valid on FEATURE tasks (got ${taskType}).`,
      );
    }

    if (parentTaskId && !parentTask) {
      throw new NotFoundException(
        `Parent task with ID ${parentTaskId} not found in this organization.`,
      );
    }
    if (
      (taskType === WORK_ITEM_TYPE_KEYS.Diagram ||
        taskType === WORK_ITEM_TYPE_KEYS.DiagramElement) &&
      parentTask &&
      parentTask.projectId !== projectId
    ) {
      throw new BadRequestException(
        'Diagram parent must belong to the same project.',
      );
    }
    this.workItemParentageValidator.assertValid({
      childType: taskType,
      parentEntityType: parentTask ? EntityType.Task : null,
      parentType: parentTask?.type ?? null,
      projectId,
    });

    const createSections = withDiagramDefaults(
      taskType,
      await this.sectionsForTaskCreate(taskType, createTaskDto, {
        organizationId,
        db: tx,
      }),
    );
    await validateDiagramSections({
      db: tx,
      organizationId,
      projectId,
      type: taskType,
      sections: createSections,
      definitions: this.workItemTypeRegistry.getSectionDefinitions(
        taskType,
        projectId,
      ),
    });
    const createGroupsKey = this.graphGroupsSectionKey(taskType, projectId);
    const createdGroups = createGroupsKey
      ? createSections.find((section) => section.key === createGroupsKey)
          ?.content
      : undefined;
    if (createdGroups) {
      const parsed = parseDiagramGroupsContent(createdGroups);
      // A Diagram has no elements before it exists, so no member can resolve.
      const issues = parsed.success
        ? validateDiagramGroups(parsed.value, new Set())
        : [];
      if (!parsed.success || issues.length > 0) {
        throw new BadRequestException(
          `Invalid Diagram groups: ${parsed.success ? formatDiagramGroupsIssues(issues) : parsed.message}`,
        );
      }
    }
    const sectionValues = this.buildTaskSectionContentMap(
      projectId,
      createSections,
      taskType,
    );
    if (
      taskType === WORK_ITEM_TYPE_KEYS.Feature &&
      this.workItemTypeRegistry.isSectionAllowed(
        taskType,
        TaskSectionKey.Requirements,
        projectId,
      ) &&
      sectionValues.requirements === undefined
    ) {
      sectionValues.requirements = EMPTY_FEATURE_REQUIREMENTS_CONTENT;
    }
    if (
      taskType === WORK_ITEM_TYPE_KEYS.Feature &&
      sectionValues.requirements !== undefined &&
      sectionValues.requirements !== EMPTY_FEATURE_REQUIREMENTS_CONTENT
    ) {
      await this.assertFeatureRequirementSection(
        tx,
        organizationId,
        projectId,
        sectionValues.requirements,
        'sections[requirements]',
        explicitTaskId,
        parentTaskId ?? undefined,
      );
    }
    const contentSnapshot = buildTaskEventContentSnapshot({
      type: taskType,
      tag:
        taskType === WORK_ITEM_TYPE_KEYS.Feature
          ? createTaskDto.tag
          : undefined,
      description: sectionValues.description ?? '',
      acceptanceCriteria: this.workItemTypeRegistry.isSectionAllowed(
        taskType,
        TaskSectionKey.AcceptanceCriteria,
        projectId,
      )
        ? (sectionValues.acceptanceCriteria ?? '')
        : undefined,
      requirements: this.workItemTypeRegistry.isSectionAllowed(
        taskType,
        TaskSectionKey.Requirements,
        projectId,
      )
        ? (sectionValues.requirements ?? '')
        : undefined,
    });
    const sectionCreatePayload = this.buildTaskSectionCreatePayload(
      sectionValues,
      taskType,
      projectId,
    );
    contentSnapshot.sections = sectionCreatePayload;

    const createdTask = await tx.task.create({
      data: {
        ...(explicitTaskId ? { id: explicitTaskId } : {}),
        name: createTaskDto.name,
        status: this.resolveInitialStatus(
          taskType,
          createTaskDto.status,
          projectId,
        ),
        source:
          (createTaskDto.source as TaskSource | undefined) ?? TaskSource.system,
        priority: createTaskDto.priority ?? Priority.MEDIUM,
        dueDate: createTaskDto.dueDate
          ? new Date(createTaskDto.dueDate)
          : undefined,
        assigneeId: createTaskDto.assigneeId ?? undefined,
        parentTaskId,
        type: taskType,
        tag:
          taskType === WORK_ITEM_TYPE_KEYS.Feature
            ? createTaskDto.tag
            : undefined,
        config: config ?? Prisma.DbNull,
        initiativeId: initiativeId ?? undefined,
        organizationId,
        projectId,
        sections: {
          create: sectionCreatePayload,
        },
      },
    });

    this.logger.debug('[createInTransaction] task created', {
      taskId: createdTask.id,
      type: taskType,
      tag: createdTask.tag ?? null,
      organizationId,
      projectId,
    });

    if (createTaskDto.serviceId) {
      await tx.serviceTask.create({
        data: {
          serviceId: createTaskDto.serviceId,
          taskId: createdTask.id,
        },
      });
    }

    await this.publishTaskCreatedEvent(tx, {
      task: createdTask,
      content: contentSnapshot,
      organizationId,
      initiativeId,
      projectId,
    });

    await this.rollUpCanonicalPlanHierarchy(
      tx,
      createdTask.id as TaskId,
      undefined,
    );

    return createdTask;
  }

  /**
   * Create multiple tasks from draft specifications
   * Similar to InitiativeService.createFromDrafts pattern
   *
   * @param drafts - Array of task drafts from LLM
   * @param organizationId - Organization ID
   * @param initiativeId - Parent initiative ID
   * @param sourceConversationId - Optional conversation that triggered creation
   * @returns Array of created task DTOs
   */
  @WithEventContext('TaskService')
  async createFromDrafts(
    drafts: TaskDraft[],
    organizationId: OrganizationId,
    initiativeId?: InitiativeId,
    sourceConversationId?: ConversationId,
    artifactContext?: {
      projectId?: ProjectId;
      generationModel?: string;
      generationPrompt?: string;
    },
  ): Promise<TaskResponseDto[]> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    this.logger.log('[createFromDrafts] Creating tasks from drafts', {
      draftCount: drafts.length,
      organizationId,
      initiativeId,
      sourceConversationId,
      correlationId: currentContext?.correlationId,
    });

    // Validation
    if (!drafts || drafts.length === 0) {
      throw new BadRequestException('Task drafts array cannot be empty');
    }
    if (!organizationId) {
      throw new BadRequestException('Organization ID is required');
    }

    let projectId: ProjectId | undefined = artifactContext?.projectId;

    // If initiativeId provided, verify it exists and resolve projectId from it
    if (initiativeId) {
      const initiative = await this.prisma.db.initiative.findFirst({
        where: {
          id: initiativeId,
          organizationId,
        },
      });

      if (!initiative) {
        throw new NotFoundException(
          `Initiative ${initiativeId} not found in organization ${organizationId}. ` +
            `Ensure the initiative exists and user has access.`,
        );
      }

      if (!initiative.originatingProjectId) {
        throw new BadRequestException(
          `Initiative ${initiativeId} is missing originating project data.`,
        );
      }

      projectId = initiative.originatingProjectId as ProjectId;
    }

    if (!projectId) {
      throw new BadRequestException(
        'Project ID is required — provide an initiativeId or artifactContext.projectId.',
      );
    }

    const createdTasks: TaskEntity[] = [];
    const originalDataForArtifacts: TaskOriginalData[] = [];

    // Create each task
    for (const draft of drafts) {
      try {
        const priority = this.mapDraftPriorityToPrisma(draft.priority);
        // Reject an unrecognized work-item type before it is persisted — now
        // that resolveTaskType preserves provided keys verbatim, an
        // LLM-hallucinated type would otherwise be written as-is. Gating
        // against the resolved project scope yields the same named-types error
        // as the create/re-parent paths instead of the registry snapshot-miss
        // throw that would surface downstream at getSections.
        if (draft.taskType != null) {
          this.workItemTypeRegistry.assertTypeActive(draft.taskType, projectId);
        }
        const taskType = this.resolveTaskType(draft.taskType);

        const task = await this.prisma.db.$transaction(async (tx) => {
          await this.assertWorkItemWriteAllowed(
            tx as unknown as Prisma.TransactionClient,
            organizationId,
            projectId,
            draft.parentTaskId ? [draft.parentTaskId] : [],
          );
          await this.assertWorkItemWriteAllowed(
            tx as unknown as Prisma.TransactionClient,
            organizationId,
            projectId,
            [],
            undefined,
            taskType,
          );
          return tx.task.create({
            data: {
              name: draft.title, // LLM 'title' maps to DB 'name'
              organizationId,
              projectId,
              initiativeId: initiativeId ?? undefined,
              status: WorkStatus.GENERATED, // AI generated, pending user acceptance
              source: TaskSource.system,
              priority,
              type: taskType,
              reasoning: draft.reasoning,
              parentTaskId: draft.parentTaskId,
              generationMetadata: {
                estimatedEffort: draft.estimatedEffort,
                influences: draft.influences || [],
                category: draft.category,
              },
              sourceConversationId,
              creatorId: 'system',
              sections: {
                create: this.buildTaskSectionCreatePayload(
                  {
                    description: draft.description,
                    requirements: this.workItemTypeRegistry.isSectionAllowed(
                      taskType,
                      TaskSectionKey.Requirements,
                      projectId,
                    )
                      ? EMPTY_FEATURE_REQUIREMENTS_CONTENT
                      : undefined,
                    acceptanceCriteria:
                      this.workItemTypeRegistry.isSectionAllowed(
                        taskType,
                        TaskSectionKey.AcceptanceCriteria,
                        projectId,
                      )
                        ? draft.acceptanceCriteria
                        : undefined,
                  },
                  taskType,
                  projectId,
                ),
              },
              // Optional fields: assigneeId, creatorId, dueDate can be null
            },
          });
        });

        this.logger.debug('[createFromDrafts] Created task', {
          taskId: task.id,
          name: task.name,
          status: task.status,
          priority: task.priority,
        });

        originalDataForArtifacts.push({
          type: 'TASK_ORIGINAL',
          taskType: toTaskOriginalArtifactTaskType(taskType),
          name: draft.title,
          description: draft.description ?? '',
          acceptanceCriteria: this.workItemTypeRegistry.isSectionAllowed(
            taskType,
            TaskSectionKey.AcceptanceCriteria,
            projectId,
          )
            ? (draft.acceptanceCriteria ?? '')
            : undefined,
          priority: this.normalizeOriginalPriority(draft.priority),
          estimatedEffort: this.normalizeEstimatedEffort(draft.estimatedEffort),
          tags: [] as string[],
          reasoning: draft.reasoning,
        });

        createdTasks.push(task);

        await this.publishTaskCreatedEventOutOfTransaction({
          task,
          content: buildTaskEventContentSnapshot({
            type: taskType,
            description: draft.description,
            acceptanceCriteria: this.workItemTypeRegistry.isSectionAllowed(
              taskType,
              TaskSectionKey.AcceptanceCriteria,
              projectId,
            )
              ? (draft.acceptanceCriteria ?? '')
              : undefined,
            requirements: this.workItemTypeRegistry.isSectionAllowed(
              taskType,
              TaskSectionKey.Requirements,
              projectId,
            )
              ? EMPTY_FEATURE_REQUIREMENTS_CONTENT
              : undefined,
          }),
          organizationId,
          initiativeId: initiativeId ?? null,
          projectId,
        });
      } catch (error) {
        this.logger.error('[createFromDrafts] Failed to create task', {
          error: error instanceof Error ? error.message : error,
          draft,
        });
        throw error; // Re-throw to fail entire operation
      }
    }

    // Store original artifacts for change detection
    try {
      await this.taskArtifactService.storeOriginalGeneration(
        originalDataForArtifacts,
        createdTasks.map((task) => ({ id: task.id as TaskId })),
        organizationId,
        projectId,
        {
          sourceId: sourceConversationId,
          generationModel:
            artifactContext?.generationModel ?? 'task-generation',
          generationPrompt:
            artifactContext?.generationPrompt ?? 'task-generation',
          influences: drafts.flatMap((draft) => draft.influences || []),
        },
      );

      this.logger.debug(
        '[createFromDrafts] Stored TASK_ORIGINAL artifacts for generated tasks',
        {
          taskCount: createdTasks.length,
          organizationId,
          initiativeId,
        },
      );
    } catch (error) {
      this.logger.error(
        '[createFromDrafts] Failed to store TASK_ORIGINAL artifacts',
        {
          error: error instanceof Error ? error.message : error,
          organizationId,
          initiativeId,
        },
      );
      // Do not throw - artifact creation should not block task creation
    }

    this.logger.log('[createFromDrafts] Tasks created successfully', {
      taskCount: createdTasks.length,
      organizationId,
      initiativeId,
      correlationId: currentContext?.correlationId,
    });

    return this.mapTasksWithChildCounts(
      createdTasks,
      organizationId,
      initiativeId,
      undefined,
      undefined,
      ALL_DECLARED_SECTIONS,
    );
  }

  /**
   * Map draft priority string to Prisma Priority enum
   * Defaults to MEDIUM if priority is unknown
   */
  private mapDraftPriorityToPrisma(priority?: string): Priority {
    switch (priority?.toLowerCase()) {
      case 'low':
        return Priority.LOW;
      case 'high':
        return Priority.HIGH;
      case 'medium':
      default:
        return Priority.MEDIUM;
    }
  }

  private normalizeOriginalPriority(
    priority?: string | null,
  ): TaskOriginalArtifactData.PriorityEnum {
    switch (priority?.toString().toLowerCase()) {
      case 'low':
        return TaskOriginalArtifactData.PriorityEnum.Low;
      case 'high':
        return TaskOriginalArtifactData.PriorityEnum.High;
      case 'critical':
        return TaskOriginalArtifactData.PriorityEnum.Critical;
      case 'medium':
      default:
        return TaskOriginalArtifactData.PriorityEnum.Medium;
    }
  }

  private normalizeEstimatedEffort(
    effort?: string | null,
  ): TaskOriginalArtifactData.EstimatedEffortEnum | undefined {
    switch (effort?.toString().toLowerCase()) {
      case 'small':
        return TaskOriginalArtifactData.EstimatedEffortEnum.Small;
      case 'medium':
        return TaskOriginalArtifactData.EstimatedEffortEnum.Medium;
      case 'large':
        return TaskOriginalArtifactData.EstimatedEffortEnum.Large;
      default:
        return undefined;
    }
  }

  /**
   * Create artifact when task transitions from GENERATED → initial refining status.
   * STANDARD tasks go to REFINING_ACCEPTANCE_CRITERIA, FEATURE/BUG to REFINING_DESCRIPTION.
   * Uses stored generationMetadata to build artifact.
   */
  private async createArtifactOnAcceptance(
    task: {
      id: string;
      name: string;
      type: WorkItemTypeKey;
      priority: Priority | null;
      reasoning: string | null;
      generationMetadata: unknown;
      sourceConversationId: string | null;
    },
    organizationId: OrganizationId,
    projectId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    this.logger.debug(
      '[createArtifactOnAcceptance] Creating artifact for accepted task',
      {
        taskId: task.id,
        organizationId,
      },
    );

    const metadata = task.generationMetadata as {
      estimatedEffort?: string;
      influences?: Array<{
        entityType: string;
        entityId: string;
        reasoning: string;
        reasonType: string;
        confidence?: number;
      }>;
      category?: string;
    } | null;

    const sectionsByTaskId = await this.loadTaskSectionsMap([task.id]);
    const sectionContent = extractTaskSectionContent(
      sectionsByTaskId.get(task.id),
    );
    const originalData: TaskOriginalData = {
      type: ArtifactType.TaskOriginal,
      taskType: toTaskOriginalArtifactTaskType(task.type),
      name: task.name,
      description: sectionContent.description ?? '',
      acceptanceCriteria: this.workItemTypeRegistry.isSectionAllowed(
        task.type,
        TaskSectionKey.AcceptanceCriteria,
        projectId,
      )
        ? (sectionContent.acceptanceCriteria ?? '')
        : undefined,
      priority: this.normalizeOriginalPriority(task.priority),
      estimatedEffort: this.normalizeEstimatedEffort(
        metadata?.estimatedEffort || undefined,
      ),
      tags: [] as string[],
      reasoning: task.reasoning ?? undefined,
    };

    try {
      await this.taskArtifactService.storeOriginalGeneration(
        [originalData],
        [{ id: task.id as TaskId }],
        organizationId,
        undefined,
        {
          sourceId: task.sourceConversationId || undefined,
          generationModel: 'unknown',
          generationPrompt: 'task-generation',
          influences: (metadata?.influences || []).map((inf) => ({
            entityId: inf.entityId,
            entityType: (inf.entityType?.toUpperCase() ??
              'ARTIFACT') as Influence['entityType'],
            reasoning: inf.reasoning,
            reasonType: inf.reasonType,
            confidence: inf.confidence,
          })),
        },
      );

      this.logger.debug(
        '[createArtifactOnAcceptance] Artifact created successfully',
        {
          taskId: task.id,
        },
      );
    } catch (error) {
      // Log but don't fail the status transition - artifacts can be recreated
      this.logger.error(
        '[createArtifactOnAcceptance] Failed to create artifact',
        {
          error: error instanceof Error ? error.message : error,
          taskId: task.id,
        },
      );
    }
  }

  async findReferences(
    organizationId: OrganizationId,
    projectId: ProjectId,
    type: string,
    page: number,
    limit: number,
    filter?: string,
    statuses?: WorkStatus[],
    sortBy: 'name' | 'createdAt' = 'name',
    sortOrder: 'asc' | 'desc' = 'asc',
  ): Promise<PaginatedWorkItemReferenceResponseDto> {
    const normalizedFilter = filter?.trim();
    const where: Prisma.TaskWhereInput = {
      organizationId,
      projectId,
      type,
      archivedAt: null,
      status: {
        not: WorkStatus.ARCHIVED,
        ...(statuses && statuses.length > 0 ? { in: statuses } : {}),
      },
      ...(normalizedFilter
        ? { name: { contains: normalizedFilter, mode: 'insensitive' } }
        : {}),
    };
    const skip = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      this.prisma.db.task.count({ where }),
      this.prisma.db.task.findMany({
        where,
        select: {
          id: true,
          name: true,
          type: true,
          parentTaskId: true,
        },
        orderBy:
          sortBy === 'createdAt'
            ? [{ createdAt: sortOrder }, { id: 'asc' }]
            : [{ name: sortOrder }, { id: 'asc' }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        parentTaskId: row.parentTaskId,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    } satisfies PaginatedWorkItemReferenceResponseDto;
  }

  async findAll(
    organizationId: OrganizationId,
    initiativeId: InitiativeId | null | undefined,
    filters?: {
      parentTaskId?: TaskId | null;
      parentTaskIds?: TaskId[];
      includeDescendants?: boolean;
      includeTrackedEntities?: boolean;
      includeTrackedWorkSummary?: boolean;
      projectId?: ProjectId;
      includeDesignDocCounts?: boolean;
      includeAgentSessionCounts?: boolean;
      includeServiceRelations?: boolean;
      includeEdges?: boolean;
      userToken?: string | null;
      edgeTypes?: RelationshipType[];
      relatedEntityId?: string;
      relatedEntityType?: AgentEdgeEndpointEntityType;
      statuses?: WorkStatus[];
      taskIds?: TaskId[];
      includeSectionKeys?: string[];
      taskType?: string;
      page?: number;
      limit?: number;
      sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'status' | 'priority';
      sortDir?: 'asc' | 'desc';
    },
  ): Promise<TaskResponseDto[]> {
    const trackedProjections: TrackedGoalProjections = {
      includeTrackedEntities: filters?.includeTrackedEntities !== false,
      includeTrackedWorkSummary: filters?.includeTrackedWorkSummary === true,
    };
    const requestedTaskIds = filters?.taskIds
      ? this.validateUuidFilterList('taskIds', filters.taskIds, 200)
      : undefined;
    const requestedParentTaskIds = filters?.parentTaskIds
      ? this.validateUuidFilterList('parentTaskIds', filters.parentTaskIds, 200)
      : undefined;
    const page = Math.max(filters?.page ?? 1, 1);
    const defaultLimit = Math.max(50, requestedTaskIds?.length ?? 0);
    const limit = Math.min(Math.max(filters?.limit ?? defaultLimit, 1), 500);
    const skip = (page - 1) * limit;
    const relatedTaskIds = await this.resolveRelatedTaskIds(
      organizationId,
      filters?.projectId,
      filters?.relatedEntityId,
      filters?.relatedEntityType,
      filters?.edgeTypes,
      filters?.userToken,
    );
    const candidateTaskIds = relatedTaskIds
      ? requestedTaskIds
        ? requestedTaskIds.filter((taskId) => relatedTaskIds.has(taskId))
        : [...relatedTaskIds]
      : requestedTaskIds;

    const where: Prisma.TaskWhereInput = {
      organizationId,
      archivedAt: null,
    };

    if (filters?.projectId) {
      where.projectId = filters.projectId;
    }
    if (initiativeId !== undefined) {
      where.initiativeId = initiativeId;
    }

    if (filters && 'parentTaskId' in filters) {
      const rootId = filters.parentTaskId;
      if (filters.includeDescendants && rootId != null && filters.projectId) {
        this.logger.debug(
          '[findAll] resolving feature subtree for includeDescendants',
          { organizationId, rootId, projectId: filters.projectId },
        );
        const subtreeIds = await this.resolveFeatureSubtreeIds(
          filters.projectId,
          rootId as string,
        );
        where.parentTaskId = { in: subtreeIds } as Prisma.StringNullableFilter;
      } else {
        where.parentTaskId = rootId ?? null;
      }
    }
    if (requestedParentTaskIds) {
      if ('parentTaskId' in (filters || {}) || filters?.includeDescendants) {
        throw new BadRequestException(
          'parentTaskIds is mutually exclusive with parentTaskId and includeDescendants.',
        );
      }
      where.parentTaskId = { in: requestedParentTaskIds };
    }

    if (filters?.statuses && filters.statuses.length > 0) {
      where.status = { in: filters.statuses };
    }

    if (candidateTaskIds) {
      where.id = { in: candidateTaskIds };
    }

    if (filters?.taskType) {
      where.type = filters.taskType;
    }

    const taskInclude = this.buildTaskInclude(organizationId, {
      includeDesignDocCounts: filters?.includeDesignDocCounts,
      includeServiceRelations: filters?.includeServiceRelations,
    });

    const sortBy = filters?.sortBy ?? 'createdAt';
    const sortDir = filters?.sortDir ?? 'desc';
    const prismaSortBy = sortBy === 'title' ? 'name' : sortBy;

    const findManyArgs: Prisma.TaskFindManyArgs = {
      where,
      orderBy: {
        [prismaSortBy]: sortDir,
      },
      skip,
      take: limit,
    };
    if (taskInclude) {
      findManyArgs.include = taskInclude;
    }

    const tasks = (await this.prisma.db.task.findMany(
      findManyArgs as any,
    )) as TaskWithCountsAndRelations[];

    const designDocCountsMap = filters?.includeDesignDocCounts
      ? await this.buildDesignDocCountsMapForTaskIds(
          organizationId,
          tasks.map((t) => t.id),
        )
      : undefined;
    const agentSessionCountsMap = filters?.includeAgentSessionCounts
      ? await this.buildAgentSessionCountsMap(
          organizationId,
          tasks.map((t) => t.id),
        )
      : undefined;
    const edgesMap =
      filters?.includeEdges && filters?.projectId
        ? await this.buildGraphGatedTaskEdgesMap(
            organizationId,
            filters.projectId,
            tasks,
            filters?.userToken ?? null,
            filters?.edgeTypes,
          )
        : undefined;
    const goalTaskIds =
      trackedProjections.includeTrackedEntities ||
      trackedProjections.includeTrackedWorkSummary
        ? tasks
            .filter((t) => t.type === WORK_ITEM_TYPE_KEYS.Goal)
            .map((t) => t.id)
        : [];
    const trackedRowsByGoal =
      goalTaskIds.length > 0 && filters?.projectId && filters?.userToken
        ? await this.loadTrackedTaskRowsByGoal(
            organizationId,
            filters.projectId,
            goalTaskIds,
            filters.userToken,
            trackedProjections,
          )
        : undefined;

    const responses = await this.mapTasksWithChildCounts(
      tasks,
      organizationId,
      initiativeId,
      designDocCountsMap,
      agentSessionCountsMap,
      filters?.includeSectionKeys,
      edgesMap,
      trackedRowsByGoal,
      trackedProjections,
    );
    return responses;
  }

  async findManyByIds(
    organizationId: OrganizationId,
    taskIds: TaskId[],
    includeSectionKeys?: string[],
  ): Promise<Map<TaskId, TaskResponseDto>> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const tasks = (await this.prisma.db.task.findMany({
      where: {
        id: { in: taskIds },
        organizationId,
        archivedAt: null,
      },
    })) as TaskEntity[];

    const sectionsByTaskId =
      includeSectionKeys && includeSectionKeys.length > 0
        ? await this.loadTaskSectionsMap(taskIds, includeSectionKeys)
        : new Map<string, MaterializedWorkItemSection[]>();

    const responses = new Map<TaskId, TaskResponseDto>();
    for (const task of tasks) {
      responses.set(
        task.id as TaskId,
        this.toTaskResponse(
          task,
          undefined,
          undefined,
          undefined,
          sectionsByTaskId.get(task.id),
        ),
      );
    }

    return responses;
  }

  async findOne(
    organizationId: OrganizationId,
    taskId: TaskId,
    includeDesignDocCounts?: boolean,
    includeAgentSessionCounts?: boolean,
    includeInitiative?: false,
    includeServiceRelations?: boolean,
    includeEdges?: boolean,
    userToken?: string | null,
    edgeTypes?: RelationshipType[],
  ): Promise<TaskResponseDto | null>;
  async findOne(
    organizationId: OrganizationId,
    taskId: TaskId,
    includeDesignDocCounts: boolean,
    includeAgentSessionCounts: boolean,
    includeInitiative: true,
    includeServiceRelations?: boolean,
    includeEdges?: boolean,
    userToken?: string | null,
    edgeTypes?: RelationshipType[],
  ): Promise<TaskResponseWithInitiative | null>;
  async findOne(
    organizationId: OrganizationId,
    taskId: TaskId,
    includeDesignDocCounts = false,
    includeAgentSessionCounts = false,
    includeInitiative = false,
    includeServiceRelations = false,
    includeEdges = false,
    userToken: string | null = null,
    edgeTypes?: RelationshipType[],
  ): Promise<TaskResponseDto | TaskResponseWithInitiative | null> {
    const task = (await this.findPersistedByOrganization(
      organizationId,
      taskId,
      includeDesignDocCounts,
      includeInitiative,
      includeServiceRelations,
    )) as TaskWithCountsAndInitiative | null;

    if (!task) {
      return null;
    }

    const taskInitiative = includeInitiative
      ? {
          originatingProjectId:
            (task.initiative?.originatingProjectId as ProjectId) ?? null,
        }
      : null;
    const { initiative: _initiative, ...taskForResponse } = task;

    const trackedRowsByGoal =
      task.type === WORK_ITEM_TYPE_KEYS.Goal && userToken
        ? await this.loadTrackedTaskRowsByGoal(
            organizationId,
            taskForResponse.projectId as ProjectId,
            [taskForResponse.id],
            userToken,
          )
        : undefined;
    const edgesMap =
      includeEdges && userToken
        ? await this.buildGraphGatedTaskEdgesMap(
            organizationId,
            taskForResponse.projectId as ProjectId,
            [taskForResponse],
            userToken,
            edgeTypes,
          )
        : undefined;

    const [response] = await this.mapTasksWithChildCounts(
      [taskForResponse],
      organizationId,
      task.initiativeId as InitiativeId,
      includeDesignDocCounts
        ? await this.buildDesignDocCountsMapForTaskIds(organizationId, [
            taskForResponse.id,
          ])
        : undefined,
      includeAgentSessionCounts
        ? await this.buildAgentSessionCountsMap(organizationId, [
            taskForResponse.id,
          ])
        : undefined,
      ALL_DECLARED_SECTIONS,
      edgesMap,
      trackedRowsByGoal,
    );
    if (!response) {
      return null;
    }

    if (includeInitiative) {
      Object.defineProperty(response, 'initiative', {
        value: taskInitiative,
        enumerable: false,
      });
    }

    return response;
  }

  async findPersistedByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
    includeDesignDocCounts = false,
    includeInitiative = false,
    includeServiceRelations = false,
  ): Promise<TaskEntity | null> {
    const taskInclude = this.buildTaskInclude(organizationId, {
      includeDesignDocCounts,
      includeInitiative,
      includeServiceRelations,
    });

    const findFirstArgs: Prisma.TaskFindFirstArgs = {
      where: {
        id: taskId,
        organizationId,
        archivedAt: null,
        status: { not: WorkStatus.ARCHIVED },
      },
    };
    if (taskInclude) {
      findFirstArgs.include = taskInclude;
    }

    return this.prisma.db.task.findFirst(findFirstArgs as any);
  }

  /** Read a mutation result, including a task archived by that mutation. */
  async findMutationResultByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<TaskResponseDto | null> {
    const task = await this.prisma.db.task.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) {
      return null;
    }

    const [response] = await this.mapTasksWithChildCounts(
      [task],
      organizationId,
      task.initiativeId as InitiativeId,
      undefined,
      undefined,
      ALL_DECLARED_SECTIONS,
    );
    return response ?? null;
  }

  async findOneByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
    includeDesignDocCounts = false,
    includeAgentSessionCounts = false,
    includeServiceRelations = false,
    includeEdges = false,
    userToken: string | null = null,
    edgeTypes?: RelationshipType[],
  ): Promise<TaskResponseDto | null> {
    return this.findOne(
      organizationId,
      taskId,
      includeDesignDocCounts,
      includeAgentSessionCounts,
      false,
      includeServiceRelations,
      includeEdges,
      userToken,
      edgeTypes,
    );
  }

  async getGraphAggregate(
    organizationId: OrganizationId,
    projectId: ProjectId,
    workItemId: TaskId,
    userToken: string | null,
    incidentRelationshipTypes: WorkItemGraphParticipationType[] = [],
  ): Promise<WorkItemGraphAggregateResponseDto> {
    if (!userToken) {
      throw new UnauthorizedException(
        'An authenticated user token is required for graph aggregate reads',
      );
    }

    const root = await this.findOneByOrganization(
      organizationId,
      workItemId,
      false,
      false,
      false,
      false,
      userToken,
    );
    if (!root || root.projectId !== projectId) {
      throw new NotFoundException('Work item not found');
    }

    const capability = this.workItemTypeRegistry.getGraphCapability(
      root.type,
      projectId,
    );
    if (!capability) {
      throw new BadRequestException(
        `Work-item type ${root.type} does not declare a graph capability`,
      );
    }

    const childRows = (await this.prisma.db.task.findMany({
      where: {
        organizationId,
        projectId,
        parentTaskId: root.id,
        type: capability.nodeChildType,
        archivedAt: null,
        status: { not: WorkStatus.ARCHIVED },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) as TaskWithCountsAndRelations[];
    const children = await this.mapMixedInitiativeTasksWithChildCounts(
      childRows,
      organizationId,
      undefined,
      undefined,
      ALL_DECLARED_SECTIONS,
    );

    const aggregateIds = [root.id, ...children.map((child) => child.id)];
    const readableTypes = [
      ...new Set(
        capability.readableRelationships.map(
          (relationship) => relationship.edgeType as RelationshipType,
        ),
      ),
    ];
    const graph = await this.graphsClient.readStructuredGraph(
      organizationId,
      projectId,
      {
        root: { entityId: root.id, entityType: 'TASK' },
        seeds: aggregateIds.map((entityId) => ({
          entityId,
          entityType: 'TASK',
        })),
        directEdgeTypes: readableTypes.map((type) => type as AgentEdgeType),
        expansions: (capability.readExpansions ?? []).map((expansion) => ({
          key: expansion.key,
          seeds: (expansion.seed === 'graphRoot' ? [root] : children).map(
            (item) => ({
              entityId: item.id,
              entityType: 'TASK',
            }),
          ),
          path: expansion.path.map((hop) => ({
            relationshipType: hop.relationshipType as RelationshipType,
            direction: hop.direction,
            entityTypes: hop.target.entityTypes,
            workItemTypeKeys: hop.target.workItemTypeKeys,
          })),
          excludeRoot: expansion.excludeRoot ?? false,
          limit: expansion.limit,
        })),
      },
      userToken,
    );
    const relationshipById = new Map(
      graph.directEdges.map((edge) => [edge.id, this.toApiAgentEdge(edge)]),
    );
    const layout = this.readGraphAggregateLayout(
      root,
      capability.layout.sectionKey,
    );
    const derivedReferences = await this.hydrateGraphReadReferences(
      organizationId,
      projectId,
      graph,
    );
    const participation = incidentRelationshipTypes.length
      ? await this.participationComposer.compose(
          organizationId,
          projectId,
          root.id,
          incidentRelationshipTypes,
          userToken,
        )
      : {
          entries: [],
          summary: {
            completeness: 'COMPLETE' as const,
            uniqueContractCount: 0,
            participantCount: 0,
            responsibilityCount: 0,
            limits: WORK_ITEM_GRAPH_PARTICIPATION_LIMITS,
            truncationReasons: [],
            errors: [],
          },
        };

    return {
      root,
      children,
      relationships: [...relationshipById.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      layout,
      derivedReferences,
      participation,
    } satisfies WorkItemGraphAggregateResponseDto;
  }

  private toApiAgentEdge(edge: AgentEdge): AgentEdgeResponseDto {
    if (
      !Object.values(ApiAgentEdgeType).includes(edge.type as ApiAgentEdgeType)
    ) {
      throw new Error(`Graph returned non-agent relationship '${edge.type}'`);
    }
    return {
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      sourceEntityType: edge.sourceEntityType,
      sourceNodeName: edge.sourceNodeName,
      targetNodeId: edge.targetNodeId,
      targetEntityType: edge.targetEntityType,
      targetNodeName: edge.targetNodeName,
      targetNodeType: edge.targetNodeType,
      type: edge.type as ApiAgentEdgeType,
      category: edge.category,
      direction: edge.direction,
      predicate: edge.predicate,
      reasoning: edge.reasoning,
      createdBySessionId: edge.createdBySessionId,
      lastModifiedBySessionId: edge.lastModifiedBySessionId,
      metadata: edge.metadata,
      createdAt: edge.createdAt,
      updatedAt: edge.updatedAt,
    } satisfies AgentEdgeResponseDto;
  }

  private readGraphAggregateLayout(
    root: TaskResponseDto,
    sectionKey: string,
  ): WorkItemGraphLayoutValue | null {
    const section = root.sections?.find(
      (candidate) => candidate.key === sectionKey,
    );
    if (!section || section.materializedMarkdown.trim().length === 0) {
      return null;
    }
    const result = validateWorkItemGraphLayoutContent(
      section.materializedMarkdown,
    );
    if (!result.success) {
      throw new BadRequestException(
        `Invalid work item graph layout: ${result.message}`,
      );
    }
    return result.value satisfies WorkItemGraphLayoutValue;
  }

  private async hydrateGraphReadReferences(
    organizationId: OrganizationId,
    projectId: ProjectId,
    graph: StructuredGraphReadResponse,
  ): Promise<WorkItemGraphDerivedReference[]> {
    const targetIds = [
      ...new Set(
        graph.expansions.flatMap((expansion) =>
          expansion.targets.map((target) => target.identity.entityId),
        ),
      ),
    ];
    if (targetIds.length === 0) return [];
    const [registryRows, taskRows] = await Promise.all([
      this.prisma.db.entityRegistry.findMany({
        where: {
          organizationId,
          entityId: { in: targetIds },
          deletedAt: null,
        },
        select: { entityId: true, entityType: true, entityName: true },
      }),
      this.prisma.db.task.findMany({
        where: {
          organizationId,
          projectId,
          id: { in: targetIds },
          archivedAt: null,
          status: { not: WorkStatus.ARCHIVED },
        },
        select: { id: true, type: true, name: true },
      }),
    ]);
    const registryByIdentity = new Map(
      registryRows.map((row) => [`${row.entityType}:${row.entityId}`, row]),
    );
    const taskById = new Map<string, (typeof taskRows)[number]>(
      taskRows.map((row) => [row.id, row]),
    );
    return graph.expansions.flatMap((expansion) =>
      expansion.targets
        .flatMap((target) => {
          const { entityId, entityType } = target.identity;
          const registry = registryByIdentity.get(`${entityType}:${entityId}`);
          if (!registry) return [];
          const task =
            entityType === 'TASK' ? taskById.get(entityId) : undefined;
          if (entityType === 'TASK' && !task) return [];
          const displayName = task?.name ?? registry.entityName;
          if (!displayName)
            throw new Error(
              `Graph expansion ${expansion.key} returned a target without a display name`,
            );
          return [
            {
              expansionKey: expansion.key,
              projectionKind: 'workItemReference',
              entityId,
              entityType,
              ...(task ? { workItemTypeKey: task.type } : {}),
              displayName,
              viaEntityIds: [
                ...new Set(
                  target.paths.map((path) => path.identities[1]!.entityId),
                ),
              ].sort(),
            } satisfies WorkItemGraphDerivedReference,
          ];
        })
        .sort((a, b) => a.entityId.localeCompare(b.entityId)),
    );
  }

  async findHierarchy(
    organizationId: OrganizationId,
    taskId: TaskId,
    includeDesignDocCounts = false,
    includeAgentSessionCounts = false,
    includeServiceRelations = false,
  ): Promise<TaskHierarchyResponseDto> {
    const task = await this.findOne(
      organizationId,
      taskId,
      includeDesignDocCounts,
      includeAgentSessionCounts,
      false,
      includeServiceRelations,
      false,
    );

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    const parent =
      task.parentTaskId != null
        ? await this.findOne(
            organizationId,
            task.parentTaskId as TaskId,
            includeDesignDocCounts,
            includeAgentSessionCounts,
            false,
            includeServiceRelations,
            false,
          )
        : null;

    const children = await this.findAll(organizationId, undefined, {
      parentTaskId: task.id as TaskId,
      includeDesignDocCounts,
      includeAgentSessionCounts,
      includeServiceRelations,
      includeSectionKeys: ALL_DECLARED_SECTIONS,
    });

    return {
      parent: parent ?? undefined,
      task,
      children,
    };
  }

  async findHierarchyByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
    includeDesignDocCounts = false,
    includeAgentSessionCounts = false,
    includeServiceRelations = false,
  ): Promise<TaskHierarchyResponseDto> {
    const taskExists = await this.prisma.db.task.findFirst({
      where: { id: taskId, organizationId, archivedAt: null },
      select: { id: true },
    });

    if (!taskExists) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    return this.findHierarchy(
      organizationId,
      taskId,
      includeDesignDocCounts,
      includeAgentSessionCounts,
      includeServiceRelations,
    );
  }

  private async updateOriginalArtifactForRefinementOverwrites(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<void> {
    this.logger.debug(
      '[updateOriginalArtifactForRefinementOverwrites] synchronizing TASK_ORIGINAL with current task content',
      {
        taskId,
        organizationId,
      },
    );

    const task = await this.prisma.db.task.findFirst({
      where: { id: taskId, organizationId, archivedAt: null },
      select: { type: true, projectId: true },
    });
    if (!task) {
      return;
    }

    const taskType = this.resolveTaskType(task.type as WorkItemTypeKey);
    const contentSnapshot = await this.loadTaskEventContentSnapshot(
      taskId,
      taskType,
      task.projectId,
    );
    const updates: Partial<
      Pick<TaskOriginalArtifactData, 'description' | 'acceptanceCriteria'>
    > = {
      description: contentSnapshot.description,
      acceptanceCriteria: contentSnapshot.acceptanceCriteria,
    };

    try {
      await this.taskArtifactService.updateOriginalArtifactFields(
        taskId,
        organizationId,
        updates,
      );
    } catch (error) {
      this.logger.warn(
        '[updateOriginalArtifactForRefinementOverwrites] Failed to update TASK_ORIGINAL',
        {
          error: error instanceof Error ? error.message : error,
          taskId,
          organizationId,
        },
      );
    }
  }

  @WithEventContext('TaskService')
  async update(
    organizationId: OrganizationId,
    initiativeId: InitiativeId | null,
    taskId: TaskId,
    updateTaskDto: UpdateTaskDto,
    userId?: UserId,
  ): Promise<TaskResponseDto> {
    const { task, postCommit } = await this.prisma.$transaction(async (tx) => {
      return this.updateInTransaction(
        tx,
        organizationId,
        initiativeId,
        taskId,
        updateTaskDto,
        userId,
      );
    });

    await this.runUpdatePostCommit(organizationId, taskId, postCommit);

    // Post-commit work — read-only response shaping for HTTP callers; never
    // belongs inside the write tx.
    const [response] = await this.mapTasksWithChildCounts(
      [task],
      organizationId,
      task.initiativeId as InitiativeId,
      undefined,
      undefined,
      ALL_DECLARED_SECTIONS,
    );

    if (!response) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    return response;
  }

  async replaceServiceAssignmentsInTransaction(
    tx: Prisma.TransactionClient,
    taskId: TaskId,
    serviceIds: readonly string[],
  ): Promise<void> {
    await tx.serviceTask.deleteMany({
      where: { taskId, serviceId: { notIn: [...serviceIds] } },
    });
    if (serviceIds.length > 0) {
      await tx.serviceTask.createMany({
        data: serviceIds.map((serviceId) => ({ taskId, serviceId })),
        skipDuplicates: true,
      });
    }
  }

  async hardDeleteByTypeInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    typeKey: string,
  ): Promise<number> {
    const result = await tx.task.deleteMany({
      where: { organizationId, projectId, type: typeKey },
    });
    this.logger.log('Hard-deleted work items for custom type', {
      organizationId,
      projectId,
      typeKey,
      deletedWorkItemCount: result.count,
    });
    return result.count;
  }

  async hardDeleteByIdsInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    typeKey: string,
    workItemIds: readonly string[],
  ): Promise<number> {
    const result = await tx.task.deleteMany({
      where: {
        id: { in: [...new Set(workItemIds)] },
        organizationId,
        projectId,
        type: typeKey,
      },
    });
    this.logger.log('Hard-deleted captured work items for custom type', {
      organizationId,
      projectId,
      typeKey,
      requestedWorkItemCount: workItemIds.length,
      deletedWorkItemCount: result.count,
    });
    return result.count;
  }

  /**
   * Transaction-aware task-update path. Performs the same validation and
   * entity write as {@link update} but inside the caller's transaction so
   * the entity write can be atomic with whatever the caller is coordinating
   * (e.g. the proposal-row state machine flipping DRAFT → APPROVED).
   *
   * Returns the raw updated task row plus a `postCommit` payload describing
   * any side effects the caller must run after its tx commits — status
   * change syncs into plan steps (cross-aggregate write) and the
   * TASK_ORIGINAL artifact refresh. These intentionally do not run inside
   * the tx; they were never atomic with the entity write under the previous
   * implementation either.
   */
  async updateInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    initiativeId: InitiativeId | null,
    taskId: TaskId,
    updateTaskDto: UpdateTaskDto,
    userId?: UserId,
    materializationId?: string,
    effectiveParentId?: string | null,
  ): Promise<{ task: TaskEntity; postCommit: TaskUpdatePostCommit }> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = organizationId;
      if (userId) {
        currentContext.userId = userId;
      }
      currentContext.metadata = {
        ...currentContext.metadata,
        initiativeId: initiativeId ?? undefined,
        taskId,
      };
    }

    const existingTask = await tx.task.findFirst({
      where: { id: taskId, organizationId, archivedAt: null },
    });
    if (!existingTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    this.assertNoDirectSectionUpdates(updateTaskDto as Record<string, unknown>);

    if (
      updateTaskDto.type !== undefined &&
      updateTaskDto.type !== existingTask.type
    ) {
      throw new BadRequestException(
        'Task type cannot be changed after creation.',
      );
    }

    const targetTaskType = this.resolveTaskType(
      existingTask.type as WorkItemTypeKey,
    );
    const projectId = existingTask.projectId as ProjectId;
    await this.assertWorkItemWriteAllowed(
      tx,
      organizationId,
      projectId,
      [taskId],
      materializationId,
    );

    const isReparenting =
      updateTaskDto.parentTaskId !== undefined &&
      updateTaskDto.parentTaskId !== existingTask.parentTaskId;

    if (updateTaskDto.parentTaskId === taskId) {
      throw new BadRequestException('Task cannot be its own parent.');
    }

    let targetParentTask: { id: string; type: string } | undefined;
    if (isReparenting) {
      if (updateTaskDto.parentTaskId) {
        targetParentTask = await this.loadActiveParentTask(
          organizationId,
          updateTaskDto.parentTaskId as TaskId,
          tx,
          targetTaskType === WORK_ITEM_TYPE_KEYS.Diagram ||
            targetTaskType === WORK_ITEM_TYPE_KEYS.DiagramElement
            ? projectId
            : undefined,
        );
      }
      this.workItemParentageValidator.assertValid({
        childType: targetTaskType,
        parentEntityType: targetParentTask ? EntityType.Task : null,
        parentType: targetParentTask?.type ?? null,
        projectId,
      });
    }

    if (
      this.workItemTypeRegistry.isScalarRequired(
        targetTaskType,
        'dueDate',
        projectId,
      ) &&
      updateTaskDto.dueDate !== undefined &&
      this.isMissingDueDate(updateTaskDto.dueDate)
    ) {
      throw new BadRequestException('GOAL tasks require a dueDate.');
    }

    // Enforce the type's allowedStatuses contract on edit, mirroring the
    // create-path constraint in resolveInitialStatus. Only a status that is
    // actually changing is checked, so unchanged-status updates (and legacy
    // rows whose persisted status predates the current policy) are unaffected.
    if (
      updateTaskDto.status !== undefined &&
      updateTaskDto.status !== existingTask.status &&
      !this.workItemTypeRegistry.isStatusAllowed(
        targetTaskType,
        updateTaskDto.status,
        projectId,
      )
    ) {
      const allowed = this.workItemTypeRegistry.getAllowedStatuses(
        targetTaskType,
        projectId,
      );
      throw new BadRequestException(
        formatWorkItemStatusNotAllowedMessage(
          updateTaskDto.status,
          targetTaskType,
          allowed,
        ),
      );
    }

    const requirementOps = updateTaskDto.requirementOps;
    let structuredRequirementsSection: WorkItemSectionInput | undefined;
    if (requirementOps !== undefined) {
      if (targetTaskType !== WORK_ITEM_TYPE_KEYS.Feature) {
        throw new BadRequestException(
          'requirementOps is only accepted for FEATURE tasks.',
        );
      }
      if (
        updateTaskDto.sections?.some(
          (section) => section.key === TaskSectionKey.Requirements,
        )
      ) {
        throw new BadRequestException(
          'Provide FEATURE requirements through requirementOps or sections[requirements], not both.',
        );
      }
      if (requirementOps.length > 0) {
        const requirementsSection = await tx.taskSection.findFirst({
          where: { taskId, key: TaskSectionKey.Requirements },
          select: { materializedMarkdown: true },
        });
        const prepared =
          await this.featureRequirementAuthoring().prepareRequirementOperations(
            requirementsSection?.materializedMarkdown,
            requirementOps,
            { organizationId, db: tx },
          );
        if (!prepared.success) {
          this.throwFeatureRequirementDiagnostics(
            'requirementOps',
            prepared.diagnostics,
          );
        }
        structuredRequirementsSection = {
          key: TaskSectionKey.Requirements,
          content: prepared.section,
        };
      }
    }

    const { requirementOps: _requirementOps, ...updateWithoutRequirementOps } =
      updateTaskDto;
    void _requirementOps;
    const effectiveSections = structuredRequirementsSection
      ? [...(updateTaskDto.sections ?? []), structuredRequirementsSection]
      : updateTaskDto.sections;
    const effectiveParentForRequirements =
      effectiveParentId !== undefined
        ? effectiveParentId
        : isReparenting
          ? updateTaskDto.parentTaskId
          : existingTask.parentTaskId;
    const hasRequirementsSectionUpdate = effectiveSections?.some(
      (section) => section.key === TaskSectionKey.Requirements,
    );
    if (
      targetTaskType === WORK_ITEM_TYPE_KEYS.Feature &&
      isReparenting &&
      !hasRequirementsSectionUpdate &&
      typeof (
        tx.taskSection as unknown as {
          findFirst?: unknown;
        }
      ).findFirst === 'function'
    ) {
      const existingRequirements = await tx.taskSection.findFirst({
        where: { taskId, key: TaskSectionKey.Requirements },
        select: { materializedMarkdown: true },
      });
      if (
        existingRequirements?.materializedMarkdown !== undefined &&
        existingRequirements.materializedMarkdown !== null
      ) {
        await this.assertFeatureRequirementSection(
          tx,
          organizationId,
          projectId,
          existingRequirements.materializedMarkdown,
          'sections[requirements]',
          taskId,
          effectiveParentForRequirements ?? undefined,
        );
      }
    }
    const effectiveUpdateTaskDto: UpdateTaskDto = {
      ...updateWithoutRequirementOps,
      ...(effectiveSections !== undefined
        ? { sections: effectiveSections }
        : {}),
    };

    const sectionUpdates = this.buildTaskSectionUpdatesFromInput(
      projectId,
      effectiveUpdateTaskDto.sections,
      targetTaskType,
    );
    const updateOriginalArtifact = this.shouldUpdateOriginalArtifactFromSource(
      updateTaskDto.sectionUpdateSource,
    );

    let nonSectionUpdates = effectiveUpdateTaskDto;
    if (sectionUpdates.length > 0) {
      const {
        sections,
        sectionUpdateSource: _sectionUpdateSource,
        ...rest
      } = effectiveUpdateTaskDto;
      nonSectionUpdates = rest;

      if (Object.keys(nonSectionUpdates).length === 0) {
        await this.applySectionUpdatesInTransaction(
          tx,
          organizationId,
          taskId,
          sectionUpdates,
          {
            updateOriginalArtifact,
            taskTypeOverride: targetTaskType,
            materializationId,
            effectiveParentId: effectiveParentForRequirements,
          },
        );
        // Re-read the task row inside the tx so callers needing response
        // shaping have a consistent view; entity row didn't change in the
        // section-only path but a fresh fetch keeps the contract uniform.
        const refreshed = await tx.task.findUniqueOrThrow({
          where: { id: taskId },
        });
        return {
          task: refreshed as TaskEntity,
          postCommit: { updateOriginalArtifact },
        };
      }

      await this.applySectionUpdatesInTransaction(
        tx,
        organizationId,
        taskId,
        sectionUpdates,
        {
          updateOriginalArtifact,
          taskTypeOverride: targetTaskType,
          materializationId,
          effectiveParentId: effectiveParentForRequirements,
        },
      );
    }

    const updateSnapshot = buildTaskEventUpdateSnapshot(nonSectionUpdates);

    const targetInitiativeId =
      (nonSectionUpdates.initiativeId as InitiativeId | undefined) ??
      initiativeId;

    if (currentContext && targetInitiativeId !== initiativeId) {
      currentContext.metadata = {
        ...currentContext.metadata,
        initiativeId: targetInitiativeId ?? undefined,
      };
    }

    if (
      nonSectionUpdates.initiativeId &&
      nonSectionUpdates.initiativeId !== initiativeId
    ) {
      const targetInitiative = await tx.initiative.findFirst({
        where: { id: targetInitiativeId!, organizationId },
        select: { id: true },
      });

      if (!targetInitiative) {
        throw new NotFoundException(
          `Initiative with ID ${targetInitiativeId} not found in this organization.`,
        );
      }
    }

    const resolvedProjectId = existingTask.projectId as ProjectId;
    const statusChanged =
      updateTaskDto.status !== undefined &&
      existingTask.status !== updateTaskDto.status;
    const newStatus = statusChanged ? updateTaskDto.status : undefined;

    if (
      nonSectionUpdates.tag !== undefined &&
      this.workItemTypeRegistry.isScalarForbidden(
        this.resolveTaskType(existingTask.type as WorkItemTypeKey),
        'tag',
        resolvedProjectId,
      )
    ) {
      throw new BadRequestException(
        `tag is only valid on FEATURE tasks (target is ${existingTask.type}).`,
      );
    }

    const updateData: Prisma.TaskUncheckedUpdateInput = {};
    if (nonSectionUpdates.name !== undefined) {
      updateData.name = nonSectionUpdates.name;
    }
    if (nonSectionUpdates.status !== undefined) {
      updateData.status = nonSectionUpdates.status;
    }
    if (nonSectionUpdates.priority !== undefined) {
      updateData.priority = nonSectionUpdates.priority;
    }
    if (nonSectionUpdates.type !== undefined) {
      // This path rejects any type change up front (see the
      // 'Task type cannot be changed after creation.' guard above), so a
      // provided type here always equals the already-persisted existingTask.type.
      // This is a verbatim re-write of that persisted key — no assertTypeActive
      // gate, which would wrongly reject a task whose custom type was later
      // archived while still being edited on unrelated fields.
      updateData.type = this.resolveTaskType(nonSectionUpdates.type);
    }
    if (nonSectionUpdates.tag !== undefined) {
      updateData.tag = nonSectionUpdates.tag;
    }
    if (nonSectionUpdates.assigneeId !== undefined) {
      updateData.assigneeId = nonSectionUpdates.assigneeId;
    }
    if (nonSectionUpdates.initiativeId !== undefined) {
      updateData.initiativeId = nonSectionUpdates.initiativeId;
    }
    if (nonSectionUpdates.parentTaskId !== undefined) {
      updateData.parentTaskId = nonSectionUpdates.parentTaskId;
    }
    if (nonSectionUpdates.dueDate !== undefined) {
      updateData.dueDate = nonSectionUpdates.dueDate
        ? new Date(nonSectionUpdates.dueDate)
        : null;
    }

    const updated = await tx.task.update({
      where: { id: taskId },
      data: updateData,
    });

    if (nonSectionUpdates.tag !== undefined) {
      this.logger.debug('[updateInTransaction] feature tag updated', {
        taskId,
        previousTag: existingTask.tag ?? null,
        newTag: updated.tag ?? null,
        organizationId,
      });
    }

    if (
      nonSectionUpdates.type !== undefined &&
      this.resolveTaskType(nonSectionUpdates.type) !==
        this.resolveTaskType(existingTask.type as WorkItemTypeKey)
    ) {
      await this.ensureTaskSectionProfile(
        tx,
        taskId,
        this.resolveTaskType(nonSectionUpdates.type),
        resolvedProjectId,
      );
    }

    await this.publishTaskUpdatedEvent(tx, {
      taskId,
      update: updateSnapshot,
      organizationId,
      initiativeId: targetInitiativeId,
      projectId: resolvedProjectId,
      userId,
    });

    if (statusChanged && newStatus) {
      await this.publishTaskStatusChangedEvent(tx, {
        taskId,
        previousStatus: existingTask.status,
        newStatus,
        organizationId,
        initiativeId: targetInitiativeId,
        projectId: resolvedProjectId,
        originatingProjectId: resolvedProjectId,
        userId,
      });
    }
    if ((statusChanged && newStatus) || isReparenting) {
      await this.rollUpCanonicalPlanHierarchy(
        tx,
        taskId,
        userId,
        isReparenting ? existingTask.parentTaskId : null,
      );
    }

    if (
      updateTaskDto.assigneeId !== undefined &&
      existingTask.assigneeId !== updateTaskDto.assigneeId
    ) {
      if (updateTaskDto.assigneeId) {
        await this.publishTaskAssignedEvent(tx, {
          taskId,
          assigneeId: updateTaskDto.assigneeId as UserId,
          previousAssigneeId: (existingTask.assigneeId || undefined) as
            | UserId
            | undefined,
          organizationId,
          initiativeId: targetInitiativeId,
          projectId: resolvedProjectId,
        });
      } else if (existingTask.assigneeId) {
        await this.publishTaskUnassignedEvent(tx, {
          taskId,
          previousAssigneeId: existingTask.assigneeId as UserId,
          organizationId,
          initiativeId: targetInitiativeId,
          projectId: resolvedProjectId,
        });
      }
    }

    return {
      task: updated as TaskEntity,
      postCommit: {
        statusChange:
          statusChanged && newStatus
            ? { previousStatus: existingTask.status, newStatus }
            : undefined,
        updateOriginalArtifact,
      },
    };
  }

  /**
   * Runs the post-commit side effects produced by {@link updateInTransaction}.
   * Called by both the {@link update} wrapper and the proposal-approval flow
   * once their outer tx has committed, so the side-effect set lives in one
   * place. None of these are load-bearing for atomicity.
   */
  async runUpdatePostCommit(
    organizationId: OrganizationId,
    taskId: TaskId,
    postCommit: TaskUpdatePostCommit,
  ): Promise<void> {
    if (postCommit.statusChange) {
    }

    if (postCommit.updateOriginalArtifact) {
      await this.updateOriginalArtifactForRefinementOverwrites(
        organizationId,
        taskId,
      );
    }
  }

  @WithEventContext('TaskService')
  async remove(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<TaskResponseDto> {
    // Set up event context
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = organizationId;
      currentContext.metadata = {
        ...currentContext.metadata,
        taskId,
      };
    }

    // First, verify the task exists
    const existingTask = await this.prisma.db.task.findFirst({
      where: { id: taskId, organizationId, archivedAt: null },
      select: {
        id: true,
        projectId: true,
        initiativeId: true,
        parentTaskId: true,
      },
    });
    if (!existingTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    const projectId = existingTask.projectId as ProjectId;
    const initiativeId = existingTask.initiativeId as InitiativeId | null;

    // Archive task and publish event in transaction
    const archivedTask = await this.prisma.$transaction(async (tx) => {
      await this.assertWorkItemWriteAllowed(tx, organizationId, projectId, [
        taskId,
      ]);
      const archived = await tx.task.update({
        where: {
          id: taskId,
        },
        data: {
          archivedAt: new Date(),
        },
      });

      await this.publishTaskArchivedEvent(tx, {
        taskId,
        archivedAt: archived.archivedAt ?? new Date(),
        organizationId,
        initiativeId,
        projectId,
      });

      await this.rollUpCanonicalPlanHierarchy(
        tx,
        null,
        undefined,
        existingTask.parentTaskId,
      );

      return archived;
    });

    const [response] = await this.mapTasksWithChildCounts(
      [archivedTask],
      organizationId,
      initiativeId,
      undefined,
      undefined,
      ALL_DECLARED_SECTIONS,
    );

    if (!response) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    return response;
  }

  async removeByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<TaskResponseDto> {
    return this.remove(organizationId, taskId);
  }

  /**
   * Transaction-aware soft-delete. Mirrors {@link remove} but runs the
   * archive write and the `task.archived` event on the caller's tx, so the
   * deletion is atomic with whatever the caller coordinates (e.g. a proposal
   * row flipping DRAFT → APPROVED). The `task.archived` event still drives
   * downstream cleanup (mentions, child handling) through its existing
   * consumers — consistent with the {@link enactUpdate}-via-updateInTransaction
   * pattern the proposal-approval flow already uses.
   */
  async removeInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    taskId: TaskId,
    materializationId?: string,
  ): Promise<void> {
    const existingTask = await tx.task.findFirst({
      where: { id: taskId, organizationId, archivedAt: null },
      select: {
        id: true,
        projectId: true,
        initiativeId: true,
        parentTaskId: true,
      },
    });
    if (!existingTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    const projectId = existingTask.projectId as ProjectId;
    await this.assertWorkItemWriteAllowed(
      tx,
      organizationId,
      projectId,
      [taskId],
      materializationId,
    );
    const initiativeId = existingTask.initiativeId as InitiativeId | null;

    const archived = await tx.task.update({
      where: { id: taskId },
      data: { archivedAt: new Date() },
    });

    this.logger.log('[removeInTransaction] archived task', {
      taskId,
      organizationId,
      projectId,
    });

    await this.publishTaskArchivedEvent(tx, {
      taskId,
      archivedAt: archived.archivedAt ?? new Date(),
      organizationId,
      initiativeId,
      projectId,
    });

    await this.pruneDiagramGroupMembership(
      tx,
      organizationId,
      existingTask.parentTaskId,
      taskId,
      materializationId,
    );

    await this.rollUpCanonicalPlanHierarchy(
      tx,
      null,
      undefined,
      existingTask.parentTaskId,
    );
  }

  private graphGroupsSectionKey(
    typeKey: string,
    projectId: string,
  ): string | undefined {
    try {
      return (
        this.workItemTypeRegistry.getGraphCapability(typeKey, projectId)?.groups
          ?.sectionKey ?? undefined
      );
    } catch {
      return undefined;
    }
  }

  /**
   * Direct and materialized writes of a graph's groups section resolve
   * members against the graph's current children and re-parent children of
   * removed groups through the previously persisted value. Saved positions
   * are untouched.
   */
  private async reconcileDiagramGroupsUpdate(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    graphId: TaskId,
    sectionKey: string,
    updates: Array<{ key: TaskSectionField; content: string | null }>,
  ): Promise<Array<{ key: TaskSectionField; content: string | null }>> {
    const update = updates.find((candidate) => candidate.key === sectionKey);
    if (!update || update.content === null) return updates;
    const parsed = parseDiagramGroupsContent(update.content);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid Diagram groups: ${parsed.message}`,
      );
    }
    const previousSection = await tx.taskSection.findFirst({
      where: { taskId: graphId, key: sectionKey },
      select: { materializedMarkdown: true },
    });
    const previous = previousSection?.materializedMarkdown
      ? parseDiagramGroupsContent(previousSection.materializedMarkdown)
      : null;
    const reconciled = reconcileDiagramGroups(parsed.value, {
      previous: previous?.success ? previous.value : null,
    });
    const elements = await tx.task.findMany({
      where: { parentTaskId: graphId, organizationId, archivedAt: null },
      select: { id: true },
    });
    const issues = validateDiagramGroups(
      reconciled,
      new Set(elements.map((element) => `existing:${element.id}`)),
    );
    if (issues.length > 0) {
      throw new BadRequestException(
        `Invalid Diagram groups: ${formatDiagramGroupsIssues(issues)}`,
      );
    }
    return updates.map((candidate) =>
      candidate === update
        ? { ...candidate, content: JSON.stringify(reconciled) }
        : candidate,
    );
  }

  /** Membership belongs to the placement, so removing it prunes its groups. */
  private async pruneDiagramGroupMembership(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    graphId: string | null,
    elementId: string,
    materializationId?: string,
  ): Promise<void> {
    if (!graphId) return;
    const graph = await tx.task.findFirst({
      where: { id: graphId, organizationId, archivedAt: null },
      select: { type: true, projectId: true },
    });
    const sectionKey = graph
      ? this.graphGroupsSectionKey(graph.type, graph.projectId)
      : undefined;
    if (!sectionKey) return;
    const section = await tx.taskSection.findFirst({
      where: { taskId: graphId, key: sectionKey },
      select: { materializedMarkdown: true },
    });
    if (!section?.materializedMarkdown) return;
    const parsed = parseDiagramGroupsContent(section.materializedMarkdown);
    if (!parsed.success) return;
    const removed = new Set([`existing:${elementId}`]);
    if (
      !parsed.value.groups.some((group) =>
        group.members.some((member) =>
          removed.has(diagramGroupMemberKey(member)),
        ),
      )
    ) {
      return;
    }
    await this.applySectionUpdatesInTransaction(
      tx,
      organizationId,
      graphId as TaskId,
      [
        {
          key: sectionKey,
          content: JSON.stringify(
            reconcileDiagramGroups(parsed.value, {
              removedMemberKeys: removed,
            }),
          ),
        },
      ],
      { materializationId },
    );
  }

  private async assertWorkItemWriteAllowed(
    tx: Prisma.TransactionClient,
    organizationId: OrganizationId,
    projectId: ProjectId,
    workItemIds: readonly string[],
    materializationId?: string,
    typeKey?: string,
  ): Promise<void> {
    if (workItemIds.length === 0 && !typeKey) return;
    await withApiSpan('work_item.write.advisory_lock', () =>
      tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${projectId}`}, 0))::text AS "lockAcquired"`,
      ),
    );
    if (materializationId) {
      const intents = await tx.workItemChangeSetMaterialization.findMany({
        where: {
          organizationId,
          projectId,
          id: materializationId,
        },
        select: {
          id: true,
          status: true,
        },
      });
      const owner = intents.find((intent) => intent.id === materializationId);
      if (owner?.status !== 'APPLYING') {
        throw new ConflictException(
          'Work-item change-set write is not owned by the active materialization.',
        );
      }
    }
    if (typeKey) {
      const execution = await tx.workItemTypeCascadeExecution.findFirst({
        where: {
          organizationId,
          projectId,
          typeKey,
          state: { not: WorkItemTypeCascadeExecutionState.COMPLETED },
        },
        select: { id: true },
      });
      if (execution) {
        throw new ConflictException(
          `Work-item type '${typeKey}' is frozen while its cascade deletion is pending.`,
        );
      }
    }
  }

  // Adapter methods for unified work item interface compatibility

  /**
   * Find task by ID without requiring initiative ID
   * Adapter method for unified refinement system
   */
  async findOneForAdapter(
    taskId: string,
    organizationId: OrganizationId,
  ): Promise<TaskResponseDto | null> {
    const task = await this.prisma.db.task.findFirst({
      where: {
        id: taskId,
        organizationId,
        archivedAt: null,
      },
    });

    if (!task) {
      return null;
    }

    const [response] = await this.mapTasksWithChildCounts(
      [task],
      organizationId,
      task.initiativeId,
      undefined,
      undefined,
      ALL_DECLARED_SECTIONS,
    );

    return response ?? null;
  }

  /**
   * Update task without requiring initiative ID
   * Adapter method for unified refinement system
   */
  @WithEventContext('TaskService')
  async updateForAdapter(
    taskId: TaskId,
    updatesInput: TaskUpdateInput,
    organizationId: OrganizationId,
    userId?: UserId,
  ): Promise<TaskResponseDto> {
    let updates = updatesInput;
    // Set up event context
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = organizationId;
      if (userId) {
        currentContext.userId = userId;
      }
      currentContext.metadata = {
        ...currentContext.metadata,
        taskId,
      };
    }

    // First, verify the task exists
    const existingTask = await this.findOne(
      organizationId,
      taskId,
      false,
      false,
      true,
    );
    if (!existingTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    // This path permits a genuine type change, so a provided type must be
    // asserted active for the project before resolveTaskType (which now
    // preserves it verbatim) lets it reach the section/parentage accessors.
    // An unknown/archived key throws the named-types error here rather than the
    // registry snapshot-miss further down. A re-parent with no type change
    // leaves the existing persisted type untouched.
    if (updates.type !== undefined && existingTask.projectId) {
      this.workItemTypeRegistry.assertTypeActive(
        updates.type as string,
        existingTask.projectId as ProjectId,
      );
    }

    const targetTaskType = this.resolveTaskType(
      (updates.type as WorkItemTypeKey | undefined) ?? existingTask.type,
    );
    const isChangingTaskType =
      updates.type !== undefined &&
      targetTaskType !== this.resolveTaskType(existingTask.type);
    const taskProjectId = existingTask.projectId as ProjectId;
    const sectionUpdates = this.buildTaskSectionUpdatesFromInput(
      taskProjectId,
      updates.sections,
      targetTaskType,
    );
    const updateOriginalArtifact = this.shouldUpdateOriginalArtifactFromSource(
      updates.sectionUpdateSource,
    );

    if (sectionUpdates.length > 0) {
      const {
        sections,
        sectionUpdateSource: _sectionUpdateSource,
        ...nonSectionUpdates
      } = updates;

      if (Object.keys(nonSectionUpdates).length === 0) {
        return this.applySectionUpdates(
          organizationId,
          taskId,
          sectionUpdates,
          {
            updateOriginalArtifact,
            taskTypeOverride: targetTaskType,
          },
        );
      }

      await this.applySectionUpdates(organizationId, taskId, sectionUpdates, {
        updateOriginalArtifact,
        taskTypeOverride: targetTaskType,
      });
      updates = nonSectionUpdates;
    }

    const updateSnapshot = buildTaskEventUpdateSnapshot(
      updates as UpdateTaskDto,
    );
    const statusChanged =
      updates.status !== undefined && existingTask.status !== updates.status;
    const newStatus = statusChanged ? updates.status : undefined;

    if (updates.parentTaskId !== undefined && updates.parentTaskId === taskId) {
      throw new BadRequestException('Task cannot be its own parent.');
    }

    const targetInitiativeId =
      (updates.initiativeId as InitiativeId | undefined) ??
      (existingTask.initiativeId as InitiativeId);

    if (
      currentContext &&
      updates.initiativeId &&
      updates.initiativeId !== existingTask.initiativeId
    ) {
      currentContext.metadata = {
        ...currentContext.metadata,
        initiativeId: targetInitiativeId,
      };
    }

    if (updates.parentTaskId !== undefined || isChangingTaskType) {
      const targetParentTaskId =
        updates.parentTaskId !== undefined
          ? updates.parentTaskId
          : existingTask.parentTaskId;
      if (targetParentTaskId) {
        await this.validateParentTaskOwnership(
          organizationId,
          targetParentTaskId as TaskId,
          targetTaskType,
          existingTask.projectId as ProjectId,
        );
      } else {
        this.workItemParentageValidator.assertValid({
          childType: targetTaskType,
          parentEntityType: null,
          parentType: null,
          projectId: existingTask.projectId as ProjectId,
        });
      }
    }

    if (
      updates.initiativeId &&
      updates.initiativeId !== existingTask.initiativeId
    ) {
      const targetInitiative = await this.prisma.db.initiative.findFirst({
        where: { id: targetInitiativeId, organizationId },
        select: { id: true },
      });

      if (!targetInitiative) {
        throw new NotFoundException(
          `Initiative with ID ${targetInitiativeId} not found in this organization.`,
        );
      }
    }

    // Build update data, filtering out undefined values
    const updateData: Prisma.TaskUncheckedUpdateInput = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.assigneeId !== undefined)
      updateData.assigneeId = updates.assigneeId;
    if (updates.initiativeId !== undefined)
      updateData.initiativeId = updates.initiativeId;
    if (updates.parentTaskId !== undefined)
      updateData.parentTaskId = updates.parentTaskId;
    if (updates.dueDate !== undefined)
      updateData.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
    if (updates.type !== undefined) {
      updateData.type = this.resolveTaskType(updates.type);
    }

    // Update task and publish events in transaction
    const updatedTask = await this.prisma.$transaction(async (tx) => {
      await this.assertWorkItemWriteAllowed(
        tx,
        organizationId,
        taskProjectId,
        [taskId],
        undefined,
        targetTaskType,
      );
      const updated = await tx.task.update({
        where: {
          id: taskId,
        },
        data: updateData,
      });

      if (
        updates.type !== undefined &&
        this.resolveTaskType(updates.type) !==
          this.resolveTaskType(existingTask.type)
      ) {
        await this.ensureTaskSectionProfile(
          tx,
          taskId,
          this.resolveTaskType(updates.type),
          taskProjectId,
        );
      }

      const projectId = existingTask.initiative?.originatingProjectId;
      if (!projectId) {
        throw new BadRequestException(
          `Task ${taskId} is missing originating project data.`,
        );
      }

      await this.publishTaskUpdatedEvent(tx, {
        taskId,
        update: updateSnapshot,
        organizationId,
        initiativeId: (updated.initiativeId ?? null) as InitiativeId | null,
        projectId: projectId,
        userId,
      });

      // Check for status change and publish separate event
      if (statusChanged && newStatus) {
        // Fetch originatingProjectId from initiative if present
        const initiative = updated.initiativeId
          ? await tx.initiative.findUnique({
              where: { id: updated.initiativeId },
              select: { originatingProjectId: true },
            })
          : null;

        await this.publishTaskStatusChangedEvent(tx, {
          taskId,
          previousStatus: existingTask.status,
          newStatus,
          organizationId,
          initiativeId: (updated.initiativeId ?? null) as InitiativeId | null,
          projectId: projectId,
          originatingProjectId:
            (initiative?.originatingProjectId as ProjectId) || null,
          userId,
        });

        // Handle GENERATED → REFINING_* transition (user acceptance)
        // STANDARD tasks go to REFINING_ACCEPTANCE_CRITERIA, others to REFINING_DESCRIPTION
        if (
          existingTask.status === WorkStatus.GENERATED &&
          (newStatus === WorkStatus.REFINING_DESCRIPTION ||
            newStatus === WorkStatus.REFINING_ACCEPTANCE_CRITERIA)
        ) {
          await this.createArtifactOnAcceptance(
            { ...updated, type: updated.type as WorkItemTypeKey },
            organizationId,
            projectId,
            tx,
          );
        }
      }

      const formerParentTaskId =
        updates.parentTaskId !== undefined &&
        updates.parentTaskId !== existingTask.parentTaskId
          ? (existingTask.parentTaskId ?? null)
          : undefined;
      if ((statusChanged && newStatus) || formerParentTaskId !== undefined) {
        await this.rollUpCanonicalPlanHierarchy(
          tx,
          taskId,
          userId,
          formerParentTaskId,
        );
      }

      // Check for assignment change and publish separate event
      if (
        updates.assigneeId !== undefined &&
        existingTask.assigneeId !== updates.assigneeId
      ) {
        if (updates.assigneeId) {
          await this.publishTaskAssignedEvent(tx, {
            taskId,
            assigneeId: updates.assigneeId as UserId,
            previousAssigneeId: (existingTask.assigneeId || undefined) as
              | UserId
              | undefined,
            organizationId,
            initiativeId: (updated.initiativeId ?? null) as InitiativeId | null,
            projectId: projectId,
          });
        } else if (existingTask.assigneeId) {
          await this.publishTaskUnassignedEvent(tx, {
            taskId,
            previousAssigneeId: existingTask.assigneeId as UserId,
            organizationId,
            initiativeId: (updated.initiativeId ?? null) as InitiativeId | null,
            projectId: projectId,
          });
        }
      }

      return updated;
    });

    if (statusChanged && newStatus) {
    }

    const [response] = await this.mapTasksWithChildCounts(
      [updatedTask],
      organizationId,
      updatedTask.initiativeId as InitiativeId,
      undefined,
      undefined,
      ALL_DECLARED_SECTIONS,
    );

    if (!response) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    return response;
  }

  async updateByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
    updateTaskDto: UpdateTaskDto,
    userId?: UserId,
  ): Promise<TaskResponseDto> {
    const task = await this.prisma.db.task.findFirst({
      where: { id: taskId, organizationId, archivedAt: null },
      select: { initiativeId: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    return this.update(
      organizationId,
      task.initiativeId as InitiativeId | null,
      taskId,
      updateTaskDto,
      userId,
    );
  }

  /**
   * Find all tasks by organization (for bulk operations)
   * Adapter method for unified refinement system
   */
  async findAllByOrganizationForAdapter(
    organizationId: OrganizationId,
    filters?: {
      statuses?: WorkStatus[];
      priority?: string;
      assigneeId?: string;
      parentTaskId?: string | null;
      parentTaskIds?: TaskId[];
      includeDescendants?: boolean;
      includeTrackedEntities?: boolean;
      includeTrackedWorkSummary?: boolean;
      page?: number;
      limit?: number;
      includeDesignDocCounts?: boolean;
      includeAgentSessionCounts?: boolean;
      includeServiceRelations?: boolean;
      includeEdges?: boolean;
      userToken?: string | null;
      edgeTypes?: RelationshipType[];
      relatedEntityId?: string;
      relatedEntityType?: AgentEdgeEndpointEntityType;
      initiativeId?: InitiativeId;
      projectId?: ProjectId;
      includeSectionKeys?: string[];
      taskIds?: TaskId[];
      taskType?: string;
      sortBy?: 'createdAt' | 'updatedAt' | 'title' | 'status' | 'priority';
      sortDir?: 'asc' | 'desc';
    },
  ): Promise<TaskResponseDto[]> {
    const trackedProjections: TrackedGoalProjections = {
      includeTrackedEntities: filters?.includeTrackedEntities !== false,
      includeTrackedWorkSummary: filters?.includeTrackedWorkSummary === true,
    };
    const requestedTaskIds = filters?.taskIds
      ? this.validateUuidFilterList('taskIds', filters.taskIds, 200)
      : undefined;
    const requestedParentTaskIds = filters?.parentTaskIds
      ? this.validateUuidFilterList('parentTaskIds', filters.parentTaskIds, 200)
      : undefined;
    const page = Math.max(filters?.page ?? 1, 1);
    const defaultLimit = Math.max(50, requestedTaskIds?.length ?? 0);
    const limit = Math.min(Math.max(filters?.limit ?? defaultLimit, 1), 500);
    const skip = (page - 1) * limit;
    const relatedTaskIds = await this.resolveRelatedTaskIds(
      organizationId,
      filters?.projectId,
      filters?.relatedEntityId,
      filters?.relatedEntityType,
      filters?.edgeTypes,
      filters?.userToken,
    );
    const candidateTaskIds = relatedTaskIds
      ? requestedTaskIds
        ? requestedTaskIds.filter((taskId) => relatedTaskIds.has(taskId))
        : [...relatedTaskIds]
      : requestedTaskIds;

    const where: Prisma.TaskWhereInput = {
      organizationId,
      archivedAt: null,
    };

    if (filters?.projectId) {
      where.projectId = filters.projectId;
    }
    if (filters?.initiativeId) {
      where.initiativeId = filters.initiativeId;
    }
    if (filters?.statuses && filters.statuses.length > 0) {
      where.status = { in: filters.statuses };
    }
    if (candidateTaskIds) {
      where.id = { in: candidateTaskIds };
    }
    if (filters?.priority) where.priority = filters.priority as TaskPriority;
    if (filters?.assigneeId) where.assigneeId = filters.assigneeId;
    if ('parentTaskId' in (filters || {})) {
      const rootId = filters?.parentTaskId;
      if (filters?.includeDescendants && rootId != null && filters?.projectId) {
        this.logger.debug(
          '[findAllByOrganizationForAdapter] resolving feature subtree for includeDescendants',
          { organizationId, rootId, projectId: filters.projectId },
        );
        const subtreeIds = await this.resolveFeatureSubtreeIds(
          filters.projectId as ProjectId,
          rootId as string,
        );
        where.parentTaskId = { in: subtreeIds } as Prisma.StringNullableFilter;
      } else {
        where.parentTaskId = rootId ?? null;
      }
    }
    if (requestedParentTaskIds) {
      if ('parentTaskId' in (filters || {}) || filters?.includeDescendants) {
        throw new BadRequestException(
          'parentTaskIds is mutually exclusive with parentTaskId and includeDescendants.',
        );
      }
      where.parentTaskId = { in: requestedParentTaskIds };
    }
    if (filters?.taskType) {
      where.type = filters.taskType;
    }

    const sortBy = filters?.sortBy ?? 'createdAt';
    const sortDir = filters?.sortDir ?? 'desc';
    const prismaSortBy = sortBy === 'title' ? 'name' : sortBy;

    const taskInclude = this.buildTaskInclude(organizationId, {
      includeDesignDocCounts: filters?.includeDesignDocCounts,
      includeServiceRelations: filters?.includeServiceRelations,
    });

    const findManyArgs: Prisma.TaskFindManyArgs = {
      where,
      orderBy: {
        [prismaSortBy]: sortDir,
      },
      skip,
      take: limit,
    };
    if (taskInclude) {
      findManyArgs.include = taskInclude;
    }

    const tasks = (await this.prisma.db.task.findMany(
      findManyArgs as any,
    )) as TaskWithCountsAndRelations[];

    const designDocCountsMap = filters?.includeDesignDocCounts
      ? await this.buildDesignDocCountsMapForTaskIds(
          organizationId,
          tasks.map((t) => t.id),
        )
      : undefined;
    const agentSessionCountsMap = filters?.includeAgentSessionCounts
      ? await this.buildAgentSessionCountsMap(
          organizationId,
          tasks.map((t) => t.id),
        )
      : undefined;
    const edgesMap =
      filters?.includeEdges && filters?.projectId
        ? await this.buildGraphGatedTaskEdgesMap(
            organizationId,
            filters.projectId,
            tasks,
            filters?.userToken ?? null,
            filters?.edgeTypes,
          )
        : undefined;
    const goalTaskIds =
      trackedProjections.includeTrackedEntities ||
      trackedProjections.includeTrackedWorkSummary
        ? tasks
            .filter((t) => t.type === WORK_ITEM_TYPE_KEYS.Goal)
            .map((t) => t.id)
        : [];
    const trackedRowsByGoal =
      goalTaskIds.length > 0 && filters?.projectId && filters?.userToken
        ? await this.loadTrackedTaskRowsByGoal(
            organizationId,
            filters.projectId,
            goalTaskIds,
            filters.userToken,
            trackedProjections,
          )
        : undefined;

    return this.mapMixedInitiativeTasksWithChildCounts(
      tasks,
      organizationId,
      designDocCountsMap,
      agentSessionCountsMap,
      filters?.includeSectionKeys,
      edgesMap,
      trackedRowsByGoal,
      trackedProjections,
    );
  }

  private validateUuidFilterList<T extends string>(
    field: string,
    ids: T[],
    maxItems: number,
  ): T[] {
    if (ids.length === 0) {
      throw new BadRequestException(`${field} must contain at least one UUID`);
    }
    if (ids.length > maxItems) {
      throw new BadRequestException(
        `${field} may contain at most ${maxItems} UUIDs`,
      );
    }
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(`${field} must contain unique UUIDs`);
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const id of ids) {
      if (!uuidPattern.test(id)) {
        throw new BadRequestException(`${field} contains invalid UUID: ${id}`);
      }
    }

    return ids;
  }

  private toTaskDependencyResponse(
    dependency: TaskDependencyEntity,
  ): TaskDependencyResponseDto {
    return {
      id: dependency.id,
      dependentTaskId: dependency.dependentTaskId,
      dependencyTaskId: dependency.dependencyTaskId,
      relationType: dependency.relationType,
      sourceType: dependency.sourceType,
      createdById: dependency.createdById ?? undefined,
      reason: dependency.reason ?? undefined,
      createdAt: dependency.createdAt.toISOString(),
      updatedAt: dependency.updatedAt.toISOString(),
    };
  }

  private async loadTaskDependencyContext(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<{
    taskId: TaskId;
    initiativeId: InitiativeId | null;
    projectId: ProjectId;
  }> {
    const task = await this.prisma.db.task.findFirst({
      where: {
        id: taskId,
        organizationId,
        archivedAt: null,
      },
      select: {
        id: true,
        initiativeId: true,
        projectId: true,
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    return {
      taskId: task.id,
      initiativeId: task.initiativeId,
      projectId: task.projectId as ProjectId,
    };
  }

  private async assertNoCircularDependency(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    dependentTaskId: TaskId;
    dependencyTaskId: TaskId;
    excludeDependencyIds?: string[];
  }): Promise<void> {
    if (params.dependentTaskId === params.dependencyTaskId) {
      throw new BadRequestException('Task cannot depend on itself');
    }

    const existingDependencies = await this.prisma.db.taskDependency.findMany({
      where: {
        ...(params.excludeDependencyIds?.length
          ? { id: { notIn: params.excludeDependencyIds } }
          : {}),
        dependentTask: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          archivedAt: null,
        },
        dependencyTask: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          archivedAt: null,
        },
      },
      select: {
        dependentTaskId: true,
        dependencyTaskId: true,
      },
    });

    const adjacency = new Map<string, Set<string>>();
    for (const dependency of existingDependencies) {
      const list =
        adjacency.get(dependency.dependentTaskId) ?? new Set<string>();
      list.add(dependency.dependencyTaskId);
      adjacency.set(dependency.dependentTaskId, list);
    }

    const newEdge = adjacency.get(params.dependentTaskId) ?? new Set<string>();
    newEdge.add(params.dependencyTaskId);
    adjacency.set(params.dependentTaskId, newEdge);

    const visited = new Set<string>();
    const stack: string[] = [params.dependencyTaskId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      if (current === params.dependentTaskId) {
        throw new BadRequestException('Circular dependency detected');
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const neighbors = adjacency.get(current);
      if (neighbors) {
        for (const next of neighbors) {
          if (!visited.has(next)) {
            stack.push(next);
          }
        }
      }
    }
  }

  async listDependenciesByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
  ): Promise<TaskDependencyResponseDto[]> {
    await this.loadTaskDependencyContext(organizationId, taskId);

    const dependencies = await this.prisma.db.taskDependency.findMany({
      where: {
        dependentTaskId: taskId,
        dependentTask: {
          organizationId,
          archivedAt: null,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return dependencies.map((dependency) =>
      this.toTaskDependencyResponse(dependency),
    );
  }

  async listDependenciesForInitiative(
    organizationId: OrganizationId,
    initiativeId: InitiativeId,
  ): Promise<TaskDependencyResponseDto[]> {
    const dependencies = await this.prisma.db.taskDependency.findMany({
      where: {
        dependentTask: {
          organizationId,
          initiativeId,
          archivedAt: null,
        },
        dependencyTask: {
          organizationId,
          archivedAt: null,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return dependencies.map((dependency) =>
      this.toTaskDependencyResponse(dependency),
    );
  }

  async applyInferredDependenciesForTask(
    organizationId: OrganizationId,
    initiativeId: InitiativeId | null,
    targetTaskId: TaskId,
    params: {
      newDependencies: Array<{
        dependentTaskId: TaskId;
        dependencyTaskId: TaskId;
        relationType: TaskDependencyRelationType;
        reason?: string | null;
      }>;
      updatedDependencies: Array<{
        originalDependentTaskId: TaskId;
        originalDependencyTaskId: TaskId;
        newDependencyTaskId: TaskId;
        reason?: string | null;
      }>;
    },
  ): Promise<void> {
    const { newDependencies, updatedDependencies } = params;
    if (!newDependencies.length && !updatedDependencies.length) {
      return;
    }

    const targetContext = await this.loadTaskDependencyContext(
      organizationId,
      targetTaskId,
    );

    let dependenciesToReplace: Array<{
      id: string;
      dependentTaskId: string;
      dependencyTaskId: string;
    }> = [];

    if (updatedDependencies.length) {
      const dependentIds = Array.from(
        new Set(updatedDependencies.map((dep) => dep.originalDependentTaskId)),
      );
      const dependencyIds = Array.from(
        new Set(updatedDependencies.map((dep) => dep.originalDependencyTaskId)),
      );

      dependenciesToReplace = await this.prisma.db.taskDependency.findMany({
        where: {
          dependentTaskId: { in: dependentIds },
          dependencyTaskId: { in: dependencyIds },
          dependentTask: {
            organizationId,
            archivedAt: null,
          },
          dependencyTask: {
            organizationId,
            archivedAt: null,
          },
        },
        select: {
          id: true,
          dependentTaskId: true,
          dependencyTaskId: true,
        },
      });

      const existingByKey = new Map(
        dependenciesToReplace.map((dep) => [
          `${dep.dependentTaskId}|${dep.dependencyTaskId}`,
          dep,
        ]),
      );
      const missingUpdates = updatedDependencies.filter(
        (dep) =>
          !existingByKey.has(
            `${dep.originalDependentTaskId}|${dep.originalDependencyTaskId}`,
          ),
      );

      if (missingUpdates.length) {
        throw new BadRequestException(
          `Inferred dependency updates include unknown edges: ${missingUpdates.length}`,
        );
      }
    }

    const inferredDependencies = [
      ...newDependencies,
      ...updatedDependencies.flatMap((dep) => [
        {
          dependentTaskId: dep.originalDependentTaskId,
          dependencyTaskId: dep.newDependencyTaskId,
          relationType: TaskDependencyRelationType.DEPENDS_ON,
          reason: dep.reason ?? undefined,
        },
        {
          dependentTaskId: dep.newDependencyTaskId,
          dependencyTaskId: dep.originalDependencyTaskId,
          relationType: TaskDependencyRelationType.DEPENDS_ON,
          reason: dep.reason ?? undefined,
        },
      ]),
    ];

    if (inferredDependencies.length && !initiativeId) {
      this.logger.debug(
        `Skipping ${inferredDependencies.length} inferred dependencies for task ${targetTaskId} — no initiativeId`,
      );
    }
    if (inferredDependencies.length && initiativeId) {
      const targetTaskIds = Array.from(
        new Set([
          targetTaskId,
          ...updatedDependencies.map((dep) => dep.newDependencyTaskId),
        ]),
      );

      await this.applyInferredDependenciesByInitiative(
        organizationId,
        initiativeId,
        {
          targetTaskIds,
          dependencies: inferredDependencies,
        },
      );
    }

    if (dependenciesToReplace.length) {
      await this.prisma.db.taskDependency.deleteMany({
        where: {
          id: { in: dependenciesToReplace.map((dep) => dep.id) },
        },
      });
    }
  }

  async applyInferredDependenciesByInitiative(
    organizationId: OrganizationId,
    initiativeId: InitiativeId,
    params: {
      targetTaskIds: TaskId[];
      dependencies: Array<{
        dependentTaskId: TaskId;
        dependencyTaskId: TaskId;
        relationType: TaskDependencyRelationType;
        reason?: string | null;
      }>;
    },
  ): Promise<TaskDependencyResponseDto[]> {
    if (!params.dependencies.length || !params.targetTaskIds.length) {
      return [];
    }

    const initiative = await this.prisma.db.initiative.findFirst({
      where: {
        id: initiativeId,
        organizationId,
      },
      select: {
        originatingProjectId: true,
      },
    });

    if (!initiative) {
      throw new NotFoundException(
        `Initiative ${initiativeId} not found for dependency inference.`,
      );
    }

    if (!initiative.originatingProjectId) {
      throw new BadRequestException(
        `Initiative ${initiativeId} is missing originating project data.`,
      );
    }

    const projectId = initiative.originatingProjectId as ProjectId;

    const tasks = await this.prisma.db.task.findMany({
      where: {
        organizationId,
        initiativeId,
        archivedAt: null,
      },
      select: {
        id: true,
      },
    });

    const taskIdSet = new Set(
      tasks.map((task) => task.id as unknown as TaskId),
    );
    const targetTaskSet = new Set(
      params.targetTaskIds.filter((taskId) => taskIdSet.has(taskId)),
    );

    if (!targetTaskSet.size) {
      return [];
    }

    const invalidEdges: Array<{
      dependentTaskId: TaskId;
      dependencyTaskId: TaskId;
    }> = [];
    const candidateEdges = new Map<
      string,
      (typeof params.dependencies)[number]
    >();

    for (const dependency of params.dependencies) {
      const { dependentTaskId, dependencyTaskId } = dependency;

      if (
        !taskIdSet.has(dependentTaskId) ||
        !taskIdSet.has(dependencyTaskId) ||
        dependentTaskId === dependencyTaskId
      ) {
        invalidEdges.push({ dependentTaskId, dependencyTaskId });
        continue;
      }

      if (
        !targetTaskSet.has(dependentTaskId) &&
        !targetTaskSet.has(dependencyTaskId)
      ) {
        continue;
      }

      const key = `${dependentTaskId}|${dependencyTaskId}`;
      if (!candidateEdges.has(key)) {
        candidateEdges.set(key, dependency);
      }
    }

    if (invalidEdges.length) {
      throw new BadRequestException(
        `Inferred dependencies include invalid task references: ${invalidEdges.length}`,
      );
    }

    if (!candidateEdges.size) {
      return [];
    }

    const existingDependencies = await this.prisma.db.taskDependency.findMany({
      where: {
        dependentTask: {
          organizationId,
          initiativeId,
          archivedAt: null,
        },
        dependencyTask: {
          organizationId,
          archivedAt: null,
        },
      },
      select: {
        dependentTaskId: true,
        dependencyTaskId: true,
      },
    });

    const existingPairs = new Set(
      existingDependencies.map(
        (dependency) =>
          `${dependency.dependentTaskId}|${dependency.dependencyTaskId}`,
      ),
    );

    const created: TaskDependencyResponseDto[] = [];

    for (const dependency of candidateEdges.values()) {
      const pairKey = `${dependency.dependentTaskId}|${dependency.dependencyTaskId}`;
      if (existingPairs.has(pairKey)) {
        continue;
      }

      await this.assertNoCircularDependency({
        organizationId,
        projectId,
        dependentTaskId: dependency.dependentTaskId,
        dependencyTaskId: dependency.dependencyTaskId,
      });

      const createdDependency = await this.prisma.db.taskDependency.create({
        data: {
          dependentTaskId: dependency.dependentTaskId,
          dependencyTaskId: dependency.dependencyTaskId,
          relationType: dependency.relationType,
          sourceType: TaskDependencySourceType.SYSTEM,
          reason: dependency.reason ?? null,
        },
      });

      created.push(this.toTaskDependencyResponse(createdDependency));
    }

    return created;
  }

  async createDependencyByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
    dto: CreateTaskDependencyDto,
    userId?: UserId,
  ): Promise<TaskDependencyResponseDto> {
    if (!dto.dependencyTaskId) {
      throw new BadRequestException('dependencyTaskId is required');
    }

    const dependent = await this.loadTaskDependencyContext(
      organizationId,
      taskId,
    );
    const dependency = await this.loadTaskDependencyContext(
      organizationId,
      dto.dependencyTaskId as TaskId,
    );

    if (dependent.projectId !== dependency.projectId) {
      throw new BadRequestException(
        'Tasks must belong to the same originating project',
      );
    }

    if (dependent.taskId === dependency.taskId) {
      throw new BadRequestException('Task cannot depend on itself');
    }

    const existing = await this.prisma.db.taskDependency.findFirst({
      where: {
        dependentTaskId: dependent.taskId,
        dependencyTaskId: dependency.taskId,
      },
    });

    if (existing) {
      throw new BadRequestException('Task dependency already exists');
    }

    await this.assertNoCircularDependency({
      organizationId,
      projectId: dependent.projectId,
      dependentTaskId: dependent.taskId,
      dependencyTaskId: dependency.taskId,
    });

    const sourceType =
      (dto.sourceType as TaskDependencySourceType | undefined) ??
      TaskDependencySourceType.USER;
    if (sourceType === TaskDependencySourceType.USER && !userId) {
      throw new BadRequestException(
        'createdBy is required for user-created dependencies',
      );
    }

    const created = await this.prisma.db.taskDependency.create({
      data: {
        dependentTaskId: dependent.taskId,
        dependencyTaskId: dependency.taskId,
        relationType:
          (dto.relationType as TaskDependencyRelationType | undefined) ??
          TaskDependencyRelationType.DEPENDS_ON,
        sourceType,
        createdById:
          sourceType === TaskDependencySourceType.USER ? userId : null,
        reason: dto.reason ?? null,
      },
    });

    return this.toTaskDependencyResponse(created);
  }

  async updateDependencyByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
    dependencyId: string,
    dto: UpdateTaskDependencyDto,
    userId?: UserId,
  ): Promise<TaskDependencyResponseDto> {
    if (!userId) {
      throw new BadRequestException('createdBy is required for updates');
    }

    const updatePayload = {
      dependencyTaskId: dto.dependencyTaskId,
      relationType: dto.relationType,
      reason: dto.reason,
    };
    const hasUpdates = Object.values(updatePayload).some(
      (value) => value !== undefined,
    );
    if (!hasUpdates) {
      throw new BadRequestException('No updates provided');
    }

    const dependent = await this.loadTaskDependencyContext(
      organizationId,
      taskId,
    );
    const existing = await this.prisma.db.taskDependency.findFirst({
      where: {
        id: dependencyId,
        dependentTaskId: taskId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Task dependency not found');
    }

    const dependencyTaskId = (dto.dependencyTaskId ??
      existing.dependencyTaskId) as TaskId;
    const dependency = await this.loadTaskDependencyContext(
      organizationId,
      dependencyTaskId,
    );

    if (dependent.projectId !== dependency.projectId) {
      throw new BadRequestException(
        'Tasks must belong to the same originating project',
      );
    }

    if (dependent.taskId === dependency.taskId) {
      throw new BadRequestException('Task cannot depend on itself');
    }

    const duplicate = await this.prisma.db.taskDependency.findFirst({
      where: {
        id: { not: dependencyId },
        dependentTaskId: taskId,
        dependencyTaskId: dependency.taskId,
      },
    });

    if (duplicate) {
      throw new BadRequestException('Task dependency already exists');
    }

    await this.assertNoCircularDependency({
      organizationId,
      projectId: dependent.projectId,
      dependentTaskId: dependent.taskId,
      dependencyTaskId: dependency.taskId,
      excludeDependencyIds: [dependencyId],
    });

    const updated = await this.prisma.db.taskDependency.update({
      where: { id: dependencyId },
      data: {
        dependencyTaskId: dependency.taskId,
        relationType:
          (dto.relationType as TaskDependencyRelationType | undefined) ??
          existing.relationType,
        reason: dto.reason ?? existing.reason,
        sourceType: TaskDependencySourceType.USER,
        createdById: userId,
      },
    });

    return this.toTaskDependencyResponse(updated);
  }

  async removeDependencyByOrganization(
    organizationId: OrganizationId,
    taskId: TaskId,
    dependencyId: string,
  ): Promise<TaskDependencyResponseDto> {
    await this.loadTaskDependencyContext(organizationId, taskId);

    const existing = await this.prisma.db.taskDependency.findFirst({
      where: {
        id: dependencyId,
        dependentTaskId: taskId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Task dependency not found');
    }

    const removed = await this.prisma.db.taskDependency.delete({
      where: { id: dependencyId },
    });

    return this.toTaskDependencyResponse(removed);
  }

  /**
   * Create task refinement conversation
   * Adapter method that will delegate to task lifecycle service when created
   */
  async createRefinementConversation(
    taskId: TaskId,
    organizationId: OrganizationId,
    projectId?: ProjectId,
  ): Promise<{
    conversation: ConversationResponseDto;
    entities: TaskResponseDto[];
  }> {
    // For now, this is a placeholder until we create TaskLifecycleService
    // similar to InitiativeLifecycleService
    this.logger.warn(
      'Task refinement conversation creation not yet implemented - requires TaskLifecycleService',
      {
        taskId,
        organizationId,
        projectId,
      },
    );

    throw new Error(
      'Task refinement conversations not yet implemented. This will be completed in Phase 4.',
    );
  }

  /**
   * Get active task refinement conversation
   * Adapter method for unified refinement system
   */
  async getActiveRefinementConversation(
    taskId: TaskId,
    organizationId: OrganizationId,
  ): Promise<string | null> {
    // This will need to be implemented similar to initiative conversations
    this.logger.warn(
      'Task active refinement conversation lookup not yet implemented',
      {
        taskId,
        organizationId,
      },
    );

    return null; // Will be implemented when task workflows are created
  }
}
