import { useUserIdentity } from "../../hooks/useUserIdentity";
import { platformAdminAccessQueryOptions } from "../collections/platformAdminAccess";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UsePlatformAdminAccessReturn {
  /** True only once the server has confirmed the signed-in user is an admin. */
  isPlatformAdmin: boolean;
  /**
   * True once the answer is known: the server responded, the read failed, or
   * nobody is signed in. Gates must wait for this before turning anyone away.
   */
  isResolved: boolean;
}

export function usePlatformAdminAccess(): UsePlatformAdminAccessReturn {
  const userId = useUserIdentity()?.userId ?? "";
  const enabled = userId !== "";
  const { result } = useDataLayerQuery(
    platformAdminAccessQueryOptions(userId),
    { enabled },
  );

  return {
    isPlatformAdmin: enabled && result.data === true,
    isResolved: !enabled || !result.isPending,
  };
}
