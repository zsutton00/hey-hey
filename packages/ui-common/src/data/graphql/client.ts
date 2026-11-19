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
import { conversationMessagesFieldPolicy } from "./conversationMessagesPolicy";
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

const typePolicies: TypePolicies = {
  ...Object.fromEntries(
    NORMALIZED_TYPES.map((typename) => [typename, { keyFields: ["id"] }]),
  ),
  Conversation: {
    keyFields: ["id"],
    fields: { messages: conversationMessagesFieldPolicy },
  },
};

const projectGraphQLPath = (operation: ApolloLink.Operation): string => {
  const { organizationId, projectId } = operation.getContext();

  if (
    typeof organizationId !== "string" ||
    organizationId.length === 0 ||
    typeof projectId !== "string" ||
    projectId.length === 0
  ) {
    throw new Error(
      "GraphQL operations require organizationId and projectId in context",
    );
  }

  return `/organizations/${organizationId}/projects/${projectId}/graphql`;
};

/**
 * Sends GraphQL over the REST axios instance so requests carry the same
 * credentials, token refresh and headers as every REST call.
 */
const createAxiosFetch = (getAxios: () => AxiosInstance): typeof fetch => {
  return async (input, init) => {
    const response = await sendThroughAxios(getAxios(), String(input), init);
    const responseContentType = response.headers["content-type"];

    return new Response(response.data, {
      status: response.status,
      headers: {
        "content-type":
          typeof responseContentType === "string"
            ? responseContentType
            : "application/json",
      },
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

interface ErrorResponseEnvelope {
  code?: string;
  message?: string;
  errors?: Array<{
    extensions?: { code?: string };
    message?: string;
  }>;
}

/** Error response bodies should be JSON; proxies may still send HTML. */
const parseErrorEnvelope = (
  bodyText: string,
): ErrorResponseEnvelope | undefined => {
  try {
    return JSON.parse(bodyText) as ErrorResponseEnvelope;
  } catch {
    return undefined;
  }
};

/**
 * Apollo reports non-2xx `application/json` responses as ServerErrors without
 * parsing their body. Recover stable codes from either the REST envelope or
 * GraphQL errors and expose them in the same `extensions.code` location.
 */
const keepStableErrorCode = new ErrorLink(({ error }) => {
  if (!ServerError.is(error)) {
    return;
  }

  const envelope = parseErrorEnvelope(error.bodyText);
  if (!envelope) {
    return;
  }

  const graphQLError = envelope.errors?.find(
    (candidate) => typeof candidate.extensions?.code === "string",
  );
  const code = graphQLError?.extensions?.code ?? envelope.code;

  if (!code) {
    return;
  }

  return new Observable((subscriber) => {
    subscriber.error(
      new GraphQLRequestError(
        graphQLError?.message ?? envelope.message ?? error.message,
        code,
      ),
    );
  });
});

const projectClients = new WeakMap<ApolloClient, WebUiGraphQLClient>();

export function getProjectGraphQLClient(
  client: ApolloClient,
  scope: GraphQLProjectScope,
): ApolloClient {
  return projectClients.get(client)?.forProject(scope) ?? client;
}

export function getGraphQLClients(
  client: ApolloClient,
): Iterable<ApolloClient> {
  return projectClients.get(client)?.scopedClients() ?? [client];
}

/**
 * Owns the Apollo clients for one authenticated user that holds work items, conversations and messages,
 * each stored once per project by `__typename` and `id`.
 */
export class WebUiGraphQLClient {
  readonly apollo: ApolloClient;

  private readonly clients = new Map<string, ApolloClient>();

  constructor(private readonly getAxios: () => AxiosInstance) {
    this.apollo = this.createClient();
    projectClients.set(this.apollo, this);
  }

  forProject({ organizationId, projectId }: GraphQLProjectScope): ApolloClient {
    const key = JSON.stringify([organizationId, projectId]);
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }

    const client = this.createClient();
    this.clients.set(key, client);
    return client;
  }

  scopedClients(): Iterable<ApolloClient> {
    return this.clients.values();
  }

  private createClient(): ApolloClient {
    return new ApolloClient({
      cache: new InMemoryCache({ typePolicies }),
      link: ApolloLink.from([
        keepStableErrorCode,
        new HttpLink({
          uri: projectGraphQLPath,
          fetch: createAxiosFetch(this.getAxios),
        }),
      ]),
    });
  }
}
