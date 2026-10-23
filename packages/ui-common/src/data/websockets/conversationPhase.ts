import { atom } from "jotai/vanilla";
import type {
  WebSocketConversationPhaseChangedEvent,
} from "../../api";

export type ConversationPhaseValue = Pick<
  WebSocketConversationPhaseChangedEvent,
  "phase" | "revision" | "transitionedAt"
>;

export type ConversationPhaseMap = Readonly<
  Record<string, ConversationPhaseValue>
>;

export const conversationPhaseByIdAtom = atom<ConversationPhaseMap>({});

/** Apply a phase observation only when it is newer than the cached value. */
export const setConversationPhaseIfNewer = (
  current: ConversationPhaseMap,
  conversationId: string,
  incoming: ConversationPhaseValue,
): ConversationPhaseMap => {
  const existing = current[conversationId];
  if (existing && existing.revision >= incoming.revision) {
    return current;
  }

  return {
    ...current,
    [conversationId]: {
      phase: incoming.phase,
      revision: incoming.revision,
      transitionedAt: incoming.transitionedAt,
    },
  };
};

export const applyConversationPhaseEntries = (
  current: ConversationPhaseMap,
  entries: readonly WebSocketConversationPhaseChangedEvent[],
): ConversationPhaseMap =>
  entries.reduce(
    (next, entry) =>
      setConversationPhaseIfNewer(next, entry.conversationId, entry),
    current,
  );

export const removeConversationPhases = (
  current: ConversationPhaseMap,
  conversationIds: ReadonlySet<string>,
): ConversationPhaseMap => {
  if (conversationIds.size === 0) return current;

  const next = Object.fromEntries(
    Object.entries(current).filter(
      ([conversationId]) => !conversationIds.has(conversationId),
    ),
  );

  return Object.keys(next).length === Object.keys(current).length
    ? current
    : next;
};
