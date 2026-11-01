import { RedisMemoryServer } from 'redis-memory-server';
import { RedisMessageBus } from '../../../core/events/redis-message-bus.service';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import type { EventEnvelope } from '../../../core/events/types/event-envelope';
import type { PrismaService } from '../../../prisma/prisma.service';
import { buildBuiltInWorkItemTypeRows } from '../../../../test/setup/work-item-type-registry.fixture';
import { WorkItemTypeGuidancePurpose } from '../../../generated/model/workItemTypeGuidancePurpose';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';

// Redis is real; database reads use an explicitly committed in-memory view.
describe('Registry Redis broadcast and recovery', () => {
  let server: RedisMemoryServer;
  const buses: RedisMessageBus[] = [];
  const registries: WorkItemTypeRegistryService[] = [];
  const projectId = 'registry-redis-project';

  afterAll(async () => {
    await Promise.all(registries.map((registry) => registry.onModuleDestroy()));
    await Promise.all(buses.map((bus) => bus.onModuleDestroy()));
    await server?.stop();
  });

  it('broadcasts repeated changes and recovers a peer that misses a notification', async () => {
    server = new RedisMemoryServer({
      spawn: { env: { ...process.env, LC_ALL: 'C' } },
    });
    const url = `redis://${await server.getHost()}:${await server.getPort()}`;
    let committedRows = buildBuiltInWorkItemTypeRows(projectId);
    const findMany = jest.fn(async () =>
      committedRows.map((row) => ({ ...row })),
    );
    const prisma = {
      $queryRaw: async () => [
        { projectId: null, fingerprint: 'empty' },
        { projectId, fingerprint: JSON.stringify(committedRows) },
      ],
      project: { findMany: async () => [{ id: projectId }] },
      workItemType: {
        findMany,
      },
      workItemTypeTemplate: { findMany: async () => [] },
    } as unknown as PrismaService;
    const warmedAt = Date.now();
    for (let i = 0; i < 2; i++) {
      const bus = new RedisMessageBus(url);
      buses.push(bus);
      const registry = new WorkItemTypeRegistryService(prisma, bus);
      registries.push(registry);
      await registry.onModuleInit(); // Includes subscription acknowledgement.
    }
    const envelope = {
      event: {
        type: EVENT_TYPES.WORK_ITEM_TYPE.CONFIG_CHANGED,
        aggregateId: projectId,
        payload: { projectId },
      },
      timestamp: new Date(0).toISOString(),
    } as EventEnvelope;
    const waitForName = async (name: string, timeout: number) => {
      const deadline = Date.now() + timeout;
      while (
        registries.some(
          (registry) =>
            registry.getDefinition(projectId, 'STANDARD')?.definition.name !==
            name,
        ) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      for (const registry of registries) {
        expect(
          registry.getDefinition(projectId, 'STANDARD')?.definition.name,
        ).toBe(name);
        expect(() =>
          registry.assertTypeActive('STANDARD', projectId),
        ).not.toThrow();
        expect(
          registry.getGuidance(
            projectId,
            'STANDARD',
            WorkItemTypeGuidancePurpose.Maintenance,
          ).maintenanceGuidance,
        ).toBe(name);
      }
    };
    const commit = (name: string) => {
      committedRows = committedRows.map((row) =>
        row.typeKey === 'STANDARD'
          ? { ...row, name, maintenanceGuidance: name }
          : row,
      );
    };
    for (const name of ['First change', 'Second change']) {
      commit(name);
      await buses[0]!.publish(envelope); // Identical envelope must still broadcast.
      await waitForName(name, 1000);
      expect(findMany).toHaveBeenLastCalledWith({
        where: { projectId: { in: [projectId] } },
      });
    }
    expect(Date.now() - warmedAt).toBeLessThan(5000);

    // Close the second transport but leave its registry and recovery timer alive.
    const disconnected = buses.pop()!;
    await disconnected.onModuleDestroy();
    commit('Recovered missed notification');
    await buses[0]!.publish(envelope);
    expect(
      registries[1]!.getDefinition(projectId, 'STANDARD')?.definition.name,
    ).toBe('Second change');
    await waitForName('Recovered missed notification', 6000);
  }, 15000);
});
