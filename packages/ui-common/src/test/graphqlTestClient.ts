import type { ApolloClient } from "@apollo/client";
import axios from "axios";
import { WebUiGraphQLClient } from "../data/graphql/client";

/** A GraphQL client for tests that never expect to reach the network. */
export const createUnreachableGraphQLClient = (): ApolloClient =>
  new WebUiGraphQLClient(() =>
    axios.create({
      adapter: async () => {
        throw new Error("Unexpected GraphQL request");
      },
    }),
  ).apollo;
