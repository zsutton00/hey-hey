import { useMutation } from "../core/useMutation";
import { openItemsClient } from "../../clients/serviceClients";
import type { OpenItemsTriageSession } from "../../api";

/** Resolves durable session/conversation identities without collection writes. */
export function useOpenItemsTriageSession() {
  return useMutation(
    async (scope: {
      organizationId: string;
      projectId: string;
    }): Promise<OpenItemsTriageSession> => {
      const result = (
        await openItemsClient.resolveOpenItemsTriageSession(scope)
      ).data.data;
      if (!result) throw new Error("Triage session is unavailable.");
      return result;
    },
  );
}
