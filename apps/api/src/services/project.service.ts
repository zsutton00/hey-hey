import { ProjectMembershipRevocationService } from '../core/websockets/project-membership-revocation.service';
import { ProjectAccessService } from '../auth/services/project-access.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Client } from '@temporalio/client';
import {
  MockLlmSessionId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';

import {
  Prisma,
  Project,
  ProjectRole as PrismaProjectRole,
  EntityType,
} from '@prisma/client';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import {
  EventContextManager,
  WithEventContext,
} from '../core/events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../core/events/tokens';
import {
  ProjectDeletedEvent,
  ProjectStatusChangedEvent,
  ProjectUpdatedEvent,
} from '../core/events/types/domain-events';
import { EVENT_TYPES } from '../core/events/types/event.types';
import {
  AddProjectMemberDto,
  ConversationStatus,
  CreateProjectDto,
  InitiativeSourceType,
  PaginatedProjectMembersResponseDto,
  ProjectConfig,
  ProjectCountsResponseDto,
  ProjectDeletedEventPayload,
  ProjectMemberResponseDto,
  ProjectMemberUserDto,
  ProjectResponseDto,
  ProjectExistingWorkIntent,
  ProjectFeatureNextStep,
  ProjectFeatureNextStepKind,
  ProjectMaturity,
  ProjectRole,
  ProjectStatus,
  ProjectStatusChangedEventPayload,
  ProjectUpdatedEventPayload,
  UpdateProjectDto,
  WorkflowName,
} from '../generated';
import { AnyTransactionClient, PrismaService } from '../prisma/prisma.service';
import { InjectTemporalClient } from '../prisma/temporal.module';
import { ensureStringDate } from '../utils/date.util';
import { WorkItemTypeRegistryService } from './tasks/work-item-type-registry.service';
import { WorkflowTypeRegistryService } from './workflows/workflow-type-registry.service';
import { OrganizationProjectEntitlementService } from './organization-project-entitlement.service';
import { EntityRegistryService } from './entity-registry/entity-registry.service';
import { PROJECT_ORGANIC_ACTIVITY_EVENT_TYPES } from './project-metrics/accepted-evidence-selector.service';

const PROJECT_MEMBER_USER_SELECT = {
  id: true,
  email: true,
  name: true,
} as const;

const PROJECT_ESTABLISHED_ACTIVITY_THRESHOLD = 10;

const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  version: ProjectConfig.VersionEnum.NUMBER_1,
  existingWorkIntent: ProjectExistingWorkIntent.Unanswered,
};

export function buildProjectConfig(
  existingWorkIntent: ProjectExistingWorkIntent,
): ProjectConfig {
  return {
    version: ProjectConfig.VersionEnum.NUMBER_1,
    existingWorkIntent,
  };
}

const PROJECT_CONFIG_KEYS = new Set([
  'version',
  'existingWorkIntent',
  'featureNextSteps',
]);

const MAX_FEATURE_NEXT_STEPS = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFeatureNextStep(
  value: unknown,
): ProjectFeatureNextStep | undefined {
  if (
    !isRecord(value) ||
    typeof value.featureId !== 'string' ||
    typeof value.rationale !== 'string' ||
    typeof value.starterPrompt !== 'string' ||
    value.starterPrompt.trim().length === 0 ||
    !Object.values(ProjectFeatureNextStepKind).includes(
      value.kind as ProjectFeatureNextStepKind,
    )
  ) {
    return undefined;
  }
  return {
    featureId: value.featureId,
    kind: value.kind as ProjectFeatureNextStepKind,
    rationale: value.rationale,
    starterPrompt: value.starterPrompt,
  };
}

// A malformed suggestion list is dropped on its own so the routing intent
// beside it still reads; a missing list simply means no suggestions.
function normalizeFeatureNextSteps(
  value: unknown,
): ProjectFeatureNextStep[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_FEATURE_NEXT_STEPS
  ) {
    return undefined;
  }
  const steps = value.map(normalizeFeatureNextStep);
  return steps.every((step) => step !== undefined)
    ? (steps as ProjectFeatureNextStep[])
    : undefined;
}

export function normalizeProjectConfig(
  value: unknown,
): ProjectConfig | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !PROJECT_CONFIG_KEYS.has(key))
  ) {
    return undefined;
  }

  if (
    value.version !== ProjectConfig.VersionEnum.NUMBER_1 ||
    typeof value.existingWorkIntent !== 'string'
  ) {
    return undefined;
  }

  const existingWorkIntent =
    value.existingWorkIntent as ProjectExistingWorkIntent;
  if (!Object.values(ProjectExistingWorkIntent).includes(existingWorkIntent)) {
    return undefined;
  }

  const featureNextSteps = normalizeFeatureNextSteps(value.featureNextSteps);

  return {
    version: ProjectConfig.VersionEnum.NUMBER_1,
    existingWorkIntent,
    ...(featureNextSteps ? { featureNextSteps } : {}),
  };
}

// Generated interfaces carry no index signature, so Prisma's JSON input type
// needs the envelope rebuilt as plain object literals.
function toProjectConfigJson(config: ProjectConfig): Prisma.InputJsonObject {
  return {
    version: config.version,
    existingWorkIntent: config.existingWorkIntent,
    ...(config.featureNextSteps
      ? {
          featureNextSteps: config.featureNextSteps.map((step) => ({
            featureId: step.featureId,
            kind: step.kind,
            rationale: step.rationale,
            starterPrompt: step.starterPrompt,
          })),
        }
      : {}),
  };
}

function parseProjectConfig(value: unknown): ProjectConfig {
  const config = normalizeProjectConfig(value);
  if (
    !config ||
    !isRecord(value) ||
    Object.keys(value).length !== Object.keys(config).length
  ) {
    throw new BadRequestException(
      'Project config must be a complete version 1 configuration envelope',
    );
  }
  return config;
}

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly membershipRevocation: ProjectMembershipRevocationService,
    private prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    @InjectTemporalClient() private temporalClient: Client,
    private workItemTypeRegistry: WorkItemTypeRegistryService,
    private workflowTypeRegistry: WorkflowTypeRegistryService,
    private organizationProjectEntitlementService: OrganizationProjectEntitlementService,
    private entityRegistryService: EntityRegistryService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
  ) {}

  private async publishProjectUpdatedEvent(
    tx: Prisma.TransactionClient,
    params: {
      projectId: ProjectId;
      organizationId: OrganizationId;
      update: UpdateProjectDto;
    },
  ): Promise<string | null> {
    const payload: ProjectUpdatedEventPayload = {
      payloadType: EVENT_TYPES.PROJECT.UPDATED,
      organizationId: params.organizationId,
      projectId: params.projectId,
      update: params.update,
    };

    const event: Omit<ProjectUpdatedEvent, 'id'> = {
      type: EVENT_TYPES.PROJECT.UPDATED,
      aggregateId: params.projectId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishProjectStatusChangedEvent(
    tx: Prisma.TransactionClient,
    params: {
      projectId: ProjectId;
      organizationId: OrganizationId;
      status: ProjectStatus;
    },
  ): Promise<string | null> {
    const payload: ProjectStatusChangedEventPayload = {
      payloadType: EVENT_TYPES.PROJECT.STATUS_CHANGED,
      organizationId: params.organizationId,
      projectId: params.projectId,
      status: params.status,
    };

    const event: Omit<ProjectStatusChangedEvent, 'id'> = {
      type: EVENT_TYPES.PROJECT.STATUS_CHANGED,
      aggregateId: params.projectId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishProjectDeletedEvent(
    tx: Prisma.TransactionClient,
    params: {
      projectId: ProjectId;
      organizationId: OrganizationId;
      deletedAt: string;
    },
  ): Promise<string | null> {
    const payload: ProjectDeletedEventPayload = {
      payloadType: EVENT_TYPES.PROJECT.DELETED,
      organizationId: params.organizationId,
      projectId: params.projectId,
      deletedAt: params.deletedAt,
    };

    const event: Omit<ProjectDeletedEvent, 'id'> = {
      type: EVENT_TYPES.PROJECT.DELETED,
      aggregateId: params.projectId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  // Data transformation methods (from project adapter)
  private async toApiResponse(
    project: Project,
    currentUserRole: ProjectRole,
  ): Promise<ProjectResponseDto> {
    const qualifyingActivity = await this.prisma.db.outboxEvent.findMany({
      where: {
        organizationId: project.organizationId,
        projectId: project.id,
        eventType: { in: [...PROJECT_ORGANIC_ACTIVITY_EVENT_TYPES] },
      },
      select: { id: true },
      take: PROJECT_ESTABLISHED_ACTIVITY_THRESHOLD,
    });
    const hasEstablishedActivity =
      qualifyingActivity.length >= PROJECT_ESTABLISHED_ACTIVITY_THRESHOLD;

    const config = normalizeProjectConfig(project.config);

    return {
      id: project.id as ProjectId,
      organizationId: project.organizationId as OrganizationId,
      name: project.name,
      status: project.status as ProjectStatus,
      currentUserRole,
      hasEstablishedActivity,
      maturity: project.maturity as ProjectMaturity,
      createdBy: project.createdBy as UserId,
      description: project.description ?? undefined,
      createdAt: ensureStringDate(project.createdAt),
      updatedAt: ensureStringDate(project.updatedAt),
      deletedAt: project.deletedAt
        ? ensureStringDate(project.deletedAt)
        : undefined,
      ...(config ? { config } : {}),
    };
  }

  private async requireCurrentUserRole(
    projectId: string,
    userId: UserId,
  ): Promise<ProjectRole> {
    const role = await this.projectAccess.findProjectRole(projectId, userId);
    if (!role) {
      throw new ForbiddenException('Access denied to this project');
    }
    return role;
  }

  // Adapter methods for external API integration
  async createForAdapter(
    dto: CreateProjectDto,
    organizationId: OrganizationId,
    actorUserId: UserId,
    mockLlmSessionId?: MockLlmSessionId,
  ): Promise<ProjectResponseDto> {
    const result = await this.create(
      { ...dto, organizationId },
      actorUserId,
      mockLlmSessionId,
    );
    return this.toApiResponse(
      result,
      await this.requireCurrentUserRole(result.id, actorUserId),
    );
  }

  async findAllForAdapter(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<ProjectResponseDto[]> {
    const results = await this.findAll(organizationId, userId);
    const memberships = await this.prisma.db.projectMember.findMany({
      where: { userId, projectId: { in: results.map((result) => result.id) } },
      select: { projectId: true, role: true },
    });
    const roleByProjectId = new Map(
      memberships.map((membership) => [membership.projectId, membership.role]),
    );
    return Promise.all(
      results.map((result) => {
        const role = roleByProjectId.get(result.id);
        if (!role) {
          throw new ForbiddenException('Access denied to this project');
        }
        return this.toApiResponse(result, role);
      }),
    );
  }

  async findOneForAdapter(
    id: string,
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<ProjectResponseDto | null> {
    const result = await this.findOne(id, organizationId);
    return result
      ? this.toApiResponse(
          result,
          await this.requireCurrentUserRole(id, userId),
        )
      : null;
  }

  async updateForAdapter(
    id: ProjectId,
    dto: UpdateProjectDto,
    organizationId: OrganizationId,
    actorUserId: UserId,
  ): Promise<ProjectResponseDto> {
    const result = await this.update(id, dto, organizationId, actorUserId);
    return this.toApiResponse(
      result,
      await this.requireCurrentUserRole(id, actorUserId),
    );
  }

  async removeForAdapter(
    id: ProjectId,
    organizationId: OrganizationId,
    actorUserId: UserId,
  ): Promise<ProjectResponseDto> {
    const result = await this.remove(id, organizationId, actorUserId);
    // Only a project OWNER passes the deleteProject check, and the soft-deleted
    // project is no longer resolvable through the access predicate.
    return this.toApiResponse(result, PrismaProjectRole.OWNER);
  }

  /**
   * Creates the project record for a system-owned sandbox inside the caller's
   * transaction. No onboarding workflow starts; content arrives by clone.
   */
  async createSandboxProjectInTransaction(
    tx: AnyTransactionClient,
    input: {
      organizationId: OrganizationId;
      name: string;
      ownerUserId: UserId;
    },
  ) {
    const created = await tx.project.create({
      data: {
        name: input.name,
        organizationId: input.organizationId,
        config: toProjectConfigJson(DEFAULT_PROJECT_CONFIG),
        status: ProjectStatus.Active,
        createdBy: input.ownerUserId,
      },
    });
    await this.entityRegistryService.registerEntity(
      {
        organizationId: input.organizationId,
        entityId: created.id,
        entityType: EntityType.PROJECT,
        name: created.name,
      },
      tx as unknown as Prisma.TransactionClient,
    );
    await tx.projectMember.create({
      data: {
        projectId: created.id,
        userId: input.ownerUserId,
        role: PrismaProjectRole.OWNER,
      },
    });
    return created;
  }

  @WithEventContext('ProjectService')
  async create(
    createProjectDto: CreateProjectDto & { organizationId: OrganizationId },
    actorUserId: UserId,
    mockLlmSessionId?: MockLlmSessionId,
  ) {
    await this.projectAccess.assertOrganizationRole(
      createProjectDto.organizationId,
      actorUserId,
      'createProject',
    );
    const requestedConfig = createProjectDto.config;
    const projectConfig =
      requestedConfig === undefined
        ? { ...DEFAULT_PROJECT_CONFIG }
        : parseProjectConfig(requestedConfig);
    const { config: _ignoredConfig, ...projectData } = createProjectDto;

    // Set up event context with business data
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = createProjectDto.organizationId;
    }

    this.logger.log('Creating project with events', {
      projectName: createProjectDto.name,
      organizationId: createProjectDto.organizationId,
      correlationId: currentContext?.correlationId,
      userId: currentContext?.userId,
    });

    try {
      const project = await this.prisma.db.$transaction(async (tx) => {
        await this.organizationProjectEntitlementService.assertProjectCreationAllowed(
          tx,
          createProjectDto.organizationId,
        );

        const created = await tx.project.create({
          data: {
            ...projectData,
            config: toProjectConfigJson(projectConfig),
            status: ProjectStatus.Onboarding,
            createdBy: actorUserId,
          },
        });

        await this.entityRegistryService.registerEntity(
          {
            organizationId: createProjectDto.organizationId,
            entityId: created.id,
            entityType: EntityType.PROJECT,
            name: created.name,
          },
          tx as unknown as Prisma.TransactionClient,
        );

        // The creator is a project member (OWNER) by virtue of creating the
        // project. Without this row, listProjectMembers — which reads from
        // project_members — would never surface them.
        await tx.projectMember.create({
          data: {
            projectId: created.id,
            userId: actorUserId,
            role: PrismaProjectRole.OWNER,
          },
        });
        this.logger.log('[create] creator added as OWNER project member', {
          projectId: created.id,
          userId: actorUserId,
          organizationId: createProjectDto.organizationId,
        });

        return created;
      });

      // The project-owned registry snapshot is now committed and visible to
      // this process. Warm it before scheduling onboarding, then notify other
      // registry instances so the worker cannot start against a stale cache.
      try {
        await this.workItemTypeRegistry.refresh();
      } catch (error) {
        this.logger.error(
          '[create] project committed but local work-item registry refresh failed; continuing with durable project-owned definitions',
          {
            projectId: project.id,
            organizationId: createProjectDto.organizationId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }

      try {
        await this.workItemTypeRegistry.publishConfigChanged(
          createProjectDto.organizationId,
          'ALL',
        );
      } catch (error) {
        this.logger.error(
          '[create] project committed but cross-instance work-item registry invalidation failed; creation remains successful',
          {
            projectId: project.id,
            organizationId: createProjectDto.organizationId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }

      // Update context with created project ID
      if (currentContext) {
        currentContext.projectId = project.id;
      }

      // Start the new conversational flow workflow for onboarding
      // This replaces the old interaction workflow system with a more flexible approach
      const workflowResult =
        await this.workflowTypeRegistry.startWorkflowByType(
          WorkflowName.Onboarding,
          null, // no conversationId for project creation
          project.id,
          createProjectDto.organizationId,
          currentContext?.userId || project.createdBy || ('system' as UserId), // Use context userId, fallback to createdBy or system
          'Project Onboarding',
          'project',
          project.id,
          undefined,
          {
            repositoryGroundingIntentRequired: true,
            ...(mockLlmSessionId ? { mockLlmSessionId } : {}),
          },
        );

      const workflowId = workflowResult.workflowId as WorkflowId;

      // Update context with workflow ID
      if (currentContext) {
        currentContext.workflowId = workflowId;
      }

      this.logger.log(
        'Project created with conversational flow workflow started',
        {
          projectId: project.id,
          workflowId,
          flowId: 'onboarding',
          organizationId: project.organizationId,
          correlationId: currentContext?.correlationId,
        },
      );

      return project;
    } catch (err) {
      this.logger.error('Error creating project', {
        message: (err as Error).message,
        name: (err as Error).name,
      });

      throw err;
    }
  }

  async findAll(organizationId: OrganizationId, userId: UserId) {
    const projects = await this.prisma.db.project.findMany({
      where: {
        ...this.projectAccess.projectWhere(userId, organizationId),
      },
    });
    this.logger.log('Project list lookup resolved', {
      event: 'project_access_lookup',
      operation: 'list',
      lookupOrganizationId: organizationId,
      resultCount: projects.length,
    });
    return projects;
  }

  async findOne(id: string, organizationId: OrganizationId) {
    const project = await this.prisma.db.project.findFirst({
      where: {
        id,
        // CRITICAL: Always filter by organization ID to prevent cross-org access
        organizationId,
      },
    });
    this.logger.log('Project detail lookup resolved', {
      event: 'project_access_lookup',
      operation: 'detail',
      lookupOrganizationId: organizationId,
      lookupProjectId: id,
      found: project !== null,
      ...(project ? { resultOrganizationId: project.organizationId } : {}),
    });
    return project;
  }

  async recordOnboardingExistingWorkIntent(
    tx: Prisma.TransactionClient,
    params: {
      projectId: ProjectId;
      organizationId: OrganizationId;
      existingWorkIntent: ProjectExistingWorkIntent;
    },
  ): Promise<void> {
    const existingProject = await tx.project.findFirst({
      where: {
        id: params.projectId,
        organizationId: params.organizationId,
      },
      select: { status: true },
    });
    if (!existingProject) {
      throw new NotFoundException('Project not found');
    }

    const shouldActivate =
      params.existingWorkIntent === ProjectExistingWorkIntent.Selected;
    const statusChanged =
      shouldActivate && existingProject.status !== ProjectStatus.Active;
    const update = {
      config: buildProjectConfig(params.existingWorkIntent),
      ...(statusChanged ? { status: ProjectStatus.Active } : {}),
    } satisfies UpdateProjectDto;

    this.logger.debug('Recording onboarding existing-work intent', {
      projectId: params.projectId,
      organizationId: params.organizationId,
      existingWorkIntent: params.existingWorkIntent,
      previousStatus: existingProject.status,
      nextStatus: statusChanged ? ProjectStatus.Active : existingProject.status,
    });

    await tx.project.update({
      where: { id: params.projectId },
      data: { ...update, config: toProjectConfigJson(update.config) },
    });
    await this.publishProjectUpdatedEvent(tx, {
      projectId: params.projectId,
      organizationId: params.organizationId,
      update,
    });
    if (statusChanged) {
      await this.publishProjectStatusChangedEvent(tx, {
        projectId: params.projectId,
        organizationId: params.organizationId,
        status: ProjectStatus.Active,
      });
    }
  }

  /**
   * Saves the feature-discovery next-step suggestions beside the persisted
   * routing intent. Projects without a readable config fall back to the
   * default envelope so the suggestions still have a home.
   */
  async recordOnboardingFeatureNextSteps(params: {
    projectId: ProjectId;
    organizationId: OrganizationId;
    featureNextSteps: ProjectFeatureNextStep[];
  }): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const existingProject = await tx.project.findFirst({
        where: {
          id: params.projectId,
          organizationId: params.organizationId,
        },
        select: { config: true },
      });
      if (!existingProject) {
        throw new NotFoundException('Project not found');
      }

      const currentConfig =
        normalizeProjectConfig(existingProject.config) ??
        DEFAULT_PROJECT_CONFIG;
      const update = {
        config: parseProjectConfig({
          ...currentConfig,
          featureNextSteps: params.featureNextSteps,
        }),
      } satisfies UpdateProjectDto;

      await tx.project.update({
        where: { id: params.projectId },
        data: { config: toProjectConfigJson(update.config) },
      });
      await this.publishProjectUpdatedEvent(
        tx as unknown as Prisma.TransactionClient,
        {
          projectId: params.projectId,
          organizationId: params.organizationId,
          update,
        },
      );
    });
  }

  @WithEventContext('ProjectService')
  async update(
    id: ProjectId,
    updateProjectDto: UpdateProjectDto,
    organizationId: OrganizationId,
    actorUserId: UserId,
  ) {
    await this.projectAccess.assertProjectRole(
      id,
      actorUserId,
      'updateProject',
    );
    const requestedConfig = updateProjectDto.config;
    const projectConfig =
      requestedConfig === undefined
        ? undefined
        : parseProjectConfig(requestedConfig);
    const { config: _ignoredConfig, ...projectData } = updateProjectDto;

    // CRITICAL: Validate organization access before updating
    const existingProject = await this.findOne(id, organizationId);
    if (!existingProject) {
      throw new Error(
        `Project with ID ${id} not found in organization ${organizationId}`,
      );
    }
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.projectId = id;
    }

    this.logger.log('Updating project with events', {
      projectId: id,
      updateData: updateProjectDto,
      correlationId: currentContext?.correlationId,
    });

    const updatedProject = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.project.update({
        where: { id },
        data: {
          ...projectData,
          ...(projectConfig
            ? { config: toProjectConfigJson(projectConfig) }
            : {}),
        },
      });

      await this.entityRegistryService.registerEntity(
        {
          organizationId,
          entityId: updated.id,
          entityType: EntityType.PROJECT,
          name: updated.name,
          deletedAt: updated.deletedAt ?? undefined,
        },
        tx as unknown as Prisma.TransactionClient,
      );

      await this.publishProjectUpdatedEvent(
        tx as unknown as Prisma.TransactionClient,
        {
          projectId: updated.id,
          organizationId,
          update: updateProjectDto,
        },
      );

      if (
        updateProjectDto.status &&
        existingProject.status !== updateProjectDto.status
      ) {
        await this.publishProjectStatusChangedEvent(
          tx as unknown as Prisma.TransactionClient,
          {
            projectId: updated.id,
            organizationId,
            status: updateProjectDto.status,
          },
        );
      }

      return updated;
    });

    // Update context with organization ID if available
    if (currentContext && updatedProject.organizationId) {
      currentContext.organizationId = updatedProject.organizationId;
    }

    this.logger.log('Project updated with events', {
      projectId: updatedProject.id,
      correlationId: currentContext?.correlationId,
    });

    return updatedProject;
  }

  @WithEventContext('ProjectService')
  async remove(
    id: ProjectId,
    organizationId: OrganizationId,
    actorUserId: UserId,
  ) {
    await this.projectAccess.assertProjectRole(
      id,
      actorUserId,
      'deleteProject',
    );
    // CRITICAL: Validate organization access before removing
    const existingProject = await this.findOne(id, organizationId);
    if (!existingProject) {
      throw new Error(
        `Project with ID ${id} not found in organization ${organizationId}`,
      );
    }
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.projectId = id;
    }

    this.logger.log('Soft deleting project with events', {
      projectId: id,
      correlationId: currentContext?.correlationId,
    });

    // Project was already validated in the remove method above
    const project = existingProject;

    // Update context with organization ID
    if (currentContext && project.organizationId) {
      currentContext.organizationId = project.organizationId;
    }

    const deletedProject = await this.prisma.db.$transaction(async (tx) => {
      const deleted = await tx.project.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      });

      if (!deleted.deletedAt) {
        throw new Error(
          `Project ${id} soft delete failed: deletedAt was not persisted`,
        );
      }

      await this.entityRegistryService.registerEntity(
        {
          organizationId,
          entityId: deleted.id,
          entityType: EntityType.PROJECT,
          name: deleted.name,
          deletedAt: deleted.deletedAt,
        },
        tx as unknown as Prisma.TransactionClient,
      );

      await this.publishProjectDeletedEvent(
        tx as unknown as Prisma.TransactionClient,
        {
          projectId: deleted.id,
          organizationId,
          deletedAt: deleted.deletedAt.toISOString(),
        },
      );

      return deleted;
    });

    // Terminate workflows after the delete + outbox event commit succeeds.
    await this.terminateProjectWorkflows(id);

    this.logger.log('Project soft deleted with events', {
      projectId: deletedProject.id,
      correlationId: currentContext?.correlationId,
    });

    return deletedProject;
  }

  async getCounts(
    actorUserId: UserId,
    projectId: ProjectId,
    organizationId: OrganizationId,
  ): Promise<ProjectCountsResponseDto> {
    await this.projectAccess.assertProject(
      actorUserId,
      organizationId,
      projectId,
    );
    const accessible = this.projectAccess.projectWhere(
      actorUserId,
      organizationId,
    );
    // Validate access
    const project = await this.findOne(projectId, organizationId);
    if (!project) {
      throw new Error(
        `Project with ID ${projectId} not found in organization ${organizationId}`,
      );
    }

    const [
      tasks,
      initiatives,
      designDocs,
      agentSessions,
      conversations,
      services,
      plans,
    ] = await Promise.all([
      this.prisma.db.task.count({
        where: {
          organizationId,
          archivedAt: null,
          project: accessible,
          OR: [{ projectId }, { projectRelations: { some: { projectId } } }],
        },
      }),
      this.prisma.db.initiative.count({
        where: {
          organizationId,
          projects: { some: { projectId } },
          originatingProject: accessible,
          archivedAt: null,
          OR: [
            { sourceType: null },
            { sourceType: { not: InitiativeSourceType.Plan } },
          ],
        },
      }),
      this.prisma.db.designDoc.count({
        where: {
          organizationId,
          projectId,
          archivedAt: null,
        },
      }),
      this.prisma.db.agentSession.count({
        where: {
          organizationId,
          project: accessible,
          conversation: {
            projectId,
          },
        },
      }),
      this.prisma.db.conversation.count({
        where: {
          organizationId,
          projectId,
          status: { not: ConversationStatus.Deleted },
          workflowAboutId: projectId,
          workflowAboutType: 'project',
        },
      }),
      this.prisma.db.service.count({
        where: {
          organizationId,
          projectId,
          archivedAt: null,
        },
      }),
      this.prisma.db.task.count({
        where: {
          organizationId,
          projectId,
          type: 'PLAN',
          archivedAt: null,
        },
      }),
    ]);

    return {
      tasks,
      initiatives,
      designDocs,
      agentSessions,
      conversations,
      services,
      plans,
    };
  }

  /**
   * Terminate all workflows associated with a project
   */
  private async terminateProjectWorkflows(projectId: ProjectId): Promise<void> {
    try {
      this.logger.log('Terminating workflows for project', { projectId });

      // Get all conversations for this project to find associated workflows
      const conversations = await this.prisma.db.conversation.findMany({
        where: {
          projectId,
        },
        select: {
          id: true,
          workflowId: true,
        },
      });

      const workflowIds = conversations
        .filter((conv) => conv.workflowId)
        .map((conv) => conv.workflowId);

      if (workflowIds.length === 0) {
        this.logger.log('No workflows found for project', { projectId });
        return;
      }

      this.logger.log('Found workflows to terminate', {
        projectId,
        workflowCount: workflowIds.length,
        workflowIds,
      });

      // Terminate each workflow
      const terminationPromises = workflowIds.map(async (workflowId) => {
        try {
          const workflowHandle =
            this.temporalClient.workflow.getHandle(workflowId);
          await workflowHandle.terminate('Project deleted');
          this.logger.log('Successfully terminated workflow', {
            projectId,
            workflowId,
          });
        } catch (error) {
          this.logger.warn('Failed to terminate workflow', {
            projectId,
            workflowId,
            error: (error as Error).message,
          });
          // Don't throw here - we want to continue terminating other workflows
        }
      });

      await Promise.allSettled(terminationPromises);

      this.logger.log('Completed workflow termination for project', {
        projectId,
        totalWorkflows: workflowIds.length,
      });
    } catch (error) {
      this.logger.error('Error terminating workflows for project', {
        projectId,
        error: (error as Error).message,
      });
      // Don't throw here - project deletion should continue even if workflow termination fails
    }
  }

  /**
   * Get active workflows for a project (useful for debugging)
   */
  async getProjectWorkflows(
    projectId: ProjectId,
    organizationId: OrganizationId,
  ): Promise<{ conversationId: string; workflowId: string; status: string }[]> {
    // CRITICAL: Validate organization access to project
    const project = await this.findOne(projectId, organizationId);
    if (!project) {
      throw new Error(
        `Project with ID ${projectId} not found in organization ${organizationId}`,
      );
    }
    try {
      const conversations = await this.prisma.db.conversation.findMany({
        where: {
          projectId,
        },
        select: {
          id: true,
          workflowId: true,
          status: true,
        },
      });

      const workflowInfos = conversations
        .filter((conv) => conv.workflowId)
        .map((conv) => ({
          conversationId: conv.id,
          workflowId: conv.workflowId,
          status: conv.status,
        }));

      this.logger.log('Retrieved project workflows', {
        projectId,
        workflowCount: workflowInfos.length,
      });

      return workflowInfos;
    } catch (error) {
      this.logger.error('Error retrieving project workflows', {
        projectId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Manually terminate all workflows for a project (useful for cleanup)
   */
  @WithEventContext('ProjectService')
  async terminateWorkflowsForProject(
    projectId: ProjectId,
    organizationId: OrganizationId,
    reason: string = 'Manual termination',
  ): Promise<{ terminated: number; failed: number }> {
    // CRITICAL: Validate organization access to project
    const project = await this.findOne(projectId, organizationId);
    if (!project) {
      throw new Error(
        `Project with ID ${projectId} not found in organization ${organizationId}`,
      );
    }
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.projectId = projectId;
    }

    this.logger.log('Manually terminating workflows for project', {
      projectId,
      reason,
      correlationId: currentContext?.correlationId,
    });

    let terminatedCount = 0;
    let failedCount = 0;

    try {
      // Get all conversations for this project to find associated workflows
      const conversations = await this.prisma.db.conversation.findMany({
        where: {
          projectId,
        },
        select: {
          id: true,
          workflowId: true,
        },
      });

      const workflowIds = conversations
        .filter((conv) => conv.workflowId)
        .map((conv) => conv.workflowId);

      if (workflowIds.length === 0) {
        this.logger.log('No workflows found for project', { projectId });
        return { terminated: 0, failed: 0 };
      }

      this.logger.log('Found workflows to terminate', {
        projectId,
        workflowCount: workflowIds.length,
        workflowIds,
        reason,
      });

      // Terminate each workflow
      const terminationResults = await Promise.allSettled(
        workflowIds.map(async (workflowId) => {
          try {
            const workflowHandle =
              this.temporalClient.workflow.getHandle(workflowId);
            await workflowHandle.terminate(reason);
            this.logger.log('Successfully terminated workflow', {
              projectId,
              workflowId,
              reason,
            });
            return { success: true, workflowId };
          } catch (error) {
            this.logger.warn('Failed to terminate workflow', {
              projectId,
              workflowId,
              error: (error as Error).message,
              reason,
            });
            return {
              success: false,
              workflowId,
              error: (error as Error).message,
            };
          }
        }),
      );

      // Count results
      terminationResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.success) {
          terminatedCount++;
        } else {
          failedCount++;
        }
      });

      this.logger.log('Completed manual workflow termination for project', {
        projectId,
        totalWorkflows: workflowIds.length,
        terminated: terminatedCount,
        failed: failedCount,
        reason,
      });

      return { terminated: terminatedCount, failed: failedCount };
    } catch (error) {
      this.logger.error('Error during manual workflow termination', {
        projectId,
        error: (error as Error).message,
        reason,
      });
      throw error;
    }
  }

  async addProjectMember(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: AddProjectMemberDto,
  ): Promise<ProjectMemberResponseDto> {
    await this.projectAccess.assertProject(
      actorUserId,
      organizationId,
      projectId,
    );
    await this.projectAccess.assertProjectRole(
      projectId,
      actorUserId,
      'addProjectMember',
    );
    return this.createProjectMembership(organizationId, projectId, dto);
  }

  /** Callers must already have authorized the acting user for this project. */
  async createProjectMembership(
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: AddProjectMemberDto,
    tx?: AnyTransactionClient,
  ): Promise<ProjectMemberResponseDto> {
    const client: AnyTransactionClient = tx ?? this.prisma.db;

    this.logger.debug('[addProjectMember] adding user to project', {
      organizationId,
      projectId,
      userId: dto.userId,
      role: dto.role,
      inTransaction: Boolean(tx),
    });

    const validRoles = Object.values(PrismaProjectRole) as ProjectRole[];
    if (!validRoles.includes(dto.role)) {
      this.logger.warn('[addProjectMember] invalid role', {
        projectId,
        role: dto.role,
      });
      throw new BadRequestException(
        `Invalid project role '${dto.role}'. Allowed roles: ${validRoles.join(', ')}`,
      );
    }

    const project = await client.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      this.logger.warn('[addProjectMember] project not found', {
        organizationId,
        projectId,
      });
      throw new NotFoundException(
        `Project ${projectId} not found in organization ${organizationId}`,
      );
    }

    const orgMembership = await client.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: dto.userId,
          organizationId,
        },
      },
    });

    if (!orgMembership || !orgMembership.isActive) {
      this.logger.warn(
        '[addProjectMember] user is not an active member of the organization',
        {
          organizationId,
          projectId,
          userId: dto.userId,
        },
      );
      throw new BadRequestException(
        'User is not a member of this organization',
      );
    }

    const existing = await client.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: dto.userId,
        },
      },
    });

    if (existing) {
      this.logger.warn('[addProjectMember] user already a member', {
        projectId,
        userId: dto.userId,
      });
      throw new ConflictException('User is already a member of this project');
    }

    try {
      const membership = await client.projectMember.create({
        data: {
          projectId,
          userId: dto.userId,
          role: dto.role as PrismaProjectRole,
        },
        include: { user: { select: PROJECT_MEMBER_USER_SELECT } },
      });

      this.logger.log('[addProjectMember] membership created', {
        projectId,
        userId: dto.userId,
        membershipId: membership.id,
        role: membership.role,
      });

      return this.mapProjectMember(membership);
    } catch (error) {
      this.logger.error('[addProjectMember] failed to create membership', {
        organizationId,
        projectId,
        userId: dto.userId,
        role: dto.role,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async removeProjectMember(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ): Promise<void> {
    await this.projectAccess.assertProject(
      actorUserId,
      organizationId,
      projectId,
    );
    await this.projectAccess.assertProjectRole(
      projectId,
      actorUserId,
      'removeProjectMember',
    );
    const client = this.prisma.db;

    this.logger.debug('[removeProjectMember] removing user from project', {
      organizationId,
      projectId,
      userId,
    });

    const project = await client.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      this.logger.warn('[removeProjectMember] project not found', {
        organizationId,
        projectId,
      });
      throw new NotFoundException(
        `Project ${projectId} not found in organization ${organizationId}`,
      );
    }

    const membership = await client.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!membership) {
      this.logger.warn('[removeProjectMember] membership not found', {
        projectId,
        userId,
      });
      throw new NotFoundException(
        `User ${userId} is not a member of project ${projectId}`,
      );
    }

    if (membership.role === PrismaProjectRole.OWNER) {
      const remainingOwners = await client.projectMember.count({
        where: {
          projectId,
          role: PrismaProjectRole.OWNER,
          userId: { not: userId },
        },
      });
      if (remainingOwners === 0) {
        this.logger.warn(
          '[removeProjectMember] cannot remove last owner of project',
          { projectId, userId },
        );
        throw new BadRequestException(
          'Cannot remove the last owner of a project',
        );
      }
    }

    try {
      await client.projectMember.delete({
        where: { projectId_userId: { projectId, userId } },
      });

      await this.membershipRevocation.membershipRemoved(userId);

      this.logger.log('[removeProjectMember] membership removed', {
        projectId,
        userId,
        membershipId: membership.id,
      });
    } catch (error) {
      this.logger.error('[removeProjectMember] failed to remove membership', {
        organizationId,
        projectId,
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async listProjectMembers(
    actorUserId: UserId,
    organizationId: OrganizationId,
    projectId: ProjectId,
    options: { page?: number; limit?: number } = {},
  ): Promise<PaginatedProjectMembersResponseDto> {
    await this.projectAccess.assertProject(
      actorUserId,
      organizationId,
      projectId,
    );
    const requestedPage = options.page ?? 1;
    const requestedLimit = options.limit ?? 50;
    const page = Math.max(1, requestedPage);
    const limit = Math.min(Math.max(1, requestedLimit), 100);
    const skip = (page - 1) * limit;

    this.logger.debug('[listProjectMembers] fetching members', {
      organizationId,
      projectId,
      page,
      limit,
    });

    const project = await this.findOne(projectId, organizationId);
    if (!project) {
      this.logger.warn('[listProjectMembers] project not found', {
        organizationId,
        projectId,
      });
      throw new NotFoundException(
        `Project ${projectId} not found in organization ${organizationId}`,
      );
    }

    const where = { projectId };
    const [members, total] = await Promise.all([
      this.prisma.db.projectMember.findMany({
        where,
        include: { user: { select: PROJECT_MEMBER_USER_SELECT } },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.db.projectMember.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    this.logger.debug('[listProjectMembers] returning members', {
      projectId,
      page,
      total,
      count: members.length,
    });

    return {
      members: members.map((member) => this.mapProjectMember(member)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  private mapProjectMember(member: {
    id: string;
    projectId: string;
    userId: string;
    role: PrismaProjectRole;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: string;
      email: string;
      name: string;
    };
  }): ProjectMemberResponseDto {
    const user: ProjectMemberUserDto = {
      id: member.user.id as UserId,
      email: member.user.email,
      name: member.user.name,
    };
    return {
      id: member.id,
      projectId: member.projectId as ProjectId,
      userId: member.userId as UserId,
      role: member.role as ProjectRole,
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
      user,
    };
  }
}
