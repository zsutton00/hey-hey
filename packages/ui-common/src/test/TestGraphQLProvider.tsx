import { ApolloProvider } from "@apollo/client/react";
import type { ApolloClient } from "@apollo/client";
import axios from "axios";
import { useMemo, type PropsWithChildren } from "react";
import { WebUiGraphQLClient } from "../data/graphql/client";

/** A GraphQL client whose network is MSW, for tests that must share it. */
export const createTestGraphQLClient = (): ApolloClient =>
  new WebUiGraphQLClient(() =>
    axios.create({ baseURL: "http://localhost:3000/api/v1" }),
  ).apollo;

/**
 * Gives a rendered tree the Apollo client the real app gets from
 * GraphQLProvider. Pass `client` when the test also drives that client itself.
 */
export function TestGraphQLProvider({
  client,
  children,
}: PropsWithChildren<{ client?: ApolloClient }>) {
  const provided = useMemo(() => client ?? createTestGraphQLClient(), [client]);

  return <ApolloProvider client={provided}>{children}</ApolloProvider>;
}
