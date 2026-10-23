/**
 * Service Entity Service
 *
 * Provides CRUD operations for software services (backend, UI, database, etc.)
 * and their relationships to tasks, initiatives, design docs, and agent sessions.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import {
  CreateServiceDto,
  ServiceDto,
  ServiceAgentSessionRelation,
  ServiceInitiativeRelation,
  ServiceLinkDto,
  ServiceTaskRelation,
  UpdateServiceDto,
} from 'src/generated';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId, ProjectId, ServiceId } from '../../types';
import { ensureStringDate } from '../../utils/date.util';

type PrismaTransaction = Prisma.TransactionClient;

const SERVICE_DELETED_STATUS = 'DELETED';

type LinkTargetType = 'task' | 'initiative' | 'agent-session';

type ServiceCounts = {
  taskRelations: number;
  initiativeRelations: number;
  agentSessionRelations: number;
  implementationHints: number;
};

type ServiceChildCounts = {
  tasks: number;
  initiatives: number;
  agentSessions: number;
  implementationHints: number;
};

type ServiceRecordWithCounts = {
  id: string;
  name: string;
  description: string | null;
  organizationId: string;
  projectId: string | null;
  repositoryUrl: string | null;
  repositoryType: string | null;
  repositoryId: string | null;
  serviceType: string | null;
  language: string | null;
  framework: string | null;
  tags: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  _count?: Partial<ServiceCounts>;
};

interface NormalizedLinkInput {
  entityType: LinkTargetType;
  entityId: string;
  relationType?: string | null;
}

const ENTITY_TYPE_ALIASES: Record<string, LinkTargetType> = {
  task: 'task',
  tasks: 'task',
  initiative: 'initiative',
  initiatives: 'initiative',
  'agent-session': 'agent-session',
  agent_session: 'agent-session',
  'agent-sessions': 'agent-session',
};

const RESPONSE_ENTITY_TYPE: Record<LinkTargetType, string> = {
  task: 'task',
  initiative: 'initiative',
  'agent-session': 'agent-session',
};

const INTERNAL_SERVICE_TYPE = 'virtual';

type ServiceVisibilityOptions = {
  includeInternal?: boolean;
};

@Injectable()
export class ServiceService {
  private readonly logger = new Logger(ServiceService.name);
  private readonly countSelection = {
    taskRelations: true,
    initiativeRelations: true,
    agentSessionRelations: true,
    implementationHints: true,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
  ) {}

  /**
   * Create a new service
   */
  async create(
    createServiceDto: CreateServiceDto & { organizationId: OrganizationId },
  ): Promise<ServiceDto> {
    this.logger.log('Creating service', {
      name: createServiceDto.name,
      organizationId: createServiceDto.organizationId,
      serviceType: createServiceDto.serviceType,
    });

    const service = await this.prisma.$transaction(
      async (tx: PrismaTransaction) => {
        const created = await tx.service.create({
          data: {
            name: createServiceDto.name,
            description: createServiceDto.description,
            organizationId: createServiceDto.organizationId,
            projectId: createServiceDto.projectId,
            repositoryUrl: createServiceDto.repositoryUrl,
            repositoryType: createServiceDto.repositoryType,
            repositoryId: createServiceDto.repositoryId,
            serviceType: createServiceDto.serviceType,
            language: createServiceDto.language,
            framework: createServiceDto.framework,
            tags: createServiceDto.tags ?? [],
            status: 'ACTIVE',
          },
          include: {
            _count: {
              select: this.countSelection,
            },
          },
        });

        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.SERVICE.CREATED,
          aggregateId: created.id as ServiceId,
          payload: {
            payloadType: EVENT_TYPES.SERVICE.CREATED,
            service: this.mapToResponse(created),
            organizationId: created.organizationId as OrganizationId,
            projectId: created.projectId as ProjectId | null,
          },
        } as never);

        return this.mapToResponse(created);
      },
    );

    return service;
  }

  /**
   * Find all services for an organization (paginated)
   */
  async findAll(
    organizationId: OrganizationId,
    filters?: {
      status?: string;
      tags?: string[];
      page?: number;
      limit?: number;
      projectId?: ProjectId;
      accessibleProjectIds?: string[];
      serviceType?: string;
      repositoryType?: string;
      includeInternal?: boolean;
    },
  ): Promise<ServiceDto[]> {
    this.logger.debug('Finding services', { organizationId, filters });

    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      organizationId,
      ...(filters?.accessibleProjectIds
        ? { AND: [{ projectId: { in: filters.accessibleProjectIds } }] }
        : {}),
      ...(filters?.status === 'ARCHIVED' ? {} : { archivedAt: null }),
      ...this.buildVisibilityWhere(filters?.includeInternal),
    };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.projectId) {
      where.projectId = filters.projectId;
    }

    if (filters?.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }

    if (filters?.serviceType) {
      where.serviceType = filters.serviceType;
    }

    if (filters?.repositoryType) {
      where.repositoryType = filters.repositoryType;
    }

    const services = await this.prisma.db.service.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        _count: {
          select: this.countSelection,
        },
      },
    });

    return services.map((service) => this.mapToResponse(service));
  }

  async findManyByIds(
    organizationId: OrganizationId,
    serviceIds: ServiceId[],
    options?: ServiceVisibilityOptions,
  ): Promise<Map<ServiceId, ServiceDto>> {
    if (serviceIds.length === 0) {
      return new Map();
    }

    const services = await this.prisma.db.service.findMany({
      where: {
        id: { in: serviceIds },
        organizationId,
        archivedAt: null,
        ...this.buildVisibilityWhere(options?.includeInternal),
      },
      include: {
        _count: {
          select: this.countSelection,
        },
      },
    });

    const responses = new Map<ServiceId, ServiceDto>();
    for (const service of services) {
      responses.set(service.id as ServiceId, this.mapToResponse(service));
    }

    return responses;
  }

  /**
   * Retrieve a single service
   */
  async findOne(
    id: string,
    organizationId: OrganizationId,
    options?: ServiceVisibilityOptions,
  ): Promise<ServiceDto | null> {
    this.logger.debug('Finding service by ID', { id, organizationId });

    const service = await this.prisma.db.service.findFirst({
      where: {
        id,
        organizationId,
        archivedAt: null,
        ...this.buildVisibilityWhere(options?.includeInternal),
      },
      include: {
        _count: {
          select: this.countSelection,
        },
      },
    });

    if (!service) {
      return null;
    }

    return this.mapToResponse(service);
  }

  /**
   * Update a service
   */
  async update(
    id: string,
    updateServiceDto: UpdateServiceDto,
    organizationId: OrganizationId,
  ): Promise<ServiceDto> {
    this.logger.log('Updating service', {
      id,
      organizationId,
      fields: Object.keys(updateServiceDto),
    });

    const existing = await this.prisma.db.service.findFirst({
      where: { id, organizationId, archivedAt: null },
    });

    if (!existing) {
      throw new NotFoundException(
        `Service ${id} not found in organization ${organizationId}`,
      );
    }

    const updatedService = await this.prisma.$transaction(
      async (tx: PrismaTransaction) => {
        const updated = await tx.service.update({
          where: { id },
          data: {
            name: updateServiceDto.name ?? existing.name,
            description:
              updateServiceDto.description !== undefined
                ? updateServiceDto.description
                : existing.description,
            projectId:
              updateServiceDto.projectId !== undefined
                ? updateServiceDto.projectId
                : existing.projectId,
            repositoryUrl:
              updateServiceDto.repositoryUrl !== undefined
                ? updateServiceDto.repositoryUrl
                : existing.repositoryUrl,
            repositoryType:
              updateServiceDto.repositoryType !== undefined
                ? updateServiceDto.repositoryType
                : existing.repositoryType,
            repositoryId:
              updateServiceDto.repositoryId !== undefined
                ? updateServiceDto.repositoryId
                : existing.repositoryId,
            serviceType:
              updateServiceDto.serviceType !== undefined
                ? updateServiceDto.serviceType
                : existing.serviceType,
            language:
              updateServiceDto.language !== undefined
                ? updateServiceDto.language
                : existing.language,
            framework:
              updateServiceDto.framework !== undefined
                ? updateServiceDto.framework
                : existing.framework,
            tags: updateServiceDto.tags ?? existing.tags,
            status: updateServiceDto.status ?? existing.status,
          },
          include: {
            _count: {
              select: this.countSelection,
            },
          },
        });

        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.SERVICE.UPDATED,
          aggregateId: updated.id as ServiceId,
          payload: {
            payloadType: EVENT_TYPES.SERVICE.UPDATED,
            service: this.mapToResponse(updated),
            organizationId: updated.organizationId as OrganizationId,
            projectId: updated.projectId as ProjectId | null,
          },
        } as never);

        return this.mapToResponse(updated);
      },
    );

    return updatedService;
  }

  /**
   * Owning project of a service that has not been removed, archived or not.
   */
  async findOwningProjectId(
    id: string,
    organizationId: OrganizationId,
  ): Promise<ProjectId | null> {
    const service = await this.prisma.db.service.findFirst({
      where: { id, organizationId, status: { not: SERVICE_DELETED_STATUS } },
      select: { projectId: true },
    });
    if (!service) {
      this.logger.warn('Service not found for owning project lookup', {
        id,
        organizationId,
      });
      throw new NotFoundException(
        `Service ${id} not found in organization ${organizationId}`,
      );
    }
    return service.projectId as ProjectId | null;
  }

  /**
   * Remove an archived service from its project. The row is retained (status
   * DELETED) because hard deletion would cascade through task, session and
   * hint relations that must survive.
   */
  async delete(id: string, organizationId: OrganizationId): Promise<void> {
    this.logger.log('Deleting archived service', { id, organizationId });

    const { count } = await this.prisma.db.service.updateMany({
      where: { id, organizationId, status: 'ARCHIVED' },
      data: { status: SERVICE_DELETED_STATUS, updatedAt: new Date() },
    });

    if (count === 0) {
      const existing = await this.prisma.db.service.findFirst({
        where: { id, organizationId, status: { not: SERVICE_DELETED_STATUS } },
        select: { status: true },
      });
      if (!existing) {
        throw new NotFoundException(
          `Service ${id} not found in organization ${organizationId}`,
        );
      }
      this.logger.warn('Refusing to delete non-archived service', {
        id,
        organizationId,
        status: existing.status,
      });
      throw new ConflictException(
        `Service ${id} must be archived before it can be deleted`,
      );
    }

    this.logger.log('Deleted archived service', { id, organizationId });
  }

  /**
   * Archive an active service
   */
  async archive(
    id: string,
    organizationId: OrganizationId,
  ): Promise<ServiceDto> {
    this.logger.log('Archiving service', { id, organizationId });

    const existing = await this.prisma.db.service.findFirst({
      where: { id, organizationId, archivedAt: null },
    });

    if (!existing) {
      throw new NotFoundException(
        `Service ${id} not found in organization ${organizationId}`,
      );
    }

    const archivedService = await this.prisma.$transaction(
      async (tx: PrismaTransaction) => {
        const updated = await tx.service.update({
          where: { id },
          data: {
            archivedAt: new Date(),
            updatedAt: new Date(),
            status: 'ARCHIVED',
          },
          include: {
            _count: {
              select: this.countSelection,
            },
          },
        });

        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.SERVICE.ARCHIVED,
          aggregateId: updated.id as ServiceId,
          payload: {
            payloadType: EVENT_TYPES.SERVICE.ARCHIVED,
            service: this.mapToResponse(updated),
            organizationId: updated.organizationId as OrganizationId,
            projectId: updated.projectId as ProjectId | null,
          },
        } as never);

        return this.mapToResponse(updated);
      },
    );

    return archivedService;
  }

  /**
   * Get all links for a service
   */
  async getLinks(
    serviceId: string,
    organizationId: OrganizationId,
  ): Promise<
    Array<
      | ServiceTaskRelation
      | ServiceInitiativeRelation
      | ServiceAgentSessionRelation
    >
  > {
    await this.ensureServiceAccess(serviceId, organizationId);

    const [taskLinks, initiativeLinks, agentSessionLinks] = await Promise.all([
      this.prisma.db.serviceTask.findMany({
        where: { serviceId },
      }),
      this.prisma.db.serviceInitiative.findMany({
        where: { serviceId },
      }),
      this.prisma.db.serviceAgentSession.findMany({
        where: { serviceId },
      }),
    ]);

    const links: Array<
      | ServiceTaskRelation
      | ServiceInitiativeRelation
      | ServiceAgentSessionRelation
    > = [
      ...taskLinks.map((relation) => this.mapTaskRelation(relation)),
      ...initiativeLinks.map((relation) =>
        this.mapInitiativeRelation(relation),
      ),
      ...agentSessionLinks.map((relation) =>
        this.mapAgentSessionRelation(relation),
      ),
    ];

    return links.sort((a, b) =>
      ensureStringDate(a.createdAt).localeCompare(
        ensureStringDate(b.createdAt),
      ),
    );
  }

  /**
   * Create links for a service
   */
  async createLink(
    serviceId: string,
    organizationId: OrganizationId,
    link: ServiceLinkDto,
  ): Promise<
    | ServiceTaskRelation
    | ServiceInitiativeRelation
    | ServiceAgentSessionRelation
  > {
    await this.ensureServiceAccess(serviceId, organizationId);

    const normalized = this.normalizeLinkInput(link);

    this.logger.log('Creating service link', {
      serviceId,
      organizationId,
      entityType: normalized.entityType,
      entityId: normalized.entityId,
    });

    return await this.prisma.$transaction(
      async (
        tx: PrismaTransaction,
      ): Promise<
        | ServiceTaskRelation
        | ServiceInitiativeRelation
        | ServiceAgentSessionRelation
      > => {
        switch (normalized.entityType) {
          case 'task': {
            return await this.createTaskLink(
              tx,
              serviceId,
              organizationId,
              normalized.entityId,
              normalized.relationType,
            );
          }
          case 'initiative': {
            return await this.createInitiativeLink(
              tx,
              serviceId,
              organizationId,
              normalized.entityId,
              normalized.relationType,
            );
          }
          case 'agent-session': {
            return await this.createAgentSessionLink(
              tx,
              serviceId,
              organizationId,
              normalized.entityId,
              normalized.relationType,
            );
          }
          default: {
            throw new BadRequestException(
              `Unsupported entity type: ${normalized.entityType as string}`,
            );
          }
        }
      },
    );
  }

  /**
   * Remove a link for a service
   */
  async removeLink(
    serviceId: string,
    organizationId: OrganizationId,
    link: ServiceLinkDto,
  ): Promise<
    | ServiceTaskRelation
    | ServiceInitiativeRelation
    | ServiceAgentSessionRelation
  > {
    await this.ensureServiceAccess(serviceId, organizationId);

    const normalized = this.normalizeLinkInput(link);

    this.logger.log('Removing service link', {
      serviceId,
      organizationId,
      entityType: normalized.entityType,
      entityId: normalized.entityId,
    });

    return await this.prisma.$transaction(
      async (
        tx: PrismaTransaction,
      ): Promise<
        | ServiceTaskRelation
        | ServiceInitiativeRelation
        | ServiceAgentSessionRelation
      > => {
        switch (normalized.entityType) {
          case 'task': {
            return await this.removeTaskLink(
              tx,
              serviceId,
              organizationId,
              normalized.entityId,
            );
          }
          case 'initiative': {
            return await this.removeInitiativeLink(
              tx,
              serviceId,
              organizationId,
              normalized.entityId,
            );
          }
          case 'agent-session': {
            return await this.removeAgentSessionLink(
              tx,
              serviceId,
              organizationId,
              normalized.entityId,
            );
          }
          default: {
            throw new BadRequestException(
              `Unsupported entity type: ${normalized.entityType as string}`,
            );
          }
        }
      },
    );
  }

  /**
   * Internal helpers
   */
  private createEmptyChildCounts(): ServiceChildCounts {
    return {
      tasks: 0,
      initiatives: 0,
      agentSessions: 0,
      implementationHints: 0,
    };
  }

  private mapToResponse(prismaService: ServiceRecordWithCounts): ServiceDto {
    const counts = {
      ...this.createEmptyChildCounts(),
      tasks: prismaService._count?.taskRelations ?? 0,
      initiatives: prismaService._count?.initiativeRelations ?? 0,
      agentSessions: prismaService._count?.agentSessionRelations ?? 0,
      implementationHints: prismaService._count?.implementationHints ?? 0,
    };

    return {
      id: prismaService.id,
      name: prismaService.name,
      description: prismaService.description ?? undefined,
      organizationId: prismaService.organizationId,
      projectId: prismaService.projectId ?? undefined,
      repositoryUrl: prismaService.repositoryUrl ?? undefined,
      repositoryType: prismaService.repositoryType as
        | 'github'
        | 'gitlab'
        | 'bitbucket'
        | 'other'
        | undefined,
      repositoryId: prismaService.repositoryId ?? undefined,
      serviceType: prismaService.serviceType as
        | 'backend'
        | 'ui'
        | 'database'
        | 'worker'
        | 'mobile'
        | 'desktop'
        | 'library'
        | 'other'
        | undefined,
      language: prismaService.language ?? undefined,
      framework: prismaService.framework ?? undefined,
      tags: prismaService.tags,
      status: prismaService.status as 'ACTIVE' | 'ARCHIVED' | 'DEPRECATED',
      childCounts: counts,
      createdAt: ensureStringDate(prismaService.createdAt),
      updatedAt: ensureStringDate(prismaService.updatedAt),
      archivedAt: prismaService.archivedAt
        ? ensureStringDate(prismaService.archivedAt)
        : undefined,
    };
  }

  private mapTaskRelation(relation: {
    id: string;
    serviceId: string;
    taskId: string;
    relationType: string | null;
    createdAt: Date;
  }): ServiceTaskRelation {
    return {
      id: relation.id,
      serviceId: relation.serviceId,
      taskId: relation.taskId,
      relationType: relation.relationType ?? undefined,
      createdAt: ensureStringDate(relation.createdAt),
    };
  }

  private mapInitiativeRelation(relation: {
    id: string;
    serviceId: string;
    initiativeId: string;
    relationType: string | null;
    createdAt: Date;
  }): ServiceInitiativeRelation {
    return {
      id: relation.id,
      serviceId: relation.serviceId,
      initiativeId: relation.initiativeId,
      relationType: relation.relationType ?? undefined,
      createdAt: ensureStringDate(relation.createdAt),
    };
  }

  private mapAgentSessionRelation(relation: {
    id: string;
    serviceId: string;
    agentSessionId: string;
    relationType: string | null;
    createdAt: Date;
  }): ServiceAgentSessionRelation {
    return {
      id: relation.id,
      serviceId: relation.serviceId,
      agentSessionId: relation.agentSessionId,
      relationType: relation.relationType ?? undefined,
      createdAt: ensureStringDate(relation.createdAt),
    };
  }

  private normalizeLinkInput(link: ServiceLinkDto): NormalizedLinkInput {
    const entityType = this.normalizeEntityType(link.entityType);
    const entityId = link.entityId?.trim();

    if (!entityId) {
      throw new BadRequestException('entityId is required for link');
    }

    return {
      entityType,
      entityId,
      relationType: link.relationType,
    };
  }

  private normalizeEntityType(value?: string | null): LinkTargetType {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('entityType is required for link');
    }

    const canonical = ENTITY_TYPE_ALIASES[normalized];
    if (!canonical) {
      throw new BadRequestException(`Unsupported entity type: ${value}`);
    }

    return canonical;
  }

  private async createTaskLink(
    tx: PrismaTransaction,
    serviceId: string,
    organizationId: OrganizationId,
    taskId: string,
    relationType?: string | null,
  ): Promise<ServiceTaskRelation> {
    await this.ensureTaskExists(tx, taskId, organizationId);

    const existing = await tx.serviceTask.findUnique({
      where: {
        serviceId_taskId: {
          serviceId,
          taskId,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Task ${taskId} is already linked to service ${serviceId}`,
      );
    }

    const created = await tx.serviceTask.create({
      data: {
        serviceId,
        taskId,
        relationType,
      },
    });

    return this.mapTaskRelation(created);
  }

  private async createInitiativeLink(
    tx: PrismaTransaction,
    serviceId: string,
    organizationId: OrganizationId,
    initiativeId: string,
    relationType?: string | null,
  ): Promise<ServiceInitiativeRelation> {
    await this.ensureInitiativeExists(tx, initiativeId, organizationId);

    const existing = await tx.serviceInitiative.findUnique({
      where: {
        serviceId_initiativeId: {
          serviceId,
          initiativeId,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Initiative ${initiativeId} is already linked to service ${serviceId}`,
      );
    }

    const created = await tx.serviceInitiative.create({
      data: {
        serviceId,
        initiativeId,
        relationType,
      },
    });

    return this.mapInitiativeRelation(created);
  }

  private async createAgentSessionLink(
    tx: PrismaTransaction,
    serviceId: string,
    organizationId: OrganizationId,
    agentSessionId: string,
    relationType?: string | null,
  ): Promise<ServiceAgentSessionRelation> {
    await this.ensureAgentSessionExists(tx, agentSessionId, organizationId);

    const existing = await tx.serviceAgentSession.findUnique({
      where: {
        serviceId_agentSessionId: {
          serviceId,
          agentSessionId,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Agent session ${agentSessionId} is already linked to service ${serviceId}`,
      );
    }

    const created = await tx.serviceAgentSession.create({
      data: {
        serviceId,
        agentSessionId,
        relationType,
      },
    });

    return this.mapAgentSessionRelation(created);
  }

  private async removeTaskLink(
    tx: PrismaTransaction,
    serviceId: string,
    organizationId: OrganizationId,
    taskId: string,
  ): Promise<ServiceTaskRelation> {
    await this.ensureTaskExists(tx, taskId, organizationId);

    const existing = await tx.serviceTask.findUnique({
      where: {
        serviceId_taskId: {
          serviceId,
          taskId,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(
        `Task ${taskId} is not linked to service ${serviceId}`,
      );
    }

    const removed = await tx.serviceTask.delete({
      where: {
        serviceId_taskId: {
          serviceId,
          taskId,
        },
      },
    });

    return this.mapTaskRelation(removed);
  }

  private async removeInitiativeLink(
    tx: PrismaTransaction,
    serviceId: string,
    organizationId: OrganizationId,
    initiativeId: string,
  ): Promise<ServiceInitiativeRelation> {
    await this.ensureInitiativeExists(tx, initiativeId, organizationId);

    const existing = await tx.serviceInitiative.findUnique({
      where: {
        serviceId_initiativeId: {
          serviceId,
          initiativeId,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(
        `Initiative ${initiativeId} is not linked to service ${serviceId}`,
      );
    }

    const removed = await tx.serviceInitiative.delete({
      where: {
        serviceId_initiativeId: {
          serviceId,
          initiativeId,
        },
      },
    });

    return this.mapInitiativeRelation(removed);
  }

  private async removeAgentSessionLink(
    tx: PrismaTransaction,
    serviceId: string,
    organizationId: OrganizationId,
    agentSessionId: string,
  ): Promise<ServiceAgentSessionRelation> {
    await this.ensureAgentSessionExists(tx, agentSessionId, organizationId);

    const existing = await tx.serviceAgentSession.findUnique({
      where: {
        serviceId_agentSessionId: {
          serviceId,
          agentSessionId,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(
        `Agent session ${agentSessionId} is not linked to service ${serviceId}`,
      );
    }

    const removed = await tx.serviceAgentSession.delete({
      where: {
        serviceId_agentSessionId: {
          serviceId,
          agentSessionId,
        },
      },
    });

    return this.mapAgentSessionRelation(removed);
  }

  private async ensureTaskExists(
    tx: PrismaTransaction,
    taskId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    const task = await tx.task.findFirst({
      where: {
        id: taskId,
        organizationId,
        archivedAt: null,
      },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundException(
        `Task ${taskId} not found in organization ${organizationId}`,
      );
    }
  }

  private async ensureInitiativeExists(
    tx: PrismaTransaction,
    initiativeId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    const initiative = await tx.initiative.findFirst({
      where: {
        id: initiativeId,
        organizationId,
        archivedAt: null,
      },
      select: { id: true },
    });

    if (!initiative) {
      throw new NotFoundException(
        `Initiative ${initiativeId} not found in organization ${organizationId}`,
      );
    }
  }

  private async ensureAgentSessionExists(
    tx: PrismaTransaction,
    agentSessionId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    const agentSession = await tx.agentSession.findFirst({
      where: {
        id: agentSessionId,
        organizationId,
      },
      select: { id: true },
    });

    if (!agentSession) {
      throw new NotFoundException(
        `Agent session ${agentSessionId} not found in organization ${organizationId}`,
      );
    }
  }

  private async ensureServiceAccess(
    serviceId: string,
    organizationId: OrganizationId,
    options?: ServiceVisibilityOptions,
  ): Promise<void> {
    const exists = await this.prisma.db.service.findFirst({
      where: {
        id: serviceId,
        organizationId,
        archivedAt: null,
        ...this.buildVisibilityWhere(options?.includeInternal),
      },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException(
        `Service ${serviceId} not found in organization ${organizationId}`,
      );
    }
  }

  private buildVisibilityWhere(
    includeInternal?: boolean,
  ): Record<string, unknown> {
    if (includeInternal) {
      return {};
    }

    return {
      NOT: { serviceType: INTERNAL_SERVICE_TYPE },
    };
  }
}
