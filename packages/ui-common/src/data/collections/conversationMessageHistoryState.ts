/**
 * Progress of loading older messages for one conversation. Which older
 * messages remain is not tracked here: the continuation lives with the
 * message list in the GraphQL cache. This only reports that a load is running
 * or failed, and keeps concurrent callers on one load.
 */
export interface ConversationMessageHistorySnapshot {
  isLoadingOlder: boolean;
  error: Error | null;
}

const IDLE_SNAPSHOT: ConversationMessageHistorySnapshot = {
  isLoadingOlder: false,
  error: null,
};

const snapshots = new Map<string, ConversationMessageHistorySnapshot>();
const listeners = new Map<string, Set<() => void>>();
const inFlightLoads = new Map<string, Promise<void>>();

export const buildConversationMessageHistoryKey = (params: {
  organizationId: string;
  projectId: string;
  conversationId: string;
}): string =>
  `${params.organizationId}:${params.projectId}:${params.conversationId}`;

export const getConversationMessageHistorySnapshot = (
  key: string,
): ConversationMessageHistorySnapshot => snapshots.get(key) ?? IDLE_SNAPSHOT;

export const subscribeConversationMessageHistory = (
  key: string,
  listener: () => void,
): (() => void) => {
  const keyListeners = listeners.get(key) ?? new Set<() => void>();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);

  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size === 0) {
      listeners.delete(key);
    }
  };
};

const setSnapshot = (
  key: string,
  snapshot: ConversationMessageHistorySnapshot,
): void => {
  snapshots.set(key, snapshot);
  listeners.get(key)?.forEach((listener) => listener());
};

export const loadOlderConversationMessageHistory = (
  key: string,
  load: () => Promise<void>,
): Promise<void> => {
  const existing = inFlightLoads.get(key);
  if (existing) {
    return existing;
  }

  setSnapshot(key, { isLoadingOlder: true, error: null });

  const request = load()
    .then(() => setSnapshot(key, IDLE_SNAPSHOT))
    .catch((cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      setSnapshot(key, { isLoadingOlder: false, error });
      throw error;
    })
    .finally(() => {
      inFlightLoads.delete(key);
    });

  inFlightLoads.set(key, request);

  return request;
};

export const resetConversationMessageHistoryStateForTests = (): void => {
  snapshots.clear();
  listeners.clear();
  inFlightLoads.clear();
};
