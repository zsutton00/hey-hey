import { gql } from "@apollo/client";
import { CombinedGraphQLErrors } from "@apollo/client/errors";
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
    contentType?: string;
  },
): MockEndpoint => {
  const requests: InternalAxiosRequestConfig[] = [];
  const instance = axios.create({
    baseURL: "/api/v1",
    withCredentials: true,
    adapter: async (config) => {
      requests.push(config);
      const {
        status,
        body,
        contentType = "application/json",
      } = respond(config);
      const response = {
        data: JSON.stringify(body),
        status,
        statusText: "",
        headers: { "content-type": contentType },
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

  it.each(["application/json", "application/graphql-response+json"])(
    "keeps a GraphQL error code on a non-2xx %s response",
    async (contentType) => {
      const { client } = createClient(() => ({
        status: 404,
        body: {
          errors: [
            {
              message: "Work item not found",
              extensions: { code: "NOT_FOUND" },
            },
          ],
        },
        contentType,
      }));

      const error = await client.apollo
        .query({
          query: WORK_ITEM,
          variables: { id: "missing" },
          context: scope,
        })
        .then(
          (result) => result.error,
          (thrown: unknown) => thrown,
        );

      if (contentType === "application/graphql-response+json") {
        expect(CombinedGraphQLErrors.is(error)).toBe(true);
      }

      expect(extractErrorCode(error)).toBe("NOT_FOUND");
    },
  );

  it("fails clearly when a GraphQL operation has no project scope", async () => {
    const { client } = createClient(() => ({
      status: 200,
      body: { data: { workItem: null } },
    }));

    await expect(
      client.apollo.query({ query: WORK_ITEM, variables: { id: "w1" } }),
    ).rejects.toThrow(
      "GraphQL operations require organizationId and projectId in context",
    );
  });
});
