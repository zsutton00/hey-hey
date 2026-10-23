import type { AgenticSessionEvent, ProviderSessionHistoryEntry } from '../session/types';
import type { DurableRunEvent } from './durable-events';

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const isRealProviderSessionId = (value: string): boolean => !value.startsWith('pending_');

const normalizeEntry = (value: unknown): ProviderSessionHistoryEntry | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const providerSessionId = readNonEmptyString(record['providerSessionId']);
  const observedAt = readNonEmptyString(record['observedAt']);
  if (!providerSessionId || !isRealProviderSessionId(providerSessionId) || !observedAt) return null;
  return {
    providerSessionId,
    providerConversationId: readNonEmptyString(record['providerConversationId']),
    providerSessionAgentId: readNonEmptyString(record['providerSessionAgentId']),
    observedAt,
  };
};

export const normalizeProviderSessionHistory = (value: unknown): ProviderSessionHistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.reduce<ProviderSessionHistoryEntry[]>((history, candidate) => {
    const entry = normalizeEntry(candidate);
    return entry ? appendProviderSessionHistoryEntry(history, entry) : history;
  }, []);
};

export const appendProviderSessionHistoryEntry = (
  history: readonly ProviderSessionHistoryEntry[],
  entry: ProviderSessionHistoryEntry,
): ProviderSessionHistoryEntry[] => {
  if (
    !isRealProviderSessionId(entry.providerSessionId) ||
    history.some(({ providerSessionId }) => providerSessionId === entry.providerSessionId)
  ) {
    return [...history];
  }
  return [...history, entry];
};

const hasProviderSessionMembership = (
  history: readonly ProviderSessionHistoryEntry[],
  providerSessionId: string,
): boolean => history.some((entry) => entry.providerSessionId === providerSessionId);

/**
 * The latest member whose owning handler counts for context. An entry with no
 * agent id predates subagent membership and is Run-owned, so it counts.
 */
export const latestContextProviderSession = (
  history: readonly ProviderSessionHistoryEntry[],
  countsForContext: (providerSessionAgentId: string) => boolean,
): ProviderSessionHistoryEntry | null => {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (
      entry &&
      (entry.providerSessionAgentId === null || countsForContext(entry.providerSessionAgentId))
    ) {
      return entry;
    }
  }
  return null;
};

const eventIdentity = (
  event: AgenticSessionEvent,
): Omit<ProviderSessionHistoryEntry, 'observedAt'> | null => {
  const payload = event.payload;
  if (!payload) return null;
  if (event.event_type === 'run_started' || event.event_type === 'run_completed') {
    const providerSessionId = readNonEmptyString(
      'provider_session_id' in payload ? payload.provider_session_id : null,
    );
    if (!providerSessionId || !isRealProviderSessionId(providerSessionId)) return null;
    return {
      providerSessionId,
      providerConversationId: readNonEmptyString(
        'provider_conversation_id' in payload ? payload.provider_conversation_id : null,
      ),
      providerSessionAgentId: null,
    };
  }
  return null;
};

const reconcileProviderSessionHistory = (
  history: readonly ProviderSessionHistoryEntry[],
  events: readonly AgenticSessionEvent[],
): ProviderSessionHistoryEntry[] =>
  events.reduce<ProviderSessionHistoryEntry[]>(
    (reconciled, event) => {
      const identity = eventIdentity(event);
      return identity
        ? appendProviderSessionHistoryEntry(reconciled, { ...identity, observedAt: event.ts })
        : reconciled;
    },
    [...history],
  );

const durableEventIdentity = (
  event: DurableRunEvent,
): Omit<ProviderSessionHistoryEntry, 'observedAt'> | null => {
  if (event.payload.kind === 'provider_identity_observed') {
    return {
      providerSessionId: event.payload.providerSessionId,
      providerConversationId: event.payload.providerConversationId,
      providerSessionAgentId: event.payload.providerSessionAgentId,
    };
  }
  if (event.payload.kind === 'run_started' || event.payload.kind === 'run_completed') {
    const providerSessionId = event.payload.providerSessionId;
    if (!providerSessionId || !isRealProviderSessionId(providerSessionId)) return null;
    return {
      providerSessionId,
      providerConversationId: event.payload.providerConversationId,
      providerSessionAgentId: event.payload.providerSessionAgentId,
    };
  }
  return null;
};

export const reconcileDurableProviderSessionHistory = (
  history: readonly ProviderSessionHistoryEntry[],
  events: readonly DurableRunEvent[],
): ProviderSessionHistoryEntry[] =>
  events.reduce<ProviderSessionHistoryEntry[]>(
    (reconciled, event) => {
      const identity = durableEventIdentity(event);
      return identity
        ? appendProviderSessionHistoryEntry(reconciled, { ...identity, observedAt: event.ts })
        : reconciled;
    },
    [...history],
  );
