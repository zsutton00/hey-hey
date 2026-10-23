import type {
  MessageResponseDto,
  OpenItemsTriagePayload,
  UIElementPayload,
} from "../../api";

function isOpenItemsTriagePayload(
  payload: UIElementPayload | undefined,
): payload is OpenItemsTriagePayload {
  return (
    !!payload &&
    typeof payload === "object" &&
    "summary" in payload &&
    typeof payload.summary === "string" &&
    "suggestions" in payload &&
    Array.isArray(payload.suggestions)
  );
}

/**
 * Expands a review's submitted request ids into every message id a reply may
 * name as its parent: a follow-up's USER row, and for a launching send, the
 * start-run trigger row plus the USER row it carries as `sourceUserMessageId`.
 */
function reviewReplyParents(
  messages: readonly MessageResponseDto[],
  requestMessageIds: readonly string[],
): ReadonlySet<string> {
  const parents = new Set(requestMessageIds);
  for (const message of messages) {
    if (!parents.has(message.id)) continue;
    const trigger = message.data.triggersAgent;
    if (
      trigger &&
      "sourceUserMessageId" in trigger &&
      trigger.sourceUserMessageId
    )
      parents.add(trigger.sourceUserMessageId);
  }
  return parents;
}

/**
 * When the review's own request first appeared in the conversation, or null
 * while none of its requests is present yet. Anything written before this
 * belongs to an earlier or discarded review.
 */
export function openItemsTriageReviewStartedAt(
  messages: readonly MessageResponseDto[],
  requestMessageIds: readonly string[],
): string | null {
  const parents = reviewReplyParents(messages, requestMessageIds);
  let earliest: string | null = null;
  for (const message of messages) {
    if (!parents.has(message.id)) continue;
    if (
      earliest === null ||
      Date.parse(message.createdAt) < Date.parse(earliest)
    )
      earliest = message.createdAt;
  }
  return earliest;
}

/**
 * The feature consumes its structured output, never the agent's execution
 * transcript. When `requestMessageIds` is given (a transient modal review),
 * only replies to those requests count, so older persisted replies in a reused
 * backing conversation and late output from a discarded review never surface.
 */
export function latestOpenItemsTriageResult(
  messages: readonly MessageResponseDto[],
  requestMessageIds?: readonly string[],
) {
  const parents = requestMessageIds
    ? reviewReplyParents(messages, requestMessageIds)
    : null;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.type !== "SYSTEM") continue;
    if (
      parents &&
      (!message.parentMessageId || !parents.has(message.parentMessageId))
    )
      continue;
    for (const element of message.data.uiElements ?? []) {
      if (
        element.type === "open_items_triage" &&
        isOpenItemsTriagePayload(element.payload)
      ) {
        return {
          payload: element.payload,
          scope: `${message.conversationId}:${message.id}:${element.id}`,
        };
      }
    }
  }
  return null;
}
