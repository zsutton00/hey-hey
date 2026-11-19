import type {
  ConversationResponseDto,
  MessageRecordDto,
  MessageResponseDto,
} from "../../api";
import type {
  ConversationFieldsFragment,
  GetMessageQuery,
  MessageFieldsFragment,
} from "../../graphql/generated/graphql";

/**
 * GraphQL answers a field REST leaves out with `null`. REST records omit it,
 * so absent fields are dropped, except the ones REST itself reports as null.
 */
const withoutAbsentFields = (
  node: object,
  nullableByContract: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(node).filter(
      ([field, value]) => value !== null || nullableByContract.includes(field),
    ),
  );

/**
 * The GraphQL schema is derived from the REST DTOs: field names and JSON
 * payloads match, and ids and enums are string-valued. These mappers are the
 * one place a GraphQL node becomes the REST-shaped record the hooks return.
 */
export const toConversationResponse = (
  node: ConversationFieldsFragment & {
    suggestionDecisions?: unknown[] | null;
    goalPmRoutingDecisions?: unknown[] | null;
  },
): ConversationResponseDto =>
  withoutAbsentFields(node, [
    "createdBy",
  ]) as unknown as ConversationResponseDto;

type MessageNode = MessageFieldsFragment & {
  proposals?: unknown[] | null;
  reports?: unknown[] | null;
};

type MessageDetailNode = NonNullable<GetMessageQuery["message"]>;

export const toMessageResponse = (node: MessageNode): MessageResponseDto =>
  withoutAbsentFields(node, ["createdAt"]) as unknown as MessageResponseDto;

/** A message with the replies and parent the single-message read returns. */
export const toMessageDetail = (node: MessageDetailNode): MessageRecordDto => {
  const { parentMessage, responses, ...message } = node;

  return {
    ...toMessageResponse(message),
    responses: (responses ?? []).map(toMessageResponse),
    ...(parentMessage
      ? { parentMessage: toMessageResponse(parentMessage) }
      : {}),
  } as MessageRecordDto;
};

export const toMessageRecord = (node: MessageNode): MessageRecordDto =>
  toMessageResponse(node);
