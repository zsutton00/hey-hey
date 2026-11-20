import { describe, expect, it } from 'vitest';
import { attributeTurnMeasurement, type TurnReading } from './eval-turn-evidence';

const reading = (
  input: number,
  cost: number | null,
  providerSessionId = 'session-a',
): TurnReading => ({
  providerSessionId,
  usage: { inputTokens: input, outputTokens: 1 },
  cost:
    cost === null
      ? { state: 'unavailable' }
      : { state: 'available', amount: cost, currency: 'USD' },
  toolCallCount: 0,
  memoCount: 0,
});

describe('attributing cumulative provider counters to one message', () => {
  it('takes the difference between two readings of the same provider session', () => {
    const { measurement, partial } = attributeTurnMeasurement(
      reading(300, 1.5),
      reading(450, 2),
      1200,
    );

    expect(measurement).toMatchObject({
      elapsedMs: 1200,
      inputTokens: 150,
      cost: { state: 'available', amount: 0.5 },
    });
    expect(partial).toBe(false);
  });

  it('does not count the old session again after a rotation, and labels the result partial', () => {
    const { measurement, partial } = attributeTurnMeasurement(
      reading(900, 4),
      reading(80, 0.4, 'session-b'),
      10,
    );

    expect(measurement.inputTokens).toBe(80);
    expect(measurement.cost).toEqual({ state: 'available', amount: 0.4, currency: 'USD' });
    expect(partial).toBe(true);
  });

  it('leaves values the provider did not report absent instead of zero', () => {
    const { measurement } = attributeTurnMeasurement(
      reading(10, 1),
      { ...reading(10, null), usage: {} },
      5,
    );

    expect(measurement).not.toHaveProperty('inputTokens');
    expect(measurement.cost).toEqual({ state: 'unavailable' });
  });
});
