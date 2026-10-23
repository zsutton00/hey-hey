import type { CliReadError, CliReadProviderUsage } from "../../api";
import { providerUsageQueryOptions } from "../collections/providerUsage";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseProviderUsageOptions {
  enabled?: boolean;
  refetchOnMount?: boolean;
}

export interface UseProviderUsageReturn {
  providers: CliReadProviderUsage[] | null;
  typedError: CliReadError | null;
  requestError: Error | null;
  isInitialLoading: boolean;
}

export function useProviderUsage(
  organizationId: string | undefined,
  projectId: string | undefined,
  routingAgentSessionId: string | undefined,
  options: UseProviderUsageOptions = {},
): UseProviderUsageReturn {
  const { enabled = true, refetchOnMount } = options;
  const canRead =
    enabled && !!organizationId && !!projectId && !!routingAgentSessionId;
  const { result: read, state: query } = useDataLayerQuery(
    providerUsageQueryOptions({
      organizationId: organizationId ?? "__noop__",
      projectId: projectId ?? "__noop__",
      routingAgentSessionId: routingAgentSessionId ?? "__noop__",
    }),
    {
      enabled: canRead,
      ...(refetchOnMount ? { refetchOnMount: true } : {}),
    },
  );
  const response = read.data?.response ?? null;
  const providers =
    response?.status === "success" ? response.result.providers : null;

  return {
    providers,
    typedError: response?.status === "error" ? response.error : null,
    requestError: query.error,
    isInitialLoading: canRead && query.isLoading && !providers,
  };
}
