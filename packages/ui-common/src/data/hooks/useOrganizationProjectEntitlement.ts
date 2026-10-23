import { useCallback, useEffect, useRef, useState } from "react";
import type { OrganizationProjectEntitlementDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";

export interface UseOrganizationProjectEntitlementReturn {
  entitlement: OrganizationProjectEntitlementDto | null;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refetch: () => Promise<OrganizationProjectEntitlementDto | null>;
}

export function useOrganizationProjectEntitlement(
  organizationId: string | undefined,
  options: { enabled?: boolean } = {}
): UseOrganizationProjectEntitlementReturn {
  const [entitlement, setEntitlement] =
    useState<OrganizationProjectEntitlementDto | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refetch = useCallback(async () => {
    if (!organizationId) return null;
    const currentRequest = ++requestId.current;
    setIsFetching(true);
    setError(null);
    try {
      const response =
        await platformClient.getOrganizationProjectEntitlement({
          organizationId,
        });
      const resolved = response.data?.data ?? null;
      if (!resolved) {
        throw new Error("Project entitlement response is missing");
      }
      if (currentRequest === requestId.current) setEntitlement(resolved);
      return resolved;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Unable to load project entitlement";
      if (currentRequest === requestId.current) setError(message);
      throw cause;
    } finally {
      if (currentRequest === requestId.current) setIsFetching(false);
    }
  }, [organizationId]);

  useEffect(() => {
    setEntitlement(null);
    setError(null);
    if (options.enabled !== false && organizationId) {
      void refetch().catch(() => undefined);
    }
  }, [organizationId, options.enabled, refetch]);

  return {
    entitlement,
    isLoading: isFetching && entitlement === null,
    isFetching,
    error,
    refetch,
  };
}
