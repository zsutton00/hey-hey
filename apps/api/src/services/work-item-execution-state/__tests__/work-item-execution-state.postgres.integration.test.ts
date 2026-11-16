import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { Socket } from 'socket.io';
import type {
  TaskMonitorStateProjection,
  WebSocketWorkItemExecutionStateChangedEvent,
  WorkItemExecutionStateBatchItemDto,
  WorkItemExecutionStateObservation,
} from '@hey-hey/contracts/api/models';
import {
  InMemoryPostgres,
  startInMemoryPostgres,
} from '../../../__tests__/helpers/in-memory-postgres';
import { ProjectAccessService } from '../../../auth/services/project-access.service';
import { WorkItemExecutionStateController } from '../../../controllers/work-item-execution-state.controller';
import type { ClientConnection } from '../../../core/events/types/event.types';
import { MachinePresenceService } from '../../../core/websockets/machine-presence.service';
import { WebsocketGateway } from '../../../core/websockets/websocket.gateway';
import { PrismaService } from '../../../prisma/prisma.service';
import { MachineId, OrganizationId, ProjectId, UserId } from '../../../types';
import { WorkItemExecutionStateRegistry } from '../work-item-execution-state.registry';
import { WorkItemExecutionStateService } from '../work-item-execution-state.service';

// The real receiver, retention, ordering, freshness, fan-out and read paths
// against a real PostgreSQL engine with the shipped migrations. Only the
// socket transport and Redis are replaced, at the system boundary. Payloads
// are the projections the real CLI Task Monitor owner publishes; the CLI
// suite fails if they drift from `taskMonitorStateProjection`.
jest.setTimeout(180_000);

const projections = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/task-monitor-state-projections.json'),
    'utf8',
  ),
) as Record<
  'running' | 'paused' | 'failed' | 'completed',
  TaskMonitorStateProjection
>;

/** The Redis commands machine presence uses, over process memory. */
class FakeRedis {
  readonly keys = new Map<string, unknown>();
  failing = false;

  private guard(): void {
    if (this.failing) {
      throw new Error('redis unavailable');
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.guard();
    this.keys.set(key, value);
  }

  async exists(key: string): Promise<number> {
    this.guard();
    return this.keys.has(key) ? 1 : 0;
  }

  async del(key: string): Promise<void> {
    this.guard();
    this.keys.delete(key);
  }

  async sadd(): Promise<void> {
    this.guard();
  }

  async srem(): Promise<void> {
    this.guard();
  }

  async hgetall(): Promise<Record<string, string>> {
    this.guard();
    return {};
  }
}

interface Owner {
  userId: UserId;
  machineId: MachineId;
  socket: Socket;
}

describe('Work item execution state with a real database', () => {
  const previousDatabaseUrl = process.env.PROJECT_DATABASE_URL;
  let database: InMemoryPostgres;
  let prisma: PrismaService;
  let redis: FakeRedis;
  let presence: MachinePresenceService;
  let registry: WorkItemExecutionStateRegistry;
  let service: WorkItemExecutionStateService;
  let gateway: WebsocketGateway;
  let controller: WorkItemExecutionStateController;
  let connections: Map<string, ClientConnection>;
  let roomEvents: Array<{
    room: string;
    name: string;
    event: WebSocketWorkItemExecutionStateChangedEvent;
  }>;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    database = await startInMemoryPostgres();
    process.env.PROJECT_DATABASE_URL = database.url;
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await database.close();
    process.env.PROJECT_DATABASE_URL = previousDatabaseUrl;
  });

  beforeEach(() => {
    redis = new FakeRedis();
    presence = new MachinePresenceService({ getClient: () => redis } as never);
    registry = new WorkItemExecutionStateRegistry();
    service = new WorkItemExecutionStateService(
      prisma,
      new ProjectAccessService(prisma),
      presence,
      registry,
    );
    controller = new WorkItemExecutionStateController(service);
    connections = new Map();
    roomEvents = [];
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const connectionManager = {
      getConnection: (id: string) => connections.get(id),
      getAllConnections: () => [...connections.values()],
      removeConnection: (id: string) => connections.delete(id),
    };
    gateway = new WebsocketGateway(
      { registerRevalidation: jest.fn() } as never,
      connectionManager as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { clearRuntimeCurrentState: jest.fn().mockResolvedValue(0) } as never,
      presence,
      {} as never,
      { register: jest.fn(), unregister: jest.fn() } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      service,
    );
    Object.assign(gateway, {
      server: {
        to: (room: string) => ({
          emit: (
            name: string,
            event: WebSocketWorkItemExecutionStateChangedEvent,
          ) => roomEvents.push({ room, name, event }),
        }),
      },
    });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    gateway.afterInit();
    jest.useRealTimers();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const seedProject = async () => {
    const organizationId = randomUUID() as OrganizationId;
    const projectId = randomUUID() as ProjectId;
    await prisma.db.organization.create({
      data: { id: organizationId, name: 'Org', slug: `o-${organizationId}` },
    });
    await prisma.db.project.create({
      data: { id: projectId, name: 'Project', organizationId },
    });

    return { organizationId, projectId };
  };

  /** A project member with a paired machine on an authenticated CLI socket. */
  const seedOwner = async (scope: {
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<Owner> => {
    const userId = randomUUID() as UserId;
    const machineId = randomUUID() as MachineId;
    await prisma.db.user.create({
      data: {
        id: userId,
        email: `owner-${userId}@example.test`,
        name: 'Owner',
        passwordHash: 'unused',
        memberships: { create: { organizationId: scope.organizationId } },
      },
    });
    await prisma.db.projectMember.create({
      data: { projectId: scope.projectId, userId },
    });
    await prisma.db.machine.create({
      data: {
        id: machineId,
        userId,
        organizationId: scope.organizationId,
        name: 'Laptop',
        publicKey: `key-${machineId}`,
        tokenHash: `hash-${machineId}`,
      },
    });

    return { userId, machineId, socket: connect(userId, machineId) };
  };

  const connect = (userId: UserId, machineId: MachineId): Socket => {
    const id = randomUUID();
    connections.set(id, {
      id,
      userId,
      machineId,
      clientType: 'cli',
      organizationIds: [],
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      designDocIds: [],
      agentSessionIds: [],
      taskMonitorIds: [],
      connectedAt: new Date(),
      lastActivity: new Date(),
    });
    void presence.setPresence(machineId, userId);

    return { id, disconnect: jest.fn() } as unknown as Socket;
  };

  const seedWorkItem = async (
    scope: { organizationId: OrganizationId; projectId: ProjectId },
    type = 'TASK_MONITOR',
  ): Promise<string> => {
    const task = await prisma.db.task.create({
      data: { name: 'Nightly monitor', type, ...scope },
    });

    return task.id;
  };

  const report = async (
    owner: Owner,
    workItemId: string,
    sourceRevision: number,
    projection: TaskMonitorStateProjection,
    overrides: Partial<WorkItemExecutionStateObservation> = {},
  ): Promise<void> => {
    const observation: WorkItemExecutionStateObservation = {
      workItemId,
      machineId: owner.machineId,
      sourceRevision,
      state: { type: 'TASK_MONITOR', projection },
      ...overrides,
    };
    await gateway.handleWorkItemExecutionStateObserved(
      owner.socket,
      observation,
    );
  };

  const read = async (
    scope: { organizationId: OrganizationId; projectId: ProjectId },
    workItemId: string,
  ): Promise<WorkItemExecutionStateBatchItemDto> => {
    const response = await controller.batchReadExecutionState(
      scope.projectId,
      scope.organizationId,
      { workItemIds: [workItemId] },
    );

    const [item] = response.items;
    if (!item) {
      throw new Error('Batch read returned no result for the requested item');
    }

    return item;
  };

  const retained = async (
    scope: { organizationId: OrganizationId; projectId: ProjectId },
    workItemId: string,
  ) => {
    const item = await read(scope, workItemId);
    if (item.result !== 'RETAINED') {
      throw new Error(`Expected retained state, got ${item.result}`);
    }

    return item.executionState;
  };

  const rejectionCodes = (): unknown[] =>
    warn.mock.calls
      .map(([, detail]) => (detail as { code?: string } | undefined)?.code)
      .filter(Boolean);

  it('keeps one row per work item, replaced in place by newer reports from its owner', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);

    expect(await read(scope, workItemId)).toEqual({
      result: 'MISSING',
      workItemId,
    });

    await report(owner, workItemId, 3, projections.running);
    const first = await retained(scope, workItemId);
    expect(first).toMatchObject({
      workItemId,
      revision: 1,
      ownerMachineId: owner.machineId,
      state: { type: 'TASK_MONITOR', projection: projections.running },
      freshness: { status: 'CURRENT' },
    });

    await report(owner, workItemId, 4, projections.failed);
    const second = await retained(scope, workItemId);
    expect(second.revision).toBe(2);
    expect(second.state.projection).toEqual(projections.failed);
    expect(
      await prisma.db.workItemExecutionState.count({ where: { workItemId } }),
    ).toBe(1);

    // Ordinary work-item status is a separate concept and is left alone.
    const task = await prisma.db.task.findUniqueOrThrow({
      where: { id: workItemId },
    });
    expect(task.status).toBe('BACKLOG');

    // Every accepted change reaches the project room, complete, and nowhere else.
    expect(roomEvents.map(({ room, name }) => ({ room, name }))).toEqual([
      {
        room: `project:${scope.projectId}`,
        name: 'work_item.execution_state_changed',
      },
      {
        room: `project:${scope.projectId}`,
        name: 'work_item.execution_state_changed',
      },
    ]);
    expect(roomEvents[1]?.event).toMatchObject({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      executionState: second,
    });
  });

  it('ignores duplicate and older reports so state cannot regress', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);
    await report(owner, workItemId, 5, projections.failed);
    const accepted = await retained(scope, workItemId);
    roomEvents.length = 0;

    await report(owner, workItemId, 5, projections.running);
    await report(owner, workItemId, 2, projections.completed);

    expect(await retained(scope, workItemId)).toEqual(accepted);
    expect(roomEvents).toEqual([]);
    expect(rejectionCodes()).toEqual(['STALE']);
  });

  it('lets exactly one of two simultaneous reports become the latest state', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);

    await Promise.all([
      report(owner, workItemId, 8, projections.paused),
      report(owner, workItemId, 9, projections.completed),
      report(owner, workItemId, 8, projections.running),
    ]);

    const latest = await retained(scope, workItemId);
    expect(latest.state.projection).toEqual(projections.completed);
    expect(
      await prisma.db.workItemExecutionState.count({ where: { workItemId } }),
    ).toBe(1);
    const row = await prisma.db.workItemExecutionState.findUniqueOrThrow({
      where: { workItemId },
    });
    expect(Number(row.sourceRevision)).toBe(9);
  });

  it('rejects another machine until the type confirms it, then orders the new owner separately', async () => {
    const scope = await seedProject();
    const first = await seedOwner(scope);
    const second = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);
    await report(first, workItemId, 40, projections.failed);

    await report(second, workItemId, 41, projections.running);
    expect((await retained(scope, workItemId)).ownerMachineId).toBe(
      first.machineId,
    );
    expect(rejectionCodes()).toEqual(['OWNER_MISMATCH']);

    // The type's own authority now names the second machine as owner.
    registry.registerOwnerRule(
      'TASK_MONITOR',
      async ({ reportingMachineId }) => reportingMachineId === second.machineId,
    );
    // Its sequence is its own: a revision far below the former owner's wins.
    await report(second, workItemId, 1, projections.running);
    const takenOver = await retained(scope, workItemId);
    expect(takenOver).toMatchObject({
      ownerMachineId: second.machineId,
      revision: 2,
      state: { projection: projections.running },
    });

    warn.mockClear();
    await report(first, workItemId, 99, projections.completed);
    expect(await retained(scope, workItemId)).toEqual(takenOver);
    expect(rejectionCodes()).toEqual(['OWNER_MISMATCH']);
  });

  it('shows the last report as last-known when the owner disconnects and current again after it replays', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);
    await report(owner, workItemId, 6, projections.failed);
    roomEvents.length = 0;

    await gateway.handleDisconnect(owner.socket);

    const offline = await retained(scope, workItemId);
    expect(offline.freshness.status).toBe('LAST_KNOWN');
    expect(offline.revision).toBe(2);
    // Going offline neither clears the known failure nor asserts health.
    expect(offline.state.projection).toEqual(projections.failed);
    expect(roomEvents).toHaveLength(1);
    expect(roomEvents[0]?.event.executionState).toEqual(offline);

    // The owner reconnects and replays its committed state, revision unchanged.
    const reconnected = {
      ...owner,
      socket: connect(owner.userId, owner.machineId),
    };
    await report(reconnected, workItemId, 6, projections.failed);

    const online = await retained(scope, workItemId);
    expect(online.freshness.status).toBe('CURRENT');
    expect(online.revision).toBe(3);
    expect(online.state.projection).toEqual(projections.failed);
    expect(online.acceptedAt).toBe(offline.acceptedAt);
  });

  it('keeps a running report current while the machine still has another connection', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);
    const secondSocket = connect(owner.userId, owner.machineId);
    await report(owner, workItemId, 1, projections.running);

    await gateway.handleDisconnect(owner.socket);
    await presence.setPresence(owner.machineId, owner.userId);
    expect((await retained(scope, workItemId)).freshness.status).toBe(
      'CURRENT',
    );

    await gateway.handleDisconnect(secondSocket);
    const offline = await retained(scope, workItemId);
    expect(offline.freshness.status).toBe('LAST_KNOWN');
    expect(offline.state.projection.execution.lifecycle).toBe('RUNNING');
  });

  it('marks state last-known on credential revocation and refuses the revoked machine', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);
    await report(owner, workItemId, 2, projections.failed);

    await prisma.db.machine.update({
      where: { id: owner.machineId },
      data: { revokedAt: new Date() },
    });
    await gateway.handleAuthRevoked(owner.socket);

    const revoked = await retained(scope, workItemId);
    expect(revoked.freshness.status).toBe('LAST_KNOWN');
    expect(revoked.state.projection).toEqual(projections.failed);

    const stillOpen = {
      ...owner,
      socket: connect(owner.userId, owner.machineId),
    };
    await report(stillOpen, workItemId, 3, projections.completed);
    expect((await retained(scope, workItemId)).state.projection).toEqual(
      projections.failed,
    );
    expect(rejectionCodes()).toEqual(['MACHINE_REVOKED']);
  });

  it('survives cache loss: the report is kept, read as last-known, and current once the owner is seen again', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);
    await report(owner, workItemId, 7, projections.failed);

    // Redis is unreachable: presence cannot be confirmed.
    redis.failing = true;
    const unreachable = await retained(scope, workItemId);
    expect(unreachable.freshness.status).toBe('LAST_KNOWN');
    expect(unreachable.state.projection).toEqual(projections.failed);

    // Redis comes back empty. The row still says connected; a read does not
    // trust it, and the sweep records the loss.
    redis.failing = false;
    redis.keys.clear();
    expect((await retained(scope, workItemId)).freshness.status).toBe(
      'LAST_KNOWN',
    );
    await service.reconcileFreshnessWithPresence();
    const swept = await retained(scope, workItemId);
    expect(swept).toMatchObject({
      revision: 2,
      freshness: { status: 'LAST_KNOWN' },
      state: { projection: projections.failed },
    });

    // The still-connected owner heartbeats, and the next sweep restores it.
    await presence.setPresence(owner.machineId, owner.userId);
    await service.reconcileFreshnessWithPresence();
    expect(await retained(scope, workItemId)).toMatchObject({
      revision: 3,
      freshness: { status: 'CURRENT' },
      state: { projection: projections.failed },
    });
  });

  it('marks a reconnecting machine current when it authenticates', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);
    await report(owner, workItemId, 1, projections.paused);
    await gateway.handleDisconnect(owner.socket);
    roomEvents.length = 0;

    connect(owner.userId, owner.machineId);
    await service.markMachineConnected(owner.machineId);

    expect((await retained(scope, workItemId)).freshness.status).toBe(
      'CURRENT',
    );
    expect(roomEvents[0]?.event.executionState).toMatchObject({
      freshness: { status: 'CURRENT' },
      state: { projection: projections.paused },
    });
  });

  it('refuses reports that are not bound to the reporter, the item or its project', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);
    const otherScope = await seedProject();
    const outsider = await seedOwner(otherScope);
    const ordinaryTaskId = await seedWorkItem(scope, 'STANDARD');
    const archivedId = await seedWorkItem(scope);
    await prisma.db.task.update({
      where: { id: archivedId },
      data: { archivedAt: new Date() },
    });
    const browser = connect(owner.userId, owner.machineId);
    connections.get(browser.id)!.clientType = 'browser';

    // Valid counterpart: the same shape from the bound owner is accepted.
    await report(owner, workItemId, 1, projections.running);
    const accepted = await retained(scope, workItemId);
    expect(rejectionCodes()).toEqual([]);

    await gateway.handleWorkItemExecutionStateObserved(browser, {
      workItemId,
      machineId: owner.machineId,
      sourceRevision: 2,
      state: { type: 'TASK_MONITOR', projection: projections.completed },
    });
    await gateway.handleWorkItemExecutionStateObserved(owner.socket, {
      workItemId,
      machineId: owner.machineId,
      sourceRevision: 2,
      state: {
        type: 'TASK_MONITOR',
        projection: { ...projections.completed, organizationId: 'spoofed' },
      },
    });
    await report(owner, workItemId, 2, projections.completed, {
      machineId: outsider.machineId,
    });
    await report(owner, randomUUID(), 2, projections.completed);
    await report(owner, archivedId, 2, projections.completed);
    await report(owner, ordinaryTaskId, 2, projections.completed);
    await report(outsider, workItemId, 2, projections.completed);

    expect(rejectionCodes()).toEqual([
      'UNAUTHENTICATED',
      'MALFORMED',
      'MACHINE_MISMATCH',
      'ITEM_NOT_FOUND',
      'ITEM_NOT_FOUND',
      'TYPE_NOT_PARTICIPATING',
      'PROJECT_FORBIDDEN',
    ]);
    // Nothing was altered or created, and no refusal carries the payload.
    expect(await retained(scope, workItemId)).toEqual(accepted);
    expect(await prisma.db.workItemExecutionState.count()).toBeGreaterThan(0);
    expect(
      await prisma.db.workItemExecutionState.count({
        where: { workItemId: { in: [archivedId, ordinaryTaskId] } },
      }),
    ).toBe(0);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('availableActions');
  });

  it('never discloses state to a read scoped to another project', async () => {
    const scope = await seedProject();
    const owner = await seedOwner(scope);
    const workItemId = await seedWorkItem(scope);
    const otherScope = await seedProject();
    await report(owner, workItemId, 1, projections.failed);

    expect(await read(otherScope, workItemId)).toEqual({
      result: 'MISSING',
      workItemId,
    });
    expect((await read(scope, workItemId)).result).toBe('RETAINED');
    await expect(
      controller.batchReadExecutionState(
        scope.projectId,
        scope.organizationId,
        { workItemIds: [workItemId, workItemId] },
      ),
    ).rejects.toThrow('1 to 100 unique UUID');
  });
});
