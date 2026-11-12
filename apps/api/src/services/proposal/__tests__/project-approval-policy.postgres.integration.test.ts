import { randomUUID } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ProjectId } from 'src/types';
import type { ProjectApprovalPolicyRule } from 'src/generated';
import { ProjectApprovalPolicyStore } from '../project-approval-policy.store';
import {
  createDefaultProjectApprovalPolicy,
  ProjectApprovalPolicyService,
} from '../project-approval-policy.service';
import { ProjectApprovalPolicyValidation } from '../project-approval-policy.validation';

// Run through worktree:exec after applying migrations to the isolated database.
const databaseTests =
  process.env.RUN_APPROVAL_POLICY_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

databaseTests(
  'project approval policy PostgreSQL durability and serialization',
  () => {
    let prisma: PrismaService;
    let store: ProjectApprovalPolicyStore;
    let organizationId: string;
    let projectId: ProjectId;
    let otherProjectId: ProjectId;
    const rules: ProjectApprovalPolicyRule[] = [
      {
        conditions: {},
        requirement: 'PROJECT_REQUIRED',
        requiredApprovals: 3,
        allowsProposerApproval: false,
      },
    ];

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();
      organizationId = randomUUID();
      await prisma.db.organization.create({
        data: {
          id: organizationId,
          name: 'Approval policy database test',
          slug: `approval-policy-${randomUUID()}`,
        },
      });
      const projects = await Promise.all(
        [0, 1].map((index) =>
          prisma.db.project.create({
            data: { organizationId, name: `Approval policy ${index}` },
          }),
        ),
      );
      projectId = projects[0]!.id;
      otherProjectId = projects[1]!.id;
      store = new ProjectApprovalPolicyStore(prisma);
    });

    afterAll(async () => {
      if (organizationId) {
        await prisma.db.organization.delete({ where: { id: organizationId } });
      }
      await prisma.$disconnect();
    });

    async function race(
      expectedRevision: number,
      documents: Array<ProjectApprovalPolicyRule[] | null>,
    ) {
      const results = await Promise.allSettled(
        documents.map((document) =>
          store.write(projectId, expectedRevision, document),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      expect(failures).toHaveLength(documents.length - 1);
      failures.forEach((failure) =>
        expect(failure.reason.getStatus()).toBe(409),
      );
      expect((await store.read(projectId)).revision).toBe(expectedRevision + 1);
    }

    it('isolates a malformed saved document while healthy projects retain defaults and accept changes', async () => {
      const resolver = new ProjectApprovalPolicyService(
        store,
        new ProjectApprovalPolicyValidation({
          isTypeActiveForProject: () => true,
        }),
      );
      const defaults = createDefaultProjectApprovalPolicy();
      expect(await resolver.resolve(otherProjectId)).toEqual(defaults);

      // Corruption is a disk trust-boundary input, deliberately bypassing writes.
      await prisma.db.$executeRaw`
        INSERT INTO project_approval_policy_configurations (project_id, revision, rules, updated_at)
        VALUES (${otherProjectId}, 1, '{"unexpected":true}'::jsonb, CURRENT_TIMESTAMP)`;
      try {
        await expect(resolver.resolve(otherProjectId)).rejects.toMatchObject({
          status: 500,
        });
        expect(await resolver.resolve(projectId)).toEqual(defaults);
        await store.write(projectId, 0, rules);
        expect(await resolver.snapshot(projectId)).toMatchObject({
          revision: 1,
          hasProjectOverride: true,
        });
      } finally {
        // Keep the serialization journey independent of this corruption fixture.
        await prisma.db.$executeRaw`
          DELETE FROM project_approval_policy_configurations
          WHERE project_id IN (${projectId}, ${otherProjectId})`;
      }
    });

    it('serializes first saves, replacements and restore/recreate while retaining revision history', async () => {
      await race(0, [rules, []]);
      await race(1, [rules, []]);
      await race(2, [null, rules]);
      await store.write(projectId, 3, null);
      expect(await store.read(projectId)).toEqual({ revision: 4, rules: null });
      await expect(store.write(projectId, 0, rules)).rejects.toMatchObject({
        status: 409,
      });
      await race(4, [rules, null]);
      await store.write(projectId, 5, rules);

      // A new connection/resolver has no in-memory state from the writes.
      const recreated = new PrismaService();
      try {
        await recreated.$connect();
        const reloaded = new ProjectApprovalPolicyService(
          new ProjectApprovalPolicyStore(recreated),
          new ProjectApprovalPolicyValidation({
            isTypeActiveForProject: () => true,
          }),
        );
        const snapshot = await reloaded.snapshot(projectId);
        expect(snapshot).toMatchObject({
          revision: 6,
          hasProjectOverride: true,
        });
        expect(
          snapshot.rules.find((rule) => rule.source === 'PROJECT'),
        ).toMatchObject({
          requirement: 'PROJECT_REQUIRED',
          requiredApprovals: 3,
        });
        expect(await reloaded.snapshot(otherProjectId)).toMatchObject({
          revision: 0,
          hasProjectOverride: false,
        });
      } finally {
        await recreated.$disconnect();
      }
    });
  },
);
