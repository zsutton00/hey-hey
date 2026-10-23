import { useCallback, useMemo } from "react";
import type {
  PrivateBetaDisclosureAcceptanceInputDto,
  PrivateBetaDisclosureAcceptanceResponseDto,
  PrivateBetaDisclosureStatusDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { privateBetaDisclosureQueryOptions } from "../collections/privateBetaDisclosure";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UsePrivateBetaDisclosureReturn
  extends DataHookReturn<PrivateBetaDisclosureStatusDto> {
  submitAcceptance: (
    input: PrivateBetaDisclosureAcceptanceInputDto
  ) => Promise<PrivateBetaDisclosureAcceptanceResponseDto>;
}

export function usePrivateBetaDisclosure(
  options: CollectionHookOptions<PrivateBetaDisclosureStatusDto> = {}
): UsePrivateBetaDisclosureReturn {
  const queryOptions = useMemo(() => privateBetaDisclosureQueryOptions(), []);
  const { result, state: query } = useDataLayerQuery(queryOptions, {
    enabled: options.enabled ?? true,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
    maxCacheAgeMs: options.maxCacheAgeMs,
  });

  const data = result.data ?? null;
  const { markStale } = query;

  const submitAcceptance = useCallback(
    async (
      input: PrivateBetaDisclosureAcceptanceInputDto
    ): Promise<PrivateBetaDisclosureAcceptanceResponseDto> => {
      const response =
        await unifiedApiClient.submitPrivateBetaDisclosureAcceptance({
          privateBetaDisclosureAcceptanceInputDto: input,
        });
      const result = response.data?.data;
      if (!result) {
        throw new Error(
          "The private-beta disclosure acceptance response was incomplete."
        );
      }
      markStale();
      return result;
    },
    [markStale]
  );

  return {
    ...query,
    data,
    isReady: query.isReady && data !== null,
    submitAcceptance,
  };
}
