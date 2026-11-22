import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  gql,
  makeVar,
  type FieldPolicy,
  type TypePolicies,
} from "@apollo/client";
import { ErrorLink } from "@apollo/client/link/error";
import { HttpLink } from "@apollo/client/link/http";
import { ServerError } from "@apollo/client/errors";
import { extractErrorCode } from "../../utils/errorUtils";
import chunk from "lodash/chunk.js";
import { forkJoin, map, Observable, tap } from "rxjs";
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

/**
 * A read of the server replaces what the cache held for these fields: a
 * refetched list, hierarchy or part of a work item is the server's current
 * answer, so members it no longer returns are gone.
 */
const replacedByRead: FieldPolicy = {
  merge: (_existing, incoming) => incoming,
};

const typePolicies: TypePolicies = {
  ...Object.fromEntries(
    NORMALIZED_TYPES.map((typename) => [typename, { keyFields: ["id"] }]),
  ),
  Query: {
    fields: {
      workItems: replacedByRead,
      workItemHierarchy: replacedByRead,
      allWorkItemReferences: replacedByRead,
      workItemReferences: replacedByRead,
    },
  },
  WorkItem: {
    keyFields: ["id"],
    fields: {
      sections: replacedByRead,
      edges: replacedByRead,
      serviceRelations: replacedByRead,
      trackedEntities: replacedByRead,
      trackedWorkSummary: { merge: true },
      childCounts: { merge: true },
      graph: replacedByRead,
    },
  },
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

// The workItems filter accepts at most 200 IDs per request. Activity can link
// more items, so split the network reads while retaining one watched result.
const ACTIVITY_WORK_ITEM_BATCH_SIZE = 200;

const batchActivityWorkItemReads = new ApolloLink((operation, forward) => {
  const { ids } = operation.variables;
  if (
    operation.operationName !== "GetActivityWorkItems" ||
    !Array.isArray(ids) ||
    ids.length <= ACTIVITY_WORK_ITEM_BATCH_SIZE
  ) {
    return forward(operation);
  }

  const reads = chunk(ids, ACTIVITY_WORK_ITEM_BATCH_SIZE).map((batch) =>
    forward({
      ...operation,
      variables: { ids: batch },
      client: operation.client,
      getContext: operation.getContext,
      setContext: operation.setContext,
    }),
  );
  return forkJoin(reads).pipe(
    map((results) => {
      const errors = results.flatMap((result) => result.errors ?? []);
      if (errors.length) {
        return { errors };
      }

      return {
        data: {
          workItems: results.flatMap((result) => result.data?.workItems ?? []),
        },
      };
    }),
  );
});

// All transcript surfaces on a project client observe the same server refusal.
const deniedByCache = new WeakMap<
  ApolloClient["cache"],
  ReturnType<typeof makeVar<ReadonlySet<string>>>
>();

export function deniedConversations(cache: ApolloClient["cache"]) {
  let denied = deniedByCache.get(cache);
  if (!denied) {
    denied = makeVar<ReadonlySet<string>>(new Set());
    deniedByCache.set(cache, denied);
  }
  return denied;
}

const messageConversation = gql`
  fragment CachedMessageConversation on Message {
    conversationId
  }
`;

export function recordConversationDenial(
  cache: ApolloClient["cache"],
  id: string,
) {
  const denied = deniedConversations(cache);
  if (!denied().has(id)) {
    denied(new Set([...denied(), id]));
  }
  cache.evict({
    id: cache.identify({ __typename: "Conversation", id }),
    fieldName: "messages",
  });
  cache.evict({
    fieldName: "latestMessage",
    args: { conversationId: id },
  });
  if (cache instanceof InMemoryCache) {
    for (const [key, record] of Object.entries(cache.extract())) {
      if (record?.__typename === "Message" && record.conversationId === id) {
        cache.evict({ id: key });
      }
    }
  }
  cache.gc();
}

function transcriptAccessLink(cache: InMemoryCache) {
  const denied = deniedConversations(cache);
  return new ApolloLink((operation, forward) => {
    const name = operation.operationName;
    let id: unknown;
    if (name === "GetLatestMessage") {
      id = operation.variables.conversationId;
    } else if (name === "GetMessage") {
      const messageId = cache.identify({
        __typename: "Message",
        id: operation.variables.id,
      });
      id = cache.readFragment<{ conversationId: string }>({
        id: messageId,
        fragment: messageConversation,
      })?.conversationId;
    } else if (
      name === "GetConversationMessages" ||
      name === "GetConversationMessageHistory" ||
      name === "ReadConversationThread"
    ) {
      id = operation.variables.id;
    }
    if (typeof id !== "string") {
      return forward(operation);
    }

    const deniedAtStart = denied().has(id);
    return forward(operation).pipe(
      tap({
        error(error: unknown) {
          if (extractErrorCode(error) === "FORBIDDEN") {
            recordConversationDenial(cache, id);
          }
        },
        next(result) {
          if (
            result.errors?.some(
              (error) => error.extensions?.code === "FORBIDDEN",
            )
          ) {
            recordConversationDenial(cache, id);
          } else if (
            deniedAtStart &&
            result.data &&
            !result.errors?.length &&
            denied().has(id)
          ) {
            const allowed = new Set(denied());
            allowed.delete(id);
            denied(allowed);
          }
        },
      }),
    );
  });
}

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
    const cache = new InMemoryCache({ typePolicies });
    return new ApolloClient({
      cache,
      link: ApolloLink.from([
        transcriptAccessLink(cache),
        keepStableErrorCode,
        batchActivityWorkItemReads,
        new HttpLink({
          uri: projectGraphQLPath,
          fetch: createAxiosFetch(this.getAxios),
        }),
      ]),
    });
  }
}
