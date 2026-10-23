import { useAtomValue } from "jotai";
import type { ConversationPhase } from "../../api";
import {
  conversationPhaseByIdAtom,
  type ConversationPhaseMap,
} from "../websockets/conversationPhase";

export interface UseConversationPhaseReturn {
  phase: ConversationPhase | undefined;
  revision: number | undefined;
  transitionedAt: string | undefined;
}

export const useConversationPhase = (
  conversationId: string | undefined,
): UseConversationPhaseReturn => {
  const phaseById = useAtomValue(conversationPhaseByIdAtom);
  const value = conversationId ? phaseById[conversationId] : undefined;

  return {
    phase: value?.phase,
    revision: value?.revision,
    transitionedAt: value?.transitionedAt,
  };
};

export const useConversationPhases = (
  conversationIds: readonly string[],
): ConversationPhaseMap => {
  const phaseById = useAtomValue(conversationPhaseByIdAtom);
  const ids = new Set(conversationIds);
  return Object.fromEntries(
    Object.entries(phaseById).filter(([conversationId]) =>
      ids.has(conversationId),
    ),
  );
};
