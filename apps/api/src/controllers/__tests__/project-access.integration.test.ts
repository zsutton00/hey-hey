import {
  Body,
  Controller,
  Get,
  INestApplication,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import {
  ProjectAccessGuard,
  ProjectResourceId,
} from '../../auth/guards/project-access.guard';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessService } from '../../auth/services/project-access.service';
import { ProjectResourceAccessService } from '../../auth/services/project-resource-access.service';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProjectMembershipRevocationService } from '../../core/websockets/project-membership-revocation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountEntitlementService } from '../../services/account-entitlement.service';
import { ApiKeyService } from '../../services/api-key.service';
import { EmailService } from '../../services/email.service';
import { LLMTrackingService } from '../../services/llm/llm-tracking.service';
import { OrganizationAccountLifecycleOwner } from '../../services/organization-account-lifecycle.owner';
import { OrganizationProjectEntitlementService } from '../../services/organization-project-entitlement.service';
import { OrganizationService } from '../../services/organization.service';
import { ProjectService } from '../../services/project.service';
import { SecurityLoggerService } from '../../services/security-logger.service';
import { UserService } from '../../services/user.service';
import { OrganizationController } from '../organization.controller';
import { ProjectController } from '../project.controller';

const fixture = {
  active: new Set(['alice', 'bob']),
  projects: [
    {
      id: 'alice-project',
      organizationId: 'same-org',
      members: new Set(['alice']),
    },
    {
      id: 'bob-project',
      organizationId: 'same-org',
      members: new Set(['bob']),
    },
  ],
  effects: 0,
};
function selectProjects(where: any) {
  return fixture.projects.filter(
    (project) =>
      (!where.id || project.id === where.id) &&
      (!where.organizationId ||
        project.organizationId === where.organizationId) &&
      (!where.members?.some?.userId ||
        project.members.has(where.members.some.userId)) &&
      (!where.organization?.members?.some?.userId ||
        fixture.active.has(where.organization.members.some.userId)),
  );
}
@Controller('organizations/:organizationId/projects')
@ProjectResourceId('project')
@UseGuards(OrganizationGuard, ProjectAccessGuard)
class ProtectedProjects {
  constructor(private readonly access: ProjectAccessService) {}
  @Get() list(@Req() req: any) {
    return this.access.accessibleProjectIds(
      req.user.userId,
      req.params.organizationId,
    );
  }
  @Get(':id') detail(@Param('id') id: string) {
    return { id, content: 'protected' };
  }
  @Get(':id/counts') counts() {
    return { count: 7 };
  }
  @Get(':projectId/work-items') workItems() {
    return { content: 'protected work items' };
  }
  @Post(':id') mutate(@Body() _body: object) {
    fixture.effects++;
    return { changed: true };
  }
}
@Controller('organizations/:organizationId/tasks')
@UseGuards(OrganizationGuard, ProjectAccessGuard)
class ProtectedChildren {
  @Get(':taskId') child() {
    return { content: 'child content' };
  }
}

describe('same-organization HTTP project isolation', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const prisma = {
      db: {
        project: {
          findMany: jest.fn(async ({ where }) => selectProjects(where)),
          findFirst: jest.fn(
            async ({ where }) => selectProjects(where)[0] ?? null,
          ),
        },
        organizationMember: {
          findFirst: jest.fn(async ({ where }) =>
            fixture.active.has(where.userId) ? { id: 'membership' } : null,
          ),
        },
        task: {
          findFirst: jest.fn(async ({ where }) =>
            where.id === 'alice-task' ? { projectId: 'alice-project' } : null,
          ),
        },
      },
    };
    const access = new ProjectAccessService(prisma as never);
    const module = await Test.createTestingModule({
      controllers: [ProtectedProjects, ProtectedChildren],
      providers: [
        { provide: ProjectAccessService, useValue: access },
        {
          provide: ProjectResourceAccessService,
          useValue: new ProjectResourceAccessService(prisma as never, access),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      req.user = { userId: req.headers['x-test-user'] };
      next();
    });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    fixture.active = new Set(['alice', 'bob']);
    fixture.projects[0]!.members = new Set(['alice']);
    fixture.effects = 0;
  });
  const get = (path: string, user = 'bob') =>
    request(app.getHttpServer())
      .get('/organizations/same-org/' + path)
      .set('x-test-user', user);
  it.each(['null', 'NULL', 'Null'])(
    'admits the root filter %s through Express while enforcing project membership',
    async (parentTaskId) => {
      const path =
        `projects/alice-project/work-items?parentTaskId=${parentTaskId}` +
        '&includeTrackedEntities=true&status=ACTIVE&type=FEATURE' +
        '&_from=src%2Fcomponents%2FExplorer%2FExplorerWorkItemQuery.tsx:60:43';
      await get(path, 'alice').expect(200, {
        content: 'protected work items',
      });
      await get(path, 'bob').expect(403);
    },
  );
  it('checks route membership without resolving query parents through Express', async () => {
    await get(
      'projects/alice-project/work-items?parentTaskId=alice-task',
      'alice',
    ).expect(200);
    await get(
      'projects/bob-project/work-items?parentTaskId=alice-task',
      'bob',
    ).expect(200);
  });
  it('filters discovery and rejects project detail, counts and mutations for a nonmember', async () => {
    await get('projects').expect(200, ['bob-project']);
    await get('projects/alice-project').expect(403);
    await get('projects/alice-project/counts').expect(403);
    await get('tasks/alice-task').expect(200);
    await request(app.getHttpServer())
      .post('/organizations/same-org/projects/alice-project')
      .set('x-test-user', 'bob')
      .send({})
      .expect(403);
    expect(fixture.effects).toBe(0);
  });
  it('admits authorized counterparts, then reflects membership addition and removal immediately', async () => {
    await get('projects/alice-project', 'alice').expect(200);
    await get('tasks/alice-task', 'alice').expect(200);
    fixture.projects[0]!.members.add('bob');
    await get('projects/alice-project').expect(200);
    fixture.projects[0]!.members.delete('bob');
    await get('projects/alice-project').expect(403);
    await get('projects/bob-project').expect(200);
    fixture.active.delete('bob');
    await get('projects/bob-project').expect(403);
  });
});

describe('HTTP role enforcement for administrative actions', () => {
  const orgId = 'role-org';
  const projectId = 'role-project';
  const orgRoles = new Map<string, string>([
    ['owner', 'OWNER'],
    ['admin', 'ADMIN'],
    ['architect', 'MEMBER'],
    ['member', 'MEMBER'],
  ]);
  const projectRoles = new Map<string, string>([
    ['owner', 'OWNER'],
    ['architect', 'ARCHITECT'],
    ['member', 'MEMBER'],
  ]);
  let app: INestApplication;

  beforeAll(async () => {
    const prisma = {
      db: {
        project: {
          findFirst: jest.fn(async ({ where }) => {
            const userId = where.members?.some?.userId;
            const role = projectRoles.get(userId);
            const visible =
              where.id === projectId &&
              role &&
              orgRoles.has(where.organization?.members?.some?.userId);
            return visible ? { id: projectId, members: [{ role }] } : null;
          }),
        },
        organizationMember: {
          findFirst: jest.fn(async ({ where }) => {
            const role = orgRoles.get(where.userId);
            return role && where.organizationId === orgId
              ? { id: 'membership', role }
              : null;
          }),
        },
      },
    };
    const access = new ProjectAccessService(prisma as never);
    const projectService = new ProjectService(
      {} as never,
      prisma as never,
      access,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const module = await Test.createTestingModule({
      controllers: [ProjectController, OrganizationController],
      providers: [
        { provide: ProjectAccessService, useValue: access },
        { provide: ProjectService, useValue: projectService },
        OrganizationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ProjectMembershipRevocationService,
          useValue: { membershipRemoved: jest.fn() },
        },
        {
          provide: SecurityLoggerService,
          useValue: { logBulkInviteAttempt: jest.fn() },
        },
        { provide: ApiKeyService, useValue: {} },
        { provide: UserService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: AccountEntitlementService, useValue: {} },
        { provide: LLMTrackingService, useValue: {} },
        { provide: OrganizationProjectEntitlementService, useValue: {} },
        { provide: OrganizationAccountLifecycleOwner, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      req.user = { userId: req.headers['x-test-user'] };
      next();
    });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  const as = (user: string) => ({
    post: (path: string) =>
      request(app.getHttpServer()).post(path).set('x-test-user', user),
    patch: (path: string) =>
      request(app.getHttpServer()).patch(path).set('x-test-user', user),
    delete: (path: string) =>
      request(app.getHttpServer()).delete(path).set('x-test-user', user),
  });
  const projectsPath = `/api/v1/organizations/${orgId}/projects`;
  const membersPath = `/api/v1/organizations/${orgId}/members`;

  it.each([
    ['update project', 'patch', `${projectsPath}/${projectId}`, { name: 'x' }],
    ['delete project', 'delete', `${projectsPath}/${projectId}`, undefined],
    [
      'add project member',
      'post',
      `${projectsPath}/${projectId}/members`,
      { userId: 'someone', role: 'MEMBER' },
    ],
    [
      'remove project member',
      'delete',
      `${projectsPath}/${projectId}/members/someone`,
      undefined,
    ],
    ['create project', 'post', projectsPath, { name: 'x' }],
    [
      'invite to organization',
      'post',
      membersPath,
      { email: 'new@example.com', role: 'MEMBER' },
    ],
    [
      'bulk invite to organization',
      'post',
      `${membersPath}/bulk-invite`,
      { invitations: [{ email: 'new@example.com', role: 'MEMBER' }] },
    ],
    [
      'remove organization member',
      'delete',
      `${membersPath}/someone`,
      undefined,
    ],
  ] as const)(
    'refuses a project MEMBER who is also an organization MEMBER: %s',
    async (_label, method, path, body) => {
      const response = await as('member')[method](path).send(body);
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Insufficient permissions');
    },
  );

  it.each([
    ['delete project', 'delete', `${projectsPath}/${projectId}`],
    [
      'remove project member',
      'delete',
      `${projectsPath}/${projectId}/members/someone`,
    ],
  ] as const)(
    'refuses a project ARCHITECT: %s',
    async (_label, method, path) => {
      const response = await as('architect')[method](path);
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Insufficient permissions');
    },
  );

  it.each([
    ['update project', 'patch', `${projectsPath}/${projectId}`, { name: 'x' }],
    [
      'add project member',
      'post',
      `${projectsPath}/${projectId}/members`,
      { userId: 'someone', role: 'MEMBER' },
    ],
  ] as const)(
    'lets a project ARCHITECT past the role check: %s',
    async (_label, method, path, body) => {
      const response = await as('architect')[method](path).send(body);
      expect(response.body.message).not.toBe('Insufficient permissions');
    },
  );

  it.each([
    ['create project', 'post', projectsPath, { name: 'x' }],
    [
      'invite to organization',
      'post',
      membersPath,
      { email: 'new@example.com', role: 'MEMBER' },
    ],
    [
      'remove organization member',
      'delete',
      `${membersPath}/someone`,
      undefined,
    ],
  ] as const)(
    'lets an organization ADMIN past the role check: %s',
    async (_label, method, path, body) => {
      const response = await as('admin')[method](path).send(body);
      expect(response.body.message).not.toBe('Insufficient permissions');
    },
  );
});
