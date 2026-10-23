import { describe, expect, it } from 'vitest';
import { computeActivityDelta } from '../activity-delta';
import type { ActivityRecord } from '../types';

const makeRecord = (overrides: Partial<ActivityRecord> & { entityId: string }): ActivityRecord => ({
  entityType: 'TASK' as unknown as ActivityRecord['entityType'],
  title: `Record ${overrides.entityId}`,
  timestamp: '2026-01-01T00:00:00.000Z',
  linkedEntities: [],
  reports: [],
  ...overrides,
});

describe('computeActivityDelta', () => {
  it('treats all current activity as new signals when no previous snapshot', () => {
    const current = [makeRecord({ entityId: 'a' }), makeRecord({ entityId: 'b' })];

    const delta = computeActivityDelta(current, undefined);

    expect(delta.statusChanges).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
    expect(delta.newSignals).toHaveLength(2);
    expect(delta.newSignals.map((s) => s.entityId)).toEqual(['a', 'b']);
    expect(delta.computedAt).toBeTruthy();
  });

  it('treats all current activity as new signals when previous is empty', () => {
    const current = [makeRecord({ entityId: 'a' })];

    const delta = computeActivityDelta(current, []);

    expect(delta.newSignals).toHaveLength(1);
    expect(delta.statusChanges).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
  });

  it('detects status changes between snapshots', () => {
    const previous = [makeRecord({ entityId: 'a', status: 'IN_PROGRESS' })];
    const current = [makeRecord({ entityId: 'a', status: 'IN_REVIEW' })];

    const delta = computeActivityDelta(current, previous);

    expect(delta.statusChanges).toHaveLength(1);
    expect(delta.statusChanges[0]).toMatchObject({
      entityId: 'a',
      previousStatus: 'IN_PROGRESS',
      currentStatus: 'IN_REVIEW',
    });
    expect(delta.newSignals).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
  });

  it('detects item completions', () => {
    const previous = [makeRecord({ entityId: 'a', status: 'IN_PROGRESS' })];
    const current = [makeRecord({ entityId: 'a', status: 'COMPLETED' })];

    const delta = computeActivityDelta(current, previous);

    expect(delta.statusChanges).toHaveLength(1);
    expect(delta.itemCompletions).toHaveLength(1);
    expect(delta.itemCompletions[0]).toMatchObject({
      entityId: 'a',
      title: 'Record a',
    });
  });

  it('recognizes multiple completion statuses', () => {
    for (const status of ['DONE', 'MERGED', 'CLOSED']) {
      const previous = [makeRecord({ entityId: 'x', status: 'OPEN' })];
      const current = [makeRecord({ entityId: 'x', status })];

      const delta = computeActivityDelta(current, previous);
      expect(delta.itemCompletions).toHaveLength(1);
    }
  });

  it('detects new entities not in previous snapshot', () => {
    const previous = [makeRecord({ entityId: 'a', status: 'OPEN' })];
    const current = [
      makeRecord({ entityId: 'a', status: 'OPEN' }),
      makeRecord({ entityId: 'b', status: 'NEW' }),
    ];

    const delta = computeActivityDelta(current, previous);

    expect(delta.newSignals).toHaveLength(1);
    expect(delta.newSignals[0]!.entityId).toBe('b');
    expect(delta.statusChanges).toHaveLength(0);
  });

  it('does not emit status change when status is unchanged', () => {
    const previous = [makeRecord({ entityId: 'a', status: 'OPEN' })];
    const current = [makeRecord({ entityId: 'a', status: 'OPEN' })];

    const delta = computeActivityDelta(current, previous);

    expect(delta.statusChanges).toHaveLength(0);
    expect(delta.newSignals).toHaveLength(0);
    expect(delta.itemCompletions).toHaveLength(0);
  });

  it('infers signal types from entity type', () => {
    const current = [
      makeRecord({
        entityId: 'msg-1',
        entityType: 'MESSAGE' as unknown as ActivityRecord['entityType'],
      }),
      makeRecord({
        entityId: 'rev-1',
        entityType: 'CODE_REVIEW' as unknown as ActivityRecord['entityType'],
      }),
      makeRecord({ entityId: 'task-1' }),
    ];

    const delta = computeActivityDelta(current, undefined);

    expect(delta.newSignals[0]!.signalType).toBe('new_message');
    expect(delta.newSignals[1]!.signalType).toBe('review_request');
    expect(delta.newSignals[2]!.signalType).toBe('new_activity');
  });

  it('handles mixed changes: status change, completion, and new signal', () => {
    const previous = [
      makeRecord({ entityId: 'a', status: 'IN_PROGRESS' }),
      makeRecord({ entityId: 'b', status: 'IN_REVIEW' }),
    ];
    const current = [
      makeRecord({ entityId: 'a', status: 'IN_REVIEW' }),
      makeRecord({ entityId: 'b', status: 'DONE' }),
      makeRecord({ entityId: 'c', status: 'NEW' }),
    ];

    const delta = computeActivityDelta(current, previous);

    expect(delta.statusChanges).toHaveLength(2);
    expect(delta.itemCompletions).toHaveLength(1);
    expect(delta.itemCompletions[0]!.entityId).toBe('b');
    expect(delta.newSignals).toHaveLength(1);
    expect(delta.newSignals[0]!.entityId).toBe('c');
  });
});
