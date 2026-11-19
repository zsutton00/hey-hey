import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { DataHooksProvider } from "../data/DataHooksProvider";
import { WebUiGraphQLClient } from "../data/graphql/client";

import type { GraphQLRequest } from "./conversationGraphQLAnswers";
import {
  answerWorkItemOperation,
  type FakeWorkItem,
} from "./workItemGraphQLAnswers";

export type { FakeWorkItem } from "./workItemGraphQLAnswers";

/**
 * A server holding a project's work items, answering the GraphQL reads the
 * Data Layer makes. Tests change the items it holds, then deliver the event
 * the real server would send, and assert what every mounted view shows.
 */
export class FakeWorkItemServer {
  items: FakeWorkItem[];
  readonly requests: GraphQLRequest[] = [];
  /** When set, only this project holds the items; others answer not found. */
  onlyProject: string | null = null;
  /** Operations the server refuses with a 403. */
  readonly refused = new Set<string>();
  readonly graphql: WebUiGraphQLClient;
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  constructor(items: FakeWorkItem[]) {
    this.items = [...items];
    const instance = axios.create({
      adapter: async (config) => this.respond(config),
    });
    this.graphql = new WebUiGraphQLClient(() => instance);
  }

  update(id: string, patch: Partial<FakeWorkItem>): void {
    this.items = this.items.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
  }

  add(item: FakeWorkItem): void {
    this.items.push(item);
  }

  remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
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
    const projectId = String(config.url).split("/projects/")[1]?.split("/")[0];
    const heldElsewhere =
      operationName === "GetWorkItem" &&
      this.onlyProject !== null &&
      projectId !== this.onlyProject;
    const { status, body } = heldElsewhere
      ? answerWorkItemOperation([], operationName, variables)
      : this.refused.has(operationName)
        ? {
            status: 403,
            body: { errors: [{ message: "Forbidden" }] },
          }
        : answerWorkItemOperation(this.items, operationName, variables);
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
