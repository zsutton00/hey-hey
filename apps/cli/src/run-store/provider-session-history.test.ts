import { describe, expect, it } from 'vitest';
import type { ProviderSessionHistoryEntry } from '../session/types';
import { latestContextProviderSession } from './provider-session-history';

const entry = (
  providerSessionId: string,
  providerSessionAgentId: string | null,
): ProviderSessionHistoryEntry => ({
  providerSessionId,
  providerConversationId: null,
  providerSessionAgentId,
  observedAt: '2026-10-05T00:00:00.000Z',
});

const COUNTED = new Set(['coding_freeform', 'startup_session']);
const countsForContext = (agentId: string) => COUNTED.has(agentId);

describe('latestContextProviderSession', () => {
  it('returns the latest member whose handler counts for context', () => {
    const history = [
      entry('implementer', 'coding_freeform'),
      entry('coding-plan', 'startup_session'),
      entry('reviewer', 'code_review'),
      entry('committer', 'commit'),
    ];
    expect(latestContextProviderSession(history, countsForContext)?.providerSessionId).toBe(
      'coding-plan',
    );
  });

  it('counts a legacy entry with no owning handler as Run-owned', () => {
    const history = [entry('implementer', 'coding_freeform'), entry('legacy', null)];
    expect(latestContextProviderSession(history, countsForContext)?.providerSessionId).toBe(
      'legacy',
    );
  });

  it('skips a member whose handler is not counted or no longer registered', () => {
    const history = [
      entry('implementer', 'coding_freeform'),
      entry('reviewer', 'code_review'),
      entry('retired', 'retired_handler'),
    ];
    expect(latestContextProviderSession(history, countsForContext)?.providerSessionId).toBe(
      'implementer',
    );
  });

  it('returns null when no member counts for context', () => {
    expect(latestContextProviderSession([], countsForContext)).toBeNull();
    expect(
      latestContextProviderSession([entry('reviewer', 'code_review')], countsForContext),
    ).toBeNull();
  });
});
