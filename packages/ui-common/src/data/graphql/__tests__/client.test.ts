import { gql } from "@apollo/client";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it } from "vitest";

import { extractErrorCode } from "../../../utils/errorUtils";
import { WebUiGraphQLClient } from "../client";

const scope = { organizationId: "org-1", projectId: "project-1" };

const WORK_ITEM = gql`
  query WorkItem($id: ID!) {
    workItem(id: $id) {
      __typename
      id
      name
    }
  }
`;

const WORK_ITEMS = gql`
  query WorkItems {
    workItems {
      __typename
      id
      name
    }
  }
`;

interface MockEndpoint {
  client: WebUiGraphQLClient;
  requests: InternalAxiosRequestConfig[];
}

/** Fakes the network: an axios instance with credentials and a canned server. */
const createClient = (
  respond: (config: InternalAxiosRequestConfig) => {
    status: number;
    body: unknown;
  },
): MockEndpoint => {
  const requests: InternalAxiosRequestConfig[] = [];
  const instance = axios.create({
    baseURL: "/api/v1",
    withCredentials: true,
    adapter: async (config) => {
      requests.push(config);
      const { status, body } = respond(config);
      const response = {
        data: JSON.stringify(body),
        status,
        statusText: "",
        headers: {},
        config,
      };
      if (status >= 400) {
        throw new AxiosError(
          "failed",
          "ERR_BAD_REQUEST",
          config,
          null,
          response,
        );
      }

      return response;
    },
  });

  return { client: new WebUiGraphQLClient(() => instance), requests };
};

describe("WebUiGraphQLClient", () => {
  it("stores a work item once, however many queries return it", async () => {
    const { client, requests } = createClient((config) => {
      const { operationName } = JSON.parse(config.data as string);
      const item = { __typename: "WorkItem", id: "w1", name: "Ship it" };

      return {
        status: 200,
        body: {
          data:
            operationName === "WorkItem"
              ? { workItem: item }
              : { workItems: [item] },
        },
      };
    });

    await client.apollo.query({
      query: WORK_ITEM,
      variables: { id: "w1" },
      context: scope,
    });
    await client.apollo.query({ query: WORK_ITEMS, context: scope });

    const workItemRecords = Object.keys(client.apollo.cache.extract()).filter(
      (key) => key.startsWith("WorkItem:"),
    );
    expect(workItemRecords).toHaveLength(1);
    expect(requests[0].url).toBe(
      "/organizations/org-1/projects/project-1/graphql",
    );
  });

  it("sends requests through the shared axios instance with its credentials", async () => {
    const { client, requests } = createClient(() => ({
      status: 200,
      body: {
        data: { workItem: { __typename: "WorkItem", id: "w1", name: "A" } },
      },
    }));

    await client.apollo.query({
      query: WORK_ITEM,
      variables: { id: "w1" },
      context: scope,
    });

    expect(requests[0].withCredentials).toBe(true);
    expect(requests[0].baseURL).toBe("/api/v1");
  });

  it("gives the same error code for a GraphQL error as for a REST error", async () => {
    const { client } = createClient(() => ({
      status: 200,
      body: {
        errors: [
          { message: "No CLI", extensions: { code: "NO_CLI_CONNECTION" } },
        ],
      },
    }));

    const graphqlError = await client.apollo
      .query({ query: WORK_ITEM, variables: { id: "w1" }, context: scope })
      .then(
        (result) => result.error,
        (error: unknown) => error,
      );
    const restError = { response: { data: { code: "NO_CLI_CONNECTION" } } };

    expect(extractErrorCode(graphqlError)).toBe("NO_CLI_CONNECTION");
    expect(extractErrorCode(graphqlError)).toBe(extractErrorCode(restError));
  });

  it("keeps the REST error code when the endpoint rejects the request", async () => {
    const { client } = createClient(() => ({
      status: 403,
      body: { success: false, code: "FORBIDDEN_PROJECT", message: "no" },
    }));

    const error = await client.apollo
      .query({ query: WORK_ITEM, variables: { id: "w1" }, context: scope })
      .then(
        (result) => result.error,
        (thrown: unknown) => thrown,
      );

    expect(extractErrorCode(error)).toBe("FORBIDDEN_PROJECT");
  });
});
