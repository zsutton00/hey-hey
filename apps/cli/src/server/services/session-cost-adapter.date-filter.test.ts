import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionCostAdapter } from './session-cost-adapter';

const sessionAt = (date: string, suffix = '000000000000'): string => {
  const timestamp = Date.parse(date).toString(16).padStart(12, '0');
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7000-8000-${suffix}`;
};
const selected = (providerSessionId: string) => ({
  providerId: 'codex' as const,
  providerSessionId,
});
const report = (ids: string[]) =>
  JSON.stringify({
    sessions: ids.map((id) => ({ sessionId: `2026/09/28/rollout-${id}`, costUSD: 2.5 })),
  });

afterEach(() => vi.useRealTimers());

describe('Codex report date scope', () => {
  it('shares equivalent batch scopes regardless of input order or duplicate selections', async () => {
    const a = sessionAt('2026-09-28T00:01:00Z');
    const b = sessionAt('2026-09-28T23:59:00Z');
    const reader = vi.fn(async () => report([a, b]));
    const first = new SessionCostAdapter(reader);
    const second = new SessionCostAdapter(reader);
    await Promise.all([
      first.readBatch([selected(a), selected(b)]),
      second.readBatch([selected(b), selected(a), selected(a)]),
    ]);
    expect(reader).toHaveBeenCalledExactlyOnceWith('codex', '2026-09-28', { sessionIds: [a, b] });
  });
  it('uses creation day in UTC even for a session resumed months later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T22:00:00Z'));
    const id = sessionAt('2026-08-13T00:01:00Z');
    const reader = vi.fn(async () => report([id]));
    expect(await new SessionCostAdapter(reader).read(selected(id))).toMatchObject({
      amountUsd: 2.5,
    });
    expect(reader).toHaveBeenCalledWith('codex', '2026-08-13', { sessionIds: [id] });
  });

  it('uses the earliest requested Codex creation day for batch totals', async () => {
    const early = sessionAt('2026-08-13T23:59:00Z');
    const late = sessionAt('2026-09-28T00:01:00Z');
    const reader = vi.fn(async () => report([early, late]));
    const result = await new SessionCostAdapter(reader).readBatch([
      selected(late),
      selected(early),
    ]);
    expect(result.costs).toEqual([
      expect.objectContaining({ amountUsd: 2.5 }),
      expect.objectContaining({ amountUsd: 2.5 }),
    ]);
    expect(reader).toHaveBeenCalledExactlyOnceWith('codex', '2026-08-13', {
      sessionIds: [early, late],
    });
  });

  it.each([null, 'legacy', '12345678-1234-4000-8000-000000000000'])(
    'keeps unknown creation dates unfiltered (%s)',
    async (id) => {
      const recent = sessionAt('2026-09-28T00:01:00Z');
      const reader = vi.fn(async () => report([recent]));
      await new SessionCostAdapter(reader).readBatch([
        selected(recent),
        { providerId: 'codex', providerSessionId: id },
      ]);
      expect(reader).toHaveBeenCalledExactlyOnceWith('codex', undefined, {
        sessionIds: [recent, ...(id ? [id] : [])].sort(),
      });
    },
  );

  it('coalesces identical selections but separates other sessions and date scopes', async () => {
    const a = sessionAt('2026-09-28T00:01:00Z');
    const b = sessionAt('2026-09-28T23:59:00Z');
    const old = sessionAt('2026-08-13T00:01:00Z');
    const reader = vi.fn(async () => report([a, b, old, 'legacy']));
    const first = new SessionCostAdapter(reader);
    const second = new SessionCostAdapter(reader);
    await Promise.all([first.read(selected(a)), second.read(selected(a))]);
    expect(reader).toHaveBeenCalledTimes(1);
    await first.read(selected(b));
    await first.read(selected(old));
    await first.read(selected('legacy'));
    expect(reader.mock.calls).toEqual([
      ['codex', '2026-09-28', { sessionIds: [a] }],
      ['codex', '2026-09-28', { sessionIds: [b] }],
      ['codex', '2026-08-13', { sessionIds: [old] }],
      ['codex', undefined, { sessionIds: ['legacy'] }],
    ]);
  });

  it('does not apply Codex timestamp interpretation to Claude IDs', async () => {
    const id = sessionAt('2026-09-28T00:01:00Z');
    const reader = vi.fn(async () => JSON.stringify({ sessions: [{ sessionId: id, costUSD: 0 }] }));
    expect(
      await new SessionCostAdapter(reader).read({ providerId: 'claude', providerSessionId: id }),
    ).toMatchObject({ amountUsd: 0 });
    expect(reader).toHaveBeenCalledExactlyOnceWith('claude');
  });
});
