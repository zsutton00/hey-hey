import { ApolloProvider } from "@apollo/client/react";
import { useMemo, type PropsWithChildren } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { getRuntimeAxios } from "../../clients/serviceClients";
import { WebUiGraphQLClient } from "./client";

export function GraphQLProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const userId = user?.id;
  const client = useMemo(
    () => new WebUiGraphQLClient(getRuntimeAxios),
    [userId],
  );
  return <ApolloProvider client={client.apollo}>{children}</ApolloProvider>;
}
