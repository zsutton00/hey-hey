import { expect, it } from 'vitest';
import { resetTimestamp, unreportedUsage, windowKey } from './provider-usage';
it('maps only exact durations and converts Unix seconds preserving absence', () => {
  expect([300, 10080, 15, 0].map(windowKey)).toEqual(['fiveHour', 'weekly', null, null]);
  expect(resetTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  expect(resetTimestamp(null)).toBeNull();
  expect(resetTimestamp(Number.MAX_VALUE)).toBeNull();
  expect(unreportedUsage('opencode')).toEqual({
    provider: 'opencode',
    observedAt: null,
    fiveHour: null,
    weekly: null,
  });
});
