import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { invalidateConversation } from "../collections/conversations";

export function useInvalidateConversation(): (conversationId: string) => void {
  const queryClient = useQueryClient();

  return useCallback(
    (conversationId: string) => {
      void invalidateConversation(queryClient, conversationId);
    },
    [queryClient]
  );
}
