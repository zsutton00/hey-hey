import { EntityType, RecentActivityCorrelationRecordDto } from 'src/generated';
import { computeActivityDelta } from '../activity-delta.util';

function makeRecord(
  overrides: Partial<RecentActivityCorrelationRecordDto> & {
    entityId: string;
  },
): RecentActivityCorrelationRecordDto {
  return {
    entityType: EntityType.Task,
    title: `Record ${overrides.entityId}`,
    timestamp: '2026-03-16T10:00:00Z',
    linkedEntities: [],
    reports: [],
    ...overrides,
  };
}

describe('computeActivityDelta', () => {
  it('treats all current activity as new signals when no previous snapshot exists', () => {
    const current = [
      makeRecord({ entityId: 'a', status: 'IN_PROGRESS' }),
      makeRecord({ entityId: 'b', status: 'TODO' }),
    ];

    const delta = computeActivityDelta(current, undefined);

    expect(delta.statusChanges).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
    expect(delta.newSignals).toHaveLength(2);
    expect(delta.newSignals[0]!.entityId).toBe('a');
    expect(delta.newSignals[1]!.entityId).toBe('b');
    expect(delta.computedAt).toBeDefined();
  });

  it('treats all current activity as new signals when previous snapshot is empty', () => {
    const current = [makeRecord({ entityId: 'a' })];

    const delta = computeActivityDelta(current, []);

    expect(delta.newSignals).toHaveLength(1);
    expect(delta.statusChanges).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
  });

  it('detects status changes between snapshots', () => {
    const previous = [makeRecord({ entityId: 'a', status: 'TODO' })];
    const current = [makeRecord({ entityId: 'a', status: 'IN_PROGRESS' })];

    const delta = computeActivityDelta(current, previous);

    expect(delta.statusChanges).toHaveLength(1);
    expect(delta.statusChanges[0]).toMatchObject({
      entityId: 'a',
      previousStatus: 'TODO',
      currentStatus: 'IN_PROGRESS',
    });
    expect(delta.newSignals).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
  });

  it('detects item completions when status transitions to COMPLETED', () => {
    const previous = [makeRecord({ entityId: 'a', status: 'IN_PROGRESS' })];
    const current = [
      makeRecord({
        entityId: 'a',
        status: 'COMPLETED',
        updatedAt: '2026-03-16T11:00:00Z',
      }),
    ];

    const delta = computeActivityDelta(current, previous);

    expect(delta.statusChanges).toHaveLength(1);
    expect(delta.itemCompletions).toHaveLength(1);
    expect(delta.itemCompletions[0]).toMatchObject({
      entityId: 'a',
      completedAt: '2026-03-16T11:00:00Z',
    });
  });

  it('detects item completions for DONE, MERGED, and CLOSED statuses', () => {
    const previous = [
      makeRecord({ entityId: 'a', status: 'IN_PROGRESS' }),
      makeRecord({ entityId: 'b', status: 'IN_REVIEW' }),
      makeRecord({ entityId: 'c', status: 'OPEN' }),
    ];
    const current = [
      makeRecord({ entityId: 'a', status: 'DONE' }),
      makeRecord({ entityId: 'b', status: 'MERGED' }),
      makeRecord({ entityId: 'c', status: 'CLOSED' }),
    ];

    const delta = computeActivityDelta(current, previous);

    expect(delta.itemCompletions).toHaveLength(3);
  });

  it('identifies new entities as new signals', () => {
    const previous = [makeRecord({ entityId: 'a', status: 'TODO' })];
    const current = [
      makeRecord({ entityId: 'a', status: 'TODO' }),
      makeRecord({ entityId: 'b', status: 'IN_PROGRESS' }),
    ];

    const delta = computeActivityDelta(current, previous);

    expect(delta.newSignals).toHaveLength(1);
    expect(delta.newSignals[0]!.entityId).toBe('b');
    expect(delta.statusChanges).toHaveLength(0);
  });

  it('reports no changes when snapshots are identical', () => {
    const records = [
      makeRecord({ entityId: 'a', status: 'IN_PROGRESS' }),
      makeRecord({ entityId: 'b', status: 'TODO' }),
    ];

    const delta = computeActivityDelta(records, records);

    expect(delta.statusChanges).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
    expect(delta.newSignals).toHaveLength(0);
  });

  it('returns empty delta when both current and previous are empty', () => {
    const delta = computeActivityDelta([], []);

    expect(delta.statusChanges).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
    expect(delta.newSignals).toHaveLength(0);
    expect(delta.computedAt).toBeDefined();
  });

  it('skips entities with no status in either snapshot', () => {
    const previous = [makeRecord({ entityId: 'a' })];
    const current = [makeRecord({ entityId: 'a' })];

    const delta = computeActivityDelta(current, previous);

    expect(delta.statusChanges).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
    expect(delta.newSignals).toHaveLength(0);
  });

  it('sets computedAt to a valid ISO timestamp', () => {
    const delta = computeActivityDelta([], undefined);

    expect(() => new Date(delta.computedAt)).not.toThrow();
    expect(new Date(delta.computedAt).toISOString()).toBe(delta.computedAt);
  });

  it('uses updatedAt for changedAt when available', () => {
    const previous = [makeRecord({ entityId: 'a', status: 'TODO' })];
    const current = [
      makeRecord({
        entityId: 'a',
        status: 'IN_PROGRESS',
        updatedAt: '2026-03-16T12:00:00Z',
      }),
    ];

    const delta = computeActivityDelta(current, previous);

    expect(delta.statusChanges[0]!.changedAt).toBe('2026-03-16T12:00:00Z');
  });

  it('preserves entity title and type in status changes', () => {
    const previous = [
      makeRecord({
        entityId: 'a',
        entityType: EntityType.AgentSession,
        title: 'Auth middleware session',
        status: 'IN_PROGRESS',
      }),
    ];
    const current = [
      makeRecord({
        entityId: 'a',
        entityType: EntityType.AgentSession,
        title: 'Auth middleware session',
        status: 'COMPLETED',
      }),
    ];

    const delta = computeActivityDelta(current, previous);

    expect(delta.statusChanges[0]).toMatchObject({
      entityType: EntityType.AgentSession,
      title: 'Auth middleware session',
    });
    expect(delta.itemCompletions[0]).toMatchObject({
      entityType: EntityType.AgentSession,
      title: 'Auth middleware session',
    });
  });
});
