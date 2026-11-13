import { type INestApplication, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { TransformInterceptor } from 'src/common/interceptors/transform.interceptor';
import { ProjectApprovalPolicyController } from '../project-approval-policy.controller';
import { ProjectApprovalPolicyManagementService } from 'src/services/proposal/project-approval-policy-management.service';
import { ProjectApprovalPolicyService } from 'src/services/proposal/project-approval-policy.service';
import { ProjectApprovalPolicyStore } from 'src/services/proposal/project-approval-policy.store';
import { ProjectApprovalPolicyValidation } from 'src/services/proposal/project-approval-policy.validation';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PrismaService } from 'src/prisma/prisma.service';
import { createMockPrismaService } from 'src/utils/testUtils';
import { WorkItemTypeRegistryService } from 'src/services/tasks/work-item-type-registry.service';
import type { ProjectApprovalPolicyRule } from 'src/generated';

const rule = {
  conditions: {
    typeKey: 'MARKETING',
    author: 'USER',
    action: 'UPDATE',
    change: 'STATUS_ONLY',
  },
  requirement: 'IMMEDIATE',
  requiredApprovals: 0,
  allowsProposerApproval: true,
} satisfies ProjectApprovalPolicyRule;
const url = '/api/v1/organizations/org/projects/project/approval-policy';

describe('project approval policy HTTP boundary', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let saved: { revision: number; rules: unknown } | null;
  let activeTypes: string[];
  let writes: number;

  beforeEach(async () => {
    saved = null;
    activeTypes = ['MARKETING', 'FEATURE'];
    writes = 0;
    prisma = createMockPrismaService();
    // PostgreSQL boundary: one durable row; everything above it is concrete.
    prisma.db.$queryRaw.mockImplementation(
      async (sql: TemplateStringsArray) => {
        if (sql.join('').includes('FROM projects')) {
          return [{ id: 'project' }];
        }
        return saved ? [saved] : [];
      },
    );
    prisma.db.$executeRaw.mockImplementation(
      async (_sql, _projectId, revision, rules) => {
        saved = { revision, rules: rules === null ? null : JSON.parse(rules) };
        writes++;
        return 1;
      },
    );
    prisma.db.project.findFirst.mockImplementation(async ({ where }) => {
      const actor = where.members?.some?.userId;
      const role =
        actor === 'owner'
          ? 'OWNER'
          : actor === 'architect'
            ? 'ARCHITECT'
            : 'MEMBER';
      if (
        where.id !== 'project' ||
        (where.organizationId && where.organizationId !== 'org') ||
        actor === 'outsider'
      ) {
        return null;
      }
      const allowed = where.members?.some?.role?.in;
      return allowed && !allowed.includes(role)
        ? null
        : { id: 'project', members: [{ role }] };
    });
    prisma.db.organizationMember.findFirst.mockResolvedValue({
      id: 'membership',
    });
    const module = await Test.createTestingModule({
      controllers: [ProjectApprovalPolicyController],
      providers: [
        ProjectAccessService,
        ProjectApprovalPolicyManagementService,
        ProjectApprovalPolicyService,
        ProjectApprovalPolicyStore,
        ProjectApprovalPolicyValidation,
        { provide: PrismaService, useValue: prisma },
        {
          provide: WorkItemTypeRegistryService,
          useValue: {
            isTypeActiveForProject: (key: string) => activeTypes.includes(key),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          req.user = { userId: req.headers['x-actor'] ?? 'owner' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    // The production wire envelope comes from this global interceptor.
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(['owner', 'architect'])(
    'allows %s to save and restore with monotonic revisions',
    async (actor) => {
      const initial = await request(app.getHttpServer())
        .get(url)
        .set('x-actor', actor)
        .expect(200);
      expect(initial.body.data).toMatchObject({
        revision: 0,
        hasProjectOverride: false,
      });
      const replaced = await request(app.getHttpServer())
        .put(url)
        .set('x-actor', actor)
        .send({ expectedRevision: 0, rules: [rule] })
        .expect(200);
      expect(replaced.body.data).toMatchObject({
        revision: 1,
        hasProjectOverride: true,
      });
      expect(
        replaced.body.data.rules
          .slice(0, 2)
          .map((entry: { source: string }) => entry.source),
      ).toEqual(['FIXED', 'PROJECT']);
      await request(app.getHttpServer())
        .get(url)
        .expect(200)
        .expect((response) => {
          expect(response.body.data).toEqual(replaced.body.data);
        });
      const restored = await request(app.getHttpServer())
        .post(url)
        .set('x-actor', actor)
        .send({ expectedRevision: 1 })
        .expect(200);
      expect(restored.body.data).toMatchObject({
        revision: 2,
        hasProjectOverride: false,
        rules: initial.body.data.rules,
      });
      await request(app.getHttpServer())
        .post(url)
        .send({ expectedRevision: 2 })
        .expect(200);
      expect(saved).toEqual({ revision: 3, rules: null });
      for (const expectedRevision of [0, 1, 2]) {
        await request(app.getHttpServer())
          .put(url)
          .send({ expectedRevision, rules: [rule] })
          .expect(409)
          .expect((response) => {
            expect(response.body).toMatchObject({
              code: 'PROJECT_APPROVAL_POLICY_REVISION_CONFLICT',
              currentRevision: 3,
              expectedRevision,
            });
          });
      }
      expect(writes).toBe(3);
    },
  );

  it.each(['member', 'outsider'])(
    'denies %s both write operations',
    async (actor) => {
      await request(app.getHttpServer())
        .put(url)
        .set('x-actor', actor)
        .send({ expectedRevision: 0, rules: [rule] })
        .expect(403);
      await request(app.getHttpServer())
        .post(url)
        .set('x-actor', actor)
        .send({ expectedRevision: 0 })
        .expect(403);
      expect(writes).toBe(0);
      await request(app.getHttpServer())
        .get(url)
        .set('x-actor', actor)
        .expect(actor === 'member' ? 200 : 403);
    },
  );

  it('accepts the storage maximum and preserves the policy and revision when the count exceeds it', async () => {
    const maximumRule = {
      ...rule,
      requirement: 'PROJECT_REQUIRED',
      requiredApprovals: 2_147_483_647,
    } satisfies ProjectApprovalPolicyRule;
    const accepted = await request(app.getHttpServer())
      .put(url)
      .send({ expectedRevision: 0, rules: [maximumRule] })
      .expect(200);
    expect(accepted.body.data).toMatchObject({ revision: 1 });
    expect(saved).toEqual({ revision: 1, rules: [maximumRule] });
    const prior = saved;

    await request(app.getHttpServer())
      .put(url)
      .send({
        expectedRevision: 1,
        rules: [{ ...maximumRule, requiredApprovals: 2_147_483_648 }],
      })
      .expect(400)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: 'PROJECT_APPROVAL_POLICY_VALIDATION_FAILED',
          issues: expect.arrayContaining([
            { path: '/rules/0/requiredApprovals', message: expect.any(String) },
          ]),
        });
      });
    expect(saved).toBe(prior);
    expect(writes).toBe(1);
    await request(app.getHttpServer())
      .get(url)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toEqual(accepted.body.data);
      });
  });

  it.each([
    { ...rule, conditions: { typeKey: 'Default' } },
    { ...rule, requirement: 'FIXED_REQUIRED' },
    { ...rule, requiredApprovals: 1 },
    { ...rule, conditions: { typeKey: 'MARKETING', topLevel: true } },
    { ...rule, conditions: { change: 'anything' } },
  ])(
    'preserves valid configuration on invalid untrusted rules',
    async (invalid) => {
      await request(app.getHttpServer())
        .put(url)
        .send({ expectedRevision: 0, rules: [rule] })
        .expect(200);
      const prior = saved;
      await request(app.getHttpServer())
        .put(url)
        .send({ expectedRevision: 1, rules: [invalid] })
        .expect(400)
        .expect((response) => {
          expect(response.body.code).toBe(
            'PROJECT_APPROVAL_POLICY_VALIDATION_FAILED',
          );
          expect(response.body.issues[0].path).toMatch(/^\/rules\/0\//);
        });
      expect(saved).toBe(prior);
      expect(writes).toBe(1);
    },
  );

  it('keeps a saved policy readable and editable after its type is retired', async () => {
    const featureRule = { ...rule, conditions: { typeKey: 'FEATURE' } };
    await request(app.getHttpServer())
      .put(url)
      .send({ expectedRevision: 0, rules: [rule, featureRule] })
      .expect(200);
    activeTypes = ['FEATURE'];

    await request(app.getHttpServer())
      .get(url)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.rules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: 'PROJECT',
              conditions: expect.objectContaining({ typeKey: 'MARKETING' }),
            }),
          ]),
        );
      });

    const changed = {
      ...featureRule,
      requirement: 'PROJECT_REQUIRED',
      requiredApprovals: 2,
    } satisfies ProjectApprovalPolicyRule;
    await request(app.getHttpServer())
      .put(url)
      .send({ expectedRevision: 1, rules: [rule, changed] })
      .expect(200);
    expect(saved).toEqual({ revision: 2, rules: [rule, changed] });

    const prior = saved;
    await request(app.getHttpServer())
      .put(url)
      .send({
        expectedRevision: 2,
        rules: [
          rule,
          changed,
          { ...rule, conditions: { typeKey: 'RETIRED_ELSEWHERE' } },
        ],
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.issues).toEqual([
          {
            path: '/rules/2/conditions/typeKey',
            message: expect.any(String),
          },
        ]);
      });
    expect(saved).toBe(prior);

    await request(app.getHttpServer())
      .put(url)
      .send({ expectedRevision: 2, rules: [changed] })
      .expect(200);
    expect(saved).toEqual({ revision: 3, rules: [changed] });
  });
});
