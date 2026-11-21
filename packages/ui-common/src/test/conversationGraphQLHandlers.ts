import { http, HttpResponse } from "msw";
import {
  answerConversationOperation,
  type FakeMessage,
} from "./conversationGraphQLAnswers";

/**
 * MSW handlers for the GraphQL endpoint that serve one conversation's thread.
 * Pass a function so a test can change the thread between reads.
 */
export const conversationThreadHandlers = (
  thread: FakeMessage[] | (() => FakeMessage[]),
  /** Pretend older messages exist before the newest page. */
  olderCursor?: string,
) => [
  http.post("*/graphql", async ({ request }) => {
    const { operationName, variables = {} } = (await request.json()) as {
      operationName: string;
      variables?: Record<string, unknown>;
    };
    const { status, body } = answerConversationOperation(
      {
        thread: typeof thread === "function" ? thread() : thread,
        conversations: [],
        olderCursor,
      },
      operationName,
      variables,
    );

    return HttpResponse.json(body, { status });
  }),
];
