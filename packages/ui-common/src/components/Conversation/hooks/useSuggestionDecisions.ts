import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConversationResponseDto,
  GoalPmRoutingDecisionResponseDto,
  SecondaryActionConfig,
  SuggestionDecisionMetadata,
  SuggestionDecisionResponseDto,
} from "../../../api";

export type SuggestionDecisionStatus = Omit<
  SuggestionDecisionResponseDto,
  "metadata"
> & {
  metadata?: SuggestionDecisionMetadata;
};

export interface SuggestionDecisionState {
  getRoutingDecision: (
    messageId: string,
    fieldId: string
  ) => GoalPmRoutingDecisionResponseDto | undefined;
  upsertRoutingDecision: (decision: GoalPmRoutingDecisionResponseDto) => void;
  decisionsById: Record<string, SuggestionDecisionStatus>;
  getDecision: (
    suggestionId: string | null | undefined
  ) => SuggestionDecisionStatus | undefined;
  upsertDecision: (decision: SuggestionDecisionStatus) => void;
}

type PayloadWithId = {
  id: string;
};

const hasPayloadId = (payload: unknown): payload is PayloadWithId => {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "id" in payload &&
    typeof (payload as { id?: unknown }).id === "string"
  );
};

export const buildSuggestionId = (
  messageId: string | undefined,
  suggestionKey: string | undefined
): string | null => {
  if (!messageId || !suggestionKey) {
    return null;
  }

  return `${messageId}:${suggestionKey}`;
};

type SecondaryActionSuggestionLike = Pick<
  SecondaryActionConfig,
  "id" | "payload"
>;

export const getSecondaryActionSuggestionId = (
  messageId: string | undefined,
  action: SecondaryActionSuggestionLike
): string | null => {
  const payloadId = hasPayloadId(action.payload)
    ? action.payload.id
    : undefined;
  const suggestionKey = payloadId ?? action.id;

  return buildSuggestionId(messageId, suggestionKey);
};

const buildDecisionLookup = (
  decisions: SuggestionDecisionResponseDto[] | undefined
): Record<string, SuggestionDecisionStatus> => {
  if (!decisions || decisions.length === 0) {
    return {};
  }

  return decisions.reduce<Record<string, SuggestionDecisionStatus>>(
    (acc, decision) => {
      acc[decision.id] = decision;
      return acc;
    },
    {}
  );
};

export const useSuggestionDecisions = (
  conversation: ConversationResponseDto | null | undefined
): SuggestionDecisionState => {
  const [recordedRoutingDecisions, setRecordedRoutingDecisions] = useState<
    GoalPmRoutingDecisionResponseDto[]
  >([]);
  const routingDecisions = [
    ...(conversation?.goalPmRoutingDecisions ?? []),
    ...recordedRoutingDecisions,
  ].filter((decision) => decision.sourceConversationId === conversation?.id);
  const getRoutingDecision = (messageId: string, fieldId: string) =>
    routingDecisions.find(
      (decision) =>
        decision.sourceMessageId === messageId &&
        decision.uiElementId === fieldId
    );
  const upsertRoutingDecision = (decision: GoalPmRoutingDecisionResponseDto) =>
    setRecordedRoutingDecisions((previous) => [
      ...previous.filter(
        (item) =>
          !(
            item.sourceConversationId === decision.sourceConversationId &&
            item.sourceMessageId === decision.sourceMessageId &&
            item.uiElementId === decision.uiElementId
          )
      ),
      decision,
    ]);
  const [optimisticDecisions, setOptimisticDecisions] = useState<
    Record<string, SuggestionDecisionStatus>
  >({});

  useEffect(() => {
    setOptimisticDecisions({});
  }, [conversation?.id]);

  const conversationDecisions = useMemo(
    () => buildDecisionLookup(conversation?.suggestionDecisions),
    [conversation?.suggestionDecisions]
  );

  const decisionsById = useMemo(() => {
    const merged: Record<string, SuggestionDecisionStatus> = {
      ...optimisticDecisions,
    };

    Object.entries(conversationDecisions).forEach(([id, decision]) => {
      merged[id] = decision;
    });

    return merged;
  }, [conversationDecisions, optimisticDecisions]);

  const upsertDecision = useCallback((decision: SuggestionDecisionStatus) => {
    setOptimisticDecisions((prev) => ({
      ...prev,
      [decision.id]: decision,
    }));
  }, []);

  const getDecision = useCallback(
    (suggestionId: string | null | undefined) => {
      if (!suggestionId) {
        return undefined;
      }

      return decisionsById[suggestionId];
    },
    [decisionsById]
  );

  return {
    getRoutingDecision,
    upsertRoutingDecision,
    decisionsById,
    getDecision,
    upsertDecision,
  };
};
