export interface ConversationMessageHistorySnapshot {
  nextCursor: string | null;
  isLoadingOlder: boolean;
  error: Error | null;
  initialized: boolean;
}

const EMPTY_SNAPSHOT: ConversationMessageHistorySnapshot = {
  nextCursor: null,
  isLoadingOlder: false,
  error: null,
  initialized: false,
};

const snapshots = new Map<string, ConversationMessageHistorySnapshot>();
const listeners = new Map<string, Set<() => void>>();
const inFlightLoads = new Map<string, Promise<void>>();
const pendingOlderCursors = new Map<string, string>();

export const buildConversationMessageHistoryKey = (params: {
  organizationId: string;
  projectId: string;
  conversationId: string;
}): string =>
  `${params.organizationId}:${params.projectId}:${params.conversationId}`;

export const getConversationMessageHistorySnapshot = (
  key: string
): ConversationMessageHistorySnapshot => snapshots.get(key) ?? EMPTY_SNAPSHOT;

export const subscribeConversationMessageHistory = (
  key: string,
  listener: () => void
): (() => void) => {
  const keyListeners = listeners.get(key) ?? new Set<() => void>();
  keyListeners.add(listener);
  listeners.set(key, keyListeners);
  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size === 0) listeners.delete(key);
  };
};

const setSnapshot = (
  key: string,
  update: (
    current: ConversationMessageHistorySnapshot
  ) => ConversationMessageHistorySnapshot
): void => {
  snapshots.set(key, update(getConversationMessageHistorySnapshot(key)));
  listeners.get(key)?.forEach((listener) => listener());
};

export const recordInitialConversationMessageHistoryPage = (
  key: string,
  nextCursor: string | undefined
): void => {
  pendingOlderCursors.delete(key);
  setSnapshot(key, () => ({
    nextCursor: nextCursor ?? null,
    isLoadingOlder: false,
    error: null,
    initialized: true,
  }));
};

export const getPendingOlderConversationMessageCursor = (
  key: string
): string | null => pendingOlderCursors.get(key) ?? null;

export const recordOlderConversationMessageHistoryPage = (
  key: string,
  nextCursor: string | undefined
): void => {
  pendingOlderCursors.delete(key);
  setSnapshot(key, (current) => ({
    ...current,
    nextCursor: nextCursor ?? null,
    isLoadingOlder: false,
    error: null,
    initialized: true,
  }));
};

export const preserveConversationMessageHistoryOnRefresh = (
  key: string,
  nextCursor: string | undefined
): void => {
  setSnapshot(key, (current) =>
    current.initialized
      ? current
      : {
          nextCursor: nextCursor ?? null,
          isLoadingOlder: false,
          error: null,
          initialized: true,
        }
  );
};

export const loadOlderConversationMessageHistory = (
  key: string,
  load: () => Promise<void>
): Promise<void> => {
  const existing = inFlightLoads.get(key);
  if (existing) return existing;

  const cursor = getConversationMessageHistorySnapshot(key).nextCursor;
  if (!cursor) return Promise.resolve();
  pendingOlderCursors.set(key, cursor);

  setSnapshot(key, (current) => ({
    ...current,
    isLoadingOlder: true,
    error: null,
  }));

  const request = load()
    .catch((cause: unknown) => {
      pendingOlderCursors.delete(key);
      const error = cause instanceof Error ? cause : new Error(String(cause));
      setSnapshot(key, (current) => ({
        ...current,
        isLoadingOlder: false,
        error,
      }));
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
  pendingOlderCursors.clear();
};
