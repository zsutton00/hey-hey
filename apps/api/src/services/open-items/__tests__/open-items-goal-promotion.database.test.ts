import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { OrganizationId, ProjectId, UserId } from '../../../types';
import type { TaskService } from '../../tasks/task.service';
import { GoalTracksService } from '../../tasks/goal-tracks.service';
import type { AgentEdgeClientService } from '../../agent-edge-client.service';
import type { AgentEdge, CreateAgentEdgeDto } from '../../../generated/graphs';
import { createWarmWorkItemTypeRegistryWithCustomTypes } from '../../../../test/setup/work-item-type-registry.fixture';
import type { WebsocketGateway } from '../../../core/websockets/websocket.gateway';
import { OpenItemsRepository } from '../open-items.repository';
import { OpenItemsService } from '../open-items.service';
import { OpenItemsGoalPromotionService } from '../open-items-goal-promotion.service';
import type { CreateTaskDto } from '../../../generated';

const database = process.env.PROJECT_DATABASE_URL;
const enabled =
  process.env.RUN_OPEN_ITEMS_PROMOTION_DB_TESTS === '1' &&
  database &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname);
const describeDatabase = enabled ? describe : describe.skip;

describeDatabase('promotion database publication and replay', () => {
  const prisma = new PrismaService();
  const repository = new OpenItemsRepository(prisma);
  const organizationId = randomUUID() as OrganizationId;
  const projectId = randomUUID() as ProjectId;
  const userId = randomUUID() as UserId;
  const scope = { organizationId, projectId, userId };
  const gateway = { publishOpenItemsChanged: jest.fn() };
  const manual = new OpenItemsService(
    repository,
    gateway as unknown as WebsocketGateway,
  );
  // The orchestration test uses real Postgres Goal rows. Dedicated TaskService
  // tests own creation validation/events; graph transport failures are injected.
  const tasks = {
    createInTransaction: jest.fn(
      (
        tx: Prisma.TransactionClient,
        org: OrganizationId,
        _initiative: null,
        dto: CreateTaskDto,
        project: ProjectId,
      ) =>
        tx.task.create({
          data: {
            organizationId: org,
            projectId: project,
            type: 'GOAL',
            name: dto.name,
            status: 'ACTIVE',
          },
        }),
    ),
  };
  const graph = new Map<string, AgentEdge>();
  const edgeClient = {
    list: jest.fn(
      async (
        _org: string,
        _project: string,
        query: { sourceNodeId: string },
      ) => ({
        content: [...graph.values()].filter(
          (edge) => edge.sourceNodeId === query.sourceNodeId,
        ),
      }),
    ),
    create: jest.fn(
      async (
        _org: string,
        _project: string,
        dto: CreateAgentEdgeDto,
      ): Promise<AgentEdge> => {
        if (!dto.id)
          throw new Error('TRACKS creation must supply its stable identity');
        const existing = graph.get(dto.id);
        if (existing) return existing;
        const edge: AgentEdge = {
          id: dto.id,
          sourceNodeId: dto.sourceNodeId,
          targetNodeId: dto.targetNodeId,
          type: 'TRACKS',
          reasoning: dto.reasoning,
          createdBySessionId: dto.createdBySessionId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        graph.set(dto.id, edge);
        return edge;
      },
    ),
  };
  let promotion: OpenItemsGoalPromotionService;

  beforeAll(async () => {
    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: 'Promotion test',
        slug: 'promotion-' + organizationId,
      },
    });
    await prisma.db.project.create({
      data: { id: projectId, organizationId, name: 'Promotion test' },
    });
    await prisma.db.user.create({
      data: {
        id: userId,
        email: userId + '@example.test',
        passwordHash: 'unused',
        name: 'Tester',
      },
    });
    const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      { typeKey: 'PROMOTION_TEST_SCOPE', projectId },
    ]);
    const tracks = new GoalTracksService(
      prisma,
      edgeClient as unknown as AgentEdgeClientService,
      registry,
    );
    promotion = new OpenItemsGoalPromotionService(
      repository,
      tasks as unknown as TaskService,
      tracks,
      gateway as unknown as WebsocketGateway,
    );
  });
  afterAll(async () => {
    await prisma.db.openItemCollection.deleteMany({ where: { projectId } });
    await prisma.db.task.deleteMany({ where: { projectId } });
    await prisma.db.project.delete({ where: { id: projectId } });
    await prisma.db.user.delete({ where: { id: userId } });
    await prisma.db.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  async function grouped() {
    await manual.resetOpenItems(scope, { idempotencyKey: randomUUID() });
    const taskId = randomUUID();
    const sessionId = randomUUID();
    await prisma.db.task.create({
      data: {
        id: taskId,
        organizationId,
        projectId,
        type: 'BUG',
        name: 'Trackable member',
        status: 'ACTIVE',
      },
    });
    for (const member of [
      { entityType: 'TASK' as const, entityId: taskId },
      { entityType: 'AGENT_SESSION' as const, entityId: sessionId },
    ]) {
      await manual.activateOpenItem(scope, {
        idempotencyKey: randomUUID(),
        item: member,
        lineage: [],
        presentation: { label: 'Member' },
      });
    }
    const created = await manual.createOpenItemGroup(scope, {
      idempotencyKey: randomUUID(),
      name: 'Group',
      assign: [
        { entityType: 'TASK', entityId: taskId },
        { entityType: 'AGENT_SESSION', entityId: sessionId },
      ],
    });
    return { groupId: created.groups[0]!.groupId, taskId, sessionId };
  }

  it('commits exactly one revision under concurrent replay, persists all filters/disclosure and preserves activation state', async () => {
    const { groupId, taskId, sessionId } = await grouped();
    const before = await manual.getOpenItems(scope);
    if (before.state !== 'PRESENT')
      throw new Error('Fixture collection absent');
    const request = {
      groupId,
      goalName: 'Outcome',
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        promotion.promoteGroupToGoal(scope, request, 'token'),
      ),
    );
    expect(new Set(results.map((r) => r.goal.entityId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results[0]!.collection.revision).toBe(before.revision + 1);
    expect(results[0]!.collection.groups).toEqual([]);
    expect(results[0]!.untrackedMembers).toEqual([
      { entityType: 'AGENT_SESSION', entityId: sessionId },
    ]);
    expect(
      [...graph.values()].filter(
        (edge) =>
          edge.sourceNodeId === results[0]!.goal.entityId &&
          edge.targetNodeId === taskId,
      ),
    ).toHaveLength(1);
    expect(
      results[0]!.collection.items.find((item) => item.entityId === taskId),
    ).toBeUndefined();
    expect(
      results[0]!.collection.items.find((item) => item.entityId === sessionId),
    ).toMatchObject({ groupId: null });
    expect(
      results[0]!.collection.items.find(
        (item) => item.entityId === results[0]!.goal.entityId,
      ),
    ).toMatchObject({
      pinned: true,
      goalTrackedWorkFilter: 'ACTIVE_AND_BACKLOG',
      goalCollapsed: true,
    });
    expect(
      await prisma.db.task.count({ where: { projectId, type: 'GOAL' } }),
    ).toBe(1);
    const goal = results[0]!.goal;
    for (const filter of [
      'ACTIVE_AND_BACKLOG',
      'ACTIVE',
      'ALL',
      'NONE',
    ] as const) {
      const request = { idempotencyKey: randomUUID(), filter };
      const result = await manual.setOpenItemGoalFilter(scope, goal, request);
      const replay = await manual.setOpenItemGoalFilter(scope, goal, request);
      expect(replay).toEqual({ ...result, replayed: true });
      const row = await prisma.db.openItem.findFirstOrThrow({
        where: { entityId: goal.entityId },
      });
      expect(row.goalTrackedWorkFilter).toBe(filter);
    }
    await manual.setOpenItemGoalDisclosure(scope, goal, {
      idempotencyKey: randomUUID(),
      collapsed: false,
    });
    await manual.activateOpenItem(scope, {
      idempotencyKey: randomUUID(),
      item: goal,
      lineage: [],
      presentation: { label: 'New title', workItemTypeKey: 'GOAL' },
    });
    const reloaded = await manual.getOpenItems(scope);
    if (reloaded.state !== 'PRESENT')
      throw new Error('Fixture collection absent');
    expect(
      reloaded.items.find((item) => item.entityId === goal.entityId),
    ).toMatchObject({ goalTrackedWorkFilter: 'NONE', goalCollapsed: false });
    await expect(
      promotion.promoteGroupToGoal(
        scope,
        { ...request, goalName: 'Conflict' },
        'token',
      ),
    ).rejects.toMatchObject({ body: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('rejects missing group before Goal creation', async () => {
    const count = await prisma.db.task.count({ where: { projectId } });
    const before = await manual.getOpenItems(scope);
    const signals = gateway.publishOpenItemsChanged.mock.calls.length;
    await expect(
      promotion.promoteGroupToGoal(
        scope,
        {
          groupId: randomUUID(),
          goalName: 'Missing',
          idempotencyKey: randomUUID(),
        },
        'token',
      ),
    ).rejects.toMatchObject({ body: { code: 'GROUP_NOT_FOUND' } });
    expect(await prisma.db.task.count({ where: { projectId } })).toBe(count);
    expect(await manual.getOpenItems(scope)).toEqual(before);
    expect(gateway.publishOpenItemsChanged).toHaveBeenCalledTimes(signals);
  });

  it('rolls back Goal creation and retry identity when the creation step fails', async () => {
    const { groupId } = await grouped();
    const before = await manual.getOpenItems(scope);
    const count = await prisma.db.task.count({
      where: { projectId, type: 'GOAL' },
    });
    tasks.createInTransaction.mockImplementationOnce(() => {
      throw new Error('Injected Goal creation failure');
    });
    const request = {
      groupId,
      goalName: 'Creation failure',
      idempotencyKey: randomUUID(),
    };
    await expect(
      promotion.promoteGroupToGoal(scope, request, 'token'),
    ).rejects.toThrow('Injected Goal creation failure');
    expect(await manual.getOpenItems(scope)).toEqual(before);
    expect(
      await prisma.db.task.count({ where: { projectId, type: 'GOAL' } }),
    ).toBe(count);
    expect(
      await prisma.db.openItemIdempotencyRecord.count({
        where: { idempotencyKey: request.idempotencyKey },
      }),
    ).toBe(0);
    const result = await promotion.promoteGroupToGoal(scope, request, 'token');
    expect(result.replayed).toBe(false);
    expect(
      await prisma.db.task.count({
        where: { projectId, name: 'Creation failure' },
      }),
    ).toBe(1);
  });

  it('retains Goal/TRACKS and rolls back all collection writes on a late database failure', async () => {
    const { groupId, taskId } = await grouped();
    const before = await manual.getOpenItems(scope);
    const request = {
      groupId,
      goalName: 'Failure',
      idempotencyKey: randomUUID(),
    };
    const advance = jest
      .spyOn(repository, 'advanceRevision')
      .mockRejectedValueOnce(new Error('Injected database failure'));
    const signals = gateway.publishOpenItemsChanged.mock.calls.length;
    await expect(
      promotion.promoteGroupToGoal(scope, request, 'token'),
    ).rejects.toThrow('Injected database failure');
    expect(await manual.getOpenItems(scope)).toEqual(before);
    expect(
      await prisma.db.task.count({ where: { projectId, name: 'Failure' } }),
    ).toBe(1);
    expect(gateway.publishOpenItemsChanged).toHaveBeenCalledTimes(signals);
    advance.mockRestore();
    const result = await promotion.promoteGroupToGoal(scope, request, 'token');
    expect(
      await prisma.db.task.count({ where: { projectId, name: 'Failure' } }),
    ).toBe(1);
    expect(
      [...graph.values()].filter(
        (edge) =>
          edge.sourceNodeId === result.goal.entityId &&
          edge.targetNodeId === taskId,
      ),
    ).toHaveLength(1);
    expect(await promotion.promoteGroupToGoal(scope, request, 'token')).toEqual(
      { ...result, replayed: true },
    );
  });

  it('retains the Goal and earlier TRACKS after a later graph write fails, then resumes without duplicates', async () => {
    const { groupId } = await grouped();
    const otherTaskId = randomUUID();
    await prisma.db.task.create({
      data: {
        id: otherTaskId,
        organizationId,
        projectId,
        type: 'BUG',
        name: 'Second trackable member',
        status: 'ACTIVE',
      },
    });
    await manual.activateOpenItem(scope, {
      idempotencyKey: randomUUID(),
      item: { entityType: 'TASK', entityId: otherTaskId },
      lineage: [],
      presentation: { label: 'Second trackable member' },
    });
    await manual.assignOpenItemsToGroup(scope, groupId, {
      idempotencyKey: randomUUID(),
      items: [{ entityType: 'TASK', entityId: otherTaskId }],
    });
    const before = await manual.getOpenItems(scope);
    edgeClient.create
      .mockImplementationOnce(edgeClient.create.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('Injected graph failure'));
    const request = {
      groupId,
      goalName: 'Graph failure',
      idempotencyKey: randomUUID(),
    };
    await expect(
      promotion.promoteGroupToGoal(scope, request, 'token'),
    ).rejects.toThrow('Injected graph failure');
    expect(await manual.getOpenItems(scope)).toEqual(before);
    expect(
      await prisma.db.task.count({
        where: { projectId, name: 'Graph failure' },
      }),
    ).toBe(1);
    const goal = await prisma.db.task.findFirstOrThrow({
      where: { projectId, name: 'Graph failure' },
    });
    expect(
      [...graph.values()].filter((edge) => edge.sourceNodeId === goal.id),
    ).toHaveLength(1);
    await promotion.promoteGroupToGoal(scope, request, 'token');
    expect(
      [...graph.values()].filter((edge) => edge.sourceNodeId === goal.id),
    ).toHaveLength(2);
    expect(
      new Set(
        [...graph.values()]
          .filter((edge) => edge.sourceNodeId === goal.id)
          .map((edge) => edge.targetNodeId),
      ).size,
    ).toBe(2);
    expect(
      await prisma.db.task.count({
        where: { projectId, name: 'Graph failure' },
      }),
    ).toBe(1);
  });
});
