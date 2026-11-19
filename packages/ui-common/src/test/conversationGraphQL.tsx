import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { DataHooksProvider } from "../data/DataHooksProvider";
import { WebUiGraphQLClient } from "../data/graphql/client";
import {
  answerConversationOperation,
  conversationNode,
  type FakeMessage,
  type GraphQLRequest,
} from "./conversationGraphQLAnswers";

export {
  answerConversationOperation,
  conversationNode,
  messageNode,
  threadOf,
  type FakeMessage,
} from "./conversationGraphQLAnswers";

const CONVERSATION_ID = "conv-1";

/**
 * A server holding one conversation's thread, answering the GraphQL reads the
 * Data Layer makes the way the real endpoint does: ordered threads, `after`
 * deltas, newest-first pages with a continuation, and rejected cursors.
 */
export class FakeConversationServer {
  thread: FakeMessage[];
  readonly conversationsByPath = new Map<string, Record<string, unknown>[]>();
  readonly requests: GraphQLRequest[] = [];
  /** What the conversation list reads answer with. */
  conversations: Record<string, unknown>[] = [conversationNode];
  readonly conversationId = CONVERSATION_ID;
  readonly graphql: WebUiGraphQLClient;
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  constructor(thread: FakeMessage[]) {
    this.thread = [...thread];
    const instance = axios.create({
      adapter: async (config) => this.respond(config),
    });
    this.graphql = new WebUiGraphQLClient(() => instance);
  }

  append(...messages: FakeMessage[]): void {
    this.thread.push(...messages);
  }

  remove(messageId: string): void {
    this.thread = this.thread.filter((message) => message.id !== messageId);
  }

  rename(messageId: string, data: unknown): void {
    this.thread = this.thread.map((message) =>
      message.id === messageId ? { ...message, data } : message,
    );
  }

  /** Operations of one name received so far, with their variables. */
  received(operationName: string): Record<string, unknown>[] {
    return this.requests
      .filter((request) => request.operationName === operationName)
      .map((request) => request.variables);
  }

  wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={createStore()}>
      <QueryClientProvider client={this.queryClient}>
        <DataHooksProvider
          queryClient={this.queryClient}
          graphqlClient={this.graphql}
        >
          {children}
        </DataHooksProvider>
      </QueryClientProvider>
    </Provider>
  );

  private async respond(config: InternalAxiosRequestConfig) {
    const { operationName, variables = {} } = JSON.parse(String(config.data));
    this.requests.push({ operationName, variables });
    const { status, body } = answerConversationOperation(
      {
        thread: this.thread,
        conversations:
          this.conversationsByPath.get(config.url ?? "") ?? this.conversations,
      },
      operationName,
      variables,
    );
    const response = {
      data: JSON.stringify(body),
      status,
      statusText: "",
      headers: { "content-type": "application/json" },
      config,
    };
    if (status >= 400) {
      throw new AxiosError("failed", "ERR_BAD_REQUEST", config, null, response);
    }

    return response;
  }
}
