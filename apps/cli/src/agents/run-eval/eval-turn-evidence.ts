import type { EvalCost, EvalMeasurement } from '@hey-hey/contracts/api/models';
import type { SubAgentUsage } from '../../run/subagent';

/** What a Run's cumulative counters showed once a Turn had settled. */
export interface TurnReading {
  /** The provider session the counters belong to; they restart when it rotates. */
  providerSessionId: string | null;
  usage: SubAgentUsage;
  cost: EvalCost;
  /** Tool calls the Run had retained in total. */
  toolCallCount: number;
  /** Memos the Run held in total. */
  memoCount: number;
}

const COUNTER_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheReadInputTokens',
  'cacheCreationInputTokens',
  'toolCalls',
] as const;

interface AttributedMeasurement {
  measurement: EvalMeasurement;
  /** True when some usage could not be tied to this Turn alone. */
  partial: boolean;
}

const attributeCost = (
  previous: EvalCost | undefined,
  current: EvalCost,
  sameSession: boolean,
): { cost: EvalCost; partial: boolean } => {
  if (current.state === 'unavailable') {
    return { cost: current, partial: false };
  }
  if (previous === undefined) {
    return { cost: current, partial: current.state === 'partial' };
  }
  if (!sameSession) {
    // A new provider session starts at this Turn; the old one's share is not ours to count again.
    return { cost: current, partial: true };
  }
  if (previous.state === 'unavailable') {
    return { cost: { state: 'unavailable' }, partial: true };
  }
  const amount = current.amount - previous.amount;
  if (amount < 0) {
    return { cost: { state: 'unavailable' }, partial: true };
  }

  return {
    cost: { state: 'available', amount, currency: current.currency },
    partial: previous.state === 'partial' || current.state === 'partial',
  };
};

/**
 * The time, tokens and cost one Turn is responsible for. Provider counters are
 * cumulative per provider session, so a Turn's share is the difference between
 * two settled readings of the same session. After a rotation the new session's
 * counters begin with this Turn, and the result is labelled partial. A value
 * the provider did not report is left out, never zero.
 */
export const attributeTurnMeasurement = (
  previous: TurnReading | undefined,
  current: TurnReading,
  elapsedMs: number,
): AttributedMeasurement => {
  const sameSession =
    previous !== undefined &&
    previous.providerSessionId !== null &&
    previous.providerSessionId === current.providerSessionId;
  let partial = previous !== undefined && !sameSession;
  const measurement: EvalMeasurement = { scope: 'TARGET_HANDLER', elapsedMs };

  for (const field of COUNTER_FIELDS) {
    const now = current.usage[field];
    if (now === undefined) {
      continue;
    }
    if (previous === undefined || !sameSession) {
      measurement[field] = now;
      continue;
    }
    const before = previous.usage[field] ?? 0;
    if (now < before) {
      partial = true;
      continue;
    }
    measurement[field] = now - before;
  }

  const cost = attributeCost(previous?.cost, current.cost, sameSession);
  measurement.cost = cost.cost;

  return { measurement, partial: partial || cost.partial };
};
