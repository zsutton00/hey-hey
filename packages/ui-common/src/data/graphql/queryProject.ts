import type {
  ApolloClient,
  OperationVariables,
  TypedDocumentNode,
} from "@apollo/client";
import { getProjectGraphQLClient, type GraphQLProjectScope } from "./client";

/** An authoritative one-off read for an operation that needs the current server value. */
export async function queryProject<
  TData,
  TVariables extends OperationVariables,
>(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  query: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
  fetchPolicy: "network-only" | "no-cache" = "network-only",
): Promise<TData | undefined> {
  const { data } = await getProjectGraphQLClient(client, scope).query({
    query,
    variables,
    context: scope,
    fetchPolicy,
  });
  return data;
}
