import { useMemo } from "react";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import {
  servicesQueryOptions,
  type ServiceStatus,
} from "../collections/services";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import type { ServiceDto } from "../../api";

export interface UseServicesOptions extends CollectionHookOptions<ServiceDto> {
  projectId?: string;
  status?: ServiceStatus;
}

export interface UseServicesReturn
  extends DataCollectionHookReturn<ServiceDto> {
  services: ServiceDto[];
}

const DISABLED_SCOPE = "__noop__";
const NO_SERVICES: ServiceDto[] = [];

export function useServices(
  organizationId: string | undefined,
  options: UseServicesOptions = {}
): UseServicesReturn {
  const {
    projectId,
    status,
    enabled = true,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  } = options;

  const isEnabled = enabled && !!organizationId;
  const queryOptions = useMemo(
    () =>
      servicesQueryOptions(organizationId || DISABLED_SCOPE, {
        projectId,
        status,
      }),
    [organizationId, projectId, status]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled: isEnabled,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  });

  const services = result.data ?? NO_SERVICES;

  return { ...state, services, data: services };
}
