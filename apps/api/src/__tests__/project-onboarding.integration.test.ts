import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { ProjectAccessService } from '../auth/services/project-access.service';
import { ProjectMembershipRevocationService } from '../core/websockets/project-membership-revocation.service';
import { ProjectController } from '../controllers/project.controller';
import { CreateProjectDto, ProjectStatus } from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import { TEMPORAL_CLIENT } from '../prisma/temporal.module';
import { ProjectService } from '../services/project.service';
import { EntityRegistryService } from '../services/entity-registry/entity-registry.service';
import { WorkItemTypeRegistryService } from '../services/tasks/work-item-type-registry.service';
import { WorkflowTypeRegistryService } from '../services/workflows/workflow-type-registry.service';
import { OrganizationId } from '../types';
import { OrganizationProjectEntitlementService } from '../services/organization-project-entitlement.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../core/events/tokens';
import * as TestUtils from '../utils/testUtils';

// Mocks
const testOrgId = 'test_org_onboarding' as OrganizationId;

const prismaMock: any = {
  db: {
    project: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => {
        return {
          id: `proj_${Date.now()}`,
          ...data,
          status: ProjectStatus.Onboarding,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    },
    projectMember: {
      create: jest.fn().mockImplementation(({ data }) => ({
        id: `pm_${Date.now()}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    interactionType: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'interaction_type_onboarding' }),
    },
    interactionFlow: {
      findFirst: jest.fn().mockResolvedValue({ id: 'flow_1' }),
    },
    interactionStep: {
      findUnique: jest.fn().mockResolvedValue({
        step: 1,
        type: { id: 'interaction_type_onboarding' },
      }),
    },
    outboxEvent: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    uiFlow: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ name: 'onboarding', isActive: true }),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => {
      return cb(prismaMock.db);
    }),
  },
};

const temporalClientMock = {
  workflow: {
    start: jest.fn().mockResolvedValue(undefined),
    getHandle: jest.fn(),
  },
};

const workflowTypeRegistryMock = {
  startWorkflowByType: jest
    .fn()
    .mockImplementation(
      async (
        _workflowName: unknown,
        _conversationId: unknown,
        projectId: string,
        organizationId: string,
      ) => {
        await temporalClientMock.workflow.start('conversationFlowWorkflow', {
          args: [{ projectId, organizationId }],
        });
        return { workflowId: `wf_${projectId}`, success: true };
      },
    ),
};

const workItemTypeRegistryMock = {
  refresh: jest.fn().mockResolvedValue(undefined),
  publishConfigChanged: jest.fn().mockResolvedValue(undefined),
};

const entitlementServiceMock = {
  assertProjectCreationAllowed: jest.fn().mockResolvedValue(undefined),
};

const entityRegistryServiceMock = {
  registerEntity: jest.fn().mockResolvedValue(undefined),
};

// TODO: Re-enable once flow support wired through controllers and mocks updated
describe('Project Onboarding Flow', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        ProjectService,
        { provide: ProjectMembershipRevocationService, useValue: {} },
        {
          provide: ProjectAccessService,
          useValue: {
            assertOrganizationRole: jest.fn().mockResolvedValue(undefined),
            findProjectRole: jest.fn().mockResolvedValue('OWNER'),
          },
        },
        { provide: PrismaService, useValue: prismaMock },
        { provide: TEMPORAL_CLIENT, useValue: temporalClientMock },
        {
          provide: WorkflowTypeRegistryService,
          useValue: workflowTypeRegistryMock,
        },
        {
          provide: WorkItemTypeRegistryService,
          useValue: workItemTypeRegistryMock,
        },
        {
          provide: OrganizationProjectEntitlementService,
          useValue: entitlementServiceMock,
        },
        {
          provide: EntityRegistryService,
          useValue: entityRegistryServiceMock,
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: TestUtils.createMockDomainEventPublisher(),
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user =
            TestUtils.createMockAuthenticatedUser({ currentOrgId: testOrgId });
          return true;
        },
      })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /project creates project and starts onboarding workflow', async () => {
    const payload: CreateProjectDto = {
      name: 'My New Project',
      description: 'Project created during integration test',
    };

    const res = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${testOrgId}/projects`)
      .send(payload)
      .expect(201);

    // Response assertions
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe(payload.name);
    expect(res.body.status).toBe(ProjectStatus.Onboarding);

    // Ensure DB insert called with correct data
    expect(prismaMock.db.project.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.db.project.create.mock.calls[0][0];
    expect(createArgs.data.name).toBe(payload.name);
    expect(createArgs.data.organizationId).toBe(testOrgId);
    expect(entityRegistryServiceMock.registerEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: testOrgId,
        entityId: res.body.id,
        entityType: 'PROJECT',
        name: payload.name,
      }),
      prismaMock.db,
    );
    // Ensure Temporal workflow started
    expect(temporalClientMock.workflow.start).toHaveBeenCalledTimes(1);
    const [workflowName, workflowOptions] =
      temporalClientMock.workflow.start.mock.calls[0];
    expect(workflowName).toBe('conversationFlowWorkflow');
    expect(workflowOptions.args[0].organizationId).toBe(testOrgId);
  });
});
