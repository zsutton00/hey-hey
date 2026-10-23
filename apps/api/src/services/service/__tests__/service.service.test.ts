import {
  Prisma,
  Service as PrismaServiceRecord,
  ServiceAgentSession as PrismaServiceAgentSessionRecord,
  ServiceInitiative as PrismaServiceInitiativeRecord,
  ServiceTask as PrismaServiceTaskRecord,
} from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ServiceService } from '../service.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateServiceDto,
  ServiceLinkDto,
  UpdateServiceDto,
} from '../../../generated';
import { OrganizationId, ProjectId, ServiceId } from '../../../types';
import * as TestUtils from '../../../utils/testUtils';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';

type DomainEventPublisherMock = jest.Mocked<
  Pick<DomainEventPublisher, 'publish' | 'publishInTransaction'>
>;
type MockPrismaService = ReturnType<typeof TestUtils.createMockPrismaService>;

describe('ServiceService', () => {
  let service: ServiceService;
  let prismaService: MockPrismaService;
  let eventPublisher: DomainEventPublisherMock;
  const organizationId = TestUtils.testIds.organization;
  const projectId = TestUtils.testIds.project;
  const serviceId = 'service-123' as ServiceId;
  const countSelection = {
    _count: {
      select: {
        taskRelations: true,
        initiativeRelations: true,
        agentSessionRelations: true,
        implementationHints: true,
      },
    },
  };

  beforeEach(async () => {
    prismaService = TestUtils.createMockPrismaService();
    Object.assign(prismaService.db.service, { updateMany: jest.fn() });
    prismaService.$transaction.mockImplementation(async (callback) =>
      callback(prismaService.db as unknown as Prisma.TransactionClient),
    );
    eventPublisher =
      TestUtils.createMockDomainEventPublisher() as DomainEventPublisherMock;

    const setup = await createServiceTestingModule({
      providers: [ServiceService, PrismaService],
      overrides: [
        [PrismaService, prismaService],
        [DOMAIN_EVENT_PUBLISHER_TOKEN, eventPublisher],
      ],
    });

    service = setup.module.get(ServiceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a service with all fields', async () => {
      const dto: CreateServiceDto & { organizationId: OrganizationId } = {
        name: 'API Service',
        description: 'Main backend API',
        organizationId,
        projectId,
        repositoryUrl: 'https://github.com/org/api',
        repositoryType: 'github',
        repositoryId: 'repo-123',
        serviceType: 'backend',
        language: 'TypeScript',
        framework: 'NestJS',
        tags: ['api', 'backend'],
      };

      const mockService: PrismaServiceRecord = {
        id: serviceId,
        name: dto.name,
        description: dto.description ?? null,
        organizationId: dto.organizationId,
        projectId: dto.projectId ?? null,
        repositoryUrl: dto.repositoryUrl ?? null,
        repositoryType: dto.repositoryType ?? null,
        repositoryId: dto.repositoryId ?? null,
        serviceType: dto.serviceType ?? null,
        language: dto.language ?? null,
        framework: dto.framework ?? null,
        tags: dto.tags ?? [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      };

      prismaService.db.service.create.mockResolvedValue(mockService);

      const result = await service.create(dto);

      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(prismaService.db.service.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'API Service',
          description: 'Main backend API',
          organizationId,
          projectId,
          repositoryUrl: 'https://github.com/org/api',
          repositoryType: 'github',
          serviceType: 'backend',
          language: 'TypeScript',
          framework: 'NestJS',
          tags: ['api', 'backend'],
          status: 'ACTIVE',
        }),
        include: countSelection,
      });

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.SERVICE.CREATED,
          aggregateId: serviceId,
          payload: expect.objectContaining({
            payloadType: EVENT_TYPES.SERVICE.CREATED,
            organizationId,
            projectId,
          }),
        }),
      );

      expect(result.id).toBe(serviceId);
      expect(result.name).toBe('API Service');
    });

    it('should create a service with minimal fields', async () => {
      const dto: CreateServiceDto & { organizationId: OrganizationId } = {
        name: 'Simple Service',
        organizationId,
      };

      const mockService: PrismaServiceRecord = {
        id: serviceId,
        name: dto.name,
        description: null,
        organizationId: dto.organizationId,
        projectId: null,
        repositoryUrl: null,
        repositoryType: null,
        repositoryId: null,
        serviceType: null,
        language: null,
        framework: null,
        tags: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      };

      prismaService.db.service.create.mockResolvedValue(mockService);

      const result = await service.create(dto);

      expect(result.id).toBe(serviceId);
      expect(result.name).toBe('Simple Service');
      expect(result.description).toBeUndefined();
      expect(result.projectId).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('should return all services for an organization', async () => {
      const mockServices: PrismaServiceRecord[] = [
        {
          id: 'service-1',
          name: 'Service 1',
          description: 'First service',
          organizationId,
          projectId: null,
          repositoryUrl: null,
          repositoryType: null,
          repositoryId: null,
          serviceType: 'backend',
          language: 'TypeScript',
          framework: null,
          tags: ['api'],
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          archivedAt: null,
        },
        {
          id: 'service-2',
          name: 'Service 2',
          description: null,
          organizationId,
          projectId,
          repositoryUrl: 'https://github.com/org/ui',
          repositoryType: 'github',
          repositoryId: 'repo-456',
          serviceType: 'ui',
          language: 'TypeScript',
          framework: 'React',
          tags: ['frontend'],
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          archivedAt: null,
        },
      ];

      prismaService.db.service.findMany.mockResolvedValue(mockServices);

      const result = await service.findAll(organizationId);

      expect(prismaService.db.service.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null,
          NOT: { serviceType: 'virtual' },
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
        include: countSelection,
      });

      expect(result).toHaveLength(2);
      const [firstService, secondService] = result;
      if (!firstService || !secondService) {
        throw new Error('Expected service results');
      }
      expect(firstService.name).toBe('Service 1');
      expect(secondService.name).toBe('Service 2');
    });

    it('should list archived services when filtering by ARCHIVED', async () => {
      prismaService.db.service.findMany.mockResolvedValue([]);

      await service.findAll(organizationId, { status: 'ARCHIVED' });

      expect(prismaService.db.service.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          NOT: { serviceType: 'virtual' },
          status: 'ARCHIVED',
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
        include: countSelection,
      });
    });

    it('should filter services by serviceType', async () => {
      prismaService.db.service.findMany.mockResolvedValue([]);

      await service.findAll(organizationId, { serviceType: 'backend' });

      expect(prismaService.db.service.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null,
          NOT: { serviceType: 'virtual' },
          serviceType: 'backend',
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
        include: countSelection,
      });
    });

    it('should filter services by repositoryType', async () => {
      prismaService.db.service.findMany.mockResolvedValue([]);

      await service.findAll(organizationId, { repositoryType: 'github' });

      expect(prismaService.db.service.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null,
          NOT: { serviceType: 'virtual' },
          repositoryType: 'github',
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
        include: countSelection,
      });
    });

    it('should filter services by projectId', async () => {
      prismaService.db.service.findMany.mockResolvedValue([]);

      await service.findAll(organizationId, { projectId });

      expect(prismaService.db.service.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null,
          NOT: { serviceType: 'virtual' },
          projectId,
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
        include: countSelection,
      });
    });

    it('should filter services by tags', async () => {
      prismaService.db.service.findMany.mockResolvedValue([]);

      await service.findAll(organizationId, { tags: ['api', 'backend'] });

      expect(prismaService.db.service.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null,
          NOT: { serviceType: 'virtual' },
          tags: { hasSome: ['api', 'backend'] },
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
        include: countSelection,
      });
    });

    it('should support pagination', async () => {
      prismaService.db.service.findMany.mockResolvedValue([]);

      await service.findAll(organizationId, { page: 2, limit: 10 });

      expect(prismaService.db.service.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null,
          NOT: { serviceType: 'virtual' },
        },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
        include: countSelection,
      });
    });

    it('should allow including internal services when explicitly requested', async () => {
      prismaService.db.service.findMany.mockResolvedValue([]);

      await service.findAll(organizationId, { includeInternal: true });

      expect(prismaService.db.service.findMany).toHaveBeenCalledWith({
        where: {
          organizationId,
          archivedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
        include: countSelection,
      });
    });
  });

  describe('findOne', () => {
    it('should return a service by id', async () => {
      const mockService: PrismaServiceRecord = {
        id: serviceId,
        name: 'Test Service',
        description: 'A test service',
        organizationId,
        projectId: null,
        repositoryUrl: null,
        repositoryType: null,
        repositoryId: null,
        serviceType: 'backend',
        language: 'TypeScript',
        framework: null,
        tags: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      };

      prismaService.db.service.findFirst.mockResolvedValue(mockService);

      const result = await service.findOne(serviceId, organizationId);

      expect(prismaService.db.service.findFirst).toHaveBeenCalledWith({
        where: {
          id: serviceId,
          organizationId,
          archivedAt: null,
          NOT: { serviceType: 'virtual' },
        },
        include: countSelection,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(serviceId);
      expect(result?.name).toBe('Test Service');
    });

    it('should return null if service not found', async () => {
      prismaService.db.service.findFirst.mockResolvedValue(null);

      const result = await service.findOne(serviceId, organizationId);

      expect(result).toBeNull();
    });

    it('should allow including internal services when explicitly requested', async () => {
      const mockService: PrismaServiceRecord = {
        id: serviceId,
        name: 'Internal Service',
        description: null,
        organizationId,
        projectId: null,
        repositoryUrl: null,
        repositoryType: null,
        repositoryId: null,
        serviceType: 'virtual',
        language: null,
        framework: null,
        tags: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      };

      prismaService.db.service.findFirst.mockResolvedValue(mockService);

      await service.findOne(serviceId, organizationId, {
        includeInternal: true,
      });

      expect(prismaService.db.service.findFirst).toHaveBeenCalledWith({
        where: { id: serviceId, organizationId, archivedAt: null },
        include: countSelection,
      });
    });
  });

  describe('update', () => {
    const existingService: PrismaServiceRecord = {
      id: serviceId,
      name: 'Original Service',
      description: 'Original description',
      organizationId,
      projectId: null,
      repositoryUrl: null,
      repositoryType: null,
      repositoryId: null,
      serviceType: 'backend',
      language: 'TypeScript',
      framework: null,
      tags: ['original'],
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };

    it('should update a service', async () => {
      const updateDto: UpdateServiceDto = {
        name: 'Updated Service',
        description: 'Updated description',
        framework: 'NestJS',
        tags: ['updated', 'api'],
      };

      prismaService.db.service.findFirst.mockResolvedValue(existingService);
      prismaService.db.service.update.mockResolvedValue({
        ...existingService,
        ...updateDto,
      });

      const result = await service.update(serviceId, updateDto, organizationId);

      expect(prismaService.db.service.update).toHaveBeenCalledWith({
        where: { id: serviceId },
        data: expect.objectContaining({
          name: 'Updated Service',
          description: 'Updated description',
          framework: 'NestJS',
          tags: ['updated', 'api'],
        }),
        include: countSelection,
      });

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.SERVICE.UPDATED,
          aggregateId: serviceId,
        }),
      );

      expect(result.name).toBe('Updated Service');
    });

    it('should throw NotFoundException if service does not exist', async () => {
      prismaService.db.service.findFirst.mockResolvedValue(null);

      await expect(
        service.update(serviceId, { name: 'Updated' }, organizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow setting nullable fields to null', async () => {
      const updateDto: UpdateServiceDto = {
        description: null as unknown as string,
        projectId: null as unknown as string,
      };

      prismaService.db.service.findFirst.mockResolvedValue(existingService);
      prismaService.db.service.update.mockResolvedValue({
        ...existingService,
        description: null,
        projectId: null,
      });

      await service.update(serviceId, updateDto, organizationId);

      expect(prismaService.db.service.update).toHaveBeenCalledWith({
        where: { id: serviceId },
        data: expect.objectContaining({
          description: null,
          projectId: null,
        }),
        include: countSelection,
      });
    });
  });

  describe('archive', () => {
    it('should archive a service', async () => {
      const mockService: PrismaServiceRecord = {
        id: serviceId,
        name: 'Service to Archive',
        description: null,
        organizationId,
        projectId: null,
        repositoryUrl: null,
        repositoryType: null,
        repositoryId: null,
        serviceType: 'backend',
        language: null,
        framework: null,
        tags: [],
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      };

      prismaService.db.service.findFirst.mockResolvedValue(mockService);
      prismaService.db.service.update.mockResolvedValue({
        ...mockService,
        status: 'ARCHIVED',
        archivedAt: new Date(),
      });

      const result = await service.archive(serviceId, organizationId);

      expect(prismaService.db.service.update).toHaveBeenCalledWith({
        where: { id: serviceId },
        data: {
          archivedAt: expect.any(Date),
          updatedAt: expect.any(Date),
          status: 'ARCHIVED',
        },
        include: countSelection,
      });

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.SERVICE.ARCHIVED,
          aggregateId: serviceId,
        }),
      );

      expect(result.status).toBe('ARCHIVED');
    });

    it('should throw NotFoundException if service does not exist', async () => {
      prismaService.db.service.findFirst.mockResolvedValue(null);

      await expect(service.archive(serviceId, organizationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('marks an archived service deleted without removing the row', async () => {
      (
        prismaService.db.service as unknown as { updateMany: jest.Mock }
      ).updateMany.mockResolvedValue({ count: 1 });

      await service.delete(serviceId, organizationId);

      expect(
        (prismaService.db.service as unknown as { updateMany: jest.Mock })
          .updateMany,
      ).toHaveBeenCalledWith({
        where: { id: serviceId, organizationId, status: 'ARCHIVED' },
        data: { status: 'DELETED', updatedAt: expect.any(Date) },
      });
      expect(prismaService.db.service.delete).not.toHaveBeenCalled();
    });

    it('rejects deletion of a service that is not archived', async () => {
      (
        prismaService.db.service as unknown as { updateMany: jest.Mock }
      ).updateMany.mockResolvedValue({ count: 0 });
      prismaService.db.service.findFirst.mockResolvedValue({
        status: 'ACTIVE',
      } as never);

      await expect(service.delete(serviceId, organizationId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException for a missing or already deleted service', async () => {
      (
        prismaService.db.service as unknown as { updateMany: jest.Mock }
      ).updateMany.mockResolvedValue({ count: 0 });
      prismaService.db.service.findFirst.mockResolvedValue(null);

      await expect(service.delete(serviceId, organizationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOwningProjectId', () => {
    it('resolves the project of an archived service from persistence', async () => {
      prismaService.db.service.findFirst.mockResolvedValue({
        projectId,
      } as never);

      await expect(
        service.findOwningProjectId(serviceId, organizationId),
      ).resolves.toBe(projectId);
      expect(prismaService.db.service.findFirst).toHaveBeenCalledWith({
        where: {
          id: serviceId,
          organizationId,
          status: { not: 'DELETED' },
        },
        select: { projectId: true },
      });
    });
  });

  describe('getLinks', () => {
    it('should return all links for a service', async () => {
      const mockService = {
        id: serviceId,
        organizationId,
      };

      prismaService.db.service.findFirst.mockResolvedValue(mockService as any);

      const mockTaskLinks: PrismaServiceTaskRecord[] = [
        {
          id: 'link-1',
          serviceId,
          taskId: TestUtils.testIds.task,
          relationType: 'implements',
          createdAt: new Date('2024-01-01'),
        },
      ];

      const mockInitiativeLinks: PrismaServiceInitiativeRecord[] = [
        {
          id: 'link-2',
          serviceId,
          initiativeId: TestUtils.testIds.initiative,
          relationType: null,
          createdAt: new Date('2024-01-02'),
        },
      ];

      const mockAgentSessionLinks: PrismaServiceAgentSessionRecord[] = [
        {
          id: 'link-4',
          serviceId,
          agentSessionId: 'agent-session-123',
          relationType: null,
          createdAt: new Date('2024-01-04'),
        },
      ];

      prismaService.db.serviceTask.findMany.mockResolvedValue(mockTaskLinks);
      prismaService.db.serviceInitiative.findMany.mockResolvedValue(
        mockInitiativeLinks,
      );
      prismaService.db.serviceAgentSession.findMany.mockResolvedValue(
        mockAgentSessionLinks,
      );

      const result = await service.getLinks(serviceId, organizationId);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(
        expect.objectContaining({ taskId: TestUtils.testIds.task }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({ initiativeId: TestUtils.testIds.initiative }),
      );
      expect(result[2]).toEqual(
        expect.objectContaining({ agentSessionId: 'agent-session-123' }),
      );
    });

    it('should throw NotFoundException if service does not exist', async () => {
      prismaService.db.service.findFirst.mockResolvedValue(null);

      await expect(service.getLinks(serviceId, organizationId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createLink', () => {
    beforeEach(() => {
      const mockService = {
        id: serviceId,
        organizationId,
      };
      prismaService.db.service.findFirst.mockResolvedValue(mockService as any);
    });

    it('should create a task link', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'task',
        entityId: TestUtils.testIds.task,
        relationType: 'implements',
      };

      const mockTask = { id: TestUtils.testIds.task, organizationId };
      prismaService.db.task.findFirst.mockResolvedValue(mockTask as any);
      prismaService.db.serviceTask.findUnique.mockResolvedValue(null);

      const mockCreatedLink: PrismaServiceTaskRecord = {
        id: 'link-123',
        serviceId,
        taskId: TestUtils.testIds.task,
        relationType: 'implements',
        createdAt: new Date(),
      };

      prismaService.db.serviceTask.create.mockResolvedValue(mockCreatedLink);

      const result = await service.createLink(
        serviceId,
        organizationId,
        linkDto,
      );

      expect(prismaService.db.serviceTask.create).toHaveBeenCalledWith({
        data: {
          serviceId,
          taskId: TestUtils.testIds.task,
          relationType: 'implements',
        },
      });

      expect(result).toEqual(
        expect.objectContaining({ taskId: TestUtils.testIds.task }),
      );
    });

    it('should create an initiative link', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'initiative',
        entityId: TestUtils.testIds.initiative,
      };

      const mockInitiative = {
        id: TestUtils.testIds.initiative,
        organizationId,
      };
      prismaService.db.initiative.findFirst.mockResolvedValue(
        mockInitiative as any,
      );
      prismaService.db.serviceInitiative.findUnique.mockResolvedValue(null);

      const mockCreatedLink: PrismaServiceInitiativeRecord = {
        id: 'link-456',
        serviceId,
        initiativeId: TestUtils.testIds.initiative,
        relationType: null,
        createdAt: new Date(),
      };

      prismaService.db.serviceInitiative.create.mockResolvedValue(
        mockCreatedLink,
      );

      const result = await service.createLink(
        serviceId,
        organizationId,
        linkDto,
      );

      expect(result).toEqual(
        expect.objectContaining({ initiativeId: TestUtils.testIds.initiative }),
      );
    });

    it('should create an agent-session link', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'agent-session',
        entityId: 'agent-session-123',
      };

      const mockAgentSession = {
        id: 'agent-session-123',
        organizationId,
      };
      prismaService.db.agentSession.findFirst.mockResolvedValue(
        mockAgentSession as any,
      );
      prismaService.db.serviceAgentSession.findUnique.mockResolvedValue(null);

      const mockCreatedLink: PrismaServiceAgentSessionRecord = {
        id: 'link-abc',
        serviceId,
        agentSessionId: 'agent-session-123',
        relationType: null,
        createdAt: new Date(),
      };

      prismaService.db.serviceAgentSession.create.mockResolvedValue(
        mockCreatedLink,
      );

      const result = await service.createLink(
        serviceId,
        organizationId,
        linkDto,
      );

      expect(result).toEqual(
        expect.objectContaining({ agentSessionId: 'agent-session-123' }),
      );
    });

    it('should throw BadRequestException for invalid entity type', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'invalid-type' as any,
        entityId: 'some-id',
      };

      await expect(
        service.createLink(serviceId, organizationId, linkDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if link already exists', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'task',
        entityId: TestUtils.testIds.task,
      };

      const mockTask = { id: TestUtils.testIds.task, organizationId };
      prismaService.db.task.findFirst.mockResolvedValue(mockTask as any);

      const existingLink = {
        id: 'existing-link',
        serviceId,
        taskId: TestUtils.testIds.task,
      };
      prismaService.db.serviceTask.findUnique.mockResolvedValue(
        existingLink as any,
      );

      await expect(
        service.createLink(serviceId, organizationId, linkDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if linked entity does not exist', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'task',
        entityId: 'non-existent-task',
      };

      prismaService.db.task.findFirst.mockResolvedValue(null);

      await expect(
        service.createLink(serviceId, organizationId, linkDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should normalize entity type aliases', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'tasks' as any, // Plural form
        entityId: TestUtils.testIds.task,
      };

      const mockTask = { id: TestUtils.testIds.task, organizationId };
      prismaService.db.task.findFirst.mockResolvedValue(mockTask as any);
      prismaService.db.serviceTask.findUnique.mockResolvedValue(null);

      const mockCreatedLink: PrismaServiceTaskRecord = {
        id: 'link-normalized',
        serviceId,
        taskId: TestUtils.testIds.task,
        relationType: null,
        createdAt: new Date(),
      };

      prismaService.db.serviceTask.create.mockResolvedValue(mockCreatedLink);

      await service.createLink(serviceId, organizationId, linkDto);

      expect(prismaService.db.serviceTask.create).toHaveBeenCalled();
    });
  });

  describe('removeLink', () => {
    beforeEach(() => {
      const mockService = {
        id: serviceId,
        organizationId,
      };
      prismaService.db.service.findFirst.mockResolvedValue(mockService as any);
    });

    it('should remove a task link', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'task',
        entityId: TestUtils.testIds.task,
      };

      const mockTask = { id: TestUtils.testIds.task, organizationId };
      prismaService.db.task.findFirst.mockResolvedValue(mockTask as any);
      prismaService.db.serviceTask.findUnique.mockResolvedValue({
        id: 'link-123',
        serviceId,
        taskId: TestUtils.testIds.task,
        relationType: 'implements',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      } as PrismaServiceTaskRecord);

      const removed: PrismaServiceTaskRecord = {
        id: 'link-123',
        serviceId,
        taskId: TestUtils.testIds.task,
        relationType: 'implements',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      };
      prismaService.db.serviceTask.delete.mockResolvedValue(removed);

      const result = await service.removeLink(
        serviceId,
        organizationId,
        linkDto,
      );

      expect(prismaService.db.serviceTask.delete).toHaveBeenCalledWith({
        where: {
          serviceId_taskId: {
            serviceId,
            taskId: TestUtils.testIds.task,
          },
        },
      });
      expect(result).toEqual(
        expect.objectContaining({ taskId: TestUtils.testIds.task }),
      );
    });

    it('should throw NotFoundException when task link does not exist', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'task',
        entityId: TestUtils.testIds.task,
      };

      const mockTask = { id: TestUtils.testIds.task, organizationId };
      prismaService.db.task.findFirst.mockResolvedValue(mockTask as any);
      prismaService.db.serviceTask.findUnique.mockResolvedValue(null);

      await expect(
        service.removeLink(serviceId, organizationId, linkDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid entity type', async () => {
      const linkDto: ServiceLinkDto = {
        entityType: 'invalid-type' as any,
        entityId: TestUtils.testIds.task,
      };

      await expect(
        service.removeLink(serviceId, organizationId, linkDto),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
