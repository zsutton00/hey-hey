import { useApolloClient } from "@apollo/client/react";
import { useCallback } from "react";
import { refreshConversation } from "../graphql/conversationCache";

export function useInvalidateConversation(): (conversationId: string) => void {
  const graphqlClient = useApolloClient();

  return useCallback(
    (conversationId: string) => {
      void refreshConversation(graphqlClient, conversationId);
    },
    [graphqlClient],
  );
}
