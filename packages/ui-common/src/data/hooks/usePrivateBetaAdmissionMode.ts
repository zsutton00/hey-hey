import { useQueryClient } from "@tanstack/react-query";
import type {
  PrivateBetaSelfServiceAdmissionMode,
  PrivateBetaSelfServiceAdmissionModeDto,
  PrivateBetaSelfServiceAdmissionModeUpdateResultDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import {
  privateBetaAdmissionModeQueryOptions,
  privateBetaAdmissionModeKeys,
} from "../collections/privateBetaAdmissionMode";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useMutation, type MutationResult } from "../core/useMutation";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
export interface UsePrivateBetaAdmissionModeReturn
  extends DataHookReturn<PrivateBetaSelfServiceAdmissionModeDto> {
  update: MutationResult<
    PrivateBetaSelfServiceAdmissionMode,
    PrivateBetaSelfServiceAdmissionModeUpdateResultDto
  >;
}

export function usePrivateBetaAdmissionMode(
  options: CollectionHookOptions<PrivateBetaSelfServiceAdmissionModeDto> = {}
): UsePrivateBetaAdmissionModeReturn {
  const queryClient = useQueryClient();
  const { result, state } = useDataLayerQuery(
    privateBetaAdmissionModeQueryOptions(),
    { ...options, enabled: options.enabled !== false }
  );
  const data = result.data ?? null;
  const update = useMutation(
    async (mode: PrivateBetaSelfServiceAdmissionMode) => {
      const response =
        await unifiedApiClient.updatePrivateBetaSelfServiceAdmissionMode({
          updatePrivateBetaSelfServiceAdmissionModeDto: { mode },
        });
      const result = response.data?.data;
      if (!result) {
        throw new Error(
          "The private-beta admission mode update was incomplete."
        );
      }
      void invalidateWithFollowUpRead(queryClient, {
        queryKey: privateBetaAdmissionModeKeys.current(),
        exact: true,
      });
      // The PUT result is the authoritative durable transition. A transient
      // follow-up read must not turn that successful operator action into a
      // reported mutation failure (especially when resuming admissions).

      return result;
    }
  );

  return { ...state, data, isReady: state.isReady && data !== null, update };
}
