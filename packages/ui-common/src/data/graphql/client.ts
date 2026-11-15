import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  type TypePolicies,
} from "@apollo/client";
import { ErrorLink } from "@apollo/client/link/error";
import { HttpLink } from "@apollo/client/link/http";
import { ServerError } from "@apollo/client/errors";
import { Observable } from "rxjs";
import axios, { type AxiosInstance, type AxiosResponse } from "axios";

/** Project that scopes a GraphQL operation; pass it as the operation context. */
export interface GraphQLProjectScope {
  organizationId: string;
  projectId: string;
}

/** A failed GraphQL request that still exposes the REST stable error code. */
export class GraphQLRequestError extends Error {
  readonly extensions: { code?: string };

  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "GraphQLRequestError";
    this.extensions = { code };
  }
}

const NORMALIZED_TYPES = ["WorkItem", "Conversation", "Message"] as const;

const typePolicies: TypePolicies = Object.fromEntries(
  NORMALIZED_TYPES.map((typename) => [typename, { keyFields: ["id"] }]),
);

const projectGraphQLPath = (operation: ApolloLink.Operation): string => {
  const { organizationId, projectId } =
    operation.getContext() as GraphQLProjectScope;

  return `/organizations/${organizationId}/projects/${projectId}/graphql`;
};

/**
 * Sends GraphQL over the REST axios instance so requests carry the same
 * credentials, token refresh and headers as every REST call.
 */
const createAxiosFetch = (getAxios: () => AxiosInstance): typeof fetch => {
  return async (input, init) => {
    const response = await sendThroughAxios(getAxios(), String(input), init);

    return new Response(response.data, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
};

/** Error statuses still carry a REST envelope body, so they are returned. */
const sendThroughAxios = async (
  axiosInstance: AxiosInstance,
  url: string,
  init: RequestInit | undefined,
): Promise<AxiosResponse<string>> => {
  try {
    return await axiosInstance.request<string>({
      url,
      method: init?.method ?? "POST",
      data: init?.body,
      headers: init?.headers as Record<string, string>,
      signal: init?.signal ?? undefined,
      responseType: "text",
      transformResponse: (body: string) => body,
    });
  } catch (error) {
    if (axios.isAxiosError<string>(error) && error.response) {
      return error.response;
    }

    throw error;
  }
};

interface RestErrorEnvelope {
  code?: string;
  message?: string;
}

/** The body is only a REST envelope when it parses; proxies may send HTML. */
const parseRestEnvelope = (bodyText: string): RestErrorEnvelope | undefined => {
  try {
    return JSON.parse(bodyText) as RestErrorEnvelope;
  } catch {
    return undefined;
  }
};

/**
 * Non-2xx responses carry the REST error envelope; surface its stable `code`
 * as `extensions.code`, the same place GraphQL errors put it.
 */
const keepStableErrorCode = new ErrorLink(({ error }) => {
  if (!ServerError.is(error)) {
    return;
  }

  const envelope = parseRestEnvelope(error.bodyText);
  if (!envelope) {
    return;
  }

  return new Observable((subscriber) => {
    subscriber.error(
      new GraphQLRequestError(envelope.message ?? error.message, envelope.code),
    );
  });
});

/**
 * Owns the Apollo client that holds work items, conversations and messages,
 * each stored once by `__typename` and `id`.
 */
export class WebUiGraphQLClient {
  readonly apollo: ApolloClient;

  constructor(getAxios: () => AxiosInstance) {
    this.apollo = new ApolloClient({
      cache: new InMemoryCache({ typePolicies }),
      link: ApolloLink.from([
        keepStableErrorCode,
        new HttpLink({
          uri: projectGraphQLPath,
          fetch: createAxiosFetch(getAxios),
        }),
      ]),
    });
  }
}
