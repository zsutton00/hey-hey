import type { JsonBodyType } from "msw";
import { MessageStatus } from "../api";

export interface GraphQLRequest {
  operationName: string;
  variables: Record<string, unknown>;
}

const CONVERSATION_ID = "conv-1";

export interface FakeMessage {
  id: string;
  createdAt: string | null;
  status?: string;
  parentMessageId?: string | null;
  data?: unknown;
  /** Further message fields, such as `type` or `proposals`. */
  [field: string]: unknown;
}

export const messageNode = (message: FakeMessage) => ({
  __typename: "Message",
  conversationId: CONVERSATION_ID,
  projectId: "project-1",
  type: "SYSTEM",
  userId: null,
  executionStatus: null,
  executionQueueConfirmed: null,
  executionAdmissionDisposition: null,
  executionCancellationRequested: null,
  executionOperationId: null,
  awaitingResponse: null,
  handler: null,
  user: null,
  proposals: [],
  reports: [],
  ...message,
  status: message.status ?? MessageStatus.Completed,
  parentMessageId: message.parentMessageId ?? null,
  data: message.data ?? { response: message.id },
  parentMessage: null,
  responses: [],
});

export const conversationNode = {
  __typename: "Conversation",
  id: CONVERSATION_ID,
  organizationId: "org-1",
  projectId: "project-1",
  title: "A conversation",
  status: "ACTIVE",
  workflowName: "task_workflow",
  workflowId: null,
  workflowAboutType: null,
  workflowAboutId: null,
  initiatedBy: "USER",
  triggerEvent: null,
  createdBy: null,
  lastModifiedBy: null,
  restricted: false,
  version: 1,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
};

const rejectedCursor = {
  status: 404,
  body: {
    errors: [
      {
        message: "Cursor message not found",
        extensions: { code: "MESSAGE_CURSOR_NOT_FOUND" },
      },
    ],
  },
};

export interface ConversationState {
  thread: FakeMessage[];
  conversations: Record<string, unknown>[];
  /** Report older messages before the newest page, whatever the thread holds. */
  olderCursor?: string;
}

const page = (nodes: FakeMessage[], continuation: string | null) => ({
  __typename: "MessageConnection",
  nodes: nodes.map(messageNode),
  endCursor: nodes.at(-1)?.id ?? null,
  startCursor: continuation,
  hasOlder: continuation !== null,
});

const ok = (data: JsonBodyType) => ({ status: 200, body: { data } });

const conversationWith = (messages: unknown) => ({
  conversation: { ...conversationNode, messages },
});

/** Answers one GraphQL operation the way the endpoint does for this state. */
export function answerConversationOperation(
  { thread, conversations, olderCursor }: ConversationState,
  operationName: string,
  variables: Record<string, unknown>,
): { status: number; body: JsonBodyType } {
  const ids = thread.map((message) => message.id);

  switch (operationName) {
    case "GetConversationMessages": {
      const after = variables.after;
      if (after === undefined || after === null) {
        return ok(conversationWith(page(thread, null)));
      }
      const position = ids.indexOf(String(after));
      if (position < 0) {
        return rejectedCursor;
      }
      const newer = thread.slice(position + 1);

      return ok(
        conversationWith({
          ...page(newer, null),
          endCursor: newer.at(-1)?.id ?? String(after),
        }),
      );
    }
    case "GetConversationMessageHistory": {
      const before = variables.before;
      const end =
        before === undefined || before === null
          ? thread.length
          : ids.indexOf(String(before));
      if (end < 0) {
        return rejectedCursor;
      }
      const start = Math.max(0, end - Number(variables.last));

      return ok(
        conversationWith(
          page(
            thread.slice(start, end),
            start > 0 ? ids[start] : (!before && olderCursor) || null,
          ),
        ),
      );
    }
    case "GetMessage": {
      const found = thread.find((m) => m.id === variables.id);
      if (!found) {
        return {
          status: 404,
          body: { errors: [{ message: "Message not found" }] },
        };
      }
      const position = ids.indexOf(found.id);
      const parent = thread.find((m) => m.id === found.parentMessageId);

      return ok({
        message: {
          ...messageNode(found),
          parentMessage: parent ? messageNode(parent) : null,
          responses: thread
            .slice(position + 1)
            .filter((m) => m.parentMessageId === found.id)
            .map(messageNode),
        },
      });
    }
    case "GetLatestMessage": {
      const latest = thread.filter((m) => m.createdAt !== null).at(-1);

      return ok({ latestMessage: latest ? messageNode(latest) : null });
    }
    case "GetConversation":
      return ok({ conversation: conversationNode });
    case "GetConversations":
    case "GetActiveConversations":
    case "GetWorkflowConversations": {
      const statuses = variables.statuses;
      const nodes = conversations.filter((conversation) =>
        operationName === "GetActiveConversations"
          ? conversation.status !== "COMPLETED"
          : !Array.isArray(statuses) || statuses.includes(conversation.status),
      );
      return ok({ page: { __typename: "ConversationPage", nodes } });
    }
    default:
      return {
        status: 400,
        body: { errors: [{ message: `Unexpected ${operationName}` }] },
      };
  }
}

/** Messages `m1..mN`, one minute apart, oldest first. */
export const threadOf = (count: number): FakeMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 3, 1, 10, index)).toISOString(),
  }));
