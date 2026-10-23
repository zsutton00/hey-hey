import { UserId } from 'src/types';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { ProjectMembershipRevocationService } from 'src/core/websockets/project-membership-revocation.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Client, Workflow, WorkflowHandle } from '@temporalio/client';
import { Prisma } from '@prisma/client';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import { EventContextManager } from '../../core/events/observable-event.context';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import {
  ConversationStatus,
  CreateProjectDto,
  InitiativeSourceType,
  ProjectStatus,
  ProjectExistingWorkIntent,
  ProjectFeatureNextStepKind,
  UpdateProjectDto,
  WorkflowName,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../../types';
import * as TestUtils from '../../utils/testUtils';
import { normalizeProjectConfig, ProjectService } from '../project.service';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import { WorkflowTypeRegistryService } from '../workflows/workflow-type-registry.service';
import { OrganizationProjectEntitlementService } from '../organization-project-entitlement.service';
const { testIds } = TestUtils;

describe('ProjectService', () => {
  let service: ProjectService;
  let prismaService: PrismaService;
  let temporalClient: Client;
  let workflowTypeRegistry: WorkflowTypeRegistryService;
  let workItemTypeRegistry: WorkItemTypeRegistryService;
  let eventPublisher: ReturnType<
    typeof TestUtils.createMockDomainEventPublisher
  >;
  let entitlementService: { assertProjectCreationAllowed: jest.Mock };
  let entityRegistryService: { registerEntity: jest.Mock };
  let projectAccess: {
    projectWhere: ProjectAccessService['projectWhere'];
    assertProject: jest.Mock;
    assertProjectRole: jest.Mock;
    assertOrganizationRole: jest.Mock;
    findProjectRole: jest.Mock;
  };

  const mockOrganizationId = testIds.organization;
  const mockProjectId = testIds.project;
  const actorId = 'caller' as UserId;

  const mockProject = TestUtils.createMockDbProject({
    id: mockProjectId,
    name: 'Test Project',
    description: 'Test Description',
    organizationId: mockOrganizationId,
    status: ProjectStatus.Onboarding,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    deletedAt: null,
  });

  const mockCreateProjectDto: CreateProjectDto = {
    name: 'Test Project',
    description: 'Test Description',
  };

  const mockUpdateProjectDto = {
    name: 'Updated Project',
    description: 'Updated Description',
  } satisfies UpdateProjectDto;

  beforeEach(async () => {
    const mockPrismaService = TestUtils.createMockPrismaServiceWithTypes();
    jest
      .spyOn(mockPrismaService.db.outboxEvent, 'findMany')
      .mockResolvedValue([] as never);
    eventPublisher = TestUtils.createMockDomainEventPublisher();

    const mockTemporalClient = {
      workflow: {
        start: jest.fn(),
        getHandle: jest.fn(),
      },
    };

    const workItemTypeRegistryMock = {
      refresh: jest.fn().mockResolvedValue(undefined),
      publishConfigChanged: jest.fn().mockResolvedValue(undefined),
    };
    entitlementService = {
      assertProjectCreationAllowed: jest.fn().mockResolvedValue(undefined),
    };
    entityRegistryService = {
      registerEntity: jest.fn().mockResolvedValue(undefined),
    };

    // Default mocks for flow resolution
    // These tables exist in the mock but not in the actual PrismaService type
    type MockDb = typeof mockPrismaService.db & {
      interactionFlow: { findFirst: jest.Mock };
      uiFlow: { findFirst: jest.Mock };
      interactionStep: { findUnique: jest.Mock };
    };
    const mockDbWithExtras = mockPrismaService.db as MockDb;
    mockDbWithExtras.interactionFlow.findFirst.mockResolvedValue({
      id: 'flow-default',
      name: 'project_onboarding',
    });

    mockDbWithExtras.uiFlow.findFirst.mockResolvedValue({
      id: 'ui-flow-onboarding',
      name: 'onboarding',
    });

    mockDbWithExtras.interactionStep.findUnique.mockResolvedValue({
      step: 1,
      flowId: 'flow-default',
      interactionTypeId: 'int-default',
      type: {
        id: 'int-default',
        name: 'project_onboarding',
        canBeTriggered: true,
      },
    });

    // interactionStep and uiFlow mocks may be overridden in individual tests
    (mockPrismaService.db.$transaction as jest.Mock).mockImplementation(
      async (callback) => callback(mockPrismaService.db),
    );

    projectAccess = {
      projectWhere: new ProjectAccessService(mockPrismaService as never)
        .projectWhere,
      assertProject: jest.fn(),
      assertProjectRole: jest.fn().mockResolvedValue('OWNER'),
      assertOrganizationRole: jest.fn().mockResolvedValue('OWNER'),
      findProjectRole: jest.fn().mockResolvedValue('OWNER'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProjectAccessService,
          useValue: projectAccess,
        },
        {
          provide: ProjectMembershipRevocationService,
          useValue: { membershipRemoved: jest.fn() },
        },
        ProjectService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: 'TEMPORAL_CLIENT',
          useValue: mockTemporalClient,
        },
        {
          provide: WorkflowTypeRegistryService,
          useValue: {
            startWorkflowByType: jest.fn().mockResolvedValue({
              workflowId: 'mock-workflow-id',
              conversationId: 'mock-conversation-id',
              success: true,
            }),
          },
        },
        {
          provide: WorkItemTypeRegistryService,
          useValue: workItemTypeRegistryMock,
        },
        {
          provide: OrganizationProjectEntitlementService,
          useValue: entitlementService,
        },
        {
          provide: EntityRegistryService,
          useValue: entityRegistryService,
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: eventPublisher,
        },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
    prismaService = module.get(PrismaService);
    temporalClient = module.get('TEMPORAL_CLIENT');
    workItemTypeRegistry = module.get(WorkItemTypeRegistryService);
    workflowTypeRegistry = module.get(WorkflowTypeRegistryService);
  });

  describe('create', () => {
    it('should create a project with onboarding status', async () => {
      jest
        .spyOn(prismaService.db.project, 'create')
        .mockResolvedValue(mockProject);

      const result = await service.create(
        {
          ...mockCreateProjectDto,
          organizationId: mockOrganizationId,
        },
        testIds.user,
      );

      expect(result).toEqual(mockProject);
      expect(prismaService.db.project.create).toHaveBeenCalledWith({
        data: {
          ...mockCreateProjectDto,
          organizationId: mockOrganizationId,
          config: {
            version: 1,
            existingWorkIntent: 'unanswered',
          },
          status: ProjectStatus.Onboarding,
          createdBy: testIds.user,
        },
      });
      expect(
        entitlementService.assertProjectCreationAllowed,
      ).toHaveBeenCalledWith(prismaService.db, mockOrganizationId);
      expect(prismaService.db.projectMember.create).toHaveBeenCalledWith({
        data: {
          projectId: mockProject.id,
          userId: testIds.user,
          role: 'OWNER',
        },
      });
      expect(entityRegistryService.registerEntity).toHaveBeenCalledWith(
        {
          organizationId: mockOrganizationId,
          entityId: mockProject.id,
          entityType: 'PROJECT',
          name: mockProject.name,
        },
        prismaService.db,
      );
      expect(workItemTypeRegistry.refresh).toHaveBeenCalledTimes(1);
      expect(workItemTypeRegistry.publishConfigChanged).toHaveBeenCalledWith(
        mockOrganizationId,
        'ALL',
      );
      expect(workflowTypeRegistry.startWorkflowByType).toHaveBeenCalledWith(
        WorkflowName.Onboarding,
        null, // no conversationId for project creation
        mockProject.id,
        mockOrganizationId,
        testIds.user, // project.createdBy fallback (since no context userId)
        'Project Onboarding',
        'project',
        mockProject.id,
        undefined,
        { repositoryGroundingIntentRequired: true },
      );
    });

    it('accepts a valid selected intent in the Project config', async () => {
      const config = {
        version: 1,
        existingWorkIntent: 'selected',
      } as const;
      const createdProject = { ...mockProject, config };
      jest
        .spyOn(prismaService.db.project, 'create')
        .mockResolvedValue(createdProject);

      await service.create(
        {
          ...mockCreateProjectDto,
          config,
          organizationId: mockOrganizationId,
        },
        testIds.user,
      );

      expect(prismaService.db.project.create).toHaveBeenCalledWith({
        data: {
          ...mockCreateProjectDto,
          organizationId: mockOrganizationId,
          config,
          status: ProjectStatus.Onboarding,
          createdBy: testIds.user,
        },
      });
    });

    it('rejects an invalid Project config before creating a project', async () => {
      await expect(
        service.create(
          {
            ...mockCreateProjectDto,
            config: {
              version: 2,
              existingWorkIntent: 'selected',
            } as never,
            organizationId: mockOrganizationId,
          },
          testIds.user,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaService.db.project.create).not.toHaveBeenCalled();
    });

    it('refuses creation before admission or any write when the actor lacks the organization role', async () => {
      projectAccess.assertOrganizationRole.mockRejectedValueOnce(
        new ForbiddenException('Insufficient permissions'),
      );

      await expect(
        service.create(
          { ...mockCreateProjectDto, organizationId: mockOrganizationId },
          testIds.user,
        ),
      ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));

      expect(projectAccess.assertOrganizationRole).toHaveBeenCalledWith(
        mockOrganizationId,
        testIds.user,
        'createProject',
      );
      expect(
        entitlementService.assertProjectCreationAllowed,
      ).not.toHaveBeenCalled();
      expect(prismaService.db.project.create).not.toHaveBeenCalled();
      expect(prismaService.db.projectMember.create).not.toHaveBeenCalled();
      expect(workflowTypeRegistry.startWorkflowByType).not.toHaveBeenCalled();
    });

    it('does not insert or schedule onboarding when entitlement admission is denied', async () => {
      entitlementService.assertProjectCreationAllowed.mockRejectedValueOnce(
        new Error('project limit reached'),
      );

      await expect(
        service.create(
          {
            ...mockCreateProjectDto,
            organizationId: mockOrganizationId,
          },
          testIds.user,
        ),
      ).rejects.toThrow('project limit reached');

      expect(prismaService.db.project.create).not.toHaveBeenCalled();
      expect(workflowTypeRegistry.startWorkflowByType).not.toHaveBeenCalled();
    });

    it('returns the committed project and starts onboarding when the post-commit registry refresh fails', async () => {
      jest
        .spyOn(prismaService.db.project, 'create')
        .mockResolvedValue(mockProject);
      (workItemTypeRegistry.refresh as jest.Mock).mockRejectedValueOnce(
        new Error('cache refresh unavailable'),
      );

      await expect(
        service.create(
          {
            ...mockCreateProjectDto,
            organizationId: mockOrganizationId,
          },
          testIds.user,
        ),
      ).resolves.toEqual(mockProject);

      expect(workItemTypeRegistry.publishConfigChanged).toHaveBeenCalledWith(
        mockOrganizationId,
        'ALL',
      );
      expect(workflowTypeRegistry.startWorkflowByType).toHaveBeenCalledTimes(1);
    });

    it('returns the committed project and starts onboarding when post-commit registry publication fails', async () => {
      jest
        .spyOn(prismaService.db.project, 'create')
        .mockResolvedValue(mockProject);
      (
        workItemTypeRegistry.publishConfigChanged as jest.Mock
      ).mockRejectedValueOnce(new Error('registry publication unavailable'));

      await expect(
        service.create(
          {
            ...mockCreateProjectDto,
            organizationId: mockOrganizationId,
          },
          testIds.user,
        ),
      ).resolves.toEqual(mockProject);

      expect(workItemTypeRegistry.refresh).toHaveBeenCalledTimes(1);
      expect(workflowTypeRegistry.startWorkflowByType).toHaveBeenCalledTimes(1);
    });

    it('seeds onboarding flow context with the isolated mock session', async () => {
      jest
        .spyOn(prismaService.db.project, 'create')
        .mockResolvedValue(mockProject);
      const mockLlmSessionId =
        '9db93370-808f-4bba-a38c-84c72cd35937' as import('../../types').MockLlmSessionId;

      await service.create(
        {
          ...mockCreateProjectDto,
          organizationId: mockOrganizationId,
        },
        testIds.user,
        mockLlmSessionId,
      );

      expect(workflowTypeRegistry.startWorkflowByType).toHaveBeenCalledWith(
        WorkflowName.Onboarding,
        null,
        mockProject.id,
        mockOrganizationId,
        testIds.user,
        'Project Onboarding',
        'project',
        mockProject.id,
        undefined,
        {
          repositoryGroundingIntentRequired: true,
          mockLlmSessionId,
        },
      );
    });

    it('records the creator as an OWNER project member when userId is in event context', async () => {
      jest
        .spyOn(prismaService.db.project, 'create')
        .mockResolvedValue(mockProject);
      (prismaService.db.projectMember.create as jest.Mock).mockResolvedValue({
        id: 'pm-creator',
        projectId: mockProjectId,
        userId: testIds.user,
        role: 'OWNER',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await EventContextManager.getInstance().runWithContext(
        {
          correlationId: 'corr-test',
          sourceService: 'test',
          sourceMethod: 'test',
          userId: testIds.user,
          organizationId: mockOrganizationId,
        },
        async () => {
          await service.create(
            {
              ...mockCreateProjectDto,
              organizationId: mockOrganizationId,
            },
            testIds.user,
          );
        },
      );

      expect(prismaService.db.$transaction).toHaveBeenCalled();
      expect(prismaService.db.project.create).toHaveBeenCalledWith({
        data: {
          ...mockCreateProjectDto,
          organizationId: mockOrganizationId,
          config: {
            version: 1,
            existingWorkIntent: 'unanswered',
          },
          status: ProjectStatus.Onboarding,
          createdBy: testIds.user,
        },
      });
      expect(prismaService.db.projectMember.create).toHaveBeenCalledWith({
        data: {
          projectId: mockProject.id,
          userId: testIds.user,
          role: 'OWNER',
        },
      });
    });
  });

  describe('findAll', () => {
    it('should return all non-deleted projects for organization', async () => {
      jest
        .spyOn(prismaService.db.project, 'findMany')
        .mockResolvedValue([mockProject]);

      const result = await service.findAll(
        mockOrganizationId,
        'caller' as UserId,
      );

      expect(result).toEqual([mockProject]);
      expect(prismaService.db.project.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: mockOrganizationId,
          deletedAt: null,
          members: { some: { userId: 'caller' } },
          organization: {
            isActive: true,
            members: { some: { userId: 'caller', isActive: true } },
          },
        },
      });
    });

    it('does not return a result when the organizationId is different', async () => {
      const differentOrgId = 'org-different' as OrganizationId;
      jest.spyOn(prismaService.db.project, 'findMany').mockResolvedValue([]);

      const result = await service.findAll(differentOrgId, 'caller' as UserId);

      expect(result).toEqual([]);
      expect(prismaService.db.project.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: differentOrgId,
          deletedAt: null,
          members: { some: { userId: 'caller' } },
          organization: {
            isActive: true,
            members: { some: { userId: 'caller', isActive: true } },
          },
        },
      });
    });
  });

  describe('findOne', () => {
    it('should return a project by id for organization', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);

      const result = await service.findOne(mockProjectId, mockOrganizationId);

      expect(result).toEqual(mockProject);
      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: mockOrganizationId,
        },
      });
    });

    it('does not return a result when the organizationId is different', async () => {
      const differentOrgId = 'org-different' as OrganizationId;
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue(null);

      const result = await service.findOne(mockProjectId, differentOrgId);

      expect(result).toBeNull();
      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: differentOrgId,
        },
      });
    });

    it('should return null if project not found', async () => {
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue(null);

      const result = await service.findOne('non-existent', mockOrganizationId);

      expect(result).toBeNull();
    });
  });

  describe('getCounts', () => {
    it('returns project counts with plan and filtered initiatives/tasks', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);

      const db = prismaService.db as typeof prismaService.db & {
        task: { count: jest.Mock };
        initiative: { count: jest.Mock };
        agentSession: { count: jest.Mock };
        service: { count: jest.Mock };
      };

      db.task.count = jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(where.type === 'PLAN' ? 6 : 7),
        );
      db.initiative.count = jest.fn().mockResolvedValue(4);
      db.designDoc.count = jest.fn().mockResolvedValue(2);
      db.agentSession.count = jest.fn().mockResolvedValue(1);
      db.conversation.count = jest.fn().mockResolvedValue(3);
      db.service.count = jest.fn().mockResolvedValue(5);

      const result = await service.getCounts(
        'caller' as UserId,
        mockProjectId,
        mockOrganizationId,
      );

      expect(db.task.count).toHaveBeenCalledWith({
        where: {
          organizationId: mockOrganizationId,
          archivedAt: null,
          project: new ProjectAccessService({} as never).projectWhere(
            'caller',
            mockOrganizationId,
          ),
          OR: [
            { projectId: mockProjectId },
            { projectRelations: { some: { projectId: mockProjectId } } },
          ],
        },
      });

      expect(db.initiative.count).toHaveBeenCalledWith({
        where: {
          organizationId: mockOrganizationId,
          projects: { some: { projectId: mockProjectId } },
          originatingProject: new ProjectAccessService(
            {} as never,
          ).projectWhere('caller', mockOrganizationId),
          archivedAt: null,
          OR: [
            { sourceType: null },
            { sourceType: { not: InitiativeSourceType.Plan } },
          ],
        },
      });

      expect(db.task.count).toHaveBeenCalledWith({
        where: {
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
          type: 'PLAN',
          archivedAt: null,
        },
      });

      expect(result).toEqual({
        tasks: 7,
        initiatives: 4,
        designDocs: 2,
        agentSessions: 1,
        conversations: 3,
        services: 5,
        plans: 6,
      });
    });
  });

  describe('update', () => {
    it.each(['TAKING_SHAPE', 'ESTABLISHED'] as const)(
      'persists and returns maturity=%s with its update event',
      async (maturity) => {
        jest
          .spyOn(prismaService.db.project, 'findFirst')
          .mockResolvedValue(mockProject);
        jest
          .spyOn(prismaService.db.project, 'update')
          .mockResolvedValue({ ...mockProject, maturity });
        const result = await service.updateForAdapter(
          mockProjectId,
          { maturity },
          mockOrganizationId,
          actorId,
        );
        expect(result.maturity).toBe(maturity);
        jest
          .spyOn(prismaService.db.project, 'findFirst')
          .mockResolvedValue({ ...mockProject, maturity });
        expect(
          (
            await service.findOneForAdapter(
              mockProjectId,
              mockOrganizationId,
              actorId,
            )
          )?.maturity,
        ).toBe(maturity);
        expect(prismaService.db.project.update).toHaveBeenCalledWith({
          where: { id: mockProjectId },
          data: { maturity },
        });
        expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
          prismaService.db,
          expect.objectContaining({
            type: EVENT_TYPES.PROJECT.UPDATED,
            payload: expect.objectContaining({ update: { maturity } }),
          }),
        );
      },
    );

    it('preserves maturity when status or setup config changes', async () => {
      const stored = { ...mockProject, maturity: 'TAKING_SHAPE' as const };
      const config = {
        version: 1 as const,
        existingWorkIntent: ProjectExistingWorkIntent.Declined,
      };
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(stored);
      jest
        .spyOn(prismaService.db.project, 'update')
        .mockResolvedValue({ ...stored, status: ProjectStatus.Active, config });
      const result = await service.updateForAdapter(
        mockProjectId,
        { status: ProjectStatus.Active, config },
        mockOrganizationId,
        actorId,
      );
      expect(result.maturity).toBe('TAKING_SHAPE');
      expect(prismaService.db.project.update).toHaveBeenCalledWith({
        where: { id: mockProjectId },
        data: { status: ProjectStatus.Active, config },
      });
    });

    it('does not change maturity outside the owning organization', async () => {
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue(null);
      await expect(
        service.update(
          mockProjectId,
          { maturity: 'TAKING_SHAPE' },
          mockOrganizationId,
          actorId,
        ),
      ).rejects.toThrow();
      expect(prismaService.db.project.update).not.toHaveBeenCalled();
    });
    it('should update a project in organization', async () => {
      const updatedProject = { ...mockProject, ...mockUpdateProjectDto };
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.project, 'update')
        .mockResolvedValue(updatedProject);

      const result = await service.update(
        mockProjectId,
        mockUpdateProjectDto,
        mockOrganizationId,
        actorId,
      );

      expect(result).toEqual(updatedProject);
      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: mockOrganizationId,
        },
      });
      expect(prismaService.db.project.update).toHaveBeenCalledWith({
        where: { id: mockProjectId },
        data: mockUpdateProjectDto,
      });
      expect(entityRegistryService.registerEntity).toHaveBeenCalledWith(
        {
          organizationId: mockOrganizationId,
          entityId: mockProjectId,
          entityType: 'PROJECT',
          name: updatedProject.name,
          deletedAt: undefined,
        },
        prismaService.db,
      );
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.PROJECT.UPDATED,
          aggregateId: mockProjectId,
          payload: expect.objectContaining({
            organizationId: mockOrganizationId,
            projectId: mockProjectId,
            update: mockUpdateProjectDto,
          }),
        }),
      );
    });

    it('persists a valid Project config and includes it in the update event', async () => {
      const config = {
        version: 1,
        existingWorkIntent: 'declined',
      } as const;
      const updatedProject = { ...mockProject, config };
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.project, 'update')
        .mockResolvedValue(updatedProject);

      await service.update(
        mockProjectId,
        { config },
        mockOrganizationId,
        actorId,
      );

      expect(prismaService.db.project.update).toHaveBeenCalledWith({
        where: { id: mockProjectId },
        data: { config },
      });
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          payload: expect.objectContaining({
            update: { config },
          }),
        }),
      );
    });

    it('rejects an invalid Project config without mutating the project', async () => {
      await expect(
        service.update(
          mockProjectId,
          {
            config: {
              version: 1,
              existingWorkIntent: 'unknown',
            } as never,
          },
          mockOrganizationId,
          actorId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaService.db.project.findFirst).not.toHaveBeenCalled();
      expect(prismaService.db.project.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });

    it('publishes status changed event when status transitions', async () => {
      const updatedProject = {
        ...mockProject,
        status: ProjectStatus.Active,
      };
      const updateWithStatus: UpdateProjectDto = {
        status: ProjectStatus.Active,
      };
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.project, 'update')
        .mockResolvedValue(updatedProject);

      await service.update(
        mockProjectId,
        updateWithStatus,
        mockOrganizationId,
        actorId,
      );

      const publishedEvents = eventPublisher.publishInTransaction.mock.calls
        .map((call) => call[1])
        .filter(Boolean);
      expect(publishedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: EVENT_TYPES.PROJECT.STATUS_CHANGED,
            aggregateId: mockProjectId,
            payload: expect.objectContaining({
              organizationId: mockOrganizationId,
              projectId: mockProjectId,
              status: ProjectStatus.Active,
            }),
          }),
        ]),
      );
    });

    it('does not update when the organizationId is different', async () => {
      const differentOrgId = 'org-different' as OrganizationId;
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue(null);

      await expect(
        service.update(
          mockProjectId,
          mockUpdateProjectDto,
          differentOrgId,
          actorId,
        ),
      ).rejects.toThrow(
        `Project with ID ${mockProjectId} not found in organization ${differentOrgId}`,
      );

      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: differentOrgId,
        },
      });
    });
  });

  describe('recordOnboardingExistingWorkIntent', () => {
    it('atomically persists selected intent, activates the project, and publishes both events', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.project, 'update')
        .mockResolvedValue({ ...mockProject, status: ProjectStatus.Active });

      await service.recordOnboardingExistingWorkIntent(
        prismaService.db as unknown as Prisma.TransactionClient,
        {
          projectId: mockProjectId,
          organizationId: mockOrganizationId,
          existingWorkIntent: ProjectExistingWorkIntent.Selected,
        },
      );

      const update = {
        config: { version: 1, existingWorkIntent: 'selected' },
        status: ProjectStatus.Active,
      };
      expect(prismaService.db.project.update).toHaveBeenCalledWith({
        where: { id: mockProjectId },
        data: update,
      });
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.PROJECT.UPDATED,
          payload: expect.objectContaining({ update }),
        }),
      );
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.PROJECT.STATUS_CHANGED,
          payload: expect.objectContaining({ status: ProjectStatus.Active }),
        }),
      );
    });

    it('persists declined intent without activating the project', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.project, 'update')
        .mockResolvedValue(mockProject);

      await service.recordOnboardingExistingWorkIntent(
        prismaService.db as unknown as Prisma.TransactionClient,
        {
          projectId: mockProjectId,
          organizationId: mockOrganizationId,
          existingWorkIntent: ProjectExistingWorkIntent.Declined,
        },
      );

      expect(prismaService.db.project.update).toHaveBeenCalledWith({
        where: { id: mockProjectId },
        data: {
          config: { version: 1, existingWorkIntent: 'declined' },
        },
      });
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.PROJECT.STATUS_CHANGED,
        }),
      );
    });
  });

  describe('recordOnboardingFeatureNextSteps', () => {
    const featureNextSteps = [
      {
        featureId: '66666666-6666-4666-8666-666666666666',
        kind: ProjectFeatureNextStepKind.Mockups,
        rationale: 'You described the checkout screens in the most detail.',
        starterPrompt:
          'Flesh out Checkout with the guest and saved-card paths I described, then mock up its screens.',
      },
    ];

    it('saves the suggestions beside the existing intent and publishes the update', async () => {
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue({
        ...mockProject,
        config: { version: 1, existingWorkIntent: 'declined' },
      });
      jest
        .spyOn(prismaService.db.project, 'update')
        .mockResolvedValue(mockProject);

      await service.recordOnboardingFeatureNextSteps({
        projectId: mockProjectId,
        organizationId: mockOrganizationId,
        featureNextSteps,
      });

      const update = {
        config: {
          version: 1,
          existingWorkIntent: 'declined',
          featureNextSteps,
        },
      };
      expect(prismaService.db.project.update).toHaveBeenCalledWith({
        where: { id: mockProjectId },
        data: update,
      });
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.PROJECT.UPDATED,
          payload: expect.objectContaining({ update }),
        }),
      );
    });

    it('rejects an invalid suggestion without mutating the project', async () => {
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue({
        ...mockProject,
        config: { version: 1, existingWorkIntent: 'unanswered' },
      });

      await expect(
        service.recordOnboardingFeatureNextSteps({
          projectId: mockProjectId,
          organizationId: mockOrganizationId,
          featureNextSteps: [
            {
              featureId: '66666666-6666-4666-8666-666666666666',
              kind: 'PLAN' as never,
              rationale: 'Not a supported kind.',
              starterPrompt: 'Flesh out Checkout, then plan it.',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaService.db.project.update).not.toHaveBeenCalled();
    });
  });

  describe('normalizeProjectConfig', () => {
    it('reads saved suggestions and drops a malformed list without losing the intent', () => {
      const featureNextSteps = [
        {
          featureId: '66666666-6666-4666-8666-666666666666',
          kind: 'DIAGRAM',
          rationale: 'Its integrations are easier to agree on drawn.',
          starterPrompt:
            'Flesh out Integrations, then diagram how orders reach the store.',
        },
      ];
      expect(
        normalizeProjectConfig({
          version: 1,
          existingWorkIntent: 'declined',
          featureNextSteps,
        }),
      ).toEqual({
        version: 1,
        existingWorkIntent: 'declined',
        featureNextSteps,
      });
      expect(
        normalizeProjectConfig({
          version: 1,
          existingWorkIntent: 'declined',
          featureNextSteps: [{ featureId: 'x' }],
        }),
      ).toEqual({ version: 1, existingWorkIntent: 'declined' });
    });

    it.each([undefined, 42, '', '   '])(
      'drops only the list when a starter prompt is %p',
      (starterPrompt) => {
        expect(
          normalizeProjectConfig({
            version: 1,
            existingWorkIntent: 'declined',
            featureNextSteps: [
              {
                featureId: '66666666-6666-4666-8666-666666666666',
                kind: 'TASKS',
                rationale: 'You know exactly how billing should work.',
                starterPrompt: 'Flesh out Billing, then create its tasks.',
              },
              {
                featureId: '77777777-7777-4777-8777-777777777777',
                kind: 'DIAGRAM',
                rationale: 'Its integrations are easier to agree on drawn.',
                ...(starterPrompt === undefined ? {} : { starterPrompt }),
              },
            ],
          }),
        ).toEqual({ version: 1, existingWorkIntent: 'declined' });
      },
    );
  });

  describe('remove', () => {
    it('should soft delete a project in organization', async () => {
      const deletedProject = { ...mockProject, deletedAt: new Date() };
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.project, 'update')
        .mockResolvedValue(deletedProject);
      jest
        .spyOn(service as any, 'terminateProjectWorkflows')
        .mockResolvedValue(undefined);

      const result = await service.remove(
        mockProjectId,
        mockOrganizationId,
        actorId,
      );

      expect(result).toEqual(deletedProject);
      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: mockOrganizationId,
        },
      });
      expect(prismaService.db.project.update).toHaveBeenCalledWith({
        where: { id: mockProjectId },
        data: {
          deletedAt: expect.any(Date),
        },
      });
      expect(entityRegistryService.registerEntity).toHaveBeenCalledWith(
        {
          organizationId: mockOrganizationId,
          entityId: mockProjectId,
          entityType: 'PROJECT',
          name: deletedProject.name,
          deletedAt: deletedProject.deletedAt,
        },
        prismaService.db,
      );
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.PROJECT.DELETED,
          aggregateId: mockProjectId,
          payload: expect.objectContaining({
            payloadType: EVENT_TYPES.PROJECT.DELETED,
            organizationId: mockOrganizationId,
            projectId: mockProjectId,
            deletedAt: expect.any(String),
          }),
        }),
      );
    });

    it('does not delete when the organizationId is different', async () => {
      const differentOrgId = 'org-different' as OrganizationId;
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue(null);

      await expect(
        service.remove(mockProjectId, differentOrgId, actorId),
      ).rejects.toThrow(
        `Project with ID ${mockProjectId} not found in organization ${differentOrgId}`,
      );

      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: differentOrgId,
        },
      });
    });

    it('should throw error if project not found', async () => {
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue(null);

      await expect(
        service.remove(
          'non-existent' as ProjectId,
          mockOrganizationId,
          actorId,
        ),
      ).rejects.toThrow(
        `Project with ID non-existent not found in organization ${mockOrganizationId}`,
      );
    });
  });

  describe('getProjectWorkflows', () => {
    it('should return workflows for a project in organization', async () => {
      const mockConversations = [
        TestUtils.createMockDbConversation({
          id: 'conv1' as ConversationId,
          workflowId: 'wf1' as WorkflowId,
          status: ConversationStatus.Started,
          projectId: mockProjectId,
        }),
        TestUtils.createMockDbConversation({
          id: 'conv2' as ConversationId,
          workflowId: 'wf2' as WorkflowId,
          status: ConversationStatus.InProgress,
          projectId: mockProjectId,
        }),
        TestUtils.createMockDbConversation({
          id: 'conv3' as ConversationId,
          workflowId: null as unknown as WorkflowId,
          status: ConversationStatus.Completed,
          projectId: mockProjectId,
        }),
      ];

      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue(mockConversations);

      const result = await service.getProjectWorkflows(
        mockProjectId,
        mockOrganizationId,
      );

      expect(result).toEqual([
        { conversationId: 'conv1', workflowId: 'wf1', status: 'STARTED' },
        { conversationId: 'conv2', workflowId: 'wf2', status: 'IN_PROGRESS' },
      ]);
      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: mockOrganizationId,
        },
      });
      expect(prismaService.db.conversation.findMany).toHaveBeenCalledWith({
        where: { projectId: mockProjectId },
        select: { id: true, workflowId: true, status: true },
      });
    });

    it('does not return workflows when the organizationId is different', async () => {
      const differentOrgId = 'org-different' as OrganizationId;
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue(null);

      await expect(
        service.getProjectWorkflows(mockProjectId, differentOrgId),
      ).rejects.toThrow(
        `Project with ID ${mockProjectId} not found in organization ${differentOrgId}`,
      );

      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: differentOrgId,
        },
      });
    });

    it('should return empty array if no workflows found', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue([]);

      const result = await service.getProjectWorkflows(
        mockProjectId,
        mockOrganizationId,
      );

      expect(result).toEqual([]);
    });
  });

  describe('terminateWorkflowsForProject', () => {
    it('should terminate all workflows for a project in organization', async () => {
      const mockConversations = [
        TestUtils.createMockDbConversation({
          id: 'conv1' as ConversationId,
          workflowId: 'wf1' as WorkflowId,
          projectId: mockProjectId,
        }),
        TestUtils.createMockDbConversation({
          id: 'conv2' as ConversationId,
          workflowId: 'wf2' as WorkflowId,
          projectId: mockProjectId,
        }),
      ];

      const mockWorkflowHandle = {
        terminate: jest.fn().mockResolvedValue(undefined),
        executeUpdate: jest.fn(),
        startUpdate: jest.fn(),
        getUpdateHandle: jest.fn(),
        query: jest.fn(),
        signal: jest.fn(),
        result: jest.fn(),
        describe: jest.fn(),
        workflowId: 'wf1',
        firstExecutionRunId: 'run1',
        runId: 'run1',
      } as unknown as WorkflowHandle<Workflow>;

      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue(mockConversations);
      jest
        .spyOn(temporalClient.workflow, 'getHandle')
        .mockReturnValue(mockWorkflowHandle);

      const result = await service.terminateWorkflowsForProject(
        mockProjectId,
        mockOrganizationId,
        'Test termination',
      );

      expect(result).toEqual({ terminated: 2, failed: 0 });
      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: mockOrganizationId,
        },
      });
      expect(temporalClient.workflow.getHandle).toHaveBeenCalledTimes(2);
      expect(mockWorkflowHandle.terminate).toHaveBeenCalledTimes(2);
      expect(mockWorkflowHandle.terminate).toHaveBeenCalledWith(
        'Test termination',
      );
    });

    it('should handle workflow termination failures gracefully', async () => {
      const mockConversations = [
        TestUtils.createMockDbConversation({
          id: 'conv1' as ConversationId,
          workflowId: 'wf1' as WorkflowId,
          projectId: mockProjectId,
        }),
        TestUtils.createMockDbConversation({
          id: 'conv2' as ConversationId,
          workflowId: 'wf2' as WorkflowId,
          projectId: mockProjectId,
        }),
      ];

      const mockWorkflowHandle1 = {
        terminate: jest.fn().mockResolvedValue(undefined),
        executeUpdate: jest.fn(),
        startUpdate: jest.fn(),
        getUpdateHandle: jest.fn(),
        query: jest.fn(),
        signal: jest.fn(),
        result: jest.fn(),
        describe: jest.fn(),
        workflowId: 'wf1',
        firstExecutionRunId: 'run1',
        runId: 'run1',
      } as unknown as WorkflowHandle<Workflow>;
      const mockWorkflowHandle2 = {
        terminate: jest.fn().mockRejectedValue(new Error('Workflow not found')),
        executeUpdate: jest.fn(),
        startUpdate: jest.fn(),
        getUpdateHandle: jest.fn(),
        query: jest.fn(),
        signal: jest.fn(),
        result: jest.fn(),
        describe: jest.fn(),
        workflowId: 'wf2',
        firstExecutionRunId: 'run2',
        runId: 'run2',
      } as unknown as WorkflowHandle<Workflow>;

      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue(mockConversations);
      jest
        .spyOn(temporalClient.workflow, 'getHandle')
        .mockReturnValueOnce(mockWorkflowHandle1)
        .mockReturnValueOnce(mockWorkflowHandle2);

      const result = await service.terminateWorkflowsForProject(
        mockProjectId,
        mockOrganizationId,
        'Test termination',
      );

      expect(result).toEqual({ terminated: 1, failed: 1 });
    });

    it('should return zero counts if no workflows found', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue([]);

      const result = await service.terminateWorkflowsForProject(
        mockProjectId,
        mockOrganizationId,
        'Test termination',
      );

      expect(result).toEqual({ terminated: 0, failed: 0 });
    });

    it('does not terminate workflows when the organizationId is different', async () => {
      const differentOrgId = 'org-different' as OrganizationId;
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue(null);

      await expect(
        service.terminateWorkflowsForProject(
          mockProjectId,
          differentOrgId,
          'Test termination',
        ),
      ).rejects.toThrow(
        `Project with ID ${mockProjectId} not found in organization ${differentOrgId}`,
      );

      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: differentOrgId,
        },
      });
    });
  });

  // Test adapter methods
  describe('Adapter Methods', () => {
    describe('toApiResponse', () => {
      it('should transform project to API response format', async () => {
        const apiResponse = await service['toApiResponse'](
          mockProject,
          'OWNER',
        );

        expect(apiResponse).toEqual({
          ...mockProject,
          description: mockProject.description,
          currentUserRole: 'OWNER',
          hasEstablishedActivity: false,
          createdAt: mockProject.createdAt.toISOString(),
          updatedAt: mockProject.updatedAt.toISOString(),
          deletedAt: undefined,
        });
      });

      it('should handle null values correctly', async () => {
        const projectWithNulls = {
          ...mockProject,
          description: null as string | null,
          deletedAt: new Date('2024-01-02'),
        };

        const apiResponse = await service['toApiResponse'](
          projectWithNulls,
          'OWNER',
        );

        expect(apiResponse.description).toBeUndefined();
        expect(apiResponse.deletedAt).toBe(
          projectWithNulls.deletedAt.toISOString(),
        );
      });

      it.each([
        ['missing version', { existingWorkIntent: 'selected' }],
        ['missing intent', { version: 1 }],
        ['unknown version', { version: 2, existingWorkIntent: 'selected' }],
      ])(
        'omits legacy %s config from the API response',
        async (_label, config) => {
          const projectWithLegacyConfig = {
            ...mockProject,
            config,
          };

          const apiResponse = await service['toApiResponse'](
            projectWithLegacyConfig,
            'OWNER',
          );

          expect(apiResponse).not.toHaveProperty('config');
        },
      );

      it('classifies ten lifetime non-bootstrap events as established activity', async () => {
        jest.spyOn(prismaService.db.outboxEvent, 'findMany').mockResolvedValue(
          Array.from({ length: 10 }, (_, index) => ({
            id: `organic-event-${index}`,
          })) as never,
        );

        const apiResponse = await service['toApiResponse'](
          mockProject,
          'OWNER',
        );

        expect(apiResponse.hasEstablishedActivity).toBe(true);
        expect(prismaService.db.outboxEvent.findMany).toHaveBeenCalledWith({
          where: {
            organizationId: mockProject.organizationId,
            projectId: mockProject.id,
            eventType: {
              in: [
                EVENT_TYPES.TASK.CREATED,
                EVENT_TYPES.TASK.UPDATED,
                EVENT_TYPES.TASK.CONTENT_CHANGED,
                EVENT_TYPES.TASK.STATUS_CHANGED,
                EVENT_TYPES.AGENT_SESSION.CREATED,
              ],
            },
          },
          select: { id: true },
          take: 10,
        });
      });

      it('keeps setup visible below the lifetime activity threshold', async () => {
        jest.spyOn(prismaService.db.outboxEvent, 'findMany').mockResolvedValue(
          Array.from({ length: 9 }, (_, index) => ({
            id: `organic-event-${index}`,
          })) as never,
        );

        const apiResponse = await service['toApiResponse'](
          mockProject,
          'OWNER',
        );

        expect(apiResponse.hasEstablishedActivity).toBe(false);
      });
    });

    describe('createForAdapter', () => {
      it('should create project and return API response', async () => {
        const spy = jest
          .spyOn(service, 'create')
          .mockResolvedValue(mockProject);

        const result = await service.createForAdapter(
          mockCreateProjectDto,
          mockOrganizationId,
          actorId,
        );

        expect(spy).toHaveBeenCalledWith(
          {
            ...mockCreateProjectDto,
            organizationId: mockOrganizationId,
          },
          actorId,
          undefined,
        );
        expect(result.createdAt).toBe(mockProject.createdAt.toISOString());
        expect(result.currentUserRole).toBe('OWNER');
        expect(projectAccess.findProjectRole).toHaveBeenCalledWith(
          mockProject.id,
          actorId,
        );
      });
    });

    describe('findAllForAdapter', () => {
      it('should find all projects and return API response', async () => {
        const spy = jest
          .spyOn(service, 'findAll')
          .mockResolvedValue([mockProject]);
        (
          prismaService.db.projectMember.findMany as jest.Mock
        ).mockResolvedValue([{ projectId: mockProject.id, role: 'ARCHITECT' }]);

        const result = await service.findAllForAdapter(
          mockOrganizationId,
          actorId,
        );

        expect(spy).toHaveBeenCalledWith(mockOrganizationId, actorId);
        expect(prismaService.db.projectMember.findMany).toHaveBeenCalledWith({
          where: { userId: actorId, projectId: { in: [mockProject.id] } },
          select: { projectId: true, role: true },
        });
        expect(result).toHaveLength(1);
        const [project] = result;
        if (!project) {
          throw new Error('Expected project result');
        }
        expect(project.createdAt).toBe(mockProject.createdAt.toISOString());
        expect(project.currentUserRole).toBe('ARCHITECT');
      });

      it('refuses to describe a project the caller has no membership row for', async () => {
        jest.spyOn(service, 'findAll').mockResolvedValue([mockProject]);
        (
          prismaService.db.projectMember.findMany as jest.Mock
        ).mockResolvedValue([]);

        await expect(
          service.findAllForAdapter(mockOrganizationId, actorId),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });

    describe('findOneForAdapter', () => {
      it('should find one project and return API response', async () => {
        const spy = jest
          .spyOn(service, 'findOne')
          .mockResolvedValue(mockProject);

        projectAccess.findProjectRole.mockResolvedValue('VIEWER');

        const result = await service.findOneForAdapter(
          mockProjectId,
          mockOrganizationId,
          actorId,
        );

        expect(spy).toHaveBeenCalledWith(mockProjectId, mockOrganizationId);
        expect(result?.createdAt).toBe(mockProject.createdAt.toISOString());
        expect(result?.currentUserRole).toBe('VIEWER');
        expect(projectAccess.findProjectRole).toHaveBeenCalledWith(
          mockProjectId,
          actorId,
        );
      });

      it('refuses to describe a project the caller has no role in', async () => {
        jest.spyOn(service, 'findOne').mockResolvedValue(mockProject);
        projectAccess.findProjectRole.mockResolvedValue(null);

        await expect(
          service.findOneForAdapter(mockProjectId, mockOrganizationId, actorId),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it('should return null if project not found', async () => {
        const spy = jest.spyOn(service, 'findOne').mockResolvedValue(null);

        const result = await service.findOneForAdapter(
          'non-existent',
          mockOrganizationId,
          actorId,
        );

        expect(spy).toHaveBeenCalledWith('non-existent', mockOrganizationId);
        expect(result).toBeNull();
      });
    });

    describe('updateForAdapter', () => {
      it('should update project and return API response', async () => {
        const updatedProject = { ...mockProject, ...mockUpdateProjectDto };
        const spy = jest
          .spyOn(service, 'update')
          .mockResolvedValue(updatedProject);

        projectAccess.findProjectRole.mockResolvedValue('ARCHITECT');

        const result = await service.updateForAdapter(
          mockProjectId,
          mockUpdateProjectDto,
          mockOrganizationId,
          actorId,
        );

        expect(spy).toHaveBeenCalledWith(
          mockProjectId,
          mockUpdateProjectDto,
          mockOrganizationId,
          actorId,
        );
        expect(result.createdAt).toBe(updatedProject.createdAt.toISOString());
        expect(result.currentUserRole).toBe('ARCHITECT');
      });
    });

    describe('removeForAdapter', () => {
      it('should remove project and return API response', async () => {
        const deletedProject = { ...mockProject, deletedAt: new Date() };
        const spy = jest
          .spyOn(service, 'remove')
          .mockResolvedValue(deletedProject);

        const result = await service.removeForAdapter(
          mockProjectId,
          mockOrganizationId,
          actorId,
        );

        expect(spy).toHaveBeenCalledWith(
          mockProjectId,
          mockOrganizationId,
          actorId,
        );
        expect(result.deletedAt).toBe(deletedProject.deletedAt.toISOString());
        expect(result.currentUserRole).toBe('OWNER');
      });
    });
  });

  describe('addProjectMember', () => {
    const targetUserId = testIds.user;
    const orgMembership = {
      id: 'org-member-1',
      userId: targetUserId,
      organizationId: mockOrganizationId,
      role: 'MEMBER',
      isActive: true,
      invitedAt: new Date('2024-01-01'),
      joinedAt: new Date('2024-01-01'),
      createdAt: new Date('2024-01-01'),
    };
    const mockUser = {
      id: targetUserId,
      email: 'member@example.com',
      name: 'Existing Member',
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    };
    const createdMembership = {
      id: 'pm-1',
      projectId: mockProjectId,
      userId: targetUserId,
      role: 'MEMBER',
      createdAt: new Date('2024-02-01'),
      updatedAt: new Date('2024-02-01'),
      user: mockUser,
    };

    beforeEach(() => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      (
        prismaService.db.organizationMember.findUnique as jest.Mock
      ).mockResolvedValue(orgMembership);
      (
        prismaService.db.projectMember.findUnique as jest.Mock
      ).mockResolvedValue(null);
      (prismaService.db.projectMember.create as jest.Mock).mockResolvedValue(
        createdMembership,
      );
    });

    it('creates the membership and returns the mapped response on happy path', async () => {
      const result = await service.addProjectMember(
        'caller' as never,
        mockOrganizationId,
        mockProjectId,
        { userId: targetUserId, role: 'MEMBER' },
      );

      expect(prismaService.db.projectMember.create).toHaveBeenCalledWith({
        data: {
          projectId: mockProjectId,
          userId: targetUserId,
          role: 'MEMBER',
        },
        include: { user: { select: { id: true, email: true, name: true } } },
      });
      expect(result).toMatchObject({
        id: 'pm-1',
        projectId: mockProjectId,
        userId: targetUserId,
        role: 'MEMBER',
      });
      expect(result.user?.email).toBe('member@example.com');
    });

    it('throws BadRequestException when the user is not in the organization', async () => {
      (
        prismaService.db.organizationMember.findUnique as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.addProjectMember(
          'caller' as never,
          mockOrganizationId,
          mockProjectId,
          {
            userId: targetUserId,
            role: 'MEMBER',
          },
        ),
      ).rejects.toThrow('User is not a member of this organization');
      expect(prismaService.db.projectMember.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the user is already a project member', async () => {
      (
        prismaService.db.projectMember.findUnique as jest.Mock
      ).mockResolvedValue(createdMembership);

      await expect(
        service.addProjectMember(
          'caller' as never,
          mockOrganizationId,
          mockProjectId,
          {
            userId: targetUserId,
            role: 'MEMBER',
          },
        ),
      ).rejects.toThrow('User is already a member of this project');
      expect(prismaService.db.projectMember.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the role is not a valid ProjectRole', async () => {
      await expect(
        service.addProjectMember(
          'caller' as never,
          mockOrganizationId,
          mockProjectId,
          {
            userId: targetUserId,
            role: 'ADMIN' as never,
          },
        ),
      ).rejects.toThrow(/Invalid project role/);
      expect(
        prismaService.db.organizationMember.findUnique,
      ).not.toHaveBeenCalled();
      expect(prismaService.db.projectMember.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the project is not in the organization', async () => {
      (prismaService.db.project.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.addProjectMember(
          'caller' as never,
          mockOrganizationId,
          mockProjectId,
          {
            userId: targetUserId,
            role: 'MEMBER',
          },
        ),
      ).rejects.toThrow(/not found in organization/);
      expect(prismaService.db.projectMember.create).not.toHaveBeenCalled();
    });
  });

  describe('removeProjectMember', () => {
    const targetUserId = testIds.user;
    const memberMember = {
      id: 'pm-member',
      projectId: mockProjectId,
      userId: targetUserId,
      role: 'MEMBER',
      createdAt: new Date('2024-02-01'),
      updatedAt: new Date('2024-02-01'),
    };
    const ownerMember = { ...memberMember, role: 'OWNER', id: 'pm-owner' };

    beforeEach(() => {
      (prismaService.db.project.findFirst as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (
        prismaService.db.projectMember.findUnique as jest.Mock
      ).mockResolvedValue(memberMember);
      (prismaService.db.projectMember.delete as jest.Mock).mockResolvedValue(
        memberMember,
      );
      (prismaService.db.projectMember.count as jest.Mock).mockResolvedValue(1);
    });

    it('deletes the project membership on happy path', async () => {
      await service.removeProjectMember(
        'caller' as never,
        mockOrganizationId,
        mockProjectId,
        targetUserId,
      );

      expect(prismaService.db.projectMember.delete).toHaveBeenCalledWith({
        where: {
          projectId_userId: { projectId: mockProjectId, userId: targetUserId },
        },
      });
    });

    it('throws NotFoundException when the project is not in the organization', async () => {
      (prismaService.db.project.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.removeProjectMember(
          'caller' as never,
          mockOrganizationId,
          mockProjectId,
          targetUserId,
        ),
      ).rejects.toThrow(/not found in organization/);
      expect(prismaService.db.projectMember.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user is not a member of the project', async () => {
      (
        prismaService.db.projectMember.findUnique as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.removeProjectMember(
          'caller' as never,
          mockOrganizationId,
          mockProjectId,
          targetUserId,
        ),
      ).rejects.toThrow(/is not a member of project/);
      expect(prismaService.db.projectMember.delete).not.toHaveBeenCalled();
    });

    it('blocks removing the last owner of the project', async () => {
      (
        prismaService.db.projectMember.findUnique as jest.Mock
      ).mockResolvedValue(ownerMember);
      (prismaService.db.projectMember.count as jest.Mock).mockResolvedValue(0);

      await expect(
        service.removeProjectMember(
          'caller' as never,
          mockOrganizationId,
          mockProjectId,
          targetUserId,
        ),
      ).rejects.toThrow(/last owner/);
      expect(prismaService.db.projectMember.delete).not.toHaveBeenCalled();
    });

    it('allows removing an owner when other owners remain', async () => {
      (
        prismaService.db.projectMember.findUnique as jest.Mock
      ).mockResolvedValue(ownerMember);
      (prismaService.db.projectMember.count as jest.Mock).mockResolvedValue(1);

      await service.removeProjectMember(
        'caller' as never,
        mockOrganizationId,
        mockProjectId,
        targetUserId,
      );

      expect(prismaService.db.projectMember.delete).toHaveBeenCalled();
    });
  });

  describe('listProjectMembers', () => {
    const mockUser = {
      id: testIds.user,
      email: 'member@example.com',
      name: 'Existing Member',
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    };
    const buildMembership = (suffix: string) => ({
      id: `pm-${suffix}`,
      projectId: mockProjectId,
      userId: testIds.user,
      role: 'MEMBER',
      createdAt: new Date('2024-02-01'),
      updatedAt: new Date('2024-02-01'),
      user: mockUser,
    });

    it('returns the first page with default pagination when no options are provided', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      (prismaService.db.projectMember.findMany as jest.Mock).mockResolvedValue([
        buildMembership('1'),
      ]);
      (prismaService.db.projectMember.count as jest.Mock).mockResolvedValue(1);

      const result = await service.listProjectMembers(
        'caller' as never,
        mockOrganizationId,
        mockProjectId,
      );

      expect(prismaService.db.projectMember.findMany).toHaveBeenCalledWith({
        where: { projectId: mockProjectId },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: { createdAt: 'asc' },
        skip: 0,
        take: 50,
      });
      expect(prismaService.db.projectMember.count).toHaveBeenCalledTimes(1);
      expect(prismaService.db.projectMember.count).toHaveBeenCalledWith({
        where: { projectId: mockProjectId },
      });
      expect(result.members).toHaveLength(1);
      expect(result.members[0]).toMatchObject({
        id: 'pm-1',
        projectId: mockProjectId,
        userId: testIds.user,
        role: 'MEMBER',
      });
      expect(result.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('applies skip/take for an explicit page=2 request and reports hasPrevious', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      (prismaService.db.projectMember.findMany as jest.Mock).mockResolvedValue([
        buildMembership('11'),
        buildMembership('12'),
      ]);
      (prismaService.db.projectMember.count as jest.Mock).mockResolvedValue(25);

      const result = await service.listProjectMembers(
        'caller' as never,
        mockOrganizationId,
        mockProjectId,
        { page: 2, limit: 10 },
      );

      expect(prismaService.db.projectMember.findMany).toHaveBeenCalledWith({
        where: { projectId: mockProjectId },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: { createdAt: 'asc' },
        skip: 10,
        take: 10,
      });
      expect(prismaService.db.projectMember.count).toHaveBeenCalledWith({
        where: { projectId: mockProjectId },
      });
      expect(result.members).toHaveLength(2);
      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNext: true,
        hasPrevious: true,
      });
    });

    it('returns an empty page beyond the last page without hasNext', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      (prismaService.db.projectMember.findMany as jest.Mock).mockResolvedValue(
        [],
      );
      (prismaService.db.projectMember.count as jest.Mock).mockResolvedValue(5);

      const result = await service.listProjectMembers(
        'caller' as never,
        mockOrganizationId,
        mockProjectId,
        { page: 5, limit: 10 },
      );

      expect(prismaService.db.projectMember.findMany).toHaveBeenCalledWith({
        where: { projectId: mockProjectId },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: { createdAt: 'asc' },
        skip: 40,
        take: 10,
      });
      expect(result.members).toEqual([]);
      expect(result.pagination).toEqual({
        page: 5,
        limit: 10,
        total: 5,
        totalPages: 1,
        hasNext: false,
        hasPrevious: true,
      });
    });

    it('throws NotFoundException when the project is not in the organization', async () => {
      (prismaService.db.project.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.listProjectMembers(
          'caller' as never,
          mockOrganizationId,
          mockProjectId,
        ),
      ).rejects.toThrow(/not found in organization/);
    });
  });

  describe('role enforcement', () => {
    const targetUserId = testIds.user;
    const denied = new ForbiddenException('Insufficient permissions');

    beforeEach(() => {
      projectAccess.assertProjectRole.mockRejectedValue(denied);
    });

    it('refuses an update from a role that cannot change project settings', async () => {
      await expect(
        service.update(
          mockProjectId,
          mockUpdateProjectDto,
          mockOrganizationId,
          actorId,
        ),
      ).rejects.toBe(denied);

      expect(projectAccess.assertProjectRole).toHaveBeenCalledWith(
        mockProjectId,
        actorId,
        'updateProject',
      );
      expect(prismaService.db.project.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });

    it('refuses deletion from a role that cannot delete the project', async () => {
      await expect(
        service.remove(mockProjectId, mockOrganizationId, actorId),
      ).rejects.toBe(denied);

      expect(projectAccess.assertProjectRole).toHaveBeenCalledWith(
        mockProjectId,
        actorId,
        'deleteProject',
      );
      expect(prismaService.db.project.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });

    it('refuses adding a member from a role that cannot add people', async () => {
      await expect(
        service.addProjectMember(actorId, mockOrganizationId, mockProjectId, {
          userId: targetUserId,
          role: 'MEMBER',
        }),
      ).rejects.toBe(denied);

      expect(projectAccess.assertProjectRole).toHaveBeenCalledWith(
        mockProjectId,
        actorId,
        'addProjectMember',
      );
      expect(prismaService.db.projectMember.create).not.toHaveBeenCalled();
    });

    it('refuses removing a member from a role that cannot remove people', async () => {
      await expect(
        service.removeProjectMember(
          actorId,
          mockOrganizationId,
          mockProjectId,
          targetUserId,
        ),
      ).rejects.toBe(denied);

      expect(projectAccess.assertProjectRole).toHaveBeenCalledWith(
        mockProjectId,
        actorId,
        'removeProjectMember',
      );
      expect(prismaService.db.projectMember.delete).not.toHaveBeenCalled();
    });

    it('adds a membership through the internal path without consulting the actor', async () => {
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      (
        prismaService.db.organizationMember.findUnique as jest.Mock
      ).mockResolvedValue({ isActive: true });
      (
        prismaService.db.projectMember.findUnique as jest.Mock
      ).mockResolvedValue(null);
      (prismaService.db.projectMember.create as jest.Mock).mockResolvedValue({
        id: 'pm-1',
        projectId: mockProjectId,
        userId: targetUserId,
        role: 'MEMBER',
        createdAt: new Date('2024-02-01'),
        updatedAt: new Date('2024-02-01'),
        user: { id: targetUserId, email: 'm@example.com', name: 'M' },
      });

      await service.createProjectMembership(mockOrganizationId, mockProjectId, {
        userId: targetUserId,
        role: 'MEMBER',
      });

      expect(prismaService.db.projectMember.create).toHaveBeenCalledTimes(1);
      expect(projectAccess.assertProject).not.toHaveBeenCalled();
      expect(projectAccess.assertProjectRole).not.toHaveBeenCalled();
    });
  });
});
