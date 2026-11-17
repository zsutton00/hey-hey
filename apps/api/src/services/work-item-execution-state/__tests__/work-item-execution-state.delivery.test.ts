import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskMonitorStateProjection } from '@hey-hey/contracts/api/models';
import { InMemoryMessageBus } from '../../../core/events/in-memory-message-bus.service';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import {
  WorkItemExecutionStateChange,
  WorkItemExecutionStateDelivery,
} from '../work-item-execution-state.delivery';
import type { StoredExecutionState } from '../work-item-execution-state.record';

// The real delivery owner on the real in-process bus. Only the database read
// is held at the boundary, so a test decides exactly when each read returns.
const projections = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/task-monitor-state-projections.json'),
    'utf8',
  ),
) as Record<'running' | 'failed' | 'completed', TaskMonitorStateProjection>;

const WORK_ITEM_ID = '40000000-0000-4000-8000-000000000004';
const PROJECT_ID = '30000000-0000-4000-8000-000000000003';
const ORGANIZATION_ID = '20000000-0000-4000-8000-000000000002';

const row = (
  revision: number,
  projection: TaskMonitorStateProjection,
): StoredExecutionState => ({
  workItemId: WORK_ITEM_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  // Stored JSON, as Prisma returns it.
  payload: JSON.parse(JSON.stringify({ type: 'TASK_MONITOR', projection })),
  ownerMachineId: '20000000-0000-4000-8000-0000000000aa',
  sourceRevision: BigInt(revision),
  revision: BigInt(revision),
  ownerConnected: true,
  freshnessChangedAt: new Date('2026-11-16T10:00:00.000Z'),
  acceptedAt: new Date('2026-11-16T10:00:00.000Z'),
});

/** Database reads that stay pending until the test answers them. */
class HeldReads {
  private readonly waiting: Array<(value: StoredExecutionState) => void> = [];
  readonly prisma = {
    db: {
      workItemExecutionState: {
        findUnique: jest.fn(
          () =>
            new Promise<StoredExecutionState>((resolve) =>
              this.waiting.push(resolve),
            ),
        ),
      },
    },
  };

  get count(): number {
    return this.prisma.db.workItemExecutionState.findUnique.mock.calls.length;
  }

  /** Answers the oldest pending read and lets delivery act on it. */
  async answer(value: StoredExecutionState): Promise<void> {
    const resolve = this.waiting.shift();
    if (!resolve) {
      throw new Error('No read is pending');
    }
    resolve(value);
    await new Promise((settle) => setImmediate(settle));
  }
}

describe('Work item execution state delivery on one instance', () => {
  const announce = (bus: InMemoryMessageBus, revision: number) =>
    bus.publish({
      event: {
        id: `retained-${revision}`,
        type: EVENT_TYPES.WORK_ITEM_EXECUTION_STATE.RETAINED,
        aggregateId: WORK_ITEM_ID,
        payload: {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          workItemId: WORK_ITEM_ID,
          revision,
        },
      },
      timestamp: new Date().toISOString(),
    } as never);

  const start = async () => {
    const reads = new HeldReads();
    const bus = new InMemoryMessageBus();
    const delivered: WorkItemExecutionStateChange[] = [];
    const delivery = new WorkItemExecutionStateDelivery(
      reads.prisma as never,
      {} as never,
      bus,
    );
    await delivery.start({
      changed: (change) => delivered.push(change),
      subscriptionChanged: jest.fn(),
      projectDeliveryChanged: jest.fn(),
    });

    return { reads, bus, delivered };
  };

  it('reads again when a newer change is announced while a read is in flight', async () => {
    const { reads, bus, delivered } = await start();

    await announce(bus, 1);
    expect(reads.count).toBe(1);
    // The failure is resolved on the publishing instance before this read returns.
    await announce(bus, 2);
    expect(reads.count).toBe(1);

    await reads.answer(row(1, projections.failed));
    expect(reads.count).toBe(2);
    await reads.answer(row(2, projections.running));

    expect(
      delivered.map(({ executionState }) => [
        executionState.revision,
        executionState.state.projection,
      ]),
    ).toEqual([
      [1, projections.failed],
      [2, projections.running],
    ]);
    expect(reads.count).toBe(2);
  });

  it('delivers once when the in-flight read already returns the newer record', async () => {
    const { reads, bus, delivered } = await start();

    await announce(bus, 1);
    await announce(bus, 2);
    await reads.answer(row(2, projections.completed));

    expect(
      delivered.map(({ executionState }) => executionState.revision),
    ).toEqual([2]);
    expect(reads.count).toBe(1);

    // A late copy of an older announcement causes neither a read nor a resend.
    await announce(bus, 1);
    expect(reads.count).toBe(1);
    expect(delivered).toHaveLength(1);
  });
});
