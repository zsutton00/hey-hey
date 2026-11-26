/**
 * Applies futures through the real work-item write against PostgreSQL, using the
 * published work-item type templates. All fixture writes roll back.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import type {
  FeatureTag,
  FutureApplyResponse,
  FutureRevisionAuthoring,
  FutureRevisionResponse,
} from '@hey-hey/contracts/api/models';
import type { OrganizationId, ProjectId, TaskId, UserId } from 'src/types';
import { createTestProjectApprovalPolicyService } from 'src/utils/testUtils';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { TaskService } from '../../tasks/task.service';
import { materializeFutureRevision } from '../future-revision-materializer';
import { readFutureRevision, stageFutureRevision } from '../future-revision';
import { ProposalApprovalService } from '../proposal-approval.service';
import { ProposalReconciliationAdapterService } from '../proposal-reconciliation-adapter.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';

// Run through worktree:exec against an isolated local database.
const databaseTests =
  process.env.RUN_FUTURE_APPLY_DB_TESTS === '1' ? describe : describe.skip;

type Dependency<
  T extends new (...args: never[]) => unknown,
  I extends number,
> = ConstructorParameters<T>[I];

/** The real approval, reconciliation and work-item write path over one transaction. */
async function createServices(tx: Prisma.TransactionClient) {
  const db = new Proxy(tx, {
    get: (target, key): unknown =>
      key === '$transaction'
        ? (run: (client: Prisma.TransactionClient) => unknown) => run(target)
        : Reflect.get(target, key),
  });
  const prisma = new Proxy(db, {
    get: (target, key): unknown =>
      key === 'db' ? db : Reflect.get(target, key),
  }) as unknown as Dependency<typeof TaskService, 0>;
  const events = {
    publishInTransaction: jest.fn().mockResolvedValue(randomUUID()),
  } as unknown as Dependency<typeof TaskService, 1>;

  const registry = new WorkItemTypeRegistryService(prisma, {
    subscribe: jest.fn(),
    publish: jest.fn(),
  } as unknown as Dependency<typeof WorkItemTypeRegistryService, 1>);
  await registry.onModuleInit();

  const taskService = new TaskService(
    prisma,
    events,
    {
      updateOriginalArtifactFields: jest.fn(),
    } as unknown as Dependency<typeof TaskService, 2>,
    {} as Dependency<typeof TaskService, 3>,
    {} as Dependency<typeof TaskService, 4>,
    {} as Dependency<typeof TaskService, 5>,
    registry,
    new WorkItemParentageValidator(registry),
    {} as Dependency<typeof TaskService, 8>,
  );
  const reconciliation = new ProposalReconciliationService(
    new ProposalReconciliationAdapterService(registry, {
      get: () => taskService,
    } as unknown as Dependency<typeof ProposalReconciliationAdapterService, 1>),
    {} as Dependency<typeof ProposalReconciliationService, 1>,
    jest.fn(),
  );
  const approvals = new ProposalApprovalService(
    prisma,
    events,
    taskService,
    registry,
    {} as Dependency<typeof ProposalApprovalService, 4>,
    {} as Dependency<typeof ProposalApprovalService, 5>,
    {} as Dependency<typeof ProposalApprovalService, 6>,
    {} as Dependency<typeof ProposalApprovalService, 7>,
    {} as Dependency<typeof ProposalApprovalService, 8>,
    {} as Dependency<typeof ProposalApprovalService, 9>,
    {
      processDeclaredEdges: jest.fn().mockResolvedValue([]),
      materializeEdges: jest.fn(),
    } as unknown as Dependency<typeof ProposalApprovalService, 10>,
    {} as Dependency<typeof ProposalApprovalService, 11>,
    {
      extractAndValidate: jest.fn().mockResolvedValue([]),
    } as unknown as Dependency<typeof ProposalApprovalService, 12>,
    createTestProjectApprovalPolicyService(),
    {} as Dependency<typeof ProposalApprovalService, 14>,
    reconciliation,
  );
  return { approvals, reconciliation, registry };
}

type AppliedState = {
  response: FutureApplyResponse;
  stored: FutureRevisionResponse;
  live: Prisma.TaskGetPayload<{ include: { sections: true } }>;
};

databaseTests('applying a work-item future against PostgreSQL', () => {
  const client = new PrismaClient();
  afterAll(() => client.$disconnect());

  async function applyFuture(input: {
    type: 'CONTRACT' | 'FEATURE';
    tag: FeatureTag | null;
    changes: Extract<
      FutureRevisionAuthoring,
      { operation: 'REVISE' }
    >['changes'];
  }) {
    const rollback = new Error('rollback test fixture');
    let outcome: AppliedState | undefined;
    await client
      .$transaction(
        async (tx) => {
          const organizationId = randomUUID() as OrganizationId;
          const projectId = randomUUID() as ProjectId;
          const userId = randomUUID() as UserId;
          const parentId = randomUUID();
          const targetId = randomUUID() as TaskId;
          const futureId = randomUUID();
          const scope = { organizationId, projectId };

          await tx.organization.create({
            data: { id: organizationId, name: 'Future', slug: randomUUID() },
          });
          await tx.user.create({
            data: {
              id: userId,
              name: 'Future fixture',
              email: `${userId}@example.invalid`,
              passwordHash: 'unused-test-fixture',
            },
          });
          await tx.project.create({
            data: { id: projectId, organizationId, name: 'Future' },
          });
          await tx.organizationMember.create({
            data: { organizationId, userId },
          });
          await tx.projectMember.create({ data: { projectId, userId } });
          await tx.task.create({
            data: {
              ...scope,
              id: parentId,
              name: 'Local Execution',
              type: 'FEATURE',
              tag: 'product',
            },
          });
          await tx.task.create({
            data: {
              ...scope,
              id: targetId,
              parentTaskId: parentId,
              name: 'Controller Proof',
              type: input.type,
              tag: input.tag,
              sections: {
                create: {
                  key: 'description',
                  order: 0,
                  materializedMarkdown: 'The provider accepts a proof.',
                },
              },
            },
          });

          const { approvals, reconciliation, registry } =
            await createServices(tx);
          const target = {
            ...scope,
            targetEntityType: 'TASK' as const,
            targetEntityId: targetId,
          };
          const mutation = await materializeFutureRevision(
            tx,
            reconciliation.futureMaterializationPorts(),
            target,
            {
              operation: 'REVISE',
              futureId,
              expectedRevision: 0,
              changes: input.changes,
              dependencies: [],
            },
          );
          const proposal = await tx.proposal.create({
            data: {
              ...target,
              requestorId: userId,
              requestorContext: { source: 'agent', toolName: 'edit_work_item' },
              action: 'VERSIONED_UPDATE',
              status: 'APPROVED',
              title: 'Future revision',
              updates: mutation as unknown as Prisma.InputJsonObject,
              approvalRecords: { create: { userId, type: 'APPROVAL' } },
            },
          });
          await reconciliation.captureAuthoring(tx, proposal);
          await stageFutureRevision(tx, registry, proposal);

          const response = await approvals.applyFuture(
            futureId,
            organizationId,
            projectId,
            userId,
            { expectedRevision: 1 },
          );
          outcome = {
            response,
            stored: await readFutureRevision(
              tx,
              registry,
              futureId,
              organizationId,
              projectId,
            ),
            live: await tx.task.findUniqueOrThrow({
              where: { id: targetId },
              include: { sections: true },
            }),
          };
          throw rollback;
        },
        { timeout: 60_000 },
      )
      .catch((error: unknown) => {
        if (error !== rollback) {
          throw error;
        }
      });
    return outcome!;
  }

  it('publishes a Contract future although its type forbids tags', async () => {
    const { response, stored, live } = await applyFuture({
      type: 'CONTRACT',
      tag: null,
      changes: {
        sections: [
          { key: 'description', content: 'The provider verifies the proof.' },
        ],
      },
    });

    expect(response).toMatchObject({ status: 'APPLIED' });
    expect(stored.outcome).toBe('APPLIED');
    expect(live.tag).toBeNull();
    expect(live.sections).toContainEqual(
      expect.objectContaining({
        key: 'description',
        materializedMarkdown: 'The provider verifies the proof.',
      }),
    );
  }, 90_000);

  it('publishes a tag that a Feature future changes', async () => {
    const { response, live } = await applyFuture({
      type: 'FEATURE',
      tag: 'product',
      changes: { tag: 'backend' },
    });

    expect(response).toMatchObject({ status: 'APPLIED' });
    expect(live.tag).toBe('backend');
  }, 90_000);
});
