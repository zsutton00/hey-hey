import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EntityType, WorkStatus } from '@prisma/client';
import {
  AdrStatus,
  AgentSessionCreatedEvent,
  ProjectStatus,
  TaskEventUpdateSnapshot,
  UpdateProjectDto,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { EntityRegistryService } from 'src/services/entity-registry/entity-registry.service';
import { EntitySummaryService } from 'src/services/entity-summary/entity-summary.service';
import { SubfacetService } from 'src/services/entity-summary/subfacet.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskDependencyInferenceService } from 'src/services/tasks/task-dependency-inference.service';
import {
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  WorkflowAboutType,
} from 'src/types';
import { isRefining } from 'src/utils/work-item.util';

@Injectable()
export class EntityLifecycleProcessor implements OnModuleInit {
  private readonly logger = new Logger(EntityLifecycleProcessor.name);

  constructor(
    private readonly entitySummaryService: EntitySummaryService,
    private readonly initiativeService: InitiativeService,
    private readonly entityRegistryService: EntityRegistryService,
    private readonly prisma: PrismaService,
    private readonly taskDependencyInferenceService: TaskDependencyInferenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.debug('[EntityLifecycleProcessor] Ready');
  }

  async handleTaskStatusChanged(params: {
    organizationId: OrganizationId;
    taskId: string;
    previousStatus: WorkStatus;
    newStatus: WorkStatus;
    projectId?: ProjectId | null;
  }): Promise<void> {
    const { organizationId, taskId, previousStatus, newStatus, projectId } =
      params;

    const wasRefining = isRefining(previousStatus);
    const isNotRefining = !isRefining(newStatus);
    const shouldGenerate = wasRefining && isNotRefining && projectId;

    this.logger.debug(
      '[EntityLifecycleProcessor] Checking if we should generate task summary',
      {
        wasRefining,
        isNotRefining,
        projectId,
        shouldGenerate,
      },
    );

    if (shouldGenerate) {
      await this.triggerSummarization(
        organizationId,
        projectId,
        taskId,
        'task',
      );
    }
  }

  async handleProjectUpdated(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    update: UpdateProjectDto;
  }): Promise<void> {
    const { organizationId, projectId, update } = params;

    this.logger.debug('[EntityLifecycleProcessor] Project update received', {
      organizationId,
      projectId,
      updateFields: Object.keys(update),
    });
  }

  async handleProjectStatusChanged(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    status: ProjectStatus;
  }): Promise<void> {
    const { organizationId, projectId, status } = params;

    this.logger.debug(
      '[EntityLifecycleProcessor] Project status change received',
      {
        organizationId,
        projectId,
        status,
      },
    );
  }

  async handleProjectDeleted(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    deletedAt?: string | Date | null;
  }): Promise<void> {
    const { organizationId, projectId, deletedAt } = params;
    const deletedDate =
      deletedAt instanceof Date
        ? deletedAt
        : deletedAt
          ? new Date(deletedAt)
          : new Date();

    await this.deactivateEntityAndRegistry({
      organizationId,
      projectId,
      entityId: projectId,
      entityType: EntityType.PROJECT,
      deletedAt: deletedDate,
      nameLookup: () => this.lookupProjectName(organizationId, projectId),
    });

    this.logger.debug('[EntityLifecycleProcessor] Project lifecycle handled', {
      projectId,
      organizationId,
      action: 'deleted',
    });
  }

  async handleInitiativeStatusChanged(params: {
    organizationId: OrganizationId;
    initiativeId: string;
    previousStatus: WorkStatus;
    newStatus: WorkStatus;
    originatingProjectId?: ProjectId | null;
  }): Promise<void> {
    const {
      organizationId,
      initiativeId,
      previousStatus,
      newStatus,
      originatingProjectId,
    } = params;

    if (
      isRefining(previousStatus) &&
      newStatus === WorkStatus.BACKLOG &&
      originatingProjectId
    ) {
      await this.triggerSummarization(
        organizationId,
        originatingProjectId,
        initiativeId,
        'initiative',
      );
    }
  }

  private async triggerSummarization(
    organizationId: string,
    projectId: string,
    triggerSourceId: string,
    workflowAboutType: WorkflowAboutType,
  ): Promise<void> {
    this.logger.debug(
      '[EntityLifecycleProcessor] Entity summarization disabled',
      {
        organizationId,
        projectId,
        triggerSourceId,
        workflowAboutType,
      },
    );
  }

  async handleDesignDocStatusChanged(params: {
    organizationId: OrganizationId;
    designDocId: string;
    newStatus: string;
    originatingProjectId?: ProjectId | null;
  }): Promise<void> {
    const { organizationId, designDocId, newStatus, originatingProjectId } =
      params;

    if (newStatus === AdrStatus.Ready && originatingProjectId) {
      await this.triggerSummarization(
        organizationId,
        originatingProjectId,
        designDocId,
        'design-doc',
      );
    }
  }

  async handleConversationCompleted(params: {
    organizationId: OrganizationId;
    conversationId: string;
    originatingProjectId?: ProjectId | null;
    approxWordCount?: number;
    messageCount?: number;
  }): Promise<void> {
    const { organizationId, conversationId, originatingProjectId } = params;

    // Simple heuristic: require minimal content to avoid low-signal summaries
    const wordThreshold = 80;
    const messageThreshold = 5;
    const meetsThreshold =
      (params.approxWordCount ?? 0) >= wordThreshold ||
      (params.messageCount ?? 0) >= messageThreshold;

    if (!originatingProjectId || !meetsThreshold) {
      return;
    }

    await this.triggerSummarization(
      organizationId,
      originatingProjectId,
      conversationId,
      'conversation',
    );
  }

  async handleAgentSessionCreated(
    event: AgentSessionCreatedEvent,
  ): Promise<void> {
    const { organizationId, agentSession } = event.payload;

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: agentSession.id,
      entityType: EntityType.AGENT_SESSION,
      name: agentSession.title,
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] Agent session lifecycle handled',
      {
        agentSessionId: agentSession.id,
        organizationId,
        action: 'created',
      },
    );
  }

  async handleTaskCreated(params: {
    organizationId: OrganizationId;
    taskId: TaskId;
    name: string;
    initiativeId: InitiativeId | null;
    projectId: ProjectId;
  }): Promise<void> {
    const { organizationId, taskId, name } = params;

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: taskId,
      entityType: EntityType.TASK,
      name,
    });

    this.logger.debug('[EntityLifecycleProcessor] Task lifecycle handled', {
      taskId,
      organizationId,
      action: 'created',
    });
  }

  async handleTaskUpdated(params: {
    organizationId: OrganizationId;
    taskId: TaskId;
    name?: string;
    update?: TaskEventUpdateSnapshot;
    previousData?: Record<string, unknown>;
    initiativeId?: InitiativeId;
    projectId?: ProjectId;
  }): Promise<void> {
    const {
      organizationId,
      taskId,
      name,
      update,
      previousData,
      initiativeId,
      projectId,
    } = params;
    const updatedName = name ?? update?.name;
    if (updatedName) {
      await this.entityRegistryService.registerEntity({
        organizationId,
        entityId: taskId,
        entityType: EntityType.TASK,
        name: updatedName,
      });

      this.logger.debug('[EntityLifecycleProcessor] Task lifecycle handled', {
        taskId,
        organizationId,
        action: 'updated',
        updatedFields: ['name'],
      });
    }

    if (
      initiativeId &&
      projectId &&
      update &&
      (await this.shouldInferTaskDependencies(
        organizationId,
        initiativeId,
        update,
        previousData,
      ))
    ) {
      this.taskDependencyInferenceService.queueInference({
        organizationId,
        initiativeId,
        projectId,
        taskId,
      });
    }
  }

  private async shouldInferTaskDependencies(
    organizationId: OrganizationId,
    initiativeId: InitiativeId,
    update: TaskEventUpdateSnapshot,
    previousData?: Record<string, unknown>,
  ): Promise<boolean> {
    const previousStatus = previousData?.status as WorkStatus | undefined;
    const nextStatus = update.status as WorkStatus | undefined;
    if (!previousStatus || !nextStatus) {
      return false;
    }
    if (
      previousStatus === WorkStatus.REFINING_ACCEPTANCE_CRITERIA &&
      !isRefining(nextStatus)
    ) {
      const initiative = await this.initiativeService.findOne(
        initiativeId,
        organizationId,
      );
      return initiative?.sourceType !== 'PLAN';
    }

    return false;
  }

  async handleTaskArchived(params: {
    organizationId: OrganizationId;
    taskId: string;
    archivedAt?: string | Date | null;
    projectId: ProjectId;
  }): Promise<void> {
    const { organizationId, taskId, projectId, archivedAt } = params;
    const deletedAt =
      archivedAt instanceof Date
        ? archivedAt
        : archivedAt
          ? new Date(archivedAt)
          : new Date();

    await this.deactivateEntityAndRegistry({
      organizationId,
      entityId: taskId,
      entityType: EntityType.TASK,
      deletedAt,
      projectId,
      nameLookup: () => this.lookupTaskName(organizationId, taskId),
    });

    this.logger.debug('[EntityLifecycleProcessor] Task lifecycle handled', {
      taskId,
      organizationId,
      action: 'archived',
    });
  }

  async handleInitiativeCreated(params: {
    organizationId: OrganizationId;
    initiativeId: string;
    name: string;
  }): Promise<void> {
    const { organizationId, initiativeId, name } = params;
    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: initiativeId,
      entityType: EntityType.INITIATIVE,
      name,
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] Initiative lifecycle handled',
      {
        initiativeId,
        organizationId,
        action: 'created',
      },
    );
  }

  async handleInitiativeUpdated(params: {
    organizationId: OrganizationId;
    initiativeId: string;
    name?: string;
  }): Promise<void> {
    const { organizationId, initiativeId, name } = params;
    if (!name) {
      return;
    }

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: initiativeId,
      entityType: EntityType.INITIATIVE,
      name,
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] Initiative lifecycle handled',
      {
        initiativeId,
        organizationId,
        action: 'updated',
        updatedFields: ['name'],
      },
    );
  }

  async handleInitiativeArchived(params: {
    organizationId: OrganizationId;
    initiativeId: string;
    archivedAt?: string | Date | null;
    projectId: ProjectId;
  }): Promise<void> {
    const { organizationId, initiativeId, archivedAt, projectId } = params;
    const deletedAt =
      archivedAt instanceof Date
        ? archivedAt
        : archivedAt
          ? new Date(archivedAt)
          : new Date();

    await this.deactivateEntityAndRegistry({
      organizationId,
      entityId: initiativeId,
      entityType: EntityType.INITIATIVE,
      deletedAt,
      projectId,
      nameLookup: () => this.lookupInitiativeName(organizationId, initiativeId),
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] Initiative lifecycle handled',
      {
        initiativeId,
        organizationId,
        action: 'archived',
      },
    );
  }

  async handleDesignDocCreated(params: {
    organizationId: OrganizationId;
    designDocId: string;
    name: string;
  }): Promise<void> {
    const { organizationId, designDocId, name } = params;
    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: designDocId,
      entityType: EntityType.DESIGN_DOC,
      name,
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] DesignDoc lifecycle handled',
      {
        designDocId,
        organizationId,
        action: 'created',
      },
    );
  }

  async handleDesignDocUpdated(params: {
    organizationId: OrganizationId;
    designDocId: string;
    name?: string;
  }): Promise<void> {
    const { organizationId, designDocId, name } = params;
    if (!name) {
      return;
    }

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: designDocId,
      entityType: EntityType.DESIGN_DOC,
      name,
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] DesignDoc lifecycle handled',
      {
        designDocId,
        organizationId,
        action: 'updated',
        updatedFields: ['name'],
      },
    );
  }

  async handleDesignDocArchived(params: {
    organizationId: OrganizationId;
    designDocId: string;
    archivedAt?: string | Date | null;
    projectId: ProjectId;
  }): Promise<void> {
    const { organizationId, designDocId, archivedAt, projectId } = params;
    const deletedAt =
      archivedAt instanceof Date
        ? archivedAt
        : archivedAt
          ? new Date(archivedAt)
          : new Date();

    await this.deactivateEntityAndRegistry({
      organizationId,
      entityId: designDocId,
      entityType: EntityType.DESIGN_DOC,
      deletedAt,
      projectId,
      nameLookup: () => this.lookupDesignDocName(organizationId, designDocId),
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] DesignDoc lifecycle handled',
      {
        designDocId,
        organizationId,
        action: 'archived',
      },
    );
  }

  async handleDesignDocRestored(params: {
    organizationId: OrganizationId;
    designDocId: string;
    name?: string;
  }): Promise<void> {
    const { organizationId, designDocId, name } = params;

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: designDocId,
      entityType: EntityType.DESIGN_DOC,
      name: name ?? '',
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] DesignDoc lifecycle handled',
      {
        designDocId,
        organizationId,
        action: 'restored',
      },
    );
  }

  async handleServiceCreated(params: {
    organizationId: OrganizationId;
    serviceId: string;
    name: string;
  }): Promise<void> {
    const { organizationId, serviceId, name } = params;

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: serviceId,
      entityType: EntityType.SERVICE,
      name,
    });

    this.logger.debug('[EntityLifecycleProcessor] Service lifecycle handled', {
      serviceId,
      organizationId,
      action: 'created',
    });
  }

  async handleServiceUpdated(params: {
    organizationId: OrganizationId;
    serviceId: string;
    name: string;
  }): Promise<void> {
    const { organizationId, serviceId, name } = params;

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: serviceId,
      entityType: EntityType.SERVICE,
      name,
    });

    this.logger.debug('[EntityLifecycleProcessor] Service lifecycle handled', {
      serviceId,
      organizationId,
      action: 'updated',
      updatedFields: ['name'],
    });
  }

  async handleServiceArchived(params: {
    organizationId: OrganizationId;
    serviceId: string;
    archivedAt?: string | Date | null;
    name?: string;
    projectId?: ProjectId | string;
  }): Promise<void> {
    const { organizationId, serviceId, archivedAt, name, projectId } = params;
    const deletedAt =
      archivedAt instanceof Date
        ? archivedAt
        : archivedAt
          ? new Date(archivedAt)
          : new Date();

    await this.entityRegistryService.recordEntityDeletion({
      organizationId,
      entityId: serviceId,
      entityType: EntityType.SERVICE,
      name,
      deletedAt,
    });

    if (projectId) {
      await this.entitySummaryService.deactivateCurrentSummaries({
        organizationId,
        projectId: projectId as ProjectId,
        entityType: EntityType.SERVICE,
        entityId: serviceId,
      });
    }

    this.logger.debug('[EntityLifecycleProcessor] Service lifecycle handled', {
      serviceId,
      organizationId,
      action: 'archived',
    });
  }

  async handleConversationCreated(params: {
    organizationId: OrganizationId;
    conversationId: string;
    name: string;
  }): Promise<void> {
    const { organizationId, conversationId, name } = params;

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: conversationId,
      entityType: EntityType.CONVERSATION,
      name,
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] Conversation lifecycle handled',
      {
        conversationId,
        organizationId,
        action: 'created',
      },
    );
  }

  async handleConversationUpdated(params: {
    organizationId: OrganizationId;
    conversationId: string;
    name?: string;
  }): Promise<void> {
    const { organizationId, conversationId, name } = params;
    if (!name) {
      return;
    }

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: conversationId,
      entityType: EntityType.CONVERSATION,
      name,
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] Conversation lifecycle handled',
      {
        conversationId,
        organizationId,
        action: 'updated',
        updatedFields: ['name'],
      },
    );
  }

  async handleConversationDeleted(params: {
    organizationId: OrganizationId;
    conversationId: string;
    deletedAt?: string | Date | null;
    projectId: ProjectId;
  }): Promise<void> {
    const { organizationId, conversationId, deletedAt, projectId } = params;
    const deletedDate =
      deletedAt instanceof Date
        ? deletedAt
        : deletedAt
          ? new Date(deletedAt)
          : new Date();

    await this.deactivateEntityAndRegistry({
      organizationId,
      entityId: conversationId,
      entityType: EntityType.CONVERSATION,
      projectId,
      deletedAt: deletedDate,
      nameLookup: () =>
        this.lookupConversationTitle(organizationId, conversationId),
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] Conversation lifecycle handled',
      {
        conversationId,
        organizationId,
        action: 'deleted',
      },
    );
  }

  async handleMessageCreated(params: {
    organizationId: OrganizationId;
    messageId: string;
    type: 'SYSTEM' | 'USER';
    projectId?: ProjectId | null;
    shouldProcess?: boolean;
  }): Promise<void> {
    const { organizationId, messageId, type, projectId, shouldProcess } =
      params;

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: messageId,
      entityType: EntityType.MESSAGE,
      name: `${type} message`,
    });

    this.logger.debug('[EntityLifecycleProcessor] Message lifecycle handled', {
      messageId,
      organizationId,
      action: 'created',
      summarizationDisabled: true,
      projectId,
      shouldProcess,
    });
  }

  async handleMessageDeleted(params: {
    organizationId: OrganizationId;
    messageId: string;
    deletedAt?: string | Date | null;
    projectId: ProjectId;
  }): Promise<void> {
    const { organizationId, messageId, deletedAt, projectId } = params;
    const deletedDate =
      deletedAt instanceof Date
        ? deletedAt
        : deletedAt
          ? new Date(deletedAt)
          : new Date();

    await this.deactivateEntityAndRegistry({
      organizationId,
      entityId: messageId,
      entityType: EntityType.MESSAGE,
      deletedAt: deletedDate,
      nameLookup: () => this.lookupMessageName(organizationId, messageId),
      projectId,
    });

    this.logger.debug('[EntityLifecycleProcessor] Message lifecycle handled', {
      messageId,
      organizationId,
      action: 'deleted',
    });
  }

  async handleAgentSessionRenamed(params: {
    organizationId: OrganizationId;
    agentSessionId: string;
    title?: string | null;
  }): Promise<void> {
    const { organizationId, agentSessionId, title } = params;
    if (!title) {
      return;
    }

    await this.entityRegistryService.registerEntity({
      organizationId,
      entityId: agentSessionId,
      entityType: EntityType.AGENT_SESSION,
      name: title,
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] Agent session lifecycle handled',
      {
        agentSessionId,
        organizationId,
        action: 'renamed',
      },
    );
  }

  async handleAgentSessionDeleted(params: {
    organizationId: OrganizationId;
    agentSessionId: string;
    deletedAt?: string | Date | null;
    projectId: ProjectId;
    title?: string | null;
  }): Promise<void> {
    const { organizationId, agentSessionId, deletedAt, projectId, title } =
      params;
    const deletedDate =
      deletedAt instanceof Date
        ? deletedAt
        : deletedAt
          ? new Date(deletedAt)
          : new Date();

    await this.entityRegistryService.recordEntityDeletion({
      organizationId,
      entityId: agentSessionId,
      entityType: EntityType.AGENT_SESSION,
      name: title ?? undefined,
      deletedAt: deletedDate,
    });

    await this.entitySummaryService.deactivateCurrentSummaries({
      organizationId,
      projectId,
      entityType: EntityType.AGENT_SESSION,
      entityId: agentSessionId,
    });

    this.logger.debug(
      '[EntityLifecycleProcessor] Agent session lifecycle handled',
      {
        agentSessionId,
        organizationId,
        action: 'deleted',
      },
    );
  }

  private async deactivateEntityAndRegistry(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    entityId: string;
    entityType: EntityType;
    deletedAt: Date;
    nameLookup?: () => Promise<string | null | undefined>;
  }): Promise<void> {
    const {
      organizationId,
      entityId,
      entityType,
      projectId,
      deletedAt,
      nameLookup,
    } = params;

    let entityName: string | undefined;
    if (nameLookup) {
      entityName = (await nameLookup()) ?? undefined;
      if (!entityName) {
        this.logger.warn(
          '[EntityLifecycleProcessor] Missing name for registry upsert on deletion',
          { organizationId, entityId, entityType },
        );
      }
    }

    await this.entityRegistryService.recordEntityDeletion({
      organizationId,
      entityId,
      entityType,
      name: entityName,
      deletedAt,
    });

    await this.entitySummaryService.deactivateCurrentSummaries({
      organizationId,
      projectId,
      entityType,
      entityId,
    });
  }

  private async lookupTaskName(
    organizationId: OrganizationId,
    taskId: string,
  ): Promise<string | undefined> {
    const task = await this.prisma.db.task.findFirst({
      where: { id: taskId, organizationId },
      select: { name: true },
    });

    return task?.name ?? undefined;
  }

  private async lookupProjectName(
    organizationId: OrganizationId,
    projectId: string,
  ): Promise<string | undefined> {
    const project = await this.prisma.db.project.findFirst({
      where: { id: projectId, organizationId },
      select: { name: true },
    });

    return project?.name ?? undefined;
  }

  private async lookupInitiativeName(
    organizationId: OrganizationId,
    initiativeId: string,
  ): Promise<string | undefined> {
    const initiative = await this.prisma.db.initiative.findFirst({
      where: { id: initiativeId, organizationId },
      select: { name: true },
    });

    return initiative?.name ?? undefined;
  }

  private async lookupDesignDocName(
    organizationId: OrganizationId,
    designDocId: string,
  ): Promise<string | undefined> {
    const designDoc = await this.prisma.db.designDoc.findFirst({
      where: { id: designDocId, organizationId },
      select: { name: true },
    });

    return designDoc?.name ?? undefined;
  }

  private async lookupConversationTitle(
    organizationId: OrganizationId,
    conversationId: string,
  ): Promise<string | undefined> {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { title: true },
    });

    return conversation?.title ?? undefined;
  }

  private async lookupMessageName(
    organizationId: OrganizationId,
    messageId: string,
  ): Promise<string | undefined> {
    const message = await this.prisma.db.message.findFirst({
      where: {
        id: messageId,
        conversation: { organizationId },
      },
      select: { type: true },
    });

    return message ? `${message.type} message` : undefined;
  }
}
