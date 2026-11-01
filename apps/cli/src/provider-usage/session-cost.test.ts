import { describe, expect, it, vi } from 'vitest';
import type { ServerLogger } from '../server/logger';
import { SessionCostReader } from './session-cost';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as ServerLogger;

const readerFor = (ccusageJson: () => Promise<string>) =>
  new SessionCostReader(logger, ccusageJson);

describe('SessionCostReader', () => {
  it('reads a Claude or Codex session cost from ccusage', async () => {
    const reader = readerFor(async () =>
      JSON.stringify({ sessions: [{ sessionId: 's1', totalCost: 0.42 }] }),
    );

    expect(await reader.read('claude', 's1')).toEqual({
      state: 'available',
      amount: 0.42,
      currency: 'USD',
    });
  });

  it('reports not reported, never zero, when ccusage fails or the session is unknown', async () => {
    const failing = readerFor(async () => {
      throw new Error('ccusage exploded');
    });
    const empty = readerFor(async () => JSON.stringify({ sessions: [] }));

    expect(await failing.read('claude', 's1')).toEqual({ state: 'unavailable' });
    expect(await empty.read('claude', 's1')).toEqual({ state: 'unavailable' });
  });

  it.each([
    ['opencode', 's1'],
    ['claude', null],
    ['claude', 'pending_abc'],
  ])('never calls ccusage for %s session %s', async (provider, sessionId) => {
    const ccusage = vi.fn(async () => '{}');

    expect(await readerFor(ccusage).read(provider, sessionId)).toEqual({ state: 'unavailable' });
    expect(ccusage).not.toHaveBeenCalled();
  });

  it('reads each session as it finished, never from a report cached before it completed', async () => {
    let cost = 0.1;
    const reader = readerFor(async () =>
      JSON.stringify({ sessions: [{ sessionId: 's1', totalCost: cost }] }),
    );

    expect(await reader.read('claude', 's1')).toMatchObject({ amount: 0.1 });
    cost = 0.9;
    expect(await reader.read('claude', 's1')).toMatchObject({ amount: 0.9 });
  });
});
