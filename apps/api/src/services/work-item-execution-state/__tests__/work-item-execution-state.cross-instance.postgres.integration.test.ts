import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Server, type Namespace, type Socket } from 'socket.io';
import type {
  TaskMonitorStateProjection,
  WebSocketWorkItemExecutionStateChangedEvent,
  WebSocketWorkItemExecutionStateDeliveryChangedEvent,
} from '@hey-hey/contracts/api/models';
import {
  InMemoryPostgres,
  startInMemoryPostgres,
} from '../../../__tests__/helpers/in-memory-postgres';
import { ProjectAccessService } from '../../../auth/services/project-access.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { OutboxPublisher } from '../../../core/events/outbox-publisher.service';
import { RedisMessageBus } from '../../../core/events/redis-message-bus.service';
import type { ClientConnection } from '../../../core/events/types/event.types';
import { MachinePresenceService } from '../../../core/websockets/machine-presence.service';
import { WebsocketGateway } from '../../../core/websockets/websocket.gateway';
import { PrismaService } from '../../../prisma/prisma.service';
import { MachineId, OrganizationId, ProjectId, UserId } from '../../../types';
import { OutboxStore } from '../../outbox-store.service';
import { decideTaskMonitorPublication } from '../task-monitor-publication-policy';
import { WorkItemExecutionStateDelivery } from '../work-item-execution-state.delivery';
import { WorkItemExecutionStateRegistry } from '../work-item-execution-state.registry';
import { WorkItemExecutionStateService } from '../work-item-execution-state.service';

/**
 * Redis pub/sub and SET NX over process memory, shared by every client the
 * real RedisMessageBus constructs. It keeps the bus's own deduplication logic
 * in play, which is what decides whether every instance sees a notification.
 */
class Broker {
  readonly subscribers = new Set<FakeIoRedis>();
  readonly keys = new Set<string>();
}
const broker = new Broker();

class FakeIoRedis extends EventEmitter {
  private readonly channels = new Set<string>();
  connected = true;

  constructor() {
    super();
    broker.subscribers.add(this);
  }

  async publish(channel: string, message: string): Promise<number> {
    const receivers = [...broker.subscribers].filter(
      (client) => client.connected && client.channels.has(channel),
    );
    receivers.forEach((client) =>
      setImmediate(() => client.emit('message', channel, message)),
    );
    return receivers.length;
  }

  async subscribe(channel: string): Promise<void> {
    this.channels.add(channel);
  }

  async set(key: string): Promise<'OK' | null> {
    if (broker.keys.has(key)) {
      return null;
    }
    broker.keys.add(key);
    return 'OK';
  }

  async quit(): Promise<void> {
    broker.subscribers.delete(this);
  }

  /** The connection drops: nothing published elsewhere arrives meanwhile. */
  drop(): void {
    this.connected = false;
    this.emit('close');
  }

  restore(): void {
    this.connected = true;
    this.emit('ready');
  }
}

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => new FakeIoRedis()),
}));

jest.setTimeout(180_000);

const projections = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/task-monitor-state-projections.json'),
    'utf8',
  ),
) as Record<string, TaskMonitorStateProjection>;

type Emitted = {
  room: string;
  name: string;
  event:
    | WebSocketWorkItemExecutionStateChangedEvent
    | WebSocketWorkItemExecutionStateDeliveryChangedEvent;
};

/** One API instance: its own bus clients, gateway and joined rooms. */
interface Instance {
  gateway: WebsocketGateway;
  service: WorkItemExecutionStateService;
  bus: RedisMessageBus;
  outbox: OutboxPublisher;
  connections: Map<string, ClientConnection>;
  namespace: Namespace;
  emitted: Emitted[];
}

describe('Work item execution state across API instances', () => {
  const previousDatabaseUrl = process.env.PROJECT_DATABASE_URL;
  let database: InMemoryPostgres;
  let prisma: PrismaService;
  let instances: Instance[];

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

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await prisma.outboxEvent.updateMany({ data: { status: 'PUBLISHED' } });
    instances = [await startInstance(), await startInstance()];
  });

  afterEach(async () => {
    await Promise.all(instances.map(({ bus }) => bus.onModuleDestroy()));
    jest.restoreAllMocks();
  });

  const startInstance = async (): Promise<Instance> => {
    const presenceRedis = {
      set: async () => undefined,
      del: async () => undefined,
      sadd: async () => undefined,
      srem: async () => undefined,
      exists: async () => 1,
      hgetall: async () => ({}),
      pipeline: () => {
        const keys: string[] = [];
        const pipeline = {
          exists: (key: string) => {
            keys.push(key);
            return pipeline;
          },
          exec: async () => keys.map(() => [null, 1]),
        };
        return pipeline;
      },
    };
    const presence = new MachinePresenceService({
      getClient: () => presenceRedis,
    } as never);
    const registry = new WorkItemExecutionStateRegistry();
    registry.registerPublicationPolicy(
      'TASK_MONITOR',
      decideTaskMonitorPublication,
    );
    const bus = new RedisMessageBus('redis://fake');
    const outbox = new OutboxPublisher(
      prisma,
      bus,
      { get: () => undefined } as never,
      {
        setOutboxLagSeconds: jest.fn(),
        recordOutboxProcessed: jest.fn(),
        recordOutboxFailed: jest.fn(),
      } as never,
    );
    const service = new WorkItemExecutionStateService(
      prisma,
      new ProjectAccessService(prisma),
      presence,
      registry,
      new WorkItemExecutionStateDelivery(
        prisma,
        new DomainEventPublisher(new OutboxStore(prisma)),
        bus,
      ),
    );
    const connections = new Map<string, ClientConnection>();
    const emitted: Emitted[] = [];
    const gateway = new WebsocketGateway(
      { registerRevalidation: jest.fn() } as never,
      {
        getConnection: (id: string) => connections.get(id),
        getAllConnections: () => [...connections.values()],
        removeConnection: (id: string) => connections.delete(id),
      } as never,
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
      prisma,
      undefined,
      service,
    );
    // The real `/events` Namespace the gateway is given; only its outbound
    // emit is captured, so room membership is read the way production reads it.
    const namespace = new Server().of('/events');
    Object.assign(namespace, {
      to: (room: string) => ({
        emit: (name: string, event: Emitted['event']) => {
          // Socket.IO emits only to sockets joined on this instance.
          if (namespace.adapter.rooms.get(room)?.size) {
            emitted.push({ room, name, event });
          }
        },
      }),
    });
    Object.assign(gateway, { server: namespace });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    gateway.afterInit();
    jest.useRealTimers();
    // Let the asynchronous bus subscription register.
    await new Promise((resolve) => setImmediate(resolve));

    return { gateway, service, bus, outbox, connections, namespace, emitted };
  };

  /** The outbox runs on whichever instance claims the row first. */
  const flush = async (): Promise<void> => {
    for (let pass = 0; pass < 10; pass += 1) {
      await instances[pass % 2]!.outbox['processOutboxEvents']();
      const pending = await prisma.outboxEvent.count({
        where: { status: { not: 'PUBLISHED' } },
      });
      if (pending === 0) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  const subscriberOf = (bus: RedisMessageBus): FakeIoRedis =>
    (bus as unknown as { subscriber: FakeIoRedis }).subscriber;

  const seed = async () => {
    const organizationId = randomUUID() as OrganizationId;
    const projectId = randomUUID() as ProjectId;
    const userId = randomUUID() as UserId;
    const machineId = randomUUID() as MachineId;
    await prisma.db.organization.create({
      data: { id: organizationId, name: 'Org', slug: `o-${organizationId}` },
    });
    await prisma.db.project.create({
      data: { id: projectId, name: 'Project', organizationId },
    });
    await prisma.db.user.create({
      data: {
        id: userId,
        email: `owner-${userId}@example.test`,
        name: 'Owner',
        passwordHash: 'unused',
        memberships: { create: { organizationId } },
      },
    });
    await prisma.db.projectMember.create({ data: { projectId, userId } });
    await prisma.db.machine.create({
      data: {
        id: machineId,
        userId,
        organizationId,
        name: 'Laptop',
        publicKey: `key-${machineId}`,
        tokenHash: `hash-${machineId}`,
      },
    });
    const monitor = await prisma.db.task.create({
      data: {
        name: 'Nightly monitor',
        type: 'TASK_MONITOR',
        organizationId,
        projectId,
      },
    });
    await prisma.db.monitorCommand.create({
      data: {
        requestId: randomUUID(),
        authorizationId: randomUUID(),
        organizationId,
        projectId,
        monitorId: monitor.id,
        userId,
        machineId,
        body: { kind: 'TASK_MONITOR_COMMAND', command: { cause: 'START' } },
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    return {
      organizationId,
      projectId,
      userId,
      machineId,
      monitorId: monitor.id,
    };
  };

  /** A CLI socket on `instance` and a browser joined to the project on another. */
  const connectCli = (
    instance: Instance,
    scope: { userId: UserId; machineId: MachineId },
  ): Socket => {
    const id = randomUUID();
    instance.connections.set(id, {
      id,
      userId: scope.userId,
      machineId: scope.machineId,
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
    return { id, disconnect: jest.fn() } as unknown as Socket;
  };

  const joinProject = (instance: Instance, projectId: string): void => {
    void instance.namespace.adapter.addAll(
      randomUUID(),
      new Set([`project:${projectId}`]),
    );
  };

  const observation = (
    scope: { machineId: MachineId; monitorId: string },
    sourceRevision: number,
    projection: TaskMonitorStateProjection,
  ) => ({
    workItemId: scope.monitorId,
    machineId: scope.machineId,
    sourceRevision,
    state: { type: 'TASK_MONITOR' as const, projection },
  });

  const changes = (instance: Instance) =>
    instance.emitted
      .filter(({ name }) => name === 'work_item.execution_state_changed')
      .map(
        ({ event }) =>
          (event as WebSocketWorkItemExecutionStateChangedEvent).executionState,
      );

  it('delivers a report accepted on one instance to subscribers on every instance, once each and in order', async () => {
    const scope = await seed();
    const [publisherSide, viewerSide] = instances as [Instance, Instance];
    joinProject(publisherSide, scope.projectId);
    joinProject(viewerSide, scope.projectId);
    const cli = connectCli(publisherSide, scope);

    await publisherSide.gateway.handleWorkItemExecutionStateObserved(
      cli,
      observation(scope, 4, projections.failed!),
    );
    await publisherSide.gateway.handleWorkItemExecutionStateObserved(
      cli,
      observation(scope, 5, projections.running!),
    );
    await flush();

    for (const instance of instances) {
      const delivered = changes(instance);
      // Superseded notifications coalesce onto the latest record, never regress.
      expect(delivered.at(-1)).toMatchObject({
        revision: 2,
        state: { projection: projections.running },
      });
      // Each revision at most once, strictly increasing.
      const revisions = delivered.map(({ revision }) => revision);
      expect(revisions).toEqual(
        [...new Set(revisions)].sort((left, right) => left - right),
      );
    }
  });

  it('tells local subscribers when cross-instance delivery is interrupted and restored, without touching retained state', async () => {
    const scope = await seed();
    const [publisherSide, viewerSide] = instances as [Instance, Instance];
    joinProject(viewerSide, scope.projectId);
    const cli = connectCli(publisherSide, scope);
    await publisherSide.gateway.handleWorkItemExecutionStateObserved(
      cli,
      observation(scope, 1, projections.failed!),
    );
    await flush();
    const before = await prisma.db.workItemExecutionState.findUniqueOrThrow({
      where: { workItemId: scope.monitorId },
    });
    viewerSide.emitted.length = 0;

    subscriberOf(viewerSide.bus).drop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Missed while interrupted: the viewer's instance never hears of it.
    await publisherSide.gateway.handleWorkItemExecutionStateObserved(
      cli,
      observation(scope, 2, projections.completed!),
    );
    await flush();
    subscriberOf(viewerSide.bus).restore();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      viewerSide.emitted.map(({ name, event }) => ({
        name,
        delivery: (event as WebSocketWorkItemExecutionStateDeliveryChangedEvent)
          .delivery,
        projectId: event.projectId,
        organizationId: event.organizationId,
      })),
    ).toEqual([
      {
        name: 'work_item.execution_state_delivery_changed',
        delivery: 'INTERRUPTED',
        projectId: scope.projectId,
        organizationId: scope.organizationId,
      },
      {
        name: 'work_item.execution_state_delivery_changed',
        delivery: 'RESTORED',
        projectId: scope.projectId,
        organizationId: scope.organizationId,
      },
    ]);
    // The retained record moved on regardless; subscribers recover it by reading.
    const after = await prisma.db.workItemExecutionState.findUniqueOrThrow({
      where: { workItemId: scope.monitorId },
    });
    expect(Number(after.revision)).toBe(Number(before.revision) + 1);

    // Live delivery resumes for later changes.
    await publisherSide.gateway.handleWorkItemExecutionStateObserved(
      cli,
      observation(scope, 3, projections.running!),
    );
    await flush();
    expect(changes(viewerSide).at(-1)).toMatchObject({
      state: { projection: projections.running },
    });
  });

  it('keeps the retained state when its notification cannot be published, and delivers it on retry', async () => {
    const scope = await seed();
    const [publisherSide, viewerSide] = instances as [Instance, Instance];
    joinProject(viewerSide, scope.projectId);
    const cli = connectCli(publisherSide, scope);
    const publish = jest
      .spyOn(RedisMessageBus.prototype, 'publish')
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockRejectedValueOnce(new Error('redis unavailable'));

    const receipt =
      await publisherSide.gateway.handleWorkItemExecutionStateObserved(
        cli,
        observation(scope, 7, projections.failed!),
      );
    expect(receipt).toMatchObject({ outcome: 'ACCEPTED' });
    await instances[0]!.outbox['processOutboxEvents']();
    expect(changes(viewerSide)).toEqual([]);

    publish.mockRestore();
    await prisma.outboxEvent.updateMany({
      where: { status: 'FAILED' },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });
    await flush();
    expect(changes(viewerSide)).toEqual([
      expect.objectContaining({
        state: { type: 'TASK_MONITOR', projection: projections.failed },
      }),
    ]);
  });

  it('retries a change whose read fails after its notification arrived, telling subscribers they may be behind until it succeeds', async () => {
    const scope = await seed();
    const [publisherSide, viewerSide] = instances as [Instance, Instance];
    joinProject(viewerSide, scope.projectId);
    const cli = connectCli(publisherSide, scope);
    // The database rejects delivery reads for three seconds after the
    // notification is published, then recovers.
    let failReadsUntil = Number.POSITIVE_INFINITY;
    const delegate = prisma.db.workItemExecutionState;
    const findUnique = delegate.findUnique.bind(delegate);
    const read = jest
      .spyOn(delegate, 'findUnique')
      .mockImplementation(((args: Parameters<typeof findUnique>[0]) =>
        Date.now() < failReadsUntil
          ? Promise.reject(new Error('connection reset'))
          : findUnique(args)) as never);

    try {
      await publisherSide.gateway.handleWorkItemExecutionStateObserved(
        cli,
        observation(scope, 1, projections.failed!),
      );
      failReadsUntil = Date.now() + 3_000;
      await flush();
      // Reads at ~0, 0.25, 0.75 and 1.75 s fail; the one at ~3.75 s succeeds.
      await new Promise((resolve) => setTimeout(resolve, 6_000));
    } finally {
      read.mockRestore();
    }

    expect(
      viewerSide.emitted.map(({ name, event }) =>
        name === 'work_item.execution_state_delivery_changed'
          ? (event as WebSocketWorkItemExecutionStateDeliveryChangedEvent)
              .delivery
          : (event as WebSocketWorkItemExecutionStateChangedEvent)
              .executionState.state,
      ),
    ).toEqual([
      'INTERRUPTED',
      { type: 'TASK_MONITOR', projection: projections.failed },
      'RESTORED',
    ]);
  });
});
