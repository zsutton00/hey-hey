import { queryOptions } from "@tanstack/react-query";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

/** Keyed by the signed-in user so a different sign-in never reuses an answer. */
export const platformAdminAccessKeys = {
  root: () => ["platformAdminAccess"] as const,
  user: (userId: string) =>
    [...platformAdminAccessKeys.root(), userId] as const,
};

/**
 * Whether the signed-in user is a platform admin, as decided by the server's
 * ADMIN_USER_IDS allowlist — the same decision every admin endpoint enforces.
 */
export function platformAdminAccessQueryOptions(userId: string) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: platformAdminAccessKeys.user(userId),
    queryFn: async ({ signal }): Promise<boolean> => {
      const response = await unifiedApiClient.getPlatformAdminAccess({
        ...captureRequestOptions(),
        signal,
      });
      const access = response.data?.data;
      if (!access) {
        throw new Error("The platform admin access response was incomplete.");
      }
      return access.isPlatformAdmin;
    },
  });
}
