import { describe, expect, it } from 'vitest';
import { CountToNGate, EveryEventGate } from './gate';
import type { CanonicalMonitorEvent } from '../normalizer';

const makeEvent = (eventType: string): CanonicalMonitorEvent => ({
  eventType,
  timestamp: '2026-06-15T00:00:00.000Z',
  origin: 'platform',
});

describe('CountToNGate', () => {
  it('does not fire before the Nth event is accepted', () => {
    const gate = new CountToNGate(3);
    expect(gate.accept(makeEvent('a'))).toEqual({ fired: false, batch: [] });
    expect(gate.accept(makeEvent('b'))).toEqual({ fired: false, batch: [] });
  });

  it('fires exactly when the Nth event is accepted and drains the accumulated batch', () => {
    const gate = new CountToNGate(3);
    gate.accept(makeEvent('a'));
    gate.accept(makeEvent('b'));
    const result = gate.accept(makeEvent('c'));
    expect(result.fired).toBe(true);
    expect(result.batch.map((e) => e.eventType)).toEqual(['a', 'b', 'c']);
  });

  it('resets accumulation after firing', () => {
    const gate = new CountToNGate(2);
    gate.accept(makeEvent('a'));
    const first = gate.accept(makeEvent('b'));
    expect(first.fired).toBe(true);
    expect(first.batch).toHaveLength(2);

    const next = gate.accept(makeEvent('c'));
    expect(next).toEqual({ fired: false, batch: [] });

    const second = gate.accept(makeEvent('d'));
    expect(second.fired).toBe(true);
    expect(second.batch.map((e) => e.eventType)).toEqual(['c', 'd']);
  });
});

describe('EveryEventGate', () => {
  it('fires on every accepted event with that single event as the batch', () => {
    const gate = new EveryEventGate();
    const a = makeEvent('a');
    const b = makeEvent('b');

    const ra = gate.accept(a);
    expect(ra.fired).toBe(true);
    expect(ra.batch).toEqual([a]);

    const rb = gate.accept(b);
    expect(rb.fired).toBe(true);
    expect(rb.batch).toEqual([b]);
  });
});
