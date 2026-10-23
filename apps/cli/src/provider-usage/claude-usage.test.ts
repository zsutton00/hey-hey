import { expect, it, vi } from 'vitest';
import type { UsageData } from '../agent-runtime/index';
import { readClaudeUsage } from './claude-usage';

const now = () => new Date('2026-10-13T23:35:00.000Z');
const unreported = {
  status: 'unreported',
  usage: { provider: 'claude', observedAt: null, fiveHour: null, weekly: null },
};
const subscriber = (rateLimits: UsageData['rate_limits']): UsageData => ({
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: rateLimits,
});

it('maps five_hour and seven_day to the 5-hour and weekly slots', async () => {
  const reading = await readClaudeUsage(
    async () =>
      subscriber({
        five_hour: { utilization: 23, resets_at: '2026-10-14T03:00:00.000000+00:00' },
        seven_day: { utilization: 0, resets_at: '2026-10-19T14:00:00+00:00' },
      }),
    undefined,
    1_000,
    now,
  );

  expect(reading).toEqual({
    status: 'reported',
    usage: {
      provider: 'claude',
      observedAt: '2026-10-13T23:35:00.000Z',
      fiveHour: { usedPercent: 23, resetsAt: '2026-10-14T03:00:00.000Z' },
      weekly: { usedPercent: 0, resetsAt: '2026-10-19T14:00:00.000Z' },
    },
  });
});

it('never presents a window whose reset time has passed, and keeps missing figures null', async () => {
  const reading = await readClaudeUsage(
    async () =>
      subscriber({
        five_hour: { utilization: null, resets_at: null },
        seven_day: { utilization: 85, resets_at: '2026-10-12T14:00:00Z' },
      }),
    undefined,
    1_000,
    now,
  );

  expect(reading.usage).toMatchObject({
    fiveHour: { usedPercent: null, resetsAt: null },
    weekly: null,
  });
});

it('reports nothing when plan limits do not apply to the account', async () => {
  await expect(
    readClaudeUsage(
      async () => ({ subscription_type: null, rate_limits_available: false, rate_limits: null }),
      undefined,
      1_000,
      now,
    ),
  ).resolves.toEqual(unreported);
});

it('reports nothing when Claude Code refuses or the reply fails validation', async () => {
  await expect(
    readClaudeUsage(async () => {
      throw new Error('get_usage is not supported in this context');
    }),
  ).resolves.toEqual(unreported);
});

it('reports nothing and aborts the request when Claude Code does not answer in time', async () => {
  vi.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const pending = readClaudeUsage(
      (received) => {
        signal = received;
        return new Promise<never>(() => {});
      },
      undefined,
      50,
    );
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toEqual(unreported);
    expect(signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
