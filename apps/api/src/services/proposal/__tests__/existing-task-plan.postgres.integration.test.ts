import { randomUUID } from 'node:crypto';
import { of, throwError, defer } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  startInMemoryPostgres,
  type InMemoryPostgres,
} from '../../../__tests__/helpers/in-memory-postgres';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { OutboxStore } from '../../outbox-store.service';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { WorkItemGraphParticipationComposer } from '../../tasks/work-item-graph-participation';
import { PlanHierarchyRollupService } from '../../tasks/plan-hierarchy-rollup.service';
import { PlanDependenciesService } from '../../plan/plan-dependencies.service';
import { TaskService } from '../../tasks/task.service';
import { DesignDocService } from '../../design-doc/design-doc.service';
import { PlanDesignDocLinksService } from '../../design-doc/plan-design-doc-links.service';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import { WorkItemChangeSetMaterializerService } from '../work-item-change-set-materializer.service';
import { ProposalReconciliationAdapterService } from '../proposal-reconciliation-adapter.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { ProposalReconciliationGroupService } from '../proposal-reconciliation-group.service';
import { ProposalApprovalService } from '../proposal-approval.service';
import { ProposalService } from '../proposal.service';
import { ProposalValidationEngine } from '../proposal-validation.engine';
import { createTestProjectApprovalPolicyService } from 'src/utils/testUtils';
import { PendingEdgeService } from '../pending-edge.service';
import { PlanToolsProvider } from '../../../mcp/tools/plan-tools.provider';
import {
  PLAN_CONFIGURATION_SCHEMA_VERSION,
  validatePlanConfigurationContent,
} from '../../tasks/plan-configuration.validator';
import type { OrganizationId, ProjectId, UserId } from '../../../types';
import type { AgentEdge, CreateAgentEdgeDto } from '../../../generated/graphs';

jest.setTimeout(180_000);

describe('existing-task Plan public approval with PostgreSQL', () => {
  let database: InMemoryPostgres;
  let prisma: PrismaService;
  let tasks: TaskService;
  let provider: PlanToolsProvider;
  let approval: ProposalApprovalService;
  const previousUrl = process.env.PROJECT_DATABASE_URL;
  const organizationId = randomUUID() as OrganizationId;
  const projectId = randomUUID() as ProjectId;
  const authorId = randomUUID() as UserId;
  const reviewerId = randomUUID() as UserId;
  const featureId = randomUUID();
  const otherFeatureId = randomUUID();
  const taskIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const edges = new Map<string, AgentEdge>();
  let failRelationships = false;
  const token = () => 'test-service-token';

  beforeAll(async () => {
    database = await startInMemoryPostgres();
    process.env.PROJECT_DATABASE_URL = database.url;
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Plan adoption integration',
        slug: organizationId,
      },
    });
    for (const id of [authorId, reviewerId]) {
      await prisma.user.create({
        data: {
          id,
          name: 'Reviewer',
          email: `${id}@example.test`,
          passwordHash: 'unused-test-hash',
          memberships: { create: { organizationId, role: 'MEMBER' } },
        },
      });
    }
    await prisma.project.create({
      data: { id: projectId, name: 'Existing work', organizationId },
    });
    for (const userId of [authorId, reviewerId]) {
      await prisma.projectMember.create({ data: { projectId, userId } });
    }
    // Only the remote Graph transport is substituted. The production adapter
    // still performs preflight, identity checks and batched publication.
    const transport = {
      findIncidentAgentEdges: (
        _org: string,
        _project: string,
        request: { nodeIds: Set<string>; types: Set<string> },
      ) =>
        of({
          data: [...edges.values()].filter(
            (edge) =>
              request.types.has(edge.type) &&
              (request.nodeIds.has(edge.sourceNodeId) ||
                request.nodeIds.has(edge.targetNodeId)),
          ),
        }),
      getAgentEdge: (_org: string, _project: string, id: string) =>
        edges.has(id)
          ? of({ data: edges.get(id) })
          : throwError(() => ({ response: { status: 404 } })),
      createAgentEdgesBatch: (
        _org: string,
        _project: string,
        request: { edges: CreateAgentEdgeDto[] },
      ) =>
        defer(() => {
          if (failRelationships) {
            throw new Error(
              'Graph transport unavailable after document commit',
            );
          }
          return of({
            data: {
              results: request.edges.map((dto, index) => {
                const edge: AgentEdge = {
                  ...dto,
                  id: dto.id ?? randomUUID(),
                  reasoning: dto.reasoning ?? 'Integration relationship',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                edges.set(edge.id, edge);
                return { index, success: true, edge };
              }),
            },
          });
        }),
    };
    const graph = new AgentEdgeClientService(transport as never, prisma);
    const registry = new WorkItemTypeRegistryService(prisma, {
      subscribe: async () => undefined,
      publish: async () => undefined,
    } as never);
    await registry.refresh();
    const parentage = new WorkItemParentageValidator(registry);
    const events = new DomainEventPublisher(new OutboxStore(prisma));
    tasks = new TaskService(
      prisma,
      events,
      {} as never,
      new PlanHierarchyRollupService(new PlanDependenciesService(graph, token)),
      {} as never,
      graph,
      registry,
      parentage,
      new WorkItemGraphParticipationComposer(prisma, graph),
    );
    const docs = new DesignDocService(
      prisma,
      events,
      {} as never,
      new PlanDesignDocLinksService(graph, token),
    );
    const modules = {
      get: () => {
        throw new Error('Unexpected optional service lookup');
      },
    };
    const reconciliation = new ProposalReconciliationService(
      new ProposalReconciliationAdapterService(registry, modules as never),
      graph,
      token,
    );
    const projector = new WorkItemChangeSetProjectorService(
      prisma,
      registry,
      parentage,
      graph,
      token,
    );
    const pending = new PendingEdgeService(prisma, graph, tasks, token);
    // Input has no mentions. This replaces mention lookup's external boundary.
    const mentions = {
      extractAndValidate: async () => [],
      extractMentionTokens: () => [],
      validateMentions: async () => [],
    };
    const materializer = new WorkItemChangeSetMaterializerService(
      prisma,
      projector,
      tasks,
      graph,
      events,
      token,
      reconciliation,
      registry,
      pending,
      mentions as never,
      undefined,
      docs,
    );
    const policy = createTestProjectApprovalPolicyService();
    const access = { assertProjectRole: async () => undefined };
    approval = new ProposalApprovalService(
      prisma,
      events,
      tasks,
      registry,
      {} as never,
      docs,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      pending,
      materializer,
      mentions as never,
      policy,
      access as never,
      reconciliation,
    );
    const proposals = new ProposalService(
      prisma,
      new ProposalValidationEngine(prisma, registry, parentage, projector),
      projector,
      approval,
      pending,
      policy,
      registry,
      access as never,
      reconciliation,
      new ProposalReconciliationGroupService(prisma, modules as never),
    );
    provider = new PlanToolsProvider(proposals, prisma);
    for (const [id, name] of [
      [featureId, 'Primary capability'],
      [otherFeatureId, 'Other capability'],
    ] as const) {
      await prisma.task.create({
        data: {
          id,
          name,
          type: 'FEATURE',
          tag: 'product',
          organizationId,
          projectId,
        },
      });
    }
    for (const [index, id] of taskIds.entries()) {
      await prisma.$transaction((tx) =>
        tasks.createInTransaction(
          tx,
          organizationId,
          null,
          {
            name: `Existing implementation ${index + 1}`,
            type: 'STANDARD',
            parentTaskId: index === 1 ? otherFeatureId : featureId,
            // BACKLOG adopted tasks roll their stages up to BACKLOG, so the
            // Plan's own starting status is the only thing that can make it ACTIVE.
            status: 'BACKLOG',
            sections: [
              {
                key: 'description',
                content:
                  'Implement the reviewed capability with canonical identities and diagnosable errors.',
              },
              {
                key: 'acceptanceCriteria',
                content:
                  'Conforming requests preserve the existing behavior and recorded project relationships.',
              },
            ],
          },
          projectId,
          id as never,
        ),
      );
      await prisma.taskSectionHistory.create({
        data: {
          taskId: id,
          sectionKey: 'description',
          versionNumber: 1,
          contentSnapshot: 'Previously reviewed implementation',
          changedBy: authorId,
        },
      });
    }
    const oldEdge: AgentEdge = {
      id: randomUUID(),
      sourceNodeId: taskIds[0]!,
      sourceEntityType: 'TASK',
      targetNodeId: otherFeatureId,
      targetEntityType: 'TASK',
      type: 'RELATED_TO',
      category: 'meta',
      reasoning: 'Existing relationship',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    edges.set(oldEdge.id, oldEdge);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.close();
    if (previousUrl === undefined) {
      delete process.env.PROJECT_DATABASE_URL;
    } else {
      process.env.PROJECT_DATABASE_URL = previousUrl;
    }
  });

  it('adopts mixed-feature identities, preserves history and relationships, and recovers publicly after a document commit', async () => {
    const before = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      orderBy: { id: 'asc' },
    });
    const histories = await prisma.taskSectionHistory.findMany({
      orderBy: { id: 'asc' },
    });
    const oldEdges = [...edges.values()];
    const markdown =
      '# Full design\n\n' +
      'Reviewed implementation decisions, input boundaries and acceptance evidence.\n'.repeat(
        300,
      );
    const result = await provider.createPlanFromExistingTasks(
      {
        planTitle: 'Deliver existing work',
        eli5: 'Organize reviewed tasks into one Plan.',
        parentFeatureId: featureId,
        designDocMarkdown: markdown,
        stages: taskIds.map((id, index) => ({
          title: `Stage ${index + 1}`,
          taskIds: [id],
        })),
        taskPrerequisites: [
          { taskId: taskIds[3]!, dependsOnTaskId: taskIds[0]! },
        ],
      },
      {} as never,
      {
        headers: { 'x-project-id': projectId },
        user: {
          userId: authorId,
          currentOrgId: organizationId,
          orgMemberships: [],
          isDevAdmin: false,
          devAdminMode: false,
        },
      } as never,
    );
    if (!('id' in result) || typeof result.id !== 'string') {
      throw new Error(
        `Producer rejected valid input: ${JSON.stringify(result)}`,
      );
    }
    const proposalId = result.id;
    const stored = await prisma.proposal.findUniqueOrThrow({
      where: { id: proposalId },
    });
    expect(stored.updates).not.toHaveProperty('planTitle');
    failRelationships = true;
    const interrupted = await approval.approve(
      proposalId,
      organizationId,
      projectId,
      reviewerId,
    );
    expect(interrupted.enacted).toBe(false);
    if ((await prisma.designDoc.count()) !== 1) {
      throw new Error(
        `Document was not committed: ${JSON.stringify(interrupted)}`,
      );
    }
    const document = await prisma.designDoc.findFirstOrThrow({
      include: { sections: true },
    });
    expect(
      document.sections.find((section) => section.key === 'content')
        ?.materializedMarkdown,
    ).toBe(markdown);
    const interruptedIntent =
      await prisma.workItemChangeSetMaterialization.findUniqueOrThrow({
        where: { proposalId },
        include: { checkpoints: true },
      });
    expect(interruptedIntent.checkpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationKind: 'designDoc.create',
          status: 'COMPLETED',
        }),
        expect.objectContaining({
          operationKind: 'relationship.create',
          status: 'FAILED',
        }),
      ]),
    );
    failRelationships = false;
    const resumed = await approval.retryApprovedGenericProposal({
      proposalId,
      organizationId,
      projectId,
    });
    expect(resumed.enacted).toBe(true);
    const planId = resumed.resultingEntityId!;
    const plan = await prisma.task.findUniqueOrThrow({ where: { id: planId } });
    expect(plan.status).toBe('ACTIVE');
    const configurationSection = await prisma.taskSection.findUnique({
      where: { taskId_key: { taskId: planId, key: 'planConfiguration' } },
    });
    const configuration = validatePlanConfigurationContent(
      configurationSection?.materializedMarkdown,
    );
    expect(configuration.success).toBe(true);
    if (!configuration.success) {
      throw new Error(configuration.message);
    }
    expect(configuration.value).toEqual({
      schemaVersion: PLAN_CONFIGURATION_SCHEMA_VERSION,
      planType: 'STANDARD',
      worktreeBranch: null,
    });
    expect(await prisma.designDoc.count()).toBe(1);
    expect((await prisma.designDoc.findFirstOrThrow()).id).toBe(document.id);
    const stages = await prisma.task.findMany({
      where: { parentTaskId: planId, type: 'PLAN_STAGE' },
    });
    expect(stages).toHaveLength(4);
    expect(stages.map((stage) => stage.status)).toEqual(
      taskIds.map(() => 'BACKLOG'),
    );
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: planId } }))
        .parentTaskId,
    ).toBe(featureId);
    expect(document.parentEntityId).toBe(planId);
    for (const [index, taskId] of taskIds.entries()) {
      const stage = stages.find((row) => row.name === `Stage ${index + 1}`);
      expect(stage).toBeDefined();
      expect(
        (await prisma.task.findUniqueOrThrow({ where: { id: taskId } }))
          .parentTaskId,
      ).toBe(stage?.id);
      if (index > 0) {
        const predecessor = stages.find((row) => row.name === `Stage ${index}`);
        expect([...edges.values()]).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourceNodeId: stage?.id,
              targetNodeId: predecessor?.id,
              type: 'DEPENDS_ON',
            }),
          ]),
        );
      }
    }
    expect(await prisma.task.count({ where: { type: 'STANDARD' } })).toBe(4);
    const after = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      orderBy: { id: 'asc' },
    });
    expect(
      after.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt,
      })),
    ).toEqual(
      before.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt,
      })),
    );
    for (const row of after) {
      expect(stages.map((stage) => stage.id)).toContain(row.parentTaskId);
    }
    expect(
      await prisma.taskSectionHistory.findMany({ orderBy: { id: 'asc' } }),
    ).toEqual(histories);
    for (const edge of oldEdges) {
      expect(edges.get(edge.id)).toEqual(edge);
    }
    expect([...edges.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: planId,
          targetNodeId: otherFeatureId,
          type: 'RELATED_TO',
        }),
        expect.objectContaining({
          sourceNodeId: taskIds[3],
          targetNodeId: taskIds[0],
          type: 'DEPENDS_ON',
        }),
        expect.objectContaining({
          sourceNodeId: planId,
          targetNodeId: document.id,
          targetEntityType: 'DESIGN_DOC',
        }),
      ]),
    );
    expect(
      [...edges.values()].filter(
        (edge) =>
          edge.type === 'DEPENDS_ON' &&
          stages.some((stage) => stage.id === edge.sourceNodeId),
      ),
    ).toHaveLength(3);
    expect(
      (
        await prisma.workItemChangeSetMaterialization.findUniqueOrThrow({
          where: { proposalId },
        })
      ).status,
    ).toBe('PUBLISHED');
  });
});
